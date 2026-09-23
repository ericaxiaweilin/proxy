package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
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
	"intent-orchestration", "engine-api", "merchant", "retention", "trust", "quality",
}

type stubOpsMetrics struct{}

func (stubOpsMetrics) Population(context.Context, time.Time) (opsmetrics.Population, error) {
	return opsmetrics.Population{Registered: 7, New30d: 2, Active30d: 3}, nil
}
func (stubOpsMetrics) Behavior(context.Context, time.Time) (opsmetrics.Behavior, error) {
	return opsmetrics.Behavior{Exposures: 11, DeepViews: 4, Zooms: 1}, nil
}

func operatorConsoleServer() *Server {
	return &Server{
		RateLimit:  NewRateLimiter(0, 100),
		Operator:   NewStaticOperatorGate([]string{"user_ops"}),
		OpsMetrics: stubOpsMetrics{},
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
	for _, path := range []string{"population", "behavior"} {
		var body map[string]any
		_ = json.Unmarshal(consoleGet(server, path, "ops_token").Body.Bytes(), &body)
		if body["dataSource"] != "LIVE" {
			t.Fatalf("%s must come from the real query: %v", path, body)
		}
	}
}
