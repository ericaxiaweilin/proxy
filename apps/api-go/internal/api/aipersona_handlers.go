package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
)

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
