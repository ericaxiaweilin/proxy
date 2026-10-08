package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// OPS-ENGINE-API-001：§20 引擎判定入口 + 运营「API / Runtime」页。
//
// evaluate 是纯计算（无 SQL），钉的是判定行为与门：
//   ① 认证是硬门 —— 没有会话 401；判定不能是匿名流量；
//   ② 暴雨规则的判定行为（heavy_rain 全条件 → intent；light_rain → NO_UI_CHANGE）；
//   ③ 输入校验（weather 受控词表、0..1 区间）—— 400 而不是静默按 clear 处理；
//   ④ 运营页给真实端点清单 + 引擎状态机，旧的假遥测（evaluate_calls_30d）
//      和旧的错误声明（「没有注册路由」）都不许回来。

func evaluatePost(server *Server, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/decisions/evaluate", strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestEngineEvaluateRequiresASession(t *testing.T) {
	server := operatorConsoleServer()
	rec := evaluatePost(server, "", `{}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("无会话 evaluate = %d, want 401 —— 判定不能是匿名流量", rec.Code)
	}
	rec = evaluatePost(server, "bad_token", `{}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("坏 token evaluate = %d, want 401", rec.Code)
	}
}

func TestEngineEvaluateRunsTheRainRule(t *testing.T) {
	server := operatorConsoleServer()

	// §20 暴雨下班全条件 → 意图。
	rec := evaluatePost(server, "user_token",
		`{"context_snapshot_id":"ctx_test_1","weather":"heavy_rain","mobility_friction":0.72,"delivery_capacity":0.61,"commute_eta":64,"decision_id":"dec_test_1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("evaluate = %d %s", rec.Code, rec.Body.String())
	}
	var p struct {
		PolicyVersion string `json:"policy_version"`
		Intent        *struct {
			Type              string   `json:"type"`
			InterventionLevel string   `json:"intervention_level"`
			AllowedActions    []string `json:"allowed_actions"`
		} `json:"intent"`
		NoUIChange string   `json:"no_ui_change"`
		Notes      []string `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if p.Intent == nil || p.Intent.Type != "HELP_USER_HANDLE_RAIN_AFTER_WORK" {
		t.Fatalf("暴雨全条件应产出意图, got intent=%v no_change=%q", p.Intent, p.NoUIChange)
	}
	if p.PolicyVersion != "rain_rule_v1" {
		t.Errorf("policy_version = %q —— 规则就是规则，版本必须随响应走", p.PolicyVersion)
	}

	// light_rain + 短 ETA → §25 change_threshold：不该触发。
	rec = evaluatePost(server, "user_token",
		`{"context_snapshot_id":"ctx_test_2","weather":"light_rain","mobility_friction":0.3,"delivery_capacity":0.8,"commute_eta":30}`)
	var q struct {
		Intent     *json.RawMessage `json:"intent"`
		NoUIChange string           `json:"no_ui_change"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if q.Intent != nil {
		t.Errorf("light_rain 不该触发意图: %s", string(*q.Intent))
	}
	if !strings.Contains(q.NoUIChange, "NO_UI_CHANGE") {
		t.Errorf("no_ui_change = %q, want NO_UI_CHANGE…", q.NoUIChange)
	}

	// 响应必须带着「内核只有暴雨规则」这句话 —— 否则 NO_UI_CHANGE 被读成「没事」。
	joined := strings.Join(p.Notes, "\n")
	if !strings.Contains(joined, "暴雨规则") {
		t.Errorf("响应必须声明当前只有暴雨规则: %q", p.Notes)
	}
}

func TestEngineEvaluateValidatesTheInput(t *testing.T) {
	server := operatorConsoleServer()
	for name, body := range map[string]string{
		"未知天气":      `{"context_snapshot_id":"c1","weather":"typhoon"}`,
		"摩擦越界":      `{"context_snapshot_id":"c1","weather":"heavy_rain","mobility_friction":1.5}`,
		"运力越界":      `{"context_snapshot_id":"c1","weather":"heavy_rain","delivery_capacity":-0.1}`,
		"ETA 越界":    `{"context_snapshot_id":"c1","weather":"heavy_rain","commute_eta":9999}`,
		"缺快照 ID":    `{"weather":"heavy_rain"}`,
		"未知字段":      `{"context_snapshot_id":"c1","weather":"clear","hacker":"x"}`,
		"双 JSON 文档": `{"context_snapshot_id":"c1","weather":"clear"} {"x":1}`,
	} {
		if rec := evaluatePost(server, "user_token", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: evaluate = %d, want 400 —— 400 而不是静默当 clear 处理", name, rec.Code)
		}
	}
}

func TestOperatorEngineAPIServesTheRealInventory(t *testing.T) {
	body := consolePageGet(t, "engine-api")
	var p struct {
		DataSource string `json:"dataSource"`
		Endpoints  []struct {
			Method string `json:"method"`
			Path   string `json:"path"`
			Live   bool   `json:"live"`
		} `json:"endpoints"`
		StateLifecycle struct {
			States        []map[string]any `json:"states"`
			TotalPeople   int64            `json:"totalPeople"`
			PolicyVersion string           `json:"policyVersion"`
		} `json:"state_lifecycle"`
		Runtime struct {
			Budget        map[string]int64 `json:"budget"`
			ChannelPolicy map[string]bool  `json:"channel_policy"`
		} `json:"runtime"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	// evaluate 必须在清单里且标 LIVE —— 清单说谎比不列更糟。
	found := false
	for _, e := range p.Endpoints {
		if e.Path == "/v1/decisions/evaluate" {
			found = true
			if e.Method != "POST" || !e.Live {
				t.Errorf("evaluate 条目 = %s live=%v, want POST live=true", e.Method, e.Live)
			}
		}
	}
	if !found {
		t.Fatalf("端点清单里没有 /v1/decisions/evaluate: %+v", p.Endpoints)
	}
	// 引擎状态机是真的（复用 DecisionEligibility：stub 里 38 人 / 三档）。
	if len(p.StateLifecycle.States) != 3 || p.StateLifecycle.TotalPeople != 38 {
		t.Errorf("states=%d people=%d, want 3 档 / 38 人", len(p.StateLifecycle.States), p.StateLifecycle.TotalPeople)
	}
	if p.StateLifecycle.PolicyVersion != "rain_rule_v1" {
		t.Errorf("policyVersion = %q", p.StateLifecycle.PolicyVersion)
	}
	if len(p.Runtime.Budget) == 0 || len(p.Runtime.ChannelPolicy) == 0 {
		t.Errorf("runtime 预算/通道策略缺失: %+v", p.Runtime)
	}
	joined := strings.Join(p.Notes, "\n")
	if !strings.Contains(joined, "evaluate") {
		t.Errorf("必须说明 evaluate 已上线: %q", p.Notes)
	}
	// 旧假遥测不许回来；「没有注册路由」的旧声明也不许回来 —— 那已经不成立。
	for _, banned := range []string{"evaluate_calls_30d", "p99_ms", "没有注册路由"} {
		if strings.Contains(string(body), banned) {
			t.Errorf("响应里出现了 %q —— 旧的假遥测 / 失真的声明", banned)
		}
	}
}
