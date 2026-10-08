package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/weather"
)

type fakeWeather struct{}

func (fakeWeather) Fetch(context.Context, float64, float64) (weather.Report, error) {
	now := time.Now().UTC().Truncate(time.Hour)
	hrs := []weather.Hour{}
	for i := 0; i < 48; i++ {
		c := weather.Clear
		if i >= 2 && i < 6 {
			c = weather.Storm
		}
		hrs = append(hrs, weather.Hour{At: now.Add(time.Duration(i) * time.Hour), PrecipProb: 90, Condition: c})
	}
	return weather.Report{Now: weather.Now{TempC: 27, Condition: weather.Clear}, Hours: hrs}, nil
}

func TestWeatherEndpointValidatesAndAdvises(t *testing.T) {
	s := &Server{Weather: &weather.Service{Provider: fakeWeather{}}}
	get := func(q string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.publicWeather(rec, httptest.NewRequest(http.MethodGet, "/v1/weather?"+q, nil))
		return rec
	}
	if get("lat=abc&lng=106").Code != http.StatusBadRequest {
		t.Fatal("bad coordinates are rejected")
	}
	at := time.Now().UTC().Truncate(time.Hour).Add(3 * time.Hour).Format(time.RFC3339)
	rec := get("lat=21.05&lng=106.07&at=" + at)
	var body struct {
		Now    weather.Now    `json:"now"`
		Advice weather.Advice `json:"advice"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.Now.TempC != 27 || body.Advice.Level != weather.LevelWarn {
		t.Fatalf("storm at the meeting time warns: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	(&Server{}).publicWeather(rec, httptest.NewRequest(http.MethodGet, "/v1/weather?lat=21&lng=106", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatal("no provider = 503, not a made-up forecast")
	}
}
