package api

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/location"
)

// LocationRepo is the storage surface the HTTP layer needs to
// read the consent history (list) endpoint. We expose it as an
// explicit field on Server rather than reaching into the
// service so the wiring stays obvious in main.go.
type LocationRepo = location.Repository

// locationConsentEnvelope is the wire shape of a precise-location
// consent record. The fields mirror the location.ConsentStatus
// struct that the service layer emits in Result.Body; the HTTP
// layer is a thin pass-through with status code mapping.
type locationConsentEnvelope struct {
	Kind             string `json:"kind"`
	Status           string `json:"status"`
	GrantedAt        string `json:"grantedAt,omitempty"`
	ExpiresAt        string `json:"expiresAt,omitempty"`
	RemainingSeconds int    `json:"remainingSeconds"`
	LastUsedAt       string `json:"lastUsedAt,omitempty"`
	DurationSeconds  int    `json:"durationSeconds"`
}

// locationConsentGet handles GET /v1/location/consent. It returns
// the current consent for the authenticated user, or status=NONE
// if no active grant exists. The endpoint also runs the expiry
// sweep, so a row whose expires_at is in the past is reported as
// EXPIRED rather than GRANTED.
func (s *Server) locationConsentGet(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.Location == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "location_service_unavailable"})
		return
	}
	envelope := buildLocationCommandEnvelope(r, auth, nil, "GetLocationConsentStatus")
	// GET has no body, so the kind arrives as ?kind=. Absent means the
	// service's PRECISE_GPS default (older clients send nothing).
	if kind := strings.TrimSpace(r.URL.Query().Get("kind")); kind != "" {
		envelope.Payload = map[string]any{"kind": kind}
	}
	result := s.Location.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	body := locationConsentEnvelope{}
	copyConsentBody(result.Body, &body)
	writeJSON(w, http.StatusOK, body)
}

// locationConsentGrant handles POST /v1/location/consent/grant. The
// request body carries the duration in seconds; 0 means "use the
// default". Only durations in location.AllowedDurations (30 min or
// 8 hours) are accepted — anything else is rejected with 400.
func (s *Server) locationConsentGrant(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.Location == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "location_service_unavailable"})
		return
	}
	payload := readLocationPayload(r)
	envelope := buildLocationCommandEnvelope(r, auth, payload, "GrantLocationConsent")
	result := s.Location.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	body := locationConsentEnvelope{}
	copyConsentBody(result.Body, &body)
	writeJSON(w, http.StatusCreated, body)
}

// locationConsentRevoke handles POST /v1/location/consent/revoke.
// The request body is empty; the consent is scoped to the
// authenticated user. Revoking a non-existent consent is a no-op
// (wasActive=false in the response).
func (s *Server) locationConsentRevoke(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.Location == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "location_service_unavailable"})
		return
	}
	payload := readLocationPayload(r)
	envelope := buildLocationCommandEnvelope(r, auth, payload, "RevokeLocationConsent")
	result := s.Location.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeCommandError(w, result)
		return
	}
	// Report the kind the SERVICE acted on, not a constant. This used to
	// hardcode PRECISE_GPS, so revoking a fuzzy grant answered
	// "PRECISE_GPS" — the client would then render the wrong switch as off.
	kind, _ := result.Body["kind"].(string)
	if kind == "" {
		// The service always echoes the kind. If it ever stops, say so
		// rather than inventing one.
		kind = "UNKNOWN"
	}
	body := map[string]any{
		"kind":      kind,
		"status":    "REVOKED",
		"wasActive": result.Body["wasActive"],
	}
	writeJSON(w, http.StatusOK, body)
}

// locationConsentHistory handles GET /v1/location/consent/history.
// It returns the full history of consent grants / revocations for
// the authenticated user, newest first. The mobile client uses
// this to render a privacy center card.
func (s *Server) locationConsentHistory(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.LocationRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "location_repository_unavailable"})
		return
	}
	rows, err := s.LocationRepo.ListByUser(r.Context(), auth.Principal.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "history_read_failed", "reason": err.Error()})
		return
	}
	out := make([]locationConsentEnvelope, 0, len(rows))
	now := time.Now()
	for _, row := range rows {
		envelope := locationConsentEnvelope{
			Kind:             string(row.Kind),
			Status:           string(row.Status),
			DurationSeconds:  row.DurationSeconds,
			RemainingSeconds: int(row.Remaining(now).Seconds()),
		}
		envelope.GrantedAt = row.GrantedAt.UTC().Format(time.RFC3339)
		envelope.ExpiresAt = row.ExpiresAt.UTC().Format(time.RFC3339)
		if row.LastUsedAt != nil {
			envelope.LastUsedAt = row.LastUsedAt.UTC().Format(time.RFC3339)
		}
		out = append(out, envelope)
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": out})
}

// authenticateLocationRequest enforces a valid access token. We
// duplicate the privacy-center's pattern rather than exporting it
// because the two endpoints use different error keys so a
// misconfigured client can tell which endpoint rejected the
// request.
func (s *Server) authenticateLocationRequest(w http.ResponseWriter, r *http.Request) (identity.AuthenticatedSession, bool) {
	if s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "auth_not_configured"})
		return identity.AuthenticatedSession{}, false
	}
	rawToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return identity.AuthenticatedSession{}, false
	}
	auth, err := s.Authenticator.Authenticate(r.Context(), rawToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized", "reason": err.Error()})
		return identity.AuthenticatedSession{}, false
	}
	return auth, true
}

// buildLocationCommandEnvelope wraps the authenticated session
// into a command.Envelope. Mirrors buildPrivacyCommandEnvelope
// but uses a LocationConsent default commandVersion.
//
// commandVersion is set to "1.0" for now; bump it if the
// envelope shape ever changes incompatibly. The mobile client
// reads it back from the response to confirm the server is
// speaking the same protocol.
func buildLocationCommandEnvelope(r *http.Request, auth identity.AuthenticatedSession, payload map[string]any, commandType string) command.Envelope {
	if payload == nil {
		payload = map[string]any{}
	}
	return command.Envelope{
		CommandID:      newRequestID(r, commandType),
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          auth.Actor,
		Principal:      auth.Principal,
		AuthContext:    buildAuthContextFor(r, auth),
		IdempotencyKey: extractIdempotencyKey(r),
		CorrelationID:  extractCorrelationID(r),
		RequestedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Payload:        payload,
	}
}

// buildAuthContextFor packages the client IP and user agent into
// AuthContext so the service layer can read them via
// envelope.AuthContextIP() / AuthContextUA().
func buildAuthContextFor(r *http.Request, auth identity.AuthenticatedSession) map[string]any {
	ctx := map[string]any{}
	if auth.AuthContext != nil {
		for k, v := range auth.AuthContext {
			ctx[k] = v
		}
	}
	if _, ok := ctx["clientIp"]; !ok {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			ctx["clientIp"] = host
		} else {
			ctx["clientIp"] = r.RemoteAddr
		}
	}
	if _, ok := ctx["userAgent"]; !ok {
		ctx["userAgent"] = r.UserAgent()
	}
	return ctx
}

// readLocationPayload reads the JSON body of a location consent
// request. The shape is { kind?: string, durationSeconds?: number }
// so we tolerate missing bodies and missing fields.
//
// `kind` MUST be forwarded when present: it selects which consent the
// command acts on (PRECISE_GPS vs FUZZY_REGION). Dropping it here
// would make every request silently mean PRECISE_GPS — the service
// would then grant the stronger disclosure the caller did not ask
// for. Absent/empty is still left absent, so the service applies its
// documented PRECISE_GPS default for older clients.
func readLocationPayload(r *http.Request) map[string]any {
	payload := map[string]any{}
	if r.Body == nil {
		return payload
	}
	defer func() {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
	}()
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
	if len(body) == 0 {
		return payload
	}
	parsed := map[string]any{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return payload
	}
	if v, ok := parsed["kind"]; ok {
		payload["kind"] = v
	}
	if v, ok := parsed["durationSeconds"]; ok {
		payload["durationSeconds"] = v
	}
	return payload
}

// copyConsentBody projects the result body map into the wire
// envelope. The service layer emits the same field names, so the
// copy is a straight field-by-field read.
func copyConsentBody(src map[string]any, dst *locationConsentEnvelope) {
	if src == nil {
		return
	}
	if v, ok := src["kind"].(string); ok {
		dst.Kind = v
	}
	if v, ok := src["status"].(string); ok {
		dst.Status = v
	}
	if v, ok := src["grantedAt"].(string); ok {
		dst.GrantedAt = v
	}
	if v, ok := src["expiresAt"].(string); ok {
		dst.ExpiresAt = v
	}
	if v, ok := src["lastUsedAt"].(string); ok {
		dst.LastUsedAt = v
	}
	switch n := src["remainingSeconds"].(type) {
	case int:
		dst.RemainingSeconds = n
	case int64:
		dst.RemainingSeconds = int(n)
	case float64:
		dst.RemainingSeconds = int(n)
	}
	switch n := src["durationSeconds"].(type) {
	case int:
		dst.DurationSeconds = n
	case int64:
		dst.DurationSeconds = int(n)
	case float64:
		dst.DurationSeconds = int(n)
	}
}
