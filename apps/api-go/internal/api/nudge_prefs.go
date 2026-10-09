package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// NudgePrefs 读写「引导推送」开关（NUDGE-OPTOUT-001）。
type NudgePrefs interface {
	NudgesEnabled(ctx context.Context, userID string) (bool, error)
	SetNudgesEnabled(ctx context.Context, userID string, enabled bool, now time.Time) error
}

// myNudges：GET /v1/me/nudges → {"enabled": bool}；POST {"enabled": bool} 改开关。
// 只管「发第一条动态 / 发第一个需求」这类引导推送；订单和安全通知不受它影响。
func (s *Server) myNudges(w http.ResponseWriter, r *http.Request) {
	if s.NudgePrefs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "nudge_prefs_unavailable"})
		return
	}
	auth, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	id := auth.Actor.ID
	switch r.Method {
	case http.MethodGet:
		enabled, err := s.NudgePrefs.NudgesEnabled(r.Context(), id)
		if err != nil {
			log.Printf("nudge prefs read: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "nudge_prefs_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
	case http.MethodPost:
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body) != nil || body.Enabled == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "enabled_required"})
			return
		}
		if err := s.NudgePrefs.SetNudgesEnabled(r.Context(), id, *body.Enabled, time.Now()); err != nil {
			log.Printf("nudge prefs write: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "nudge_prefs_failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"enabled": *body.Enabled})
	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
	}
}
