package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicSceneAssetsReturnsNetworkCatalog(t *testing.T) {
	recorder := httptest.NewRecorder()
	(&Server{}).Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/scene-assets", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body struct {
		Version int               `json:"version"`
		Actions map[string]string `json:"actions"`
		Scenes  map[string]string `json:"scenes"`
		Themes  map[string]string `json:"themes"`
		Moments map[string]string `json:"moments"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version != 2 || len(body.Actions) != 24 || len(body.Scenes) != 11 || len(body.Themes) != 11 || len(body.Moments) != 9 {
		t.Fatalf("unexpected catalog sizes: %+v", body)
	}
	if got := body.Actions["coffee"]; got != "/v1/media/thumb/seed_scene_action_extended_0_0" {
		t.Fatalf("coffee = %q", got)
	}
	if _, exists := body.Actions["water-sports"]; exists {
		t.Fatal("high-risk water sports must not be exposed for matching")
	}
	if _, exists := body.Actions["hiking"]; exists {
		t.Fatal("high-risk hiking must not be exposed for matching")
	}
	if got := body.Scenes["hospital"]; got != "/v1/media/thumb/seed_scene_medical_hospital_v1" {
		t.Fatalf("hospital = %q", got)
	}
}

func TestPublicSceneAssetsRejectsMutation(t *testing.T) {
	recorder := httptest.NewRecorder()
	(&Server{}).Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/scene-assets", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", recorder.Code)
	}
}
