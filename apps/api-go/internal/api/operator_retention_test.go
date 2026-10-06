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

// OPS-RETENTION-001：这一页要守的不是「有没有数」，而是**没有来源的指标不许被算出来**。
// 两个具体的诱惑：窗口前没有人群可比时摆一个「留存 100%」；前一个窗口只有 1 个活跃
// 的人时摆一个「回访率 100%」。两个都会被人当结论念出去。

// 嵌 stubOpsMetrics：Source 以后再加一个指标，这里不用跟着补空方法。
type retentionStubSource struct {
	stubOpsMetrics
	retention opsmetrics.Retention
	err       error
}

func (r retentionStubSource) Retention(context.Context, time.Time) (opsmetrics.Retention, error) {
	return r.retention, r.err
}

func retentionServer(ret opsmetrics.Retention) *Server {
	server := operatorConsoleServer()
	server.OpsMetrics = retentionStubSource{retention: ret}
	return server
}

func TestOperatorRetentionRefusesRatesItCannotJustify(t *testing.T) {
	server := retentionServer(opsmetrics.Retention{
		WindowDays: 30, Orders: 415, Requesters: 196, RepeatRequests: 117,
		RepeatRequesterRate: 59.7, SamePairRepeatGroups: 117, AgentsWithOrders: 191,
		Completed: 12, Cancelled: 12,
		Lifecycle:     map[string]int64{"CONFIRMED": 336, "OFFERED": 49, "COMPLETED": 12, "CANCELLED": 12},
		ActiveLast14d: 9, ActivePrev14d: 1, ReturnedUsers: 1, PriorWindowRequesters: 0,
	})
	rec := consoleGet(server, "retention", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	// 结构上就没有这两个字段：不是「先算出来再藏起来」，是根本没算。
	for _, banned := range []string{"returnedRate", "retentionRate", "cohortRetention", "gross", "revenue"} {
		if strings.Contains(body, `"`+banned+`"`) {
			t.Fatalf("响应里出现了 %q —— 没有事实来源的指标不许被造出来：%s", banned, body)
		}
	}

	var payload struct {
		DataSource string               `json:"dataSource"`
		Retention  opsmetrics.Retention `json:"retention"`
		Notes      []string             `json:"notes"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", payload.DataSource)
	}
	if payload.Retention.Requesters == 0 || payload.Retention.RepeatRequesterRate <= 0 {
		t.Fatalf("真数没透出来: %+v", payload.Retention)
	}
	joined := strings.Join(payload.Notes, "\n")
	// 同 OPS-SUPPLY-HEALTH-001：控制台按纯文本渲染 notes，markdown 星号会原样出现在界面上。
	if strings.Contains(joined, "**") {
		t.Fatalf("说明文字里还有 markdown 星号：%s", joined)
	}
	// 状态机分布不能印成 Go 的 map[...]（那是调试输出，不是给人读的说明）。
	if strings.Contains(joined, "map[") {
		t.Fatalf("说明里出现了 Go map 的原始打印：%s", joined)
	}
	for _, want := range []string{
		"金额",              // 说清这不是金额复购
		"同期群留存", "没有前期人群", // 拒绝给留存，并说明为什么
		"噪声",        // 回访只给人数
		"订单数不等于成交数", // 415 单里只有 12 单走完履约
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("说明里少了 %q：%s", want, joined)
		}
	}
	if !strings.Contains(joined, "117") || !strings.Contains(joined, "12") {
		t.Fatalf("说明没有带上真实的数字，读起来像模板：%s", joined)
	}
}

// 窗口之前有人下过单时，措辞必须跟着变 —— 不然这条说明会变成一句过期的断言
// （库里已经能算两期了，页面还在说「没有前期人群」）。
func TestOperatorRetentionWordingFollowsTheData(t *testing.T) {
	server := retentionServer(opsmetrics.Retention{
		WindowDays: 30, Orders: 200, Requesters: 300, RepeatRequests: 150, RepeatRequesterRate: 50,
		Completed: 200, Lifecycle: map[string]int64{"COMPLETED": 200},
		ActiveLast14d: 900, ActivePrev14d: 800, ReturnedUsers: 500,
		PriorWindowRequesters: 80,
	})
	var payload struct {
		Retention opsmetrics.Retention `json:"retention"`
		Notes     []string             `json:"notes"`
	}
	if err := json.Unmarshal(consoleGet(server, "retention", "ops_token").Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(payload.Notes, "\n")
	if strings.Contains(joined, "没有前期人群") {
		t.Fatalf("库里已经有 80 个窗口前下过单的人了，页面还在说没有前期人群：%s", joined)
	}
	if !strings.Contains(joined, "80") {
		t.Fatalf("说明没有反映真实的前期人数：%s", joined)
	}
	// Completed == Orders 时不该再报「订单数不等于成交数」。
	if strings.Contains(joined, "订单数不等于成交数") {
		t.Fatalf("全部订单都走完了履约，还在警告订单数不等于成交数：%s", joined)
	}
	// 分母大了，就不能再说「样本太小」—— 那句话只在样本小的时候成立。
	if strings.Contains(joined, "噪声") {
		t.Fatalf("前一个窗口有 800 个活跃的人，还在说分母小是噪声：%s", joined)
	}
	if !strings.Contains(joined, "900") {
		t.Fatalf("回访人数没有如实报出来：%s", joined)
	}
}

// 没有库 = 一个数都不给，回 NOT_CONNECTED + 缺的模块。
func TestOperatorRetentionWithoutADBIsNotConnected(t *testing.T) {
	server := operatorConsoleServer()
	server.OpsMetrics = nil
	rec := consoleGet(server, "retention", "ops_token")
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

func TestOperatorRetentionQueryFailureIsAnErrorNotZeroes(t *testing.T) {
	server := retentionServer(opsmetrics.Retention{})
	server.OpsMetrics = retentionStubSource{err: context.DeadlineExceeded}
	rec := consoleGet(server, "retention", "ops_token")
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "retention_query_failed") {
		t.Fatalf("查询失败必须报错，不能回一串 0 假装是「今天没人复购」: %d %s", rec.Code, rec.Body.String())
	}
}
