package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
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
	Idempotency   command.IdempotencyStore
	Authenticator Authenticator
	ReadyCheck    func(context.Context) error
	ReadyMode     string
	Transactions  TransactionRunner
	Operator      OperatorGate
	RateLimit     *RateLimiter
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
	return &Server{Identity: identityService, Demand: demandService, CityCompanion: cityCompanionService, LocalNet: localNetService, LocalContext: localContextService, Conversation: conversationService, Engagement: engagementService, Fulfillment: fulfillmentService, Supply: supplyService, Media: mediaService, Contribution: contributionService, Experience: experience.New(), Voucher: voucher.New(), Idempotency: idempotencyStore, Authenticator: authenticator, ReadyCheck: readyCheck, ReadyMode: readyMode, Transactions: transactions, RateLimit: NewRateLimiter(time.Minute, 120)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", s.live)
	mux.HandleFunc("/health/ready", s.ready)
	mux.HandleFunc("/v1/commands/", s.command)
	mux.HandleFunc("/v1/media/upload/", s.mediaUpload)
	mux.HandleFunc("/v1/media/play/", s.mediaFile)
	mux.HandleFunc("/v1/media/thumb/", s.mediaFile)
	return s.recoverMiddleware(mux)
}

// mediaUpload is a narrow authenticated raw-body endpoint. Metadata and state
// transitions remain commands; only the file bytes use this route.
func (s *Server) mediaUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
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
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1)
	if _, err := s.Media.SaveUpload(r.Context(), id, authenticated.Principal.ID, r.Body, maxUploadBytes); err != nil {
		switch {
		case errors.Is(err, media.ErrAssetNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "media_asset_not_found"})
		case errors.Is(err, media.ErrMediaNotOwner):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "media_not_owner"})
		case errors.Is(err, media.ErrUploadTooLarge):
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "media_upload_too_large"})
		case errors.Is(err, media.ErrMediaTypeMismatch):
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "media_type_mismatch"})
		case errors.Is(err, media.ErrOriginalImmutable):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "media_original_immutable"})
		case errors.Is(err, media.ErrStatusTransition):
			writeJSON(w, http.StatusConflict, map[string]string{"error": "media_not_uploading"})
		default:
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "media_upload_failed"})
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// mediaFile 提供 READY 资产的播放/缩略图文件（GET，播放器直接拉 MP4/图片 URL）。
// 内容可见性已由 Feed 管道 fail-closed 控制，P0 不再叠加会话鉴权；
// 非 READY / 不存在一律 404。
func (s *Server) mediaFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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
	http.ServeFile(w, r, path)
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
	if !s.rateAllow("ip:" + clientIP(r) + ":" + envelope.CommandType) {
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
	default:
		return notImplemented(envelope)
	}
}

func idempotencyScope(envelope command.Envelope) string {
	return envelope.Actor.Type + ":" + envelope.Actor.ID + "|" + envelope.Principal.Type + ":" + envelope.Principal.ID
}

func requiresAuthentication(commandType string) bool {
	switch commandType {
	case "BeginPasswordlessAuthentication", "RequestLoginChallenge", "VerifyLoginChallenge", "CreateSession", "CreateAnonymousSession", "RequestAccountRecovery", "RefreshSession":
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

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if first = strings.TrimSpace(first); first != "" {
			return first
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
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
