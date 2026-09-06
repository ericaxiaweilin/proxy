package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/location"
	"github.com/proxy-app/proxy-api/internal/realityscene"
)

type realitySceneRecord = realityscene.Scene

func (s *Server) publicRealityScenes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if !s.rateAllow("ip:" + clientIP(r, s.TrustCloudflareIP) + ":public_reality_scenes") {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Retry-After", "60")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	svc := s.RealityScene
	if svc == nil {
		svc = realityscene.New()
	}
	scenes, err := svc.ListScenes(r.Context())
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "scene_projection_unavailable"})
		return
	}
	payload, err := json.Marshal(map[string]any{"scenes": scenes, "privacy": "historical_public_not_live"})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "scene_projection_failed"})
		return
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(payload))
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(payload)
}

// dynamicSceneRead exposes the R27 canonical read projection. Public reads are
// intentional: authentication gates commitments, not scene discovery.
func (s *Server) dynamicSceneRead(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/v1/scenes/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "scene_not_found"})
		return
	}
	svc := s.RealityScene
	if svc == nil {
		svc = realityscene.New()
	}
	detail, found, err := svc.GetDetail(r.Context(), parts[0], r.URL.Query().Get("variant"), time.Now())
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "scene_projection_unavailable"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "scene_not_found"})
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=30, stale-while-revalidate=120")
	if len(parts) == 1 {
		writeJSON(w, http.StatusOK, detail)
		return
	}
	switch parts[1] {
	case "live-state":
		writeJSON(w, http.StatusOK, detail.LiveState)
	case "menu":
		writeJSON(w, http.StatusOK, map[string]any{"sceneId": detail.SceneID, "variant": detail.SelectedVariant, "items": detail.Menu})
	case "humans":
		writeJSON(w, http.StatusOK, map[string]any{"sceneId": detail.SceneID, "variant": detail.SelectedVariant, "humans": detail.Humans, "reservation": false})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "scene_projection_not_found"})
	}
}

func (s *Server) nearbyRealityScenes(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	auth, ok := s.authenticateLocationRequest(w, r)
	if !ok {
		return
	}
	if s.LocationRepo == nil || s.RealityScene == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "location_pipeline_unavailable"})
		return
	}
	now := time.Now().UTC()
	_, _ = s.LocationRepo.ExpireOverdue(r.Context(), now)
	consent, err := s.LocationRepo.GetActive(r.Context(), auth.Actor.ID, location.KindPreciseGPS)
	if err != nil || !consent.Active(now) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "precise_location_consent_required"})
		return
	}
	var input struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		RadiusKM  float64 `json:"radiusKm"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_location_query"})
		return
	}
	if input.RadiusKM == 0 {
		input.RadiusKM = 10
	}
	if input.Latitude < -90 || input.Latitude > 90 || input.Longitude < -180 || input.Longitude > 180 || input.RadiusKM <= 0 || input.RadiusKM > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_location_query"})
		return
	}
	scenes, err := s.RealityScene.ListNearbyScenes(r.Context(), input.Latitude, input.Longitude, input.RadiusKM, 30)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "nearby_scene_read_failed"})
		return
	}
	_ = s.LocationRepo.Touch(r.Context(), consent.ID, now)
	writeJSON(w, http.StatusOK, map[string]any{"scenes": scenes, "origin": "current_location", "radiusKm": input.RadiusKM, "privacy": "precise_location_not_persisted"})
}
