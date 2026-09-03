package api

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// privacyRequestEnvelope is the wire shape of a privacy request as
// returned by the privacy center endpoints. It deliberately mirrors
// identity.PrivacyRequest but is rendered as a flat JSON object so
// the mobile client can render it without a second type.
type privacyRequestEnvelope struct {
	ID                   string     `json:"id"`
	UserID               string     `json:"userId"`
	Kind                 string     `json:"kind"`
	Status               string     `json:"status"`
	RequestedAt          time.Time  `json:"requestedAt"`
	CompletedAt          *time.Time `json:"completedAt,omitempty"`
	ErasedAt             *time.Time `json:"erasedAt,omitempty"`
	ExportSnapshotURL    string     `json:"exportSnapshotUrl,omitempty"`
	ExportSHA256         string     `json:"exportSha256,omitempty"`
	ExportRetentionUntil *time.Time `json:"exportRetentionUntil,omitempty"`
	LegalBasis           string     `json:"legalBasis"`
	RejectionReason      string     `json:"rejectionReason,omitempty"`
	Version              int        `json:"version"`
}

func renderPrivacyRequest(r identity.PrivacyRequest) privacyRequestEnvelope {
	return privacyRequestEnvelope{
		ID:                   r.ID,
		UserID:               r.UserID,
		Kind:                 string(r.Kind),
		Status:               string(r.Status),
		RequestedAt:          r.RequestedAt,
		CompletedAt:          r.CompletedAt,
		ErasedAt:             r.ErasedAt,
		ExportSnapshotURL:    r.ExportSnapshotURL,
		ExportSHA256:         r.ExportSHA256,
		ExportRetentionUntil: r.ExportRetentionUntil,
		LegalBasis:           r.LegalBasis,
		RejectionReason:      r.RejectionReason,
		Version:              r.Version,
	}
}

// privacyExportEnvelope is the response shape for GET /v1/privacy/me.
// It wraps the in-memory data export assembled by the service plus a
// few envelope fields so the client can prove the export is fresh.
type privacyExportEnvelope struct {
	Data          json.RawMessage            `json:"data"`
	FormatVersion string                     `json:"formatVersion"`
	LegalBasis    string                     `json:"legalBasis"`
	GeneratedAt   time.Time                  `json:"generatedAt"`
	History       []privacyRequestEnvelope   `json:"history"`
}

// privacyMe handles GET /v1/privacy/me. The endpoint returns the
// requesting user's data export snapshot, plus the full history of
// their privacy requests. Auth is mandatory; the request must carry
// a valid access token.
func (s *Server) privacyMe(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	export, err := s.Identity.GeneratePrivacyExportData(r.Context(), authenticated.Principal.ID)
	if err != nil {
		if errors.Is(err, identity.ErrUserNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user_not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "export_assembly_failed", "reason": err.Error()})
		return
	}
	// History: also list the user's privacy requests so the response is
	// self-contained — the client can render "your past export / delete
	// requests" without a second round-trip.
	history := make([]privacyRequestEnvelope, 0)
	if repo := s.identityPrivacyRepository(); repo != nil {
		if rows, err := repo.ListPrivacyRequestsByUser(r.Context(), authenticated.Principal.ID); err == nil {
			for _, row := range rows {
				history = append(history, renderPrivacyRequest(row))
			}
		}
	}
	payload, err := json.Marshal(export)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "export_serialize_failed", "reason": err.Error()})
		return
	}
	envelope := privacyExportEnvelope{
		Data:          payload,
		FormatVersion: export.FormatVersion,
		LegalBasis:    export.LegalBasis,
		GeneratedAt:   export.GeneratedAt,
		History:       history,
	}
	writeJSON(w, http.StatusOK, envelope)
}

// privacyExportRequest handles POST /v1/privacy/export. It creates a
// 'received' export request. The actual export assembly runs
// synchronously today; in production the same flow runs in a
// background worker that polls for 'received' rows.
func (s *Server) privacyExportRequest(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	payload := readPrivacyPayload(r)
	envelope := buildPrivacyCommandEnvelope(r, authenticated, payload, "RequestPrivacyExport")
	result := s.Identity.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"request":       renderPrivacyRequestFromResult(result),
		"retentionDays": result.Body["retentionDays"],
	})
}

// privacyDeleteRequest handles POST /v1/privacy/delete. It creates a
// 'received' delete request. The 30-day grace window is reported back
// in the response so the mobile client can render a countdown.
func (s *Server) privacyDeleteRequest(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	payload := readPrivacyPayload(r)
	envelope := buildPrivacyCommandEnvelope(r, authenticated, payload, "RequestPrivacyDelete")
	result := s.Identity.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"request":         renderPrivacyRequestFromResult(result),
		"gracePeriodDays": result.Body["gracePeriodDays"],
		"erasedAt":        result.Body["erasedAt"],
		"cancelableUntil": result.Body["cancelableUntil"],
	})
}

// privacyCancelRequest handles POST /v1/privacy/cancel. It transitions
// a received / in_progress request to cancelled. The request id comes
// from the JSON body.
func (s *Server) privacyCancelRequest(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	payload := readPrivacyPayload(r)
	envelope := buildPrivacyCommandEnvelope(r, authenticated, payload, "CancelPrivacyRequest")
	result := s.Identity.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": renderPrivacyRequestFromResult(result)})
}

// privacyStatus handles GET /v1/privacy/status?requestId=... and
// returns the current status of a request the caller owns.
func (s *Server) privacyStatus(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	requestID := strings.TrimSpace(r.URL.Query().Get("requestId"))
	if requestID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request_id_required"})
		return
	}
	envelope := buildPrivacyCommandEnvelope(r, authenticated, map[string]any{"requestId": requestID}, "GetPrivacyRequestStatus")
	result := s.Identity.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"request": renderPrivacyRequestFromResult(result)})
}

// privacyList handles GET /v1/privacy/requests and returns the
// caller's full request history, newest first.
func (s *Server) privacyList(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	authenticated, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_service_unavailable"})
		return
	}
	envelope := buildPrivacyCommandEnvelope(r, authenticated, nil, "ListPrivacyRequests")
	result := s.Identity.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	raw, _ := result.Body["privacyRequests"].([]identity.PrivacyRequest)
	rows := make([]privacyRequestEnvelope, 0, len(raw))
	for _, row := range raw {
		rows = append(rows, renderPrivacyRequest(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": rows, "count": len(rows)})
}

// --- helpers ---

// authenticatePrivacyRequest is the shared auth flow for every
// /v1/privacy/* endpoint. It returns the authenticated session on
// success and writes a 401 / 503 on failure. The bool is the "ok"
// signal: false means the handler should return immediately.
func (s *Server) authenticatePrivacyRequest(w http.ResponseWriter, r *http.Request) (identity.AuthenticatedSession, bool) {
	if s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "auth_not_configured"})
		return identity.AuthenticatedSession{}, false
	}
	rawToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return identity.AuthenticatedSession{}, false
	}
	authenticated, err := s.Authenticator.Authenticate(r.Context(), rawToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized", "reason": err.Error()})
		return identity.AuthenticatedSession{}, false
	}
	return authenticated, true
}

// readPrivacyPayload reads the (small) JSON body of a privacy
// request. Privacy bodies are tiny — a legal_basis string, an
// optional reason, and an optional request id — so a 8 KB cap is
// plenty and protects the server from a malicious client streaming
// a multi-gigabyte body.
func readPrivacyPayload(r *http.Request) map[string]any {
	payload := map[string]any{}
	if r.Body == nil {
		return payload
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	if len(body) == 0 {
		return payload
	}
	_ = json.Unmarshal(body, &payload)
	return payload
}

// buildPrivacyCommandEnvelope assembles the command.Envelope the
// service layer expects. CommandID / CorrelationID are derived from
// the HTTP request so the audit log on the privacy_requests_events
// table can be tied back to a specific HTTP call. The envelope is
// a plain struct, not a JSON-decoded body, so the request cannot
// spoof another user's actor / principal: the values come from the
// Authenticator's verified session.
func buildPrivacyCommandEnvelope(r *http.Request, session identity.AuthenticatedSession, payload map[string]any, commandType string) command.Envelope {
	authContext := map[string]any{}
	for k, v := range session.AuthContext {
		authContext[k] = v
	}
	if host, _, splitErr := net.SplitHostPort(r.RemoteAddr); splitErr == nil {
		authContext["clientIp"] = host
	} else {
		authContext["clientIp"] = r.RemoteAddr
	}
	if ua := r.Header.Get("User-Agent"); ua != "" {
		authContext["userAgent"] = ua
	}
	envelope := command.Envelope{
		CommandID:     newRequestID(r, commandType),
		CommandType:   commandType,
		CommandVersion: 1,
		Actor:         session.Actor,
		Principal:     session.Principal,
		Target:        command.Target{Type: "PrivacyRequest", ID: session.Principal.ID},
		IdempotencyKey: extractIdempotencyKey(r),
		AuthContext:   authContext,
		CorrelationID: extractCorrelationID(r),
		CausationID:   r.Header.Get("X-Request-Causation"),
		RequestedAt:   "",
		Payload:       payload,
	}
	return envelope
}

// newRequestID is a tiny correlation-id generator. It uses the
// request's X-Request-Id header if present, otherwise fabricates a
// unique id so each HTTP call has a stable identifier across
// command.Result.CorrelationID and the privacy_request_events log.
func newRequestID(r *http.Request, commandType string) string {
	if id := r.Header.Get("X-Request-Id"); id != "" {
		return id
	}
	return commandType + "-" + strings.ReplaceAll(time.Now().UTC().Format("20060102T150405.000000000Z"), ".", "")
}

// extractCorrelationID prefers X-Correlation-Id, falling back to
// X-Request-Id, falling back to the empty string (which the service
// layer will fill in with the command's own correlation id).
func extractCorrelationID(r *http.Request) string {
	if id := r.Header.Get("X-Correlation-Id"); id != "" {
		return id
	}
	return r.Header.Get("X-Request-Id")
}

// extractIdempotencyKey reads the Idempotency-Key header if any.
// Privacy requests are intrinsically user-driven and not retry-prone,
// so this is optional; absent keys fall back to a per-request value
// which the service layer's Begin() will treat as a fresh attempt.
func extractIdempotencyKey(r *http.Request) string {
	return r.Header.Get("Idempotency-Key")
}

// renderPrivacyRequestFromResult pulls the typed identity.PrivacyRequest
// out of the service's result.Body and projects it onto the wire
// envelope. Returns the zero value if the body is missing or the
// shape has drifted; the caller is expected to treat that as a
// 500 and let the global handler log it.
func renderPrivacyRequestFromResult(result command.Result) privacyRequestEnvelope {
	if result.Body == nil {
		return privacyRequestEnvelope{}
	}
	raw, ok := result.Body["privacyRequest"]
	if !ok {
		return privacyRequestEnvelope{}
	}
	switch v := raw.(type) {
	case identity.PrivacyRequest:
		return renderPrivacyRequest(v)
	case *identity.PrivacyRequest:
		if v == nil {
			return privacyRequestEnvelope{}
		}
		return renderPrivacyRequest(*v)
	}
	return privacyRequestEnvelope{}
}

// writeCommandError translates a service-level command.Result error
// into a JSON HTTP response. The status code is picked from the
// error category: VALIDATION / AUTHORIZATION / NOT_FOUND /
// ACCOUNT_STATE / INTERNAL — these match the codes the service
// already emits, so the translation is just a lookup.
func writeCommandError(w http.ResponseWriter, result command.Result) {
	code := commandResultStatusCode(result)
	body := map[string]any{
		"error":   result.Error.ErrorCode,
		"details": result.Error.SafeDetails,
	}
	if result.CorrelationID != "" {
		body["correlationId"] = result.CorrelationID
	}
	writeJSON(w, code, body)
}

// commandResultStatusCode maps a service-level error category to an
// HTTP status. The mapping is intentionally small and explicit so
// the privacy surface can be audited at a glance.
func commandResultStatusCode(result command.Result) int {
	if result.Error == nil {
		return http.StatusOK
	}
	switch result.Error.Category {
	case "VALIDATION":
		return http.StatusBadRequest
	case "AUTHORIZATION":
		return http.StatusForbidden
	case "NOT_FOUND":
		return http.StatusNotFound
	case "ACCOUNT_STATE":
		return http.StatusConflict
	case "INTERNAL":
		if result.Error.Retryability == "SAFE_RETRY" {
			return http.StatusServiceUnavailable
		}
		return http.StatusInternalServerError
	default:
		return http.StatusInternalServerError
	}
}

// methodGuard rejects requests whose method does not match the
// handler's expected method. It writes a 405 with a structured body
// and returns false so the caller can early-return.
func methodGuard(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed", "expected": method})
		return false
	}
	return true
}

// identityPrivacyRepository lets the privacy center surface list
// historical requests even when the service layer's command pathway
// is not in play.
func (s *Server) identityPrivacyRepository() identity.PrivacyRequestRepository {
	if s.Identity == nil {
		return nil
	}
	repo := s.Identity.Repository()
	if repo == nil {
		return nil
	}
	if p, ok := repo.(identity.PrivacyRequestRepository); ok {
		return p
	}
	return nil
}
