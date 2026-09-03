package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicRealityScenesContract(t *testing.T) {
	server := &Server{RateLimit: NewRateLimiter(0, 100)}
	handler := server.Handler()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/reality-scenes", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Header().Get("Cache-Control"), "stale-if-error") {
		t.Fatalf("missing edge fallback cache policy: %q", recorder.Header().Get("Cache-Control"))
	}
	var body struct {
		Scenes  []realitySceneRecord `json:"scenes"`
		Privacy string               `json:"privacy"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Scenes) != 8 || body.Privacy != "historical_public_not_live" {
		t.Fatalf("unexpected projection: scenes=%d privacy=%q", len(body.Scenes), body.Privacy)
	}
	if body.Scenes[0].ID == "" || body.Scenes[0].Latitude == 0 || body.Scenes[0].Longitude == 0 {
		t.Fatalf("scene identity or coordinates missing: %#v", body.Scenes[0])
	}
}

func TestPublicRealityScenesRejectsWrites(t *testing.T) {
	server := &Server{RateLimit: NewRateLimiter(0, 100)}
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/reality-scenes", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d", recorder.Code)
	}
}
