package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// AI-ASSIST-001: 公开目录永远 5 条，字段齐全，与写真资产同值。
// 改名/换色/换图必须同步（handler 目录值 ↔ photos/ 文件），否则此测试先红。
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
		} else if badge != "AI生成" {
			// 小美≠助手：对外只叫“AI生成”，不叫“AI助手”。
			t.Errorf("assistant %v badge must be AI生成, got %q", a["id"], badge)
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

// 小美写真原文件直出：模型生成的真人写真 PNG、PNG content-type、
// 未知 id 404。用户要求用 GPT 交付的原文件，不在代码里复制第二份。
func TestPersonaPhotoServesRealPNG(t *testing.T) {
	dir, err := filepath.Abs("../../../../apps/mobile/assets/ai-personas")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PROXY_AI_PERSONA_ASSETS_DIR", dir)
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodGet, "/v1/ai/personas/photo/ai_001", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("expected image/png, got %q", ct)
	}
	body := rec.Body.Bytes()
	if len(body) < 8 || string(body[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Errorf("photo body is not a real PNG portrait")
	}
	if len(body) < 100_000 {
		t.Errorf("portrait suspiciously small (%d bytes), expected model-generated photo", len(body))
	}

	bad := httptest.NewRequest(http.MethodGet, "/v1/ai/personas/photo/ai_999", nil)
	badRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(badRec, bad)
	if badRec.Code != http.StatusNotFound {
		t.Errorf("unknown persona photo: expected 404, got %d", badRec.Code)
	}

	traversal := httptest.NewRequest(http.MethodGet, "/v1/ai/personas/photo/../server", nil)
	traversalRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(traversalRec, traversal)
	if traversalRec.Code == http.StatusOK {
		t.Errorf("path traversal must not return 200")
	}
}
