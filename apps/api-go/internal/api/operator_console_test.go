package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

// OPS-REAL-001（取代 OPS-TELEMETRY-001 的「自报占位」）：运营控制台的 17 个端点
//   - 没会话 401、不是运营 403 —— 以前任何人都能读；
//   - 没有数据源的页面只回 NOT_CONNECTED + 缺的模块，**一个数字都不给**（以前是写死的 428K / 2.75M / 18.6M）；
//   - 用户构成 / 行为信号走真实查询（LIVE）。

var operatorConsolePaths = []string{
	"context-field", "surface-plans", "execution-runtime", "decision-engine", "clarification-gate", "supply-health",
	"fulfillment-attribution", "behavior", "research", "population", "tags", "intent-orchestration", "engine-api",
	"merchant", "retention", "trust", "quality",
}

var notConnectedConsolePaths = []string{
	"decision-engine", "clarification-gate", "supply-health", "fulfillment-attribution", "research", "tags",
	"intent-orchestration", "engine-api", "retention", "trust", "quality",
}

// merchant 曾经是桩，OPS-MERCHANT-001 把它换成真实读模型；这里断言它**不再**属于
// "必须回 NOT_CONNECTED" 那一组，而属于下面的 LIVE 组 —— 挪走要留下痕迹，
// 不然下一次有人把它塞回桩也没人拦。
var liveConsolePaths = []string{"population", "behavior", "merchant"}

type stubOpsMetrics struct{}

func (stubOpsMetrics) Population(context.Context, time.Time) (opsmetrics.Population, error) {
	return opsmetrics.Population{Registered: 7, New30d: 2, Active30d: 3}, nil
}
func (stubOpsMetrics) Behavior(context.Context, time.Time) (opsmetrics.Behavior, error) {
	return opsmetrics.Behavior{Exposures: 11, DeepViews: 4, Zooms: 1}, nil
}

// Merchants 回一整套真形状（含"订单有但挂到门店的是 0"那个归因缺口），因为
// handler 里那条 note 是这页最有信息量的一行 —— 它防止 0 被读成"没生意"。
func (stubOpsMetrics) Merchants(_ context.Context, _ time.Time) (opsmetrics.Merchants, error) {
	return opsmetrics.Merchants{
		WindowDays: 30,
		Totals: opsmetrics.MerchantTotals{
			Accounts: 47, Stores: 46, StoreLines: 2, Orders30d: 0, Orders30dAll: 445,
		},
		Merchants: []opsmetrics.MerchantRow{
			{BusinessID: "biz_probe_1", Name: "Three Beans", Stores: 1, ActiveStores: 1, Members: 1,
				Products: 6, Orders30d: 0, StoresWithDescription: 1, StoresWithHours: 1},
		},
	}, nil
}

func operatorConsoleServer() *Server {
	return &Server{
		RateLimit:  NewRateLimiter(0, 100),
		Operator:   NewStaticOperatorGate([]string{"user_ops"}),
		OpsMetrics: stubOpsMetrics{},
		Gravity:    gravity.NewMemory(),
		Authenticator: strictAuthenticator{validTokens: map[string]identity.AuthenticatedSession{
			"ops_token":  {Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_ops"}},
			"user_token": {Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_xiaomei"}},
		}},
	}
}

func consoleGet(server *Server, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/v1/operator/"+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestOperatorConsoleIsOperatorOnly(t *testing.T) {
	server := operatorConsoleServer()
	for _, path := range operatorConsolePaths {
		if rec := consoleGet(server, path, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a session must be 401, got %d", path, rec.Code)
		}
		if rec := consoleGet(server, path, "user_token"); rec.Code != http.StatusForbidden {
			t.Fatalf("%s for an ordinary user must be 403, got %d", path, rec.Code)
		}
		if rec := consoleGet(server, path, "ops_token"); rec.Code != http.StatusOK {
			t.Fatalf("%s for an operator must be 200, got %d %s", path, rec.Code, rec.Body.String())
		}
	}
	// 没配运营门：fail-closed，不是放行。
	unguarded := operatorConsoleServer()
	unguarded.Operator = nil
	if rec := consoleGet(unguarded, "population", "ops_token"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no operator gate must fail closed, got %d", rec.Code)
	}
}

func TestOperatorConsoleNeverServesFixtureNumbers(t *testing.T) {
	server := operatorConsoleServer()
	for _, path := range notConnectedConsolePaths {
		var body map[string]any
		_ = json.Unmarshal(consoleGet(server, path, "ops_token").Body.Bytes(), &body)
		if body["dataSource"] != "NOT_CONNECTED" || body["missing"] == "" {
			t.Fatalf("%s has no data source and must say NOT_CONNECTED + what is missing: %v", path, body)
		}
		for key := range body {
			if key != "dataSource" && key != "missing" && key != "spec" {
				t.Fatalf("%s must not carry any metric while not connected, found %q", path, key)
			}
		}
	}
	for _, path := range liveConsolePaths {
		var body map[string]any
		_ = json.Unmarshal(consoleGet(server, path, "ops_token").Body.Bytes(), &body)
		if body["dataSource"] != "LIVE" {
			t.Fatalf("%s must come from the real query: %v", path, body)
		}
	}
}

// OPS-MERCHANT-001：商家管理页的三个要求 —— 真数进得来、"待接入"的指标不出现，
// 以及「有订单但挂不到门店」这个归因缺口必须作为话讲出来，而不是留一个 0 让人自己误读。
func TestOperatorMerchantServesRealCountsAndFlagsTheAttributionGap(t *testing.T) {
	server := operatorConsoleServer()
	rec := consoleGet(server, "merchant", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string `json:"dataSource"`
		Totals     struct {
			Accounts     int64 `json:"accounts"`
			Stores       int64 `json:"stores"`
			Orders30d    int64 `json:"orders30d"`
			Orders30dAll int64 `json:"orders30dAll"`
		} `json:"totals"`
		Merchants []struct {
			BusinessID string `json:"businessId"`
			Name       string `json:"name"`
			Products   int64  `json:"products"`
		} `json:"merchants"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.DataSource != "LIVE" {
		t.Fatalf("dataSource = %q, want LIVE", body.DataSource)
	}
	if body.Totals.Accounts != 47 || body.Totals.Stores != 46 {
		t.Errorf("totals = %+v, want the source's 47/46", body.Totals)
	}
	if len(body.Merchants) != 1 || body.Merchants[0].Name != "Three Beans" {
		t.Fatalf("merchants = %+v", body.Merchants)
	}
	joined := ""
	for _, n := range body.Notes {
		joined += n + "\n"
	}
	if !strings.Contains(joined, "成交额") || !strings.Contains(joined, "曝光") {
		t.Error("notes must name what is NOT connected (成交额 / 曝光), so the absence reads as a gap not as a zero")
	}
	// 关键一条：445 单、0 单挂到门店 —— 必须说明是归因没建，不是没生意。
	if body.Totals.Orders30d == 0 && body.Totals.Orders30dAll > 0 && !strings.Contains(joined, "归因") {
		t.Errorf("orders exist but none attribute to a store; the response must say so, notes=%q", body.Notes)
	}
	// 反过来：编出来的**字段**一个都不许出现。查的是 JSON 键（"gross": …），
	// 不是散文 —— note 里写明「成交额（gross）未接入」是这页最该说的话，
	// 拿子串在整段响应里禁词会把诚实的说明也一起禁掉（第一版就是这么误伤的）。
	for _, key := range []string{`"impressions"`, `"gross"`, `"revenue"`, `"repurchase"`} {
		if strings.Contains(rec.Body.String(), key+":") {
			t.Errorf("响应里出现了字段 %s —— 没有来源的指标不能成为一个字段", key)
		}
	}
}

// GRAVITY-001：引力页（逐人概率）同样只给运营；重算是 POST，同一道门。
func TestOperatorGravityIsOperatorOnlyAndLive(t *testing.T) {
	server := operatorConsoleServer()
	if rec := consoleGet(server, "gravity", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("gravity for an ordinary user must be 403, got %d", rec.Code)
	}
	post := func(token string) int {
		req := httptest.NewRequest(http.MethodPost, "/v1/operator/gravity/recompute", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		return rec.Code
	}
	if code := post(""); code != http.StatusUnauthorized {
		t.Fatalf("recompute without a session must be 401, got %d", code)
	}
	if code := post("user_token"); code != http.StatusForbidden {
		t.Fatalf("recompute by an ordinary user must be 403, got %d", code)
	}
	if code := post("ops_token"); code != http.StatusOK {
		t.Fatalf("recompute by an operator must be 200, got %d", code)
	}
	var body map[string]any
	_ = json.Unmarshal(consoleGet(server, "gravity", "ops_token").Body.Bytes(), &body)
	if body["dataSource"] != "LIVE" || body["summary"] == nil || body["top"] == nil {
		t.Fatalf("gravity page is live derived data: %v", body)
	}
}
