package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/safety"
	"github.com/proxy-app/proxy-api/internal/scene"
	"github.com/proxy-app/proxy-api/internal/socialspace"
	"github.com/proxy-app/proxy-api/internal/supply"
	"github.com/proxy-app/proxy-api/internal/voucher"
)

type Server struct {
	Identity      *identity.Service
	Demand        *demand.Service
	CityCompanion *citycompanion.Service
	LocalNet      *localnet.Service
	LocalContext  *localcontext.Service
	Conversation  *conversation.Service
	Engagement    *engagement.Service
	Fulfillment   *fulfillment.Service
	Supply        *supply.Service
	Media         *media.Service
	Activity      *activity.Service
	Contribution  *contribution.Service
	Experience    *experience.Service
	Voucher       *voucher.Service
	Marketplace   *marketplace.Service
	SocialSpace   *socialspace.Service
	Payment       *payment.Service
	Outcome       *outcome.Service
	Notification  *notification.Service
	Safety        *safety.Service
	Business      *business.Service
	Scene         *scene.Service
	Facet         *facet.Service
	Idempotency   command.IdempotencyStore
	Authenticator Authenticator
	ReadyCheck    func(context.Context) error
	ReadyMode     string
	Transactions  TransactionRunner
	// R15.32.1.3: HTTP client used by /v1/geocode/reverse to talk to
	// Nominatim. Tests inject a stub via NewServerWithHTTPClient;
	// production wires a 4s-timeout client in main.go.
	HTTPClient *http.Client
	Operator      OperatorGate
	RateLimit     *RateLimiter
	// TrustCloudflareIP must only be enabled when the origin is reachable
	// exclusively through Cloudflare. Otherwise CF-Connecting-IP is client
	// controlled and must be ignored.
	TrustCloudflareIP bool
	ReadTimeout       time.Duration
}

type Authenticator interface {
	Authenticate(ctx context.Context, rawAccessToken string) (identity.AuthenticatedSession, error)
}

// TransactionRunner binds the API command boundary to the persistence unit of
// work. PostgreSQL uses it to commit idempotency, aggregate state and outbox
// events together.
type TransactionRunner interface {
	WithinTransaction(ctx context.Context, operation func(context.Context) error) error
}

func NewServer(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service) *Server {
	return NewServerWithDependencies(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, command.NewMemoryIdempotencyStore(), nil)
}

func NewServerWithDependencies(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error) *Server {
	return NewServerWithDependenciesAndAuthenticator(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, nil)
}

func NewServerWithDependenciesAndAuthenticator(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator) *Server {
	return NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, authenticator, nil)
}

func NewServerWithRuntime(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator, transactions TransactionRunner) *Server {
	if idempotencyStore == nil {
		idempotencyStore = command.NewMemoryIdempotencyStore()
	}
	readyMode := "local_memory"
	if readyCheck != nil {
		readyMode = "configured"
	}
	return &Server{Identity: identityService, Demand: demandService, CityCompanion: cityCompanionService, LocalNet: localNetService, LocalContext: localContextService, Conversation: conversationService, Engagement: engagementService, Fulfillment: fulfillmentService, Supply: supplyService, Media: mediaService, Contribution: contributionService, Experience: experience.New(), Voucher: voucher.New(), SocialSpace: socialspace.New(), Payment: payment.New(), Outcome: outcome.New(), Notification: notification.New(), Safety: safety.New(), Business: business.New(), Scene: scene.New(), Facet: facet.New(), Idempotency: idempotencyStore, Authenticator: authenticator, ReadyCheck: readyCheck, ReadyMode: readyMode, Transactions: transactions, RateLimit: NewRateLimiter(time.Minute, 120), TrustCloudflareIP: envBool("PROXY_TRUST_CLOUDFLARE_IP"), ReadTimeout: 4 * time.Second}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", s.live)
	mux.HandleFunc("/health/ready", s.ready)
	mux.HandleFunc("/v1/commands/", s.command)
	mux.HandleFunc("/v1/experience/surface", s.experienceSurface)
	mux.HandleFunc("/v1/experience/delta", s.experienceDelta)
	mux.HandleFunc("/v1/experience/metrics", s.experienceMetrics)
	mux.HandleFunc("/v1/operator/context-field", s.operatorContextField)
	mux.HandleFunc("/v1/operator/surface-plans", s.operatorSurfacePlans)
	mux.HandleFunc("/v1/operator/execution-runtime", s.operatorExecutionRuntime)
	mux.HandleFunc("/v1/operator/decision-engine", s.operatorDecisionEngine)
	mux.HandleFunc("/v1/operator/clarification-gate", s.operatorClarificationGate)
	mux.HandleFunc("/v1/operator/supply-health", s.operatorSupplyHealth)
	mux.HandleFunc("/v1/operator/fulfillment-attribution", s.operatorFulfillmentAttribution)
	mux.HandleFunc("/v1/operator/behavior", s.operatorBehavior)
	mux.HandleFunc("/v1/operator/research", s.operatorResearch)
	mux.HandleFunc("/v1/operator/population", s.operatorPopulation)
	mux.HandleFunc("/v1/operator/tags", s.operatorTags)
	mux.HandleFunc("/v1/operator/intent-orchestration", s.operatorIntentOrchestration)
	mux.HandleFunc("/v1/operator/engine-api", s.operatorEngineAPI)
	mux.HandleFunc("/v1/operator/merchant", s.operatorMerchant)
	mux.HandleFunc("/v1/operator/retention", s.operatorRetention)
	mux.HandleFunc("/v1/operator/trust", s.operatorTrust)
	mux.HandleFunc("/v1/operator/quality", s.operatorQuality)
	mux.HandleFunc("/v1/media/upload/", s.mediaUpload)
	mux.HandleFunc("/v1/media/play/", s.mediaFile)
	mux.HandleFunc("/v1/media/thumb/", s.mediaFile)
	mux.HandleFunc("/v1/media/variant/", s.mediaVariantFile)
	mux.HandleFunc("/v1/feed", s.publicFeed)
	// R15.25 FACET — object-oriented content operation (Phase 1 = list only).
	// 匿名 GET endpoint, 返回 mock 3 个对象 (Ken / Linh / ABC Spa) 跟 prototype
	// 一致. Phase 1 没有持久化, 也不需要 auth — 跟 prototype HTML demo 同形.
	mux.HandleFunc("/v1/facet/objects", s.facetObjects)
	// R15.33: /v1/map/items 撤了 — LocationPickerSheet 直接用
	// /v1/geocode/reverse (Photon proxy) 拿真实地址，不需要 server
	// 拿 bbox 查 post/agent/order pin。Post pin overlay 如果要
	// 重做，起新端点 /v1/feed/local (Phase 2, not yet)。
	// R15.32.1.3: reverse geocode proxy. Mobile LocationPickerSheet
	// calls this with (lat, lng) after GPS snap and the server relays
	// the request to Nominatim. Server-side proxy gives us
	// observability (one log line per call) and lets us add caching
	// later without touching the mobile code path.
	mux.HandleFunc("/v1/geocode/reverse", s.reverseGeocode)
	return s.recoverMiddleware(s.versionMiddleware(mux))
}

// publicFeed is the cacheable anonymous read projection for edge delivery.
// Commands remain the write boundary; Cloudflare must not cache command POSTs.
func (s *Server) publicFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.LocalNet == nil {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "feed_not_configured"})
		return
	}
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":public_feed") {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 1024 {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_cursor"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 25
	}
	now := time.Now().UTC()
	readTimeout := s.ReadTimeout
	if readTimeout <= 0 {
		readTimeout = 4 * time.Second
	}
	readContext, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	result := s.LocalNet.HandleContext(readContext, command.Envelope{
		CommandID: "public_feed_" + strconv.FormatInt(now.UnixNano(), 36), CommandType: "ListFeedPosts", CommandVersion: 1,
		Actor: command.Actor{Type: "PUBLIC", ID: "anonymous_reader"}, Principal: command.Principal{Type: "PUBLIC", ID: "anonymous_reader"},
		Target: command.Target{Type: "Feed", ID: "public"}, Purpose: "public_feed_read", RequestedAt: now.Format(time.RFC3339Nano),
		Payload: map[string]any{"cursor": cursor, "limit": limit},
	})
	if result.Error != nil && result.Error.ErrorCode == "INVALID_CURSOR" {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_cursor"})
		return
	}
	if result.Outcome != "ACCEPTED" || result.OperationRef == "" || !json.Valid([]byte(result.OperationRef)) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "feed_temporarily_unavailable"})
		return
	}
	payload := []byte(result.OperationRef)
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(payload))
	w.Header().Set("Cache-Control", "public, max-age=15, stale-while-revalidate=120, stale-if-error=86400")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

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
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_not_available"})
		return
	}
	// Asset routes are stable identifiers. They may point at a newer recipe after
	// an explicit re-derivation, so keep the browser cache bounded and validate by
	// ETag. Variant routes above are recipe-versioned and fully immutable.
	serveMediaPath(w, r, path, "public, max-age=86400, stale-while-revalidate=604800")
}

func serveMediaPath(w http.ResponseWriter, r *http.Request, path, cacheControl string) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
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

// versionMiddleware enforces minimum app version when PROXY_MIN_APP_VERSION is set.
// Clients must send X-Proxy-App-Version (e.g. 1.0.0); older clients receive 426 Upgrade Required.
func (s *Server) versionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		minVersion := strings.TrimSpace(os.Getenv("PROXY_MIN_APP_VERSION"))
		if minVersion == "" {
			next.ServeHTTP(w, r)
			return
		}
		// Health probes are version-agnostic
		if r.URL.Path == "/health/live" || r.URL.Path == "/health/ready" {
			next.ServeHTTP(w, r)
			return
		}
		clientVersion := strings.TrimSpace(r.Header.Get("X-Proxy-App-Version"))
		if clientVersion == "" {
			// 未带版本头的旧客户端视为需升级（但匿名 GET /v1/facet/objects 仍放行以便引导页可读）
			if r.URL.Path == "/v1/facet/objects" {
				next.ServeHTTP(w, r)
				return
			}
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{"error": "app_version_required", "min_version": minVersion})
			return
		}
		if compareVersion(clientVersion, minVersion) < 0 {
			writeJSON(w, http.StatusUpgradeRequired, map[string]string{"error": "app_version_too_old", "min_version": minVersion, "client_version": clientVersion})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func compareVersion(a, b string) int {
	parse := func(s string) []int {
		parts := strings.Split(strings.TrimPrefix(s, "v"), ".")
		out := make([]int, 3)
		for i := 0; i < 3 && i < len(parts); i++ {
			n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
			out[i] = n
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return -1
		}
		if pa[i] > pb[i] {
			return 1
		}
	}
	return 0
}

// recoverMiddleware keeps a panic inside any command handler from crashing the
// whole API process (a malformed upload must not take down the service).
func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "proxy-api"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if s.ReadyCheck != nil {
		if err := s.ReadyCheck(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "service": "proxy-api", "error": "dependency_unavailable"})
			return
		}
	}
	checks := map[string]string{"database": "not_configured_local_mode", "redis": "not_configured_local_mode"}
	if s.ReadyMode == "configured" {
		checks["database"] = "ok"
		checks["redis"] = "not_configured_optional"
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "service": "proxy-api", "checks": checks})
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	routeCommandType := strings.TrimPrefix(r.URL.Path, "/v1/commands/")
	if routeCommandType == "" || strings.Contains(routeCommandType, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "command_route_not_found"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var envelope command.Envelope
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		result := invalidEnvelope("unknown", "invalid_envelope", "command.invalid_envelope", r)
		writeResult(w, http.StatusBadRequest, result)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		result := invalidEnvelope("unknown", "invalid_envelope", "command.invalid_envelope", r)
		writeResult(w, http.StatusBadRequest, result)
		return
	}
	if result := validateEnvelope(envelope, routeCommandType); result != nil {
		writeResult(w, http.StatusBadRequest, *result)
		return
	}
	// Pre-auth per-IP rate limit: protects authentication and every command
	// route from brute force (also bounds OTP challenge requests).
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":" + envelope.CommandType) {
		result := command.Rejected(envelope, "RATE_LIMITED", "RESOURCE", "SAFE_RETRY", "command.rate_limited", nil)
		writeResult(w, http.StatusTooManyRequests, result)
		return
	}
	if requiresAuthentication(envelope.CommandType) {
		if s.Authenticator == nil {
			result := command.Rejected(envelope, "AUTHENTICATION_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "command.authentication_unavailable", nil)
			writeResult(w, http.StatusServiceUnavailable, result)
			return
		}
		rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			result := command.Rejected(envelope, "ACCESS_TOKEN_REQUIRED", "AUTHENTICATION", "AFTER_REAUTH", "command.access_token_required", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
		if err != nil {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		// The App may send actor/principal as a UI hint, but the server owned
		// session is authoritative for command scope and idempotency.
		envelope.Actor = authenticated.Actor
		envelope.Principal = authenticated.Principal
		envelope.AuthContext = authenticated.AuthContext
		// Privileged commands (capability verification, contribution review /
		// reward, media readiness override) require operator rights. Fail closed.
		if requiresOperator(envelope.CommandType) {
			if s.Operator == nil || !s.Operator.IsOperator(envelope.Actor, envelope.Principal, envelope.AuthContext) {
				result := command.Rejected(envelope, "OPERATOR_PRIVILEGE_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "command.operator_privilege_required", nil)
				writeResult(w, http.StatusForbidden, result)
				return
			}
		}
		// Per-actor rate limit on top of the IP limit: rotating idempotency
		// keys must not allow unbounded command volume per session.
		if !s.rateAllow("actor:" + envelope.Actor.Type + ":" + envelope.Actor.ID + ":" + envelope.CommandType) {
			result := command.Rejected(envelope, "RATE_LIMITED", "RESOURCE", "SAFE_RETRY", "command.rate_limited", nil)
			writeResult(w, http.StatusTooManyRequests, result)
			return
		}
	}
	// Passwordless authentication is normally public. When it is initiated
	// from an existing Guest session, however, preserve that server-authenticated
	// person so the new credential upgrades it instead of creating a duplicate.
	if envelope.CommandType == "BeginPasswordlessAuthentication" && r.Header.Get("Authorization") != "" {
		if s.Authenticator == nil {
			result := command.Rejected(envelope, "AUTHENTICATION_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "command.authentication_unavailable", nil)
			writeResult(w, http.StatusServiceUnavailable, result)
			return
		}
		rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
		if err != nil {
			result := command.Rejected(envelope, "INVALID_ACCESS_TOKEN", "AUTHENTICATION", "AFTER_REAUTH", "command.invalid_access_token", nil)
			writeResult(w, http.StatusUnauthorized, result)
			return
		}
		envelope.Actor = authenticated.Actor
		envelope.Principal = authenticated.Principal
		envelope.AuthContext = authenticated.AuthContext
	}

	result, status, err := s.executeCommand(r.Context(), envelope)
	if err != nil {
		log.Printf("command transaction failed: command=%s key=%s err=%v", envelope.CommandType, envelope.IdempotencyKey, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "command_transaction_failed"})
		return
	}
	writeResult(w, status, result)
}

func (s *Server) executeCommand(ctx context.Context, envelope command.Envelope) (command.Result, int, error) {
	fingerprint := fingerprintFor(envelope)
	scope := idempotencyScope(envelope)
	var result command.Result
	status := http.StatusInternalServerError

	operation := func(operationContext context.Context) error {
		decision, previous, err := s.Idempotency.Begin(operationContext, scope, envelope.IdempotencyKey, fingerprint)
		if err != nil {
			log.Printf("idempotency begin failed: command=%s err=%v", envelope.CommandType, err)
			return err
		}
		switch decision {
		case command.IdempotencyConflict:
			result = command.Rejected(envelope, "IDEMPOTENCY_KEY_REUSED", "CONCURRENCY", "AFTER_USER_ACTION", "command.idempotency_key_reused", map[string]any{"idempotencyKey": envelope.IdempotencyKey})
			status = http.StatusConflict
			return nil
		case command.IdempotencyInProgress:
			result = command.Rejected(envelope, "IDEMPOTENCY_IN_PROGRESS", "CONCURRENCY", "SAFE_RETRY", "command.idempotency_in_progress", map[string]any{"idempotencyKey": envelope.IdempotencyKey})
			status = http.StatusConflict
			return nil
		case command.IdempotencyReplay:
			if previous == nil {
				return errors.New("idempotency replay record is missing")
			}
			result = previous.Result
			result.Outcome = "ALREADY_APPLIED"
			status = http.StatusOK
			return nil
		case command.IdempotencyClaimed:
			result = s.dispatchCommand(operationContext, envelope)
			if err := s.Idempotency.Complete(operationContext, scope, envelope.IdempotencyKey, command.IdempotencyRecord{Fingerprint: fingerprint, Result: result}); err != nil {
				log.Printf("idempotency complete failed: command=%s outcome=%s err=%v", envelope.CommandType, result.Outcome, err)
				return err
			}
			status = statusFor(result)
			return nil
		default:
			return errors.New("unknown idempotency decision")
		}
	}

	var err error
	if s.Transactions != nil {
		err = s.Transactions.WithinTransaction(ctx, operation)
	} else {
		err = operation(ctx)
	}
	if err != nil {
		// Dispatch/transaction failed: release the inflight idempotency claim
		// so the key does not stay IN_PROGRESS forever (best effort; the
		// transactional store may have rolled the claim back already).
		_ = s.Idempotency.Release(context.WithoutCancel(ctx), scope, envelope.IdempotencyKey, fingerprint)
	}
	return result, status, err
}

func (s *Server) dispatchCommand(ctx context.Context, envelope command.Envelope) command.Result {
	switch {
	case s.Identity != nil && s.Identity.Supports(envelope.CommandType):
		return s.Identity.HandleContext(ctx, envelope)
	case s.Demand != nil && s.Demand.Supports(envelope.CommandType):
		return s.Demand.HandleContext(ctx, envelope)
	case s.CityCompanion != nil && s.CityCompanion.Supports(envelope.CommandType):
		return s.CityCompanion.HandleContext(ctx, envelope)
	case s.LocalNet != nil && s.LocalNet.Supports(envelope.CommandType):
		return s.LocalNet.HandleContext(ctx, envelope)
	case s.LocalContext != nil && s.LocalContext.Supports(envelope.CommandType):
		return s.LocalContext.HandleContext(ctx, envelope)
	case s.Conversation != nil && s.Conversation.Supports(envelope.CommandType):
		return s.Conversation.HandleContext(ctx, envelope)
	case s.Engagement != nil && s.Engagement.Supports(envelope.CommandType):
		return s.Engagement.HandleContext(ctx, envelope)
	case s.Fulfillment != nil && s.Fulfillment.Supports(envelope.CommandType):
		return s.Fulfillment.HandleContext(ctx, envelope)
	case s.Supply != nil && s.Supply.Supports(envelope.CommandType):
		return s.Supply.HandleContext(ctx, envelope)
	case s.Media != nil && s.Media.Supports(envelope.CommandType):
		return s.Media.HandleContext(ctx, envelope)
	case s.Activity != nil && s.Activity.Supports(envelope.CommandType):
		return s.Activity.HandleContext(ctx, envelope)
	case s.Contribution != nil && s.Contribution.Supports(envelope.CommandType):
		return s.Contribution.HandleContext(ctx, envelope)
	case s.Experience != nil && s.Experience.Supports(envelope.CommandType):
		return s.Experience.HandleContext(ctx, envelope)
	case s.Voucher != nil && s.Voucher.Supports(envelope.CommandType):
		return s.Voucher.HandleContext(ctx, envelope)
	case s.Marketplace != nil && s.Marketplace.Supports(envelope.CommandType):
		return s.Marketplace.HandleContext(ctx, envelope)
	case s.SocialSpace != nil && s.SocialSpace.Supports(envelope.CommandType):
		return s.SocialSpace.HandleContext(ctx, envelope)
	case s.Payment != nil && s.Payment.Supports(envelope.CommandType):
		return s.Payment.HandleContext(ctx, envelope)
	case s.Outcome != nil && s.Outcome.Supports(envelope.CommandType):
		return s.Outcome.HandleContext(ctx, envelope)
	case s.Notification != nil && s.Notification.Supports(envelope.CommandType):
		return s.Notification.HandleContext(ctx, envelope)
	case s.Safety != nil && s.Safety.Supports(envelope.CommandType):
		return s.Safety.HandleContext(ctx, envelope)
	case s.Business != nil && s.Business.Supports(envelope.CommandType):
		return s.Business.HandleContext(ctx, envelope)
	case s.Scene != nil && s.Scene.Supports(envelope.CommandType):
		return s.Scene.HandleContext(ctx, envelope)
	default:
		return notImplemented(envelope)
	}
}

func idempotencyScope(envelope command.Envelope) string {
	return envelope.Actor.Type + ":" + envelope.Actor.ID + "|" + envelope.Principal.Type + ":" + envelope.Principal.ID
}

func requiresAuthentication(commandType string) bool {
	switch commandType {
	case "BeginPasswordlessAuthentication", "RequestLoginChallenge", "VerifyLoginChallenge", "CreateSession", "CreateAnonymousSession", "RequestAccountRecovery", "RefreshSession",
		"ListFeedPosts", "ListMarketOpportunities", "ListActivities", "ListStatuses", "ListCommunities":
		return false
	default:
		return true
	}
}

func bearerToken(header string) (string, bool) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func (s *Server) rateAllow(scope string) bool {
	if s.RateLimit == nil {
		return true
	}
	return s.RateLimit.Allow(scope, time.Now())
}

func clientIP(r *http.Request, trustCloudflare bool) string {
	if trustCloudflare {
		if candidate := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); candidate != "" {
			if parsed := net.ParseIP(candidate); parsed != nil {
				return parsed.String()
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if parsed := net.ParseIP(host); parsed != nil {
			return parsed.String()
		}
	}
	if parsed := net.ParseIP(strings.TrimSpace(r.RemoteAddr)); parsed != nil {
		return parsed.String()
	}
	return "unknown"
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func validateEnvelope(envelope command.Envelope, routeCommandType string) *command.Result {
	if envelope.CommandID == "" || envelope.CommandType == "" || envelope.CommandVersion <= 0 || envelope.Actor.Type == "" || envelope.Actor.ID == "" || envelope.Principal.Type == "" || envelope.Principal.ID == "" || envelope.Target.Type == "" || envelope.Target.ID == "" || len(envelope.IdempotencyKey) < 8 || envelope.AuthContext == nil || envelope.Purpose == "" || envelope.CorrelationID == "" || envelope.RequestedAt == "" || envelope.Payload == nil {
		result := invalidEnvelope(envelope.CommandID, envelope.CorrelationID, "command.invalid_envelope", nil)
		return &result
	}
	if _, err := time.Parse(time.RFC3339, envelope.RequestedAt); err != nil {
		result := command.Rejected(envelope, "INVALID_COMMAND_ENVELOPE", "VALIDATION", "AFTER_USER_ACTION", "command.invalid_envelope", map[string]any{"field": "requestedAt"})
		return &result
	}
	if envelope.CommandType != routeCommandType {
		result := command.Rejected(envelope, "COMMAND_TYPE_MISMATCH", "VALIDATION", "AFTER_USER_ACTION", "command.type_mismatch", map[string]any{"routeCommandType": routeCommandType})
		return &result
	}
	return nil
}

func invalidEnvelope(commandID, correlationID, messageKey string, _ *http.Request) command.Result {
	if correlationID == "" {
		correlationID = "http_invalid"
	}
	return command.Result{CommandID: commandID, Outcome: "REJECTED", EventRefs: []string{}, CorrelationID: correlationID, Error: &command.ErrorEnvelope{ErrorCode: "INVALID_COMMAND_ENVELOPE", Category: "VALIDATION", Retryability: "AFTER_USER_ACTION", MessageKey: messageKey, SafeDetails: map[string]any{}, CorrelationID: correlationID}}
}

func notImplemented(envelope command.Envelope) command.Result {
	return command.Rejected(envelope, "COMMAND_NOT_IMPLEMENTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "foundation.command_not_implemented", map[string]any{"commandType": envelope.CommandType})
}

func fingerprintFor(envelope command.Envelope) string {
	value := struct {
		CommandType              string            `json:"commandType"`
		CommandVersion           int               `json:"commandVersion"`
		Actor                    command.Actor     `json:"actor"`
		Principal                command.Principal `json:"principal"`
		Target                   command.Target    `json:"target"`
		ExpectedAggregateVersion *int              `json:"expectedAggregateVersion,omitempty"`
		PolicySnapshot           map[string]any    `json:"policySnapshot,omitempty"`
		AuthContext              map[string]any    `json:"authContext"`
		Purpose                  string            `json:"purpose"`
		Payload                  map[string]any    `json:"payload"`
	}{envelope.CommandType, envelope.CommandVersion, envelope.Actor, envelope.Principal, envelope.Target, envelope.ExpectedAggregateVersion, envelope.PolicySnapshot, envelope.AuthContext, envelope.Purpose, envelope.Payload}
	bytes, _ := json.Marshal(value)
	return string(bytes)
}

func statusFor(result command.Result) int {
	switch result.Outcome {
	case "PENDING":
		return http.StatusAccepted
	case "REJECTED":
		if result.Error != nil && result.Error.ErrorCode == "COMMAND_NOT_IMPLEMENTED" {
			return http.StatusNotImplemented
		}
		return http.StatusConflict
	default:
		return http.StatusOK
	}
}

func writeResult(w http.ResponseWriter, status int, result command.Result) {
	writeJSON(w, status, result)
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// facetObjects 列出当前用户的所有 FACET 对象（R15.25 Phase 1）。
//
// Phase 1 = 静态 mock 三条数据（与 Proxy_COMPLETE_FiveRoot_FACET_v11.html
// prototype 的 facetObjects 一致）：
//   - ken  = 重点关系 (BUILDING_TRUST)
//   - linh = 朋友     (SHARED_INTEREST)
//   - spa  = 合作     (CREATOR_COLLAB)
//
// 行为契约：
//   - GET only, 其它方法 → 405
//   - 不需要 auth（Phase 1 不做持久化）
//   - 返回 ListFacetObjectsPayload（{ objects, totalObjects, freshAssets, shownAssets }）
//   - Phase 1 NOT-IN-SCOPE：图片 URL 永远 = ""（UI 显示 placeholder）；
//     不做 LIBRARY / OBJECTS / OBJECT DETAIL / 关系规则引擎 / 真实持久化。
//
// 后端 facade shape 必须跟 packages/contracts/src/facet.ts 严格对齐：
// schema rename 一旦发生, 编译期会爆 (zod 解析)。
// R15.25.1 起：数据来自 facet.Service（PG持久化或内存seed），不再hardcode mock，
// 但 wire shape 与mock完全一致，保证前端zod不漂。
func (s *Server) facetObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Facet == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "facet_not_configured"})
		return
	}
	payload, err := s.Facet.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "facet_list_failed"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// reverseGeocode is a thin server-side proxy to Nominatim OpenStreetMap.
// The mobile LocationPickerSheet (R15.32.1.3) calls this with (lat, lng)
// after the user GPS-snaps the pin, so the picker can show a real
// street/POI/city name (e.g. "Hoàn Kiếm, Hà Nội") instead of grid
// coordinates. Going through our server gives us one log line per
// call and a place to add a small in-memory cache if Nominatim
// rate-limits us.
//
// Query params:
//   - lat, lng (required): -90..90 / -180..180
//   - zoom (optional): 1..18, default 18 (street-level)
//
// Response: { displayName, road?, poi?, source }
//   - source = "remote" if Nominatim returned a hit
//   - source = "offline" if Nominatim was unreachable or returned
//     an empty body; the mobile side falls back to its grid POI
//     lookup in that case.
//
// We do NOT do any auth — this is anonymous read traffic, like
// /v1/map/items and /v1/facet/objects.
func (s *Server) reverseGeocode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	q := r.URL.Query()
	latStr := q.Get("lat")
	lngStr := q.Get("lng")
	if latStr == "" || lngStr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_lat_or_lng"})
		return
	}
	lat, errLat := strconv.ParseFloat(latStr, 64)
	lng, errLng := strconv.ParseFloat(lngStr, 64)
	if errLat != nil || errLng != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_lat_or_lng"})
		return
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "out_of_range"})
		return
	}
	zoom := "18"
	if z := q.Get("zoom"); z != "" {
		zoom = z
	}
	// R15.32.1.3: we proxy Photon (komoot.io) instead of Nominatim
	// because Nominatim aggressively rate-limits / IP-blocks
	// anonymous consumers from cloud IPs. Photon is a free OSM-
	// based geocoder with no auth, and returns GeoJSON Feature-
	// Collection. We translate one feature into the same
	// { displayName, road, poi, source } shape the mobile side
	// already understands.
	photonURL := fmt.Sprintf("https://photon.komoot.io/reverse?lon=%f&lat=%f", lng, lat)
	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, photonURL, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "build_request_failed"})
		return
	}
	req.Header.Set("User-Agent", "Proxy-App/1.0")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		// Network / DNS / TLS — return a 200 with source=offline so
		// the mobile side can degrade to its grid-POI fallback
		// instead of showing a hard error to the user.
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	var body struct {
		Features []struct {
			Properties struct {
				// Photon properties — see https://photon.komoot.io/.
				// "name" is the most specific hit (street / POI).
				// We prefer "name" for displayName, with city +
				// country as suffixes when present.
				Name     string `json:"name"`
				Street   string `json:"street"`
				City     string `json:"city"`
				State    string `json:"state"`
				District string `json:"district"`
				Country  string `json:"country"`
				Type     string `json:"type"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	if len(body.Features) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"displayName": "",
			"source":      "offline",
		})
		return
	}
	first := body.Features[0]
	props := first.Properties
	// Build a human-readable displayName from Photon's parts.
	// Prefer: "Street, City" → fall back to "City, Country" →
	// "Name" alone. The mobile side picks city from the city
	// field via pickCityFromDisplayName.
	display := buildPhotonDisplayName(props)
	out := map[string]any{
		"displayName": display,
		"source":      "remote",
	}
	if props.Name != "" {
		// POI: only treat as POI if the type is a specific landmark
		// (not a street or city). Photon uses OSM tags; we treat
		// anything with a name as POI-eligible.
		out["poi"] = props.Name
	}
	if props.Street != "" {
		out["road"] = props.Street
	}
	if props.City != "" {
		out["city"] = props.City
	}
	// R15.32.1.5: pass through state / district too. Mobile used to
	// only read `city`, but Photon's `city` is sometimes a
	// district (e.g. "District 1" for HCMC inner wards). When
	// `state` is non-empty, the mobile side prefers
	// city ?? state as the canonical city label.
	if props.State != "" {
		out["state"] = props.State
	}
	if props.District != "" {
		out["district"] = props.District
	}
	_ = zoom // reserved for future Nominatim fallback
	writeJSON(w, http.StatusOK, out)
}

// buildPhotonDisplayName assembles a single-line human-readable
// label from a Photon properties blob. Mirrors the shape Nominatim
// returns (so the mobile pickCityFromDisplayName can reuse the
// same "City, Country" detection).
func buildPhotonDisplayName(p struct {
	Name     string `json:"name"`
	Street   string `json:"street"`
	City     string `json:"city"`
	State    string `json:"state"`
	District string `json:"district"`
	Country  string `json:"country"`
	Type     string `json:"type"`
}) string {
	// "Lê Thánh Tôn, Thành phố Hồ Chí Minh, Việt Nam"
	parts := []string{}
	if p.Name != "" {
		parts = append(parts, p.Name)
	}
	if p.City != "" && !containsString(parts, p.City) {
		parts = append(parts, p.City)
	}
	if p.Country != "" && !containsString(parts, p.Country) {
		parts = append(parts, p.Country)
	}
	return strings.Join(parts, ", ")
}

func containsString(s []string, want string) bool {
	for _, v := range s {
		if v == want {
			return true
		}
	}
	return false
}
