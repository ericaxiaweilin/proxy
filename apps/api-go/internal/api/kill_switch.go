package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/compliance"
)

// legalStatus handles GET /v1/legal/status. The endpoint is
// public (no auth) because the mobile client needs to read it
// at boot before the user has logged in. The response is a
// map keyed by category, with the active KILLED switches
// only. An empty map means the operator has not disabled
// anything.
func (s *Server) legalStatus(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.Compliance == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "compliance_service_unavailable"})
		return
	}
	status, err := s.Compliance.GlobalStatus(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "status_read_failed", "reason": err.Error()})
		return
	}
	if status == nil {
		status = map[string]compliance.KillSwitchView{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"killed": status,
		"checkedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// operatorKillSwitchKill handles POST
// /v1/operator/legal/kill-switch. The endpoint requires an
// authenticated operator (OperatorGate.IsOperator). The
// request body carries { category, reason, expiresAt? }.
func (s *Server) operatorKillSwitchKill(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	if !s.requireOperator(w, r) {
		return
	}
	if s.Compliance == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "compliance_service_unavailable"})
		return
	}
	var body struct {
		Category  string `json:"category"`
		Reason    string `json:"reason"`
		ExpiresAt string `json:"expiresAt,omitempty"`
	}
	if err := decodeBodyJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body", "reason": err.Error()})
		return
	}
	category, err := compliance.NormalizeCategory(body.Category)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_category", "reason": err.Error()})
		return
	}
	var expiresAt *time.Time
	if body.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, body.ExpiresAt)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_expires_at", "reason": err.Error()})
			return
		}
		expiresAt = &t
	}
	row, err := s.Compliance.Kill(r.Context(), category, body.Reason, r.Header.Get("X-Operator-Id"), expiresAt)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kill_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, killSwitchResponse(row))
}

// operatorKillSwitchRearm handles DELETE
// /v1/operator/legal/kill-switch/{category}. Operator only.
func (s *Server) operatorKillSwitchRearm(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodDelete) {
		return
	}
	if !s.requireOperator(w, r) {
		return
	}
	if s.Compliance == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "compliance_service_unavailable"})
		return
	}
	categoryStr := r.PathValue("category")
	category, err := compliance.NormalizeCategory(categoryStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_category", "reason": err.Error()})
		return
	}
	if err := s.Compliance.Rearm(r.Context(), category, r.Header.Get("X-Operator-Id")); err != nil {
		if err == compliance.ErrNotFound {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no_active_switch"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "rearm_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"category": string(category),
		"status": "REARMED",
	})
}

// operatorKillSwitchList handles GET
// /v1/operator/legal/kill-switches. Operator only. Returns
// the full audit trail.
func (s *Server) operatorKillSwitchList(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if !s.requireOperator(w, r) {
		return
	}
	if s.Compliance == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "compliance_service_unavailable"})
		return
	}
	rows, err := s.Compliance.ListHistory(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list_failed", "reason": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, killSwitchResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": out})
}

// requireOperator is a small wrapper around the OperatorGate
// that writes a 403 response and returns false when the
// caller is not an operator. We keep this in the kill_switch
// handler file (rather than security.go) because it is only
// used by the operator routes.
func (s *Server) requireOperator(w http.ResponseWriter, r *http.Request) bool {
	if s.Operator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "operator_gate_unavailable"})
		return false
	}
	// Reuse the access token to identify the operator. The
	// envelope-style IsOperator signature expects command.Actor
	// / command.Principal / map, so we pass the auth context
	// straight through.
	rawToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return false
	}
	auth, err := s.Authenticator.Authenticate(r.Context(), rawToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return false
	}
	if !s.Operator.IsOperator(auth.Actor, auth.Principal, auth.AuthContext) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "operator_privilege_required"})
		return false
	}
	return true
}

func killSwitchResponse(k *compliance.KillSwitch) map[string]any {
	out := map[string]any{
		"id": k.ID,
		"category": string(k.Category),
		"status": string(k.Status),
		"reason": k.Reason,
		"setBy": k.SetBy,
		"setAt": k.SetAt.UTC().Format(time.RFC3339),
	}
	if k.ExpiresAt != nil {
		out["expiresAt"] = k.ExpiresAt.UTC().Format(time.RFC3339)
	}
	if k.RearmedBy != nil {
		out["rearmedBy"] = *k.RearmedBy
	}
	if k.RearmedAt != nil {
		out["rearmedAt"] = k.RearmedAt.UTC().Format(time.RFC3339)
	}
	return out
}

// decodeBodyJSON is a tiny wrapper that decodes a request
// body with a size cap. We duplicate this from the privacy
// handler to keep the kill-switch file self-contained.
func decodeBodyJSON(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 4096)
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}
