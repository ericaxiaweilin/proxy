package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localnet"
)

type Server struct {
	Identity        *identity.Service
	Demand          *demand.Service
	CityCompanion   *citycompanion.Service
	LocalNet        *localnet.Service
	Idempotency     command.IdempotencyStore
	Authenticator   Authenticator
	ReadyCheck      func(context.Context) error
	ReadyMode       string
	Transactions    TransactionRunner
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

func NewServer(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service) *Server {
	return NewServerWithDependencies(identityService, demandService, cityCompanionService, localNetService, command.NewMemoryIdempotencyStore(), nil)
}

func NewServerWithDependencies(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error) *Server {
	return NewServerWithDependenciesAndAuthenticator(identityService, demandService, cityCompanionService, localNetService, idempotencyStore, readyCheck, nil)
}

func NewServerWithDependenciesAndAuthenticator(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator) *Server {
	return NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, idempotencyStore, readyCheck, authenticator, nil)
}

func NewServerWithRuntime(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator, transactions TransactionRunner) *Server {
	if idempotencyStore == nil {
		idempotencyStore = command.NewMemoryIdempotencyStore()
	}
	readyMode := "local_memory"
	if readyCheck != nil {
		readyMode = "configured"
	}
	return &Server{Identity: identityService, Demand: demandService, CityCompanion: cityCompanionService, LocalNet: localNetService, Idempotency: idempotencyStore, Authenticator: authenticator, ReadyCheck: readyCheck, ReadyMode: readyMode, Transactions: transactions}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", s.live)
	mux.HandleFunc("/health/ready", s.ready)
	mux.HandleFunc("/v1/commands/", s.command)
	return mux
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
		// The App may send actor/principal as a UI hint, but the server-owned
		// session is authoritative for command scope and idempotency.
		envelope.Actor = authenticated.Actor
		envelope.Principal = authenticated.Principal
		envelope.AuthContext = authenticated.AuthContext
	}

	result, status, err := s.executeCommand(r.Context(), envelope)
	if err != nil {
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
	default:
		return notImplemented(envelope)
	}
}

func idempotencyScope(envelope command.Envelope) string {
	return envelope.Actor.Type + ":" + envelope.Actor.ID + "|" + envelope.Principal.Type + ":" + envelope.Principal.ID
}

func requiresAuthentication(commandType string) bool {
	switch commandType {
	case "RequestLoginChallenge", "VerifyLoginChallenge", "CreateSession", "RequestAccountRecovery", "RefreshSession":
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
