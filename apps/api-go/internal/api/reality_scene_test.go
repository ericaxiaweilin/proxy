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

// GEO-HONEST-001 / OPS-TELEMETRY-001: 纯字面量端点必须自报 dataSource。
//
// 这三个端点一个查询都不做：evaluate_calls_30d "18.6M"、lineage_complete
// "99.92%"、各 segment 的 health 0.82/0.64/0.38、activation ladder 的
// 1.2K/860/420/210 全是写死的。
//
// 它们的问题不是"数字是假的"，而是**长得和遥测一模一样** —— 运营看到
// "30 天 1860 万次调用 · 谱系完整度 99.92%" 会认为引擎在跑，而仓库里
// 既没有决策引擎的实现，也没有任何一张表记录这些数字。
// 一个假的健康度比没有健康度更糟：它让人停止怀疑。
//
// 这里钉的是**声明**，不是数值。数值将来接真实遥测后可以随便变，
// 但"这个响应有没有来源"必须一直可读 —— 控制台的横幅就靠这个字段决定显示。
//
// 注意：不是所有 /v1/operator/* 都是占位。context-field / surface-plans
// 真的调用了 runtime.Decide 和 compiler.Compile（输入是固定快照），
// experience/metrics 返回的是真实进程内计数器。所以这里只钉这三个，
// 不写"整个 /v1/operator 都是假的" —— 那会是另一个谎。
func TestOperatorFixtureEndpointsDeclareSource(t *testing.T) {
	server := &Server{RateLimit: NewRateLimiter(0, 100)}
	paths := []string{"/v1/operator/decision-engine", "/v1/operator/clarification-gate", "/v1/operator/supply-health"}
	for _, path := range paths {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, recorder.Code, recorder.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s unmarshal: %v", path, err)
		}
		// 这里必须钉**字面量** "FIXTURE"，不能钉 OperatorFixtureSource 常量。
		//
		// 第一版写的是 `body["dataSource"] != OperatorFixtureSource` —— 拿生产者的
		// 常量去比对生产者的输出，两边永远相等，断言恒真。把常量改成 "LIVE"、
		// 也就是把线上契约破坏掉，测试照样绿。反向注入时抓到了这一点。
		//
		// 之所以字面量才是真契约：客户端的 FixtureNotice 判断的是
		// `dataSource !== "FIXTURE"`，横幅显不显示只看这个字符串。
		// 常量只是服务端内部的书写便利，改它就是在改协议。
		if body["dataSource"] != "FIXTURE" {
			t.Fatalf("%s does not declare dataSource=\"FIXTURE\" (got %v) — the console keys its placeholder banner off that literal, so anything else means the banner silently disappears", path, body["dataSource"])
		}
	}
}
