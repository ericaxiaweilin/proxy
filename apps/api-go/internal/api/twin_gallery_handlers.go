package api

import (
	"net/http"
	"strings"
)

// twinGalleryMediaItem is the wire projection for one 图库 photo —
// deliberately smaller than media.MediaAsset (no storage keys, checksums,
// composition hints): the gallery only needs enough to render a thumbnail
// grid and open an action sheet.
type twinGalleryMediaItem struct {
	ID                 string `json:"id"`
	ThumbnailURL       string `json:"thumbnailUrl"`
	PlaybackURL        string `json:"playbackUrl,omitempty"`
	AIGenerationSource string `json:"aiGenerationSource"`
	CreatedAt          string `json:"createdAt"`
}

// GET /v1/ai/personas/{id}/media?source=raw|ai
//
// AI-TWIN-GALLERY-001: two real sources, no invented third one.
//   - source=ai:  photos this persona has generated (persona_id-scoped).
//   - source=raw: the caller's own uploaded, non-AI photos (owner-scoped —
//     raw material belongs to the person, not to any one persona).
//
// Requires a session, unlike the other /v1/ai/personas endpoints (which
// intentionally skip auth for e2e convenience — see createPersona's
// comment). A gallery is private; "list someone else's raw photos by
// guessing their ownerId" must not be possible just because the persona
// endpoints elsewhere are open.
func (s *Server) listPersonaGallery(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.Media == nil || s.AIPersona == nil || s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "gallery_unavailable"})
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/v1/ai/personas/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[1] != "media" || parts[0] == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_path"})
		return
	}
	personaID := parts[0]
	source := r.URL.Query().Get("source")
	if source != "ai" && source != "raw" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_source"})
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
	persona, err := s.AIPersona.GetPersona(r.Context(), personaID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "persona_not_found"})
		return
	}
	if persona.OwnerID != authenticated.Principal.ID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not_persona_owner"})
		return
	}
	assets, err := s.Media.ListPersonaGallery(r.Context(), authenticated.Principal.ID, personaID, source)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gallery_lookup_failed", "reason": err.Error()})
		return
	}
	items := make([]twinGalleryMediaItem, 0, len(assets))
	for _, a := range assets {
		items = append(items, twinGalleryMediaItem{
			ID:                 a.MediaAssetID,
			ThumbnailURL:       a.ThumbnailURL,
			PlaybackURL:        a.PlaybackURL,
			AIGenerationSource: a.AIGenerationSource,
			CreatedAt:          a.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
