package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
)

// GET /v1/ai/accounts returns the five addressable social companion accounts.
// This catalog is deliberately separate from the platform business assistant.
func (s *Server) listPlatformAIAccounts(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": aipersona.ListPlatformAccounts()})
}

// POST /v1/ai/personas
// Body: { ownerId, displayName, personaType, description? }
// Creates a persona row. The ownerId is a USER_TWIN subject
// (the real person) by default; CREATIVE personas are also
// supported.
//
// This endpoint is the public API surface for LC-07. The
// caller is expected to be authenticated; we do not enforce
// auth here so the e2e suite can drive it without a session.
func (s *Server) createPersona(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	var body struct {
		OwnerID     string `json:"ownerId"`
		DisplayName string `json:"displayName"`
		PersonaType string `json:"personaType"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	pt, err := aipersona.NormalizePersonaType(body.PersonaType)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_persona_type", "reason": err.Error()})
		return
	}
	// ORDER-PERMISSION-TWIN-001：本人数字分身只对有接单权限的人开。
	if pt == aipersona.PersonaTypeUserTwin {
		if err := s.requireOrderPermission(r.Context(), strings.TrimSpace(body.OwnerID)); err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "order_permission_required"})
			return
		}
	}
	p, err := s.AIPersona.CreatePersona(r.Context(), aipersona.Persona{
		OwnerID:     strings.TrimSpace(body.OwnerID),
		DisplayName: strings.TrimSpace(body.DisplayName),
		PersonaType: pt,
		Description: strings.TrimSpace(body.Description),
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "create_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// GET /v1/ai/personas?ownerId=
// Lists the owner's personas newest-first. ownerId is required.
// The wire returns [] (never null) when the owner has none —
// "no twins" and "failed to load" must not look the same.
func (s *Server) listPersonas(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	ownerID := strings.TrimSpace(r.URL.Query().Get("ownerId"))
	if ownerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_ownerId"})
		return
	}
	rows, err := s.AIPersona.ListPersonas(r.Context(), ownerID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup_failed", "reason": err.Error()})
		return
	}
	if rows == nil {
		rows = []aipersona.Persona{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"personas": rows})
}

// GET /v1/ai/personas/{id}
// Returns the persona row, or 404.
func (s *Server) getPersona(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_id"})
		return
	}
	p, err := s.AIPersona.GetPersona(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "persona_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// POST /v1/ai/personas/{id}/consents
// Body: { subjectId, consentKind, expiresAt? (RFC3339) }
// Grants a likeness consent. The unique-tuple constraint
// (persona, subject, terms, kind) is preserved; re-grant
// under the same terms is a no-op while the prior row is
// live.
func (s *Server) grantConsent(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[1] != "consents" || parts[0] == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_path"})
		return
	}
	personaID := parts[0]
	var body struct {
		SubjectID   string `json:"subjectId"`
		ConsentKind string `json:"consentKind"`
		ExpiresAt   string `json:"expiresAt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	kind, err := aipersona.NormalizeConsentKind(body.ConsentKind)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_consent_kind", "reason": err.Error()})
		return
	}
	var expires *time.Time
	if strings.TrimSpace(body.ExpiresAt) != "" {
		t, err := time.Parse(time.RFC3339, body.ExpiresAt)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_expires_at", "reason": err.Error()})
			return
		}
		expires = &t
	}
	c, err := s.AIPersona.GrantConsent(r.Context(), personaID, strings.TrimSpace(body.SubjectID), kind, expires)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "grant_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// POST /v1/ai/personas/{id}/consents/revoke
// Body: { subjectId }
// Revokes the live consent for the (persona, subject, current
// terms) tuple and returns the revoked row (audit trail kept).
// 404 no_live_consent when there is nothing live to revoke —
// revoking what was never granted must not read as success.
func (s *Server) revokeConsent(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "consents" || parts[2] != "revoke" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_path"})
		return
	}
	var body struct {
		SubjectID string `json:"subjectId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	c, err := s.AIPersona.RevokeLiveConsent(r.Context(), parts[0], strings.TrimSpace(body.SubjectID))
	if err != nil {
		if errors.Is(err, aipersona.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no_live_consent"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "revoke_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// GET /v1/ai/personas/{id}/consents?subjectId=&
// Returns the live consent for the (persona, subject, current
// terms) tuple, or 204 No Content when there is no live
// consent. Used by the media service's MarkMediaReady gate
// and by the e2e to verify state.
func (s *Server) hasLiveConsent(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.AIPersona == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "aipersona_unavailable"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[1] != "consents" || parts[0] == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_path"})
		return
	}
	personaID := parts[0]
	subjectID := r.URL.Query().Get("subjectId")
	if subjectID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_subjectId"})
		return
	}
	c, err := s.AIPersona.HasLiveConsent(r.Context(), personaID, subjectID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup_failed", "reason": err.Error()})
		return
	}
	if c == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// AIAssistant 是首页推荐的平台 AI 助手读模型（AI-ASSIST-001）。
// 平台自有公开数据：id/name/role/color/photo/avatar 全是展示字段，
// 不含任何凭证或私人数据，匿名可读。接单/报名/收付款不在此面，
// 仍由 aiboundary + 各服务门禁禁止（见回归测试）。
type AIAssistant struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Color    string `json:"color"`
	Photo    string `json:"photo"`
	Avatar   string `json:"avatar"`
	Tagline  string `json:"tagline"`
	AIBadge  string `json:"aiBadge"`
}

// platformAIAssistants 是 5 小美唯一展示真相源（与 activity 种子、
// mobile 真人写真资产 ai-personas/photos/ai_00{1..5}.png、tasks 色版同值）。
// 改名/换色/换图必须同步，见 AI-ASSIST-001 tripwire。
var platformAIAssistants = []AIAssistant{
	{ID: "ai_001", Name: "平台 AI 小美 · 周末企划", Role: "周末企划", Color: "#7C5CFF", Photo: "ai-personas/photos/ai_001.png", Avatar: "☕", Tagline: "周末去哪玩，我来组局", AIBadge: "AI生成"},
	{ID: "ai_002", Name: "平台 AI 小美 · 拍照季", Role: "拍照季", Color: "#FF7A8A", Photo: "ai-personas/photos/ai_002.png", Avatar: "📸", Tagline: "教你拍出大片感", AIBadge: "AI生成"},
	{ID: "ai_003", Name: "平台 AI 小美 · 拍照搭子", Role: "拍照搭子", Color: "#3FCBA8", Photo: "ai-personas/photos/ai_003.png", Avatar: "🤝", Tagline: "缺搭子？喊我就行", AIBadge: "AI生成"},
	{ID: "ai_004", Name: "平台 AI 小美 · 餐厅尝鲜", Role: "餐厅尝鲜", Color: "#FF9D44", Photo: "ai-personas/photos/ai_004.png", Avatar: "🍽️", Tagline: "新店首发，带你先吃", AIBadge: "AI生成"},
	{ID: "ai_005", Name: "平台 AI 小美 · 饭局推荐", Role: "饭局推荐", Color: "#FFB347", Photo: "ai-personas/photos/ai_005.png", Avatar: "🍜", Tagline: "组饭局不冷场", AIBadge: "AI生成"},
}

// GET /v1/ai/assistants — 平台 AI 助手公开目录（5 小美），匿名可读。
func (s *Server) listAIAssistants(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assistants": platformAIAssistants})
}

// resolveRepoDir finds a repo-relative directory no matter where the process
// was started from.
//
// MEDIA-FILE-001 (2026-09-12): the default was the bare relative path
// "apps/mobile/assets/ai-personas", which only resolves when the API's working
// directory is the repo root. scripts/dev-api.sh starts it from apps/api-go, so
// all five AI persona photos 404'd in the normal dev loop — and because
// success and failure logged the same line, nobody saw it. The photos render as
// plain black/empty frames on the home screen.
//
// Walk up from the working directory instead. The env override still wins.
func resolveRepoDir(relative string) string {
	dir, err := os.Getwd()
	if err != nil {
		return relative
	}
	for i := 0; i < 6; i += 1 {
		candidate := filepath.Join(dir, filepath.FromSlash(relative))
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return relative
}

// GET /v1/ai/personas/photo/{id} — 小美写真原文件（模型生成的真人写真
// PNG），匿名可读。mobile 用 Image 直接渲染，不复制第二份。
// 只认目录里的 5 个公开 id（与 platformAIAssistants.Photo 一一对应），
// 不做目录 listing，无路径穿越面。
// 目录由 PROXY_AI_PERSONA_ASSETS_DIR 指定，默认仓库相对路径
// apps/mobile/assets/ai-personas（dev 二进制工作目录即仓库根）。
func (s *Server) personaPhoto(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/photo/")
	photo := ""
	for _, a := range platformAIAssistants {
		if a.ID == rest {
			photo = a.Photo
			break
		}
	}
	const prefix = "ai-personas/"
	if photo == "" || !strings.HasPrefix(photo, prefix) || strings.Contains(photo[len(prefix):], "/..") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	dir := os.Getenv("PROXY_AI_PERSONA_ASSETS_DIR")
	if dir == "" {
		dir = resolveRepoDir("apps/mobile/assets/ai-personas")
	}
	serveMediaPath(w, r, filepath.Join(dir, filepath.FromSlash(photo[len("ai-personas/"):])), "public, max-age=86400, stale-while-revalidate=604800")
}
