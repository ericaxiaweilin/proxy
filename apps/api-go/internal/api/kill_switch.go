package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
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
	out := killSwitchResponse(row)
	// LC-16 (2026-09-21): arming a category with no enforcement
	// point writes an audit row and blocks nothing. We do NOT
	// refuse the call -- declaring an incident is a legitimate
	// use of the switch even when the actual mitigation happens
	// elsewhere (a load balancer, a feature flag). But we must
	// not let the operator walk away believing traffic stopped,
	// so the response and the log say so at the moment the false
	// belief would otherwise form.
	if !compliance.IsEnforceable(category) {
		out["warning"] = "category " + string(category) + " has no enforcement point: the decision is recorded, but no command is blocked"
		log.Printf("kill-switch: armed %s with NO enforcement point (operator=%q) -- nothing is blocked; see compliance.EnforceableCategories",
			category, r.Header.Get("X-Operator-Id"))
	}
	writeJSON(w, http.StatusCreated, out)
}

// operatorKillSwitchRearm handles DELETE
// /v1/operator/legal/kill-switch/{category}. Operator only.
//
// COMP-KILLSWITCH-REARM-001（2026-09-27 修）：这里原来用 r.PathValue("category")。
// 本仓的 http.NewServeMux 上没有任何带 {name} 的 pattern（server.go 里
// 全部是字面路径，如 "/v1/operator/legal/kill-switch/"），所以 PathValue
// **恒为空串**，NormalizeCategory("") 必然失败 —— 这个 DELETE 口从上线起
// 就只会返回 400 invalid_category。
//
// 后果不是「少个功能」：法务 kill switch 一旦被武装就**再也卸不掉**
// （只能直接改库）。这是一个合规工具，不能只有武装没有解除。
//
// 之所以一直没被发现：kill_switch_dispatch_test.go 测的是
// svc.Rearm(...)（服务层），从来没有一个用例穿过 mux 打到这个 HTTP 口。
// 修法 + 补钉见同批的 kill_switch_rearm_route_test.go。
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
	raw := strings.TrimPrefix(r.URL.Path, "/v1/operator/legal/kill-switch/")
	categoryStr := strings.Trim(strings.TrimSpace(raw), "/")
	if categoryStr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "category_required"})
		return
	}
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
		// LC-16 (2026-09-21): whether this row actually blocks
		// anything. A false here means the switch is a record of
		// the operator's decision, not a mitigation. The audit
		// list carries it too, so a post-incident review can see
		// which switches were no-ops without re-reading the code.
		"enforced": compliance.IsEnforceable(k.Category),
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
