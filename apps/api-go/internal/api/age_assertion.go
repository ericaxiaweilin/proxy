package api

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// POST /v1/identity/age-assertion — 老账号补年龄断言 (AGE-BACKFILL-001).
//
// COMP-AGE-001 之前注册的账号没有出生日期，user_age_assertions 里零记录，
// AI 伴侣 / 分身门禁（COMP-AI-MINOR-001）会 fail-closed 拒绝。这一口给
// 调用者本人补一条 SELF_DECLARED_BACKFILL 断言（append-only，写错可重交纠正）。
//
// Body: { dateOfBirth: "YYYY-MM-DD" }，必须是过去的合法日期。未成年也如实
// 记录 —— 成年与否由各门禁判定，这里不替用户决定。成功返回 201
// {"recorded": true}；调用方（分身中心）随后重试被拦的创建，用创建结果
// 说话，不在这里预判成年。
func (s *Server) recordAgeAssertion(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	auth, ok := s.authenticateAgeAssertionRequest(w, r)
	if !ok {
		return
	}
	if s.Identity == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_unavailable"})
		return
	}
	var body struct {
		DateOfBirth string `json:"dateOfBirth"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	if err := s.Identity.RecordAgeAssertionBackfill(r.Context(), auth.Actor.ID, body.DateOfBirth, clientIPOf(r), r.Header.Get("User-Agent")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "record_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"recorded": true})
}

func (s *Server) authenticateAgeAssertionRequest(w http.ResponseWriter, r *http.Request) (identity.AuthenticatedSession, bool) {
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

func clientIPOf(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return strings.TrimSpace(host)
	}
	return strings.TrimSpace(r.RemoteAddr)
}
