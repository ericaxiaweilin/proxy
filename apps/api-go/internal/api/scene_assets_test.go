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
	if body.Version != 1 || len(body.Actions) != 19 || len(body.Scenes) != 10 || len(body.Themes) != 10 || len(body.Moments) != 8 {
		t.Fatalf("unexpected catalog sizes: %+v", body)
	}
	if got := body.Actions["coffee"]; got != "/v1/media/thumb/seed_scene_action_extended_0_0" {
		t.Fatalf("coffee = %q", got)
	}
}

func TestPublicSceneAssetsRejectsMutation(t *testing.T) {
	recorder := httptest.NewRecorder()
	(&Server{}).Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/scene-assets", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", recorder.Code)
	}
}
