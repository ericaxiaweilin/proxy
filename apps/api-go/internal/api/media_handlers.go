package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/proxy-app/proxy-api/internal/media"
)

func (s *Server) mediaVariantFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Media == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_configured"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/media/variant/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_route_not_found"})
		return
	}
	path, err := s.Media.ResolveVariantPath(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_variant_not_available"})
		return
	}
	// R36.x WATERMARK-001 viewer-side tracing: asset id + client IP.
	// Media GETs are anonymous by design, so the trail carries no identity.
	log.Printf("media access variant=%s ip=%s", id, clientIP(r, s.TrustCloudflareIP))
	serveMediaPath(w, r, path, "public, max-age=31536000, immutable")
}

// mediaUpload is a narrow authenticated raw-body endpoint. Metadata and state
// transitions remain commands; only the file bytes use this route.
func (s *Server) mediaUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Media == nil || s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "media_upload_unavailable"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/media/upload/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_route_not_found"})
		return
	}
	rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return
	}
	const maxUploadBytes = int64(25 << 20)
	w.Header().Set("Upload-Protocol", "content-range-v1")
	if r.Method == http.MethodHead {
		progress, err := s.Media.UploadOffset(r.Context(), id, authenticated.Principal.ID)
		if err != nil {
			writeMediaUploadError(w, err, 0)
			return
		}
		w.Header().Set("Upload-Offset", strconv.FormatInt(progress.Offset, 10))
		if progress.Total > 0 {
			w.Header().Set("Upload-Length", strconv.FormatInt(progress.Total, 10))
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if contentRange := r.Header.Get("Content-Range"); contentRange != "" {
		start, end, total, parseErr := parseUploadContentRange(contentRange)
		if parseErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_content_range"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, end-start+2)
		progress, uploadErr := s.Media.SaveUploadChunk(r.Context(), id, authenticated.Principal.ID, r.Body, start, end, total, maxUploadBytes, r.Header.Get("X-Chunk-SHA256"))
		w.Header().Set("Upload-Offset", strconv.FormatInt(progress.Offset, 10))
		w.Header().Set("Upload-Length", strconv.FormatInt(total, 10))
		if uploadErr != nil {
			writeMediaUploadError(w, uploadErr, progress.Offset)
			return
		}
		if !progress.Complete {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1)
	if _, err := s.Media.SaveUpload(r.Context(), id, authenticated.Principal.ID, r.Body, maxUploadBytes); err != nil {
		writeMediaUploadError(w, err, 0)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseUploadContentRange(value string) (start, end, total int64, err error) {
	if !strings.HasPrefix(value, "bytes ") {
		return 0, 0, 0, errors.New("range unit")
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes "), "/")
	if len(parts) != 2 {
		return 0, 0, 0, errors.New("range total")
	}
	bounds := strings.Split(parts[0], "-")
	if len(bounds) != 2 {
		return 0, 0, 0, errors.New("range bounds")
	}
	start, err = strconv.ParseInt(bounds[0], 10, 64)
	if err != nil {
		return 0, 0, 0, err
	}
	end, err = strconv.ParseInt(bounds[1], 10, 64)
	if err != nil {
		return 0, 0, 0, err
	}
	total, err = strconv.ParseInt(parts[1], 10, 64)
	if err != nil || start < 0 || end < start || total <= end {
		return 0, 0, 0, errors.New("invalid range")
	}
	return start, end, total, nil
}

func writeMediaUploadError(w http.ResponseWriter, err error, expectedOffset int64) {
	if expectedOffset > 0 {
		w.Header().Set("Upload-Offset", strconv.FormatInt(expectedOffset, 10))
	}
	switch {
	case errors.Is(err, media.ErrAssetNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_asset_not_found"})
	case errors.Is(err, media.ErrMediaNotOwner):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "media_not_owner"})
	case errors.Is(err, media.ErrUploadTooLarge), errors.Is(err, media.ErrUploadLength):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "media_upload_too_large_or_invalid"})
	case errors.Is(err, media.ErrMediaTypeMismatch):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "media_type_mismatch"})
	case errors.Is(err, media.ErrOriginalImmutable):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "media_original_immutable"})
	case errors.Is(err, media.ErrUploadOffset):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "media_upload_offset_mismatch"})
	case errors.Is(err, media.ErrChunkChecksum):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "media_chunk_checksum_mismatch"})
	case errors.Is(err, media.ErrStatusTransition):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "media_not_uploading"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_upload_failed"})
	}
}

// mediaFile 提供 READY 资产的播放/缩略图文件（GET，播放器直接拉 MP4/图片 URL）。
// 内容可见性已由 Feed 管道 fail-closed 控制，P0 不再叠加会话鉴权；
// 非 READY / 不存在一律 404。
func (s *Server) mediaFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Media == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_configured"})
		return
	}
	kind := "play"
	id := strings.TrimPrefix(r.URL.Path, "/v1/media/play/")
	if strings.HasPrefix(r.URL.Path, "/v1/media/thumb/") {
		kind = "thumb"
		id = strings.TrimPrefix(r.URL.Path, "/v1/media/thumb/")
	}
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_route_not_found"})
		return
	}
	path, err := s.Media.ResolveServingPath(r.Context(), id, kind)
	if err != nil {
		// MEDIA-RENDER-RACE-001: 404 默认可被 HTTP 缓存（RFC 7231 §6.1 把 404
		// 列进"cacheable by default"），这里之前没显式 Cache-Control。刚发送
		// 的媒体在 worker 处理完之前打这个接口必然先吃一次 404 —— 客户端的
		// URLCache 会把这次 404 缓存下来，资产几秒后转 READY 也不会再发起网络
		// 请求，图/视频永久空白。显式 no-store，禁止缓存这个瞬时状态。
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_available"})
		return
	}
	// R36.x WATERMARK-001 viewer-side tracing (see mediaVariantFile).
	log.Printf("media access asset=%s kind=%s ip=%s", id, kind, clientIP(r, s.TrustCloudflareIP))
	// Asset routes are stable identifiers. They may point at a newer recipe after
	// an explicit re-derivation, so keep the browser cache bounded and validate by
	// ETag. Variant routes above are recipe-versioned and fully immutable.
	serveMediaPath(w, r, path, "public, max-age=86400, stale-while-revalidate=604800")
}

func serveMediaPath(w http.ResponseWriter, r *http.Request, path, cacheControl string) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		// MEDIA-FILE-001: the "media access" line is emitted by the caller before
		// this check and reads identically for a 200 and a 404, so a missing
		// object used to be invisible in the logs. Say it out loud instead.
		log.Printf("media object MISSING file=%s", filepath.Base(path))
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_object_missing"})
		return
	}
	etag := `W/"` + strconv.FormatInt(info.Size(), 36) + "-" + strconv.FormatInt(info.ModTime().UnixNano(), 36) + `"`
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	http.ServeFile(w, r, path)
}
