package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
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

// newAuthedFacetTestServer: FACET-AUTH-001 写路径回归用的带鉴权 server。
// 复用 server_test.go 的 strictAuthenticator；有效 token 唯一映射
// principal user_real_001。
func newAuthedFacetTestServer() *Server {
	srv := newFacetTestServer()
	srv.Authenticator = strictAuthenticator{
		validTokens: map[string]identity.AuthenticatedSession{
			"valid_access_001": {
				Actor:       command.Actor{Type: "USER", ID: "user_real_001"},
				Principal:   command.Principal{Type: "INDIVIDUAL", ID: "user_real_001"},
				SessionID:   "session_real_001",
				AuthContext: map[string]any{"sessionId": "session_real_001"},
			},
		},
	}
	return srv
}

func authedFacetRequest(method, path, body string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer valid_access_001")
	return req
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

// TestFacetSideSpace_SpaSeeded —— R15.43 验证 Spa 默认有 3 条副空间
func TestFacetSideSpace_SpaSeeded(t *testing.T) {
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodGet, "/v1/facet/objects/spa/side-space/posts", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var raw struct {
		Posts []map[string]any `json:"posts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if len(raw.Posts) != 3 {
		t.Errorf("spa should have 3 default posts, got %d", len(raw.Posts))
	}
}

// TestFacetSideSpace_NonCollabIsEmpty —— R15.43 Linh (SHARED_INTEREST) 副空间 = 0
func TestFacetSideSpace_NonCollabIsEmpty(t *testing.T) {
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodGet, "/v1/facet/objects/linh/side-space/posts", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var raw struct {
		Posts []map[string]any `json:"posts"`
	}
	json.Unmarshal(rec.Body.Bytes(), &raw)
	if raw.Posts == nil {
		t.Error("posts should be [], not null")
	}
	if len(raw.Posts) != 0 {
		t.Errorf("linh should have 0 posts, got %d", len(raw.Posts))
	}
}

// TestFacetSideSpace_AddRemove —— R15.43 端到端 add / remove
// FACET-AUTH-001: 写请求必须带有效 Authorization，否则 401。
func TestFacetSideSpace_AddRemove(t *testing.T) {
	srv := newAuthedFacetTestServer()

	// add ss-capability-compare to spa
	addBody := `{"postId":"ss-capability-compare"}`
	addReq := authedFacetRequest(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", addBody)
	addRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(addRec, addReq)
	if addRec.Code != http.StatusOK {
		t.Fatalf("add expected 200, got %d body=%s", addRec.Code, addRec.Body.String())
	}

	// list → 应该是 4
	listReq := httptest.NewRequest(http.MethodGet, "/v1/facet/objects/spa/side-space/posts", nil)
	listRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(listRec, listReq)
	var raw struct {
		Posts []map[string]any `json:"posts"`
	}
	json.Unmarshal(listRec.Body.Bytes(), &raw)
	if len(raw.Posts) != 4 {
		t.Errorf("after add, spa should have 4 posts, got %d", len(raw.Posts))
	}

	// remove
	delReq := authedFacetRequest(http.MethodDelete, "/v1/facet/objects/spa/side-space/posts/ss-capability-compare", "")
	delRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("remove expected 200, got %d body=%s", delRec.Code, delRec.Body.String())
	}

	// list → 3
	listReq2 := httptest.NewRequest(http.MethodGet, "/v1/facet/objects/spa/side-space/posts", nil)
	listRec2 := httptest.NewRecorder()
	srv.Handler().ServeHTTP(listRec2, listReq2)
	json.Unmarshal(listRec2.Body.Bytes(), &raw)
	if len(raw.Posts) != 3 {
		t.Errorf("after remove, spa should have 3 posts, got %d", len(raw.Posts))
	}
}

// TestFacetSideSpace_AddToNonCollabRejected —— R15.43 给 Ken 加副空间 → 400
// （先过鉴权，再被 domain 规则拒绝；无 token 的是 401，见 FACET-AUTH-001。）
func TestFacetSideSpace_AddToNonCollabRejected(t *testing.T) {
	srv := newAuthedFacetTestServer()
	addBody := `{"postId":"ss-store-env"}`
	addReq := authedFacetRequest(http.MethodPost, "/v1/facet/objects/ken/side-space/posts", addBody)
	addRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(addRec, addReq)
	if addRec.Code != http.StatusBadRequest {
		t.Errorf("ken (not collab) should get 400, got %d", addRec.Code)
	}
}

// TestFacetSideSpace_AddAlreadyAddedConflict —— R15.43 重复 add → 409
func TestFacetSideSpace_AddAlreadyAddedConflict(t *testing.T) {
	srv := newAuthedFacetTestServer()
	// 用一个没被 seed 的 catalog post
	addBody := `{"postId":"ss-collab-1"}`
	for i := 0; i < 2; i++ {
		req := authedFacetRequest(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", addBody)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if i == 0 && rec.Code != http.StatusOK {
			t.Fatalf("first add expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if i == 1 && rec.Code != http.StatusConflict {
			t.Errorf("second add expected 409, got %d body=%s", rec.Code, rec.Body.String())
		}
	}
}

// TestFacetSideSpace_Catalog —— R15.43 GET catalog → 5 条
func TestFacetSideSpace_Catalog(t *testing.T) {
	srv := newFacetTestServer()
	req := httptest.NewRequest(http.MethodGet, "/v1/facet/side-space/catalog", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var raw struct {
		Posts []map[string]any `json:"posts"`
	}
	json.Unmarshal(rec.Body.Bytes(), &raw)
	if len(raw.Posts) != 5 {
		t.Errorf("catalog should have 5 posts, got %d", len(raw.Posts))
	}
}

// FACET-AUTH-001: facet 写路径匿名必须 401（side-space POST/DELETE、config POST）。
// 匿名可读（GET）不受影响 —— public feed 免登可读不变量。
func TestFacetSideSpace_WriteRequiresAuth(t *testing.T) {
	srv := newAuthedFacetTestServer()

	anon := func(method, path, body string) *httptest.ResponseRecorder {
		var req *http.Request
		if body == "" {
			req = httptest.NewRequest(method, path, nil)
		} else {
			req = httptest.NewRequest(method, path, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		return rec
	}

	if rec := anon(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", `{"postId":"ss-collab-1"}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("anon POST side-space: expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec := anon(http.MethodDelete, "/v1/facet/objects/spa/side-space/posts/ss-collab-1", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("anon DELETE side-space: expected 401, got %d", rec.Code)
	}
	if rec := anon(http.MethodPost, "/v1/facet/config", `{"expectedVersion":1,"patch":{"updatedBy":"spoofed"}}`); rec.Code != http.StatusUnauthorized {
		t.Errorf("anon POST config: expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}

	// 坏 token 同样 401。
	badReq := httptest.NewRequest(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", strings.NewReader(`{"postId":"ss-collab-1"}`))
	badReq.Header.Set("Content-Type", "application/json")
	badReq.Header.Set("Authorization", "Bearer forged_token")
	badRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Errorf("forged token: expected 401, got %d", badRec.Code)
	}

	// 匿名 GET 仍然 200（读路径不变量）。
	getReq := httptest.NewRequest(http.MethodGet, "/v1/facet/objects/spa/side-space/posts", nil)
	getRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Errorf("anon GET side-space: expected 200, got %d", getRec.Code)
	}
}

// FACET-AUTH-001: config POST 的 UpdatedBy 必须由 server 按 principal 回填，
// 客户端自填 "ops_panel" 之类必须被覆盖（防伪造运营人）。
func TestFacetConfig_PostStampsPrincipal(t *testing.T) {
	srv := newAuthedFacetTestServer()
	req := authedFacetRequest(http.MethodPost, "/v1/facet/config", `{"expectedVersion":1,"patch":{"sideSpaceHighThreshold":9,"updatedBy":"ops_panel"}}`)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authed config POST: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var cfg struct {
		UpdatedBy string `json:"updatedBy"`
		Version   int    `json:"version"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("config response not JSON: %v", err)
	}
	if cfg.UpdatedBy != "user_real_001" {
		t.Errorf("updatedBy must be server-stamped principal, got %q", cfg.UpdatedBy)
	}
}

// FACET-AUTH-001: facet 写路径高频刷必须 429（IP + principal 双限流）。
func TestFacetWrite_RateLimited(t *testing.T) {
	srv := newAuthedFacetTestServer()
	srv.RateLimit = NewRateLimiter(time.Minute, 1)

	first := authedFacetRequest(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", `{"postId":"ss-collab-1"}`)
	firstRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(firstRec, first)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first write: expected 200, got %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	second := authedFacetRequest(http.MethodPost, "/v1/facet/objects/spa/side-space/posts", `{"postId":"ss-store-env"}`)
	secondRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(secondRec, second)
	if secondRec.Code != http.StatusTooManyRequests {
		t.Errorf("second rapid write: expected 429, got %d body=%s", secondRec.Code, secondRec.Body.String())
	}
}
