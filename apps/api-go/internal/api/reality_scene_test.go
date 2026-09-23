package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/location"
	"github.com/proxy-app/proxy-api/internal/realityscene"
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
	if len(body.Scenes) < 8 || body.Privacy != "historical_public_not_live" {
		t.Fatalf("unexpected projection: scenes=%d privacy=%q", len(body.Scenes), body.Privacy)
	}
	if body.Scenes[0].ID == "" || body.Scenes[0].Latitude == 0 || body.Scenes[0].Longitude == 0 {
		t.Fatalf("scene identity or coordinates missing: %#v", body.Scenes[0])
	}
}

func TestR27SceneReadSurface(t *testing.T) {
	server := &Server{RealityScene: realityscene.New(), RateLimit: NewRateLimiter(0, 100)}
	for _, path := range []string{"/v1/scenes/threebeans?variant=sunlight", "/v1/scenes/threebeans/live-state?variant=sunlight", "/v1/scenes/threebeans/menu?variant=sunlight", "/v1/scenes/threebeans/humans?variant=sunlight"} {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, recorder.Code, recorder.Body.String())
		}
	}
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/scenes/missing", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing status=%d", recorder.Code)
	}
}

func TestNearbyRealityScenesRequiresConsentAndUsesLocationRanking(t *testing.T) {
	repo := location.NewMemoryRepository(time.Now)
	server := &Server{Authenticator: stubAuthenticator{}, LocationRepo: repo, RealityScene: realityscene.New(), RateLimit: NewRateLimiter(0, 100)}
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/v1/reality-scenes/nearby", bytes.NewBufferString(`{"latitude":21.0454,"longitude":105.8361,"radiusKm":5}`))
		r.Header.Set("Authorization", "Bearer test")
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w
	}
	if got := request(); got.Code != http.StatusForbidden {
		t.Fatalf("without consent status=%d body=%s", got.Code, got.Body.String())
	}
	if _, err := repo.Grant(context.Background(), "user_001", location.KindPreciseGPS, 30*time.Minute, "", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	got := request()
	if got.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", got.Code, got.Body.String())
	}
	var body struct {
		Scenes []realitySceneRecord `json:"scenes"`
		Origin string               `json:"origin"`
	}
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Scenes) == 0 || body.Origin != "current_location" || body.Scenes[0].DistanceMeters < 0 {
		t.Fatalf("unexpected nearby response: %#v", body)
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

