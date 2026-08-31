package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// newFacetTestServer 构造一个 minimal Server, 只注入 facetObjects 路由
// 需要的依赖. 不需要 auth / postgres / modelstack, 因为 facetObjects
// 完全是静态 mock (R15.25 Phase 1).
func newFacetTestServer() *Server {
	return NewServer(
		identity.New(nil),
		demand.New(nil, nil),
		citycompanion.New(),
		localnet.New(),
		localcontext.New(),
		conversation.New(),
		engagement.New(),
		fulfillment.New(),
		supply.New(),
		media.New(),
		contribution.New(),
	)
}

// TestFacetObjects_GET_OK 验证 R15.25 Phase 1 wire 形状:
//   - 3 个对象 (ken / linh / spa)
//   - 每个对象有 8 个必填字段
//   - totalObjects = 3, freshAssets > 0, shownAssets > 0
//   - avatarUrl 永远 = "" (Phase 1 不做图片)
//
// 字段命名 / 类型必须跟 packages/contracts/src/facet.ts
// ListFacetObjectsPayloadSchema 严格对齐 — 任何 rename 都会让前端
// zod parse 爆掉 (fail-closed).
func TestFacetObjects_GET_OK(t *testing.T) {
	srv := newFacetTestServer()

	req := httptest.NewRequest(http.MethodGet, "/v1/facet/objects", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %q", ct)
	}

	var raw struct {
		Objects []map[string]any `json:"objects"`
		Total   int              `json:"totalObjects"`
		Fresh   int              `json:"freshAssets"`
		Shown   int              `json:"shownAssets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("response was not valid JSON: %v body=%s", err, rec.Body.String())
	}
	if raw.Total != 3 {
		t.Fatalf("expected totalObjects=3, got %d", raw.Total)
	}
	if len(raw.Objects) != 3 {
		t.Fatalf("expected 3 objects, got %d", len(raw.Objects))
	}
	if raw.Fresh <= 0 || raw.Shown <= 0 {
		t.Fatalf("expected freshAssets > 0 and shownAssets > 0, got fresh=%d shown=%d", raw.Fresh, raw.Shown)
	}

	wantIDs := map[string]bool{"ken": false, "linh": false, "spa": false}
	requiredKeys := []string{"id", "displayName", "relation", "goal", "currentState", "pillLabel", "gap", "avatarUrl"}
	for _, obj := range raw.Objects {
		for _, k := range requiredKeys {
			if _, ok := obj[k]; !ok {
				t.Errorf("object %v missing required key %q", obj["id"], k)
			}
		}
		if id, _ := obj["id"].(string); id != "" {
			if _, expected := wantIDs[id]; expected {
				wantIDs[id] = true
			}
		}
		if avatar, _ := obj["avatarUrl"].(string); avatar != "" {
			t.Errorf("Phase 1 contract: avatarUrl must be empty placeholder, got %q", avatar)
		}
		gap, ok := obj["gap"].(map[string]any)
		if !ok {
			t.Errorf("object %v missing gap object", obj["id"])
			continue
		}
		for _, k := range []string{"summary", "nextShowAt"} {
			if _, ok := gap[k]; !ok {
				t.Errorf("object %v gap missing %q", obj["id"], k)
			}
		}
	}
	for id, seen := range wantIDs {
		if !seen {
			t.Errorf("expected object %q in response", id)
		}
	}
}

// TestFacetObjects_MethodNotAllowed 验证 POST / PUT / DELETE 都被拒.
func TestFacetObjects_MethodNotAllowed(t *testing.T) {
	srv := newFacetTestServer()
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		req := httptest.NewRequest(method, "/v1/facet/objects", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: expected 405, got %d", method, rec.Code)
		}
	}
}
