package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

// OPS-SUPPLY-HEALTH-001：供给健康度这一页守的是三件容易做错的事 ——
// 核验按哪一列数、时间窗的两种口径、以及需求侧空的时候不许给比值。

// 嵌 stubOpsMetrics：Source 以后再加一个指标，这里不用跟着补空方法。
type supplyStubSource struct {
	stubOpsMetrics
	supply opsmetrics.SupplyHealth
	err    error
}

func (s supplyStubSource) SupplyHealth(context.Context, time.Time) (opsmetrics.SupplyHealth, error) {
	return s.supply, s.err
}

func supplyServer(h opsmetrics.SupplyHealth) *Server {
	server := operatorConsoleServer()
	server.OpsMetrics = supplyStubSource{supply: h}
	return server
}

func TestOperatorSupplyHealthRefusesARatioWithAnEmptyDenominator(t *testing.T) {
	rec := consoleGet(supplyServer(opsmetrics.SupplyHealth{
		WindowDays: 30, Agents: 107, AgentsActive: 106, AgentsWithAvailability: 106, AgentsWithOpenWindow: 41,
		RealNameVerified: 7, RealNameExpired: 6, CapabilityVerified: 6,
		AgentsWithOrders: 0, OrdersWindow: 355, DemandTaskDrafts: 54, DemandTasks: 0, CityCompanionNeeds: 5,
	}), "supply-health", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, banned := range []string{"supplyDemandRatio", "ratio", "conversionRate", "coveragePercent"} {
		if strings.Contains(body, `"`+banned+`"`) {
			t.Fatalf("响应里出现了 %q —— 分母接近 0 的时候不许有比值：%s", banned, body)
		}
	}
	var payload struct {
		DataSource string                  `json:"dataSource"`
		Supply     opsmetrics.SupplyHealth `json:"supply"`
		Notes      []string                `json:"notes"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", payload.DataSource)
	}
	joined := strings.Join(payload.Notes, "\n")
	// 控制台把 notes 当纯文本渲染，** 会原样出现在界面上（2026-10-06 浏览器里看到过：
	// 「这一页**没有供需比**」）。要么写成人话，要么别加粗 —— 说明文字里不许有 markdown。
	if strings.Contains(joined, "**") {
		t.Fatalf("说明文字里还有 markdown 星号，界面会原样显示：%s", joined)
	}
	for _, want := range []string{
		"agent_id", // 核验按哪一列数，写明白（按 user_account_id 会数出 0）
		"没有供需比", "噪声",
		"配过时间窗", // 两种口径不能合成一个数
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("说明里少了 %q：%s", want, joined)
		}
	}
	// 有单服务者是 0 而订单有 355 张 —— 这个矛盾必须被解释，不能安静地摆一个 0。
	if !strings.Contains(joined, "宁可报 0") {
		t.Fatalf("订单有 %d 张而有单服务者是 0，页面没解释这个矛盾：%s", payload.Supply.OrdersWindow, joined)
	}
}

// 需求侧真有正式任务时，措辞要跟着变（不能继续说「分母是 0」）。
func TestOperatorSupplyHealthWordingFollowsTheDemandSide(t *testing.T) {
	rec := consoleGet(supplyServer(opsmetrics.SupplyHealth{
		WindowDays: 30, Agents: 500, DemandTasks: 900, DemandTaskDrafts: 40,
	}), "supply-health", "ops_token")
	var payload struct{ Notes []string }
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(payload.Notes, "\n")
	if strings.Contains(joined, "分母接近 0") {
		t.Fatalf("需求侧已经有 900 个正式任务，页面还在说分母接近 0：%s", joined)
	}
	if !strings.Contains(joined, "900") {
		t.Fatalf("说明没反映真实的需求体量：%s", joined)
	}
}

func TestOperatorSupplyHealthWithoutADBIsNotConnected(t *testing.T) {
	server := operatorConsoleServer()
	server.OpsMetrics = nil
	rec := consoleGet(server, "supply-health", "ops_token")
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["dataSource"] != OperatorNotConnectedSource || body["missing"] == "" {
		t.Fatalf("没有库却给了别的东西: %v", body)
	}
	for key := range body {
		if key != "dataSource" && key != "missing" && key != "spec" {
			t.Fatalf("NOT_CONNECTED 状态下不许带任何指标字段，发现 %q", key)
		}
	}
}

func TestOperatorSupplyHealthQueryFailureIsAnErrorNotZeroes(t *testing.T) {
	server := operatorConsoleServer()
	server.OpsMetrics = supplyStubSource{err: context.DeadlineExceeded}
	rec := consoleGet(server, "supply-health", "ops_token")
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "supply_query_failed") {
		t.Fatalf("查询失败必须报错，不能回一串 0 假装「今天没有供给」: %d %s", rec.Code, rec.Body.String())
	}
}
