package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/jurisdiction"
)

// GET /v1/identity/jurisdiction
// Returns the caller's current jurisdiction. The
// authenticated principal id is the user id; the
// jurisdiction service falls back to the platform default
// (VN-79) when the user has no row.
func (s *Server) getJurisdiction(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.Jurisdiction == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "jurisdiction_unavailable"})
		return
	}
	userID, ok := authenticatePrincipal(s, w, r)
	if !ok {
		return
	}
	row, err := s.Jurisdiction.Resolve(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "resolve_failed", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// PATCH /v1/identity/jurisdiction
// Body: { jurisdiction: "VN-79" } or { country: "VN", region: "79" }
// The user updates their own jurisdiction. Operators use a
// separate operator-only endpoint (TODO). The rate limit
// is enforced upstream (the user can change at most once
// per 24 hours); this method only writes.
func (s *Server) setJurisdiction(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPatch) {
		return
	}
	if s.Jurisdiction == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "jurisdiction_unavailable"})
		return
	}
	userID, ok := authenticatePrincipal(s, w, r)
	if !ok {
		return
	}
	var body struct {
		Jurisdiction string `json:"jurisdiction"`
		Country      string `json:"country"`
		Region       string `json:"region"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	var j jurisdiction.Jurisdiction
	if strings.TrimSpace(body.Jurisdiction) != "" {
		parsed, err := jurisdiction.ParseJurisdiction(body.Jurisdiction)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_jurisdiction", "reason": err.Error()})
			return
		}
		j = parsed
	} else {
		if body.Country == "" || body.Region == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_country_or_region"})
			return
		}
		region, err := jurisdiction.NormalizeRegion(body.Region)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_region", "reason": err.Error()})
			return
		}
		j = jurisdiction.Jurisdiction{Country: jurisdiction.Country(strings.ToUpper(strings.TrimSpace(body.Country))), Region: region}
	}
	if err := s.Jurisdiction.Set(r.Context(), userID, j, "USER_SELF"); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "set_failed", "reason": err.Error()})
		return
	}
	row, _ := s.Jurisdiction.Resolve(r.Context(), userID)
	writeJSON(w, http.StatusOK, row)
}
