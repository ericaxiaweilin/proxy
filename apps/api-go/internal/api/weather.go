package api

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/weather"
)

// WEATHER-001：GET /v1/weather?lat=&lng=[&at=RFC3339&hours=2]
// 地址旁的天气（now）；带 at 时再给「那个见面时段」的提示等级和更合适的开始时间。
// 只收城市级坐标（服务端再取整到 0.1° 才出站），不需要登录也不记录谁查的。
// 产品只在越南，预报时区固定 UTC+7。
var weatherLoc = time.FixedZone("ICT", 7*3600)

func (s *Server) publicWeather(w http.ResponseWriter, r *http.Request) {
	if !methodGuard(w, r, http.MethodGet) {
		return
	}
	if s.Weather == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "weather_unavailable"})
		return
	}
	q := r.URL.Query()
	lat, e1 := strconv.ParseFloat(q.Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(q.Get("lng"), 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_location"})
		return
	}
	rep, err := s.Weather.Forecast(r.Context(), lat, lng)
	if err != nil {
		log.Printf("weather upstream: %v", err) // 不带坐标
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "weather_unavailable"})
		return
	}
	out := map[string]any{"now": rep.Now, "fetchedAt": rep.FetchedAt}
	if raw := q.Get("at"); raw != "" {
		at, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_at"})
			return
		}
		hours := 2.0
		if h, err := strconv.ParseFloat(q.Get("hours"), 64); err == nil && h > 0 && h <= 12 {
			hours = h
		}
		out["advice"] = weather.Advise(rep, at, time.Duration(hours*float64(time.Hour)), time.Now(), weatherLoc)
	}
	writeJSON(w, http.StatusOK, out)
}
