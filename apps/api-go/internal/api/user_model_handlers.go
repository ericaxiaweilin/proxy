package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/usermodel"
)

// AI-MANAGE-015: AI 分身「用户建模」。
//
//	GET  /v1/ai/user-model          本人的建模 + 授权图库张数
//	PUT  /v1/ai/user-model          本人手动修改（来源标 manual，AI 之后不覆盖）
//	POST /v1/ai/user-model/analyze  让 vision 模型从本人授权的公共图库照片里识别外观特征
//
// 三个都要会话，而且都要本人对自己 AI 分身的形象授权仍然有效（likenessReferencePhotos）：
// 用户规则「ai 分身只给小美授权使用 没有这个授权的就是没有」—— 没授权就没有建模，
// 模型更不能读她的照片。

// 4 张够看清发型 / 肤色 / 身材；张数越多 vision 越慢（6 张实测超过 30 秒）。
const userModelMaxPhotos = 4
const userModelMaxPhotoBytes = 4 << 20

func (s *Server) routeUserModel(w http.ResponseWriter, r *http.Request) {
	if s.UserModel == nil || s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user_model_unavailable"})
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
	ownerID := authenticated.Principal.ID
	photos, err := s.likenessReferencePhotos(r.Context(), ownerID)
	if errors.Is(err, ErrOrderPermissionRequired) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "order_permission_required"})
		return
	}
	if errors.Is(err, ErrLikenessConsentRequired) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "likeness_consent_required"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gallery_lookup_failed"})
		return
	}
	respond := func(profile usermodel.Profile, extra map[string]any) {
		body := map[string]any{"model": profile, "galleryCount": len(photos)}
		for k, v := range extra {
			body[k] = v
		}
		writeJSON(w, http.StatusOK, body)
	}

	switch {
	case r.URL.Path == "/v1/ai/user-model" && r.Method == http.MethodGet:
		profile, err := s.UserModel.Get(r.Context(), ownerID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "user_model_read_failed"})
			return
		}
		respond(profile, nil)
	case r.URL.Path == "/v1/ai/user-model" && r.Method == http.MethodPut:
		var patch usermodel.Patch
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&patch); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
			return
		}
		profile, err := s.UserModel.Update(r.Context(), ownerID, patch)
		if errors.Is(err, usermodel.ErrInvalid) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_value", "reason": err.Error()})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "user_model_write_failed"})
			return
		}
		respond(profile, nil)
	case r.URL.Path == "/v1/ai/user-model/analyze" && r.Method == http.MethodPost:
		// 看图比普通请求慢：服务器全局 WriteTimeout 是 30 秒，到点会把连接掐断而处理还在跑 ——
		// 结果写进了库，客户端却只拿到「失败」。这一个端点单独放宽到 90 秒。
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(90 * time.Second))
		inputs := make([]usermodel.Photo, 0, userModelMaxPhotos)
		for _, asset := range photos {
			if len(inputs) >= userModelMaxPhotos {
				break
			}
			if s.Media == nil || asset.MediaType != "IMAGE" {
				continue
			}
			path, err := s.Media.OwnerImagePath(r.Context(), ownerID, asset.MediaAssetID)
			if err != nil {
				continue
			}
			if uri := imageFileDataURI(path); uri != "" {
				inputs = append(inputs, usermodel.Photo{DataURI: uri})
			}
		}
		profile, recognised, err := s.UserModel.Analyze(r.Context(), ownerID, inputs)
		switch {
		case errors.Is(err, usermodel.ErrNoPhotos):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "no_photos"})
		case errors.Is(err, usermodel.ErrModelUnavailable):
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "vision_unavailable"})
		case errors.Is(err, usermodel.ErrUnreadable):
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "vision_unreadable"})
		case err != nil:
			log.Printf("user model analyze failed owner=%s: %v", ownerID, err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "vision_failed"})
		default:
			respond(profile, map[string]any{"recognised": recognised})
		}
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}

func imageFileDataURI(path string) string {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > userModelMaxPhotoBytes {
		return ""
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	mime := "image/jpeg"
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png":
		mime = "image/png"
	case ".webp":
		mime = "image/webp"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)
}
