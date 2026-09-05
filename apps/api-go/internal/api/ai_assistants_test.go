package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// AI-ASSIST-001: 公开目录永远 5 条，字段齐全，与 mobile 资产同值。
// 改名/换色必须三处同步（handler/种子/SVG），否则此测试先红。
func TestListAIAssistantsFiveWithPhotos(t *testing.T) {
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodGet, "/v1/ai/assistants", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var raw struct {
		Assistants []map[string]any `json:"assistants"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if len(raw.Assistants) != 5 {
		t.Fatalf("expected 5 assistants, got %d", len(raw.Assistants))
	}
	wantIDs := map[string]bool{"ai_001": false, "ai_002": false, "ai_003": false, "ai_004": false, "ai_005": false}
	for _, a := range raw.Assistants {
		for _, k := range []string{"id", "name", "role", "color", "photo", "avatar", "tagline", "aiBadge"} {
			v, ok := a[k].(string)
			if !ok || v == "" {
				t.Errorf("assistant %v missing/empty %q", a["id"], k)
			}
		}
		if id, _ := a["id"].(string); id != "" {
			if _, expected := wantIDs[id]; expected {
				wantIDs[id] = true
			} else {
				t.Errorf("unexpected assistant id %q", id)
			}
		}
		if badge, _ := a["aiBadge"].(string); badge == "" {
			t.Errorf("assistant %v must carry an explicit AI badge", a["id"])
		}
	}
	for id, seen := range wantIDs {
		if !seen {
			t.Errorf("expected assistant %q in response", id)
		}
	}
}

func TestListAIAssistantsMethodNotAllowed(t *testing.T) {
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodPost, "/v1/ai/assistants", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}
