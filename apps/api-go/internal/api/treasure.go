package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/treasure"
)

// TREASURE-001：寻宝接口（登录）。判定全在 internal/treasure；这里只做收参、限速、把原因码翻成 HTTP 状态。
//
//	GET  /v1/treasure/nearby?lat=&lng=   5 公里内的活箱子 + 我能凭它开同行加成的订单 + 今日已开
//	POST /v1/treasure/open               {kind:"SOLO",chestId} 或 {kind:"COMPANION",activityId,companionId}，都带 lat/lng/accuracy
func (s *Server) treasureNearby(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.Treasure == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "treasure_unavailable"})
		return
	}
	auth, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	lat, e1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e1 != nil || e2 != nil || !(treasure.Location{Lat: lat, Lng: lng}).Valid() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "BAD_LOCATION"})
		return
	}
	out, err := s.Treasure.Nearby(r.Context(), auth.Actor.ID, lat, lng, time.Now())
	if err != nil {
		log.Printf("treasure nearby: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "treasure_failed"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) treasureOpen(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodPost) {
		return
	}
	if s.Treasure == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "treasure_unavailable"})
		return
	}
	auth, ok := s.authenticatePrivacyRequest(w, r)
	if !ok {
		return
	}
	if !s.rateAllow("user:" + auth.Actor.ID + ":treasure_open") {
		w.Header().Set("Retry-After", "30")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	var body struct {
		Kind        string  `json:"kind"`
		ChestID     string  `json:"chestId"`
		ActivityID  string  `json:"activityId"`
		CompanionID string  `json:"companionId"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
		Accuracy    float64 `json:"accuracy"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "json_body_required"})
		return
	}
	loc := treasure.Location{Lat: body.Lat, Lng: body.Lng, AccuracyM: body.Accuracy}
	var (
		res treasure.Result
		err error
	)
	switch body.Kind {
	case "SOLO":
		res, err = s.Treasure.OpenSolo(r.Context(), auth.Actor.ID, body.ChestID, loc, time.Now())
	case "COMPANION":
		res, err = s.Treasure.OpenCompanion(r.Context(), auth.Actor.ID, body.ActivityID, body.CompanionID, loc, time.Now())
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_kind"})
		return
	}
	if err != nil {
		code, status := treasureError(err)
		if status == http.StatusInternalServerError {
			log.Printf("treasure open: %v", err)
		}
		out := map[string]any{"error": code}
		if res.DistanceM > 0 {
			out["distanceM"] = res.DistanceM
		}
		writeJSON(w, status, out)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func treasureError(err error) (string, int) {
	switch {
	case errors.Is(err, treasure.ErrBadLocation):
		return "BAD_LOCATION", http.StatusBadRequest
	case errors.Is(err, treasure.ErrTooFar), errors.Is(err, treasure.ErrAccuracy), errors.Is(err, treasure.ErrSpeed), errors.Is(err, treasure.ErrNotEligible), errors.Is(err, treasure.ErrDailyCap):
		return err.Error(), http.StatusUnprocessableEntity
	case errors.Is(err, treasure.ErrAlreadyOpened):
		return err.Error(), http.StatusConflict
	case errors.Is(err, treasure.ErrChestGone):
		return err.Error(), http.StatusNotFound
	}
	return "treasure_failed", http.StatusInternalServerError
}
