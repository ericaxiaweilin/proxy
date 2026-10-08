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
	// OPS-DATA-ENV-001：比率型指标只在数据环境声明成 production 时才发布。这一测试要的是
	// 「发布之后的说明文字仍然守着口径」，所以先把声明摆上，拒绝路径另有测试钉。
	t.Setenv(DataEnvVar, DataEnvProduction)
	server := retentionServer(opsmetrics.Retention{
		WindowDays: 30, Orders: 415, Requesters: 196, RepeatRequests: 117,
		// 全量 196 个「下单人」里只有 48 个对得上账号，其余是集成测试留下的行
		// （订单永不硬删，而测试连的是这个库）。标题那个复购率按对得上账号的口径算。
		OrdersAttributable: 268, OrdersUnattributed: 147,
		RealRequesters: 48, RealRepeatRequesters: 11, RepeatRequesterRate: ratePtr(22.9),
		SamePairRepeatGroups: 117, AgentsWithOrders: 191,
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
	if payload.Retention.Requesters == 0 || payload.Retention.RepeatRequesterRate == nil || *payload.Retention.RepeatRequesterRate <= 0 {
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
		"能追溯到账号",    // 复购率的分母是能追溯到账号的那批
		"不是生意",      // 而且必须明说追溯不到账号的那些是什么
		// OPS-DATA-ENV-001：这一步排不掉脚本建的账号，说明里必须自己把边界说出来，
		// 不然「对得上账号」又会被读成「是真人」—— 上一版就是这么错的。
		"排不掉脚本建的账号", DataEnvVar,
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("说明里少了 %q：%s", want, joined)
		}
	}
	// 上一版的越界说法不许回来：把「有账号行」写成「真人」，48 个循环变量就成了 48 个客户。
	for _, banned := range []string{"真实账号", "真实下单人", "真人"} {
		if strings.Contains(joined, banned) {
			t.Fatalf("说明里又出现了 %q —— 对得上账号推不出「是真人」：%s", banned, joined)
		}
	}
	// 分母换了就得看得见换成了什么：48（对得上账号）和 147（对不上）都要出现在说明里，
	// 否则读者只知道口径严了，不知道严到什么程度。
	if !strings.Contains(joined, "48") || !strings.Contains(joined, "147") {
		t.Fatalf("说明没报出可归因口径的两个数（对得上账号 48 / 对不上 147）：%s", joined)
	}
	if !strings.Contains(joined, "117") || !strings.Contains(joined, "12") {
		t.Fatalf("说明没有带上真实的数字，读起来像模板：%s", joined)
	}
}

// 窗口之前有人下过单时，措辞必须跟着变 —— 不然这条说明会变成一句过期的断言
// （库里已经能算两期了，页面还在说「没有前期人群」）。
func TestOperatorRetentionWordingFollowsTheData(t *testing.T) {
	t.Setenv(DataEnvVar, DataEnvProduction)
	server := retentionServer(opsmetrics.Retention{
		WindowDays: 30, Orders: 200, Requesters: 300, RepeatRequests: 150, RepeatRequesterRate: ratePtr(50),
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

// OPS-DATA-ENV-001：这台库连的是哪一套数据，只有部署知道，所以没声明就不出比率。
//
// 这条测试钉的是一个真实发生过的错误（2026-10-08）：我把复购率的分母换成「请求方对得上
// identity.user_accounts 的订单」，以为这样就排掉了测试数据。排掉了一半 —— 另一半是
// scripts/*-e2e.sh 造的：走真 API、建真账号、下真订单，引用完整性全过。于是这台库上
// 显示出 93.8% 的复购率，而 860 张单里没有一张是生意。
//
// 「对得上账号」推不出「是业务」。能推的只有部署声明的那句话，所以判据搬到 env 上，
// 并且默认值站在不给数这一侧。
func TestOperatorRetentionRefusesRatesWhenDataEnvUndeclared(t *testing.T) {
	ret := opsmetrics.Retention{
		WindowDays: 30, Orders: 415, Requesters: 196, RepeatRequests: 117,
		OrdersAttributable: 268, OrdersUnattributed: 147,
		RealRequesters: 48, RealRepeatRequesters: 11, RepeatRequesterRate: ratePtr(93.8),
		Completed: 12, Cancelled: 12, Lifecycle: map[string]int64{"CONFIRMED": 336},
	}
	// 未声明，和「声明了但拼错」，必须落在同一侧：拼错的环境名不能顺手把比率打开。
	for _, tc := range []struct{ name, value string }{
		{"未设置", ""},
		{"写成 prod", "prod"},
		{"首字母大写", "Production"},
		{"全大写", "PRODUCTION"},
		{"写着 dev", "dev"},
		{"只有空格", "   "},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(DataEnvVar, tc.value)
			rec := consoleGet(retentionServer(ret), "retention", "ops_token")
			raw := rec.Body.String()
			// 比率必须是 JSON null。用 0.0 表达「没算」是这一页最容易复发的错：
			// 界面会印成「复购率 0%」，读的人以为那是一个结论。
			if !strings.Contains(raw, `"repeatRequesterRate":null`) {
				t.Fatalf("数据环境是 %q 却没有把比率置成 null：%s", tc.value, raw)
			}
			var body struct {
				DataSource     string `json:"dataSource"`
				RatesPublished bool   `json:"ratesPublished"`
				Retention      struct {
					Orders         int64 `json:"orders"`
					RealRequesters int64 `json:"realRequesters"`
				} `json:"retention"`
				Notes []string `json:"notes"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			// 这一页**不整页拒掉**：计数是对行的陈述，在哪个库上都成立；而且整页 NOT_CONNECTED
			// 会把控制台里每个引用这一页的地方一起抹掉（平台总览就是这么被清空的）。
			if body.DataSource != OperatorLiveSource {
				t.Fatalf("计数不该跟着比率一起消失，却收到 %q", body.DataSource)
			}
			if body.Retention.Orders != 415 || body.Retention.RealRequesters != 48 {
				t.Fatalf("计数没透出来: %+v", body.Retention)
			}
			if body.RatesPublished {
				t.Fatalf("数据环境是 %q 却声称比率已发布", tc.value)
			}
			joined := strings.Join(body.Notes, "\n")
			for _, want := range []string{DataEnvVar, DataEnvProduction, "415", "147", "48", "脚本"} {
				if !strings.Contains(joined, want) {
					t.Fatalf("说明里少了 %q（要么说清缺哪个变量、要么说清它此刻查到了什么）：%s", want, joined)
				}
			}
			if strings.Contains(joined, "**") || strings.Contains(joined, "map[") {
				t.Fatalf("说明会被原样印在界面上，不许有 markdown 星号或 Go 的 map 打印：%s", joined)
			}
		})
	}
}

// 声明成 production 就走真读模型：这一条保证门不是「永远不给比率」，否则整个改动只是把指标关掉。
func TestOperatorRetentionPublishesMetricsWhenDataEnvIsProduction(t *testing.T) {
	t.Setenv(DataEnvVar, DataEnvProduction)
	rec := consoleGet(retentionServer(opsmetrics.Retention{
		WindowDays: 30, Orders: 415, Requesters: 196, RealRequesters: 48,
		OrdersAttributable: 268, OrdersUnattributed: 147, RealRepeatRequesters: 11,
		RepeatRequesterRate: ratePtr(22.9), Lifecycle: map[string]int64{"COMPLETED": 415},
	}), "retention", "ops_token")
	var body struct {
		DataSource     string `json:"dataSource"`
		DataEnv        string `json:"dataEnv"`
		RatesPublished bool   `json:"ratesPublished"`
		Retention      struct {
			RepeatRequesterRate *float64 `json:"repeatRequesterRate"`
		} `json:"retention"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.DataSource != OperatorLiveSource {
		t.Fatalf("声明成 production 之后这一页应该走真读模型，却收到：%+v", body)
	}
	if !body.RatesPublished || body.Retention.RepeatRequesterRate == nil || *body.Retention.RepeatRequesterRate != 22.9 {
		t.Fatalf("声明成 production 却不给比率：%+v", body)
	}
	if body.DataEnv != DataEnvProduction {
		t.Fatalf("响应要带上它是在哪个数据环境下给的数：%q", body.DataEnv)
	}
}

func ratePtr(v float64) *float64 { return &v }

// 门本身的两端：只有 production 这个字符串算声明成生产。
func TestBusinessRatesPublishedOnlyForDeclaredProduction(t *testing.T) {
	t.Setenv(DataEnvVar, "production")
	if !businessRatesPublished() {
		t.Fatal("声明成 production 却不发布比率")
	}
	t.Setenv(DataEnvVar, "production ")
	if !businessRatesPublished() {
		t.Fatal("尾部空格该被去掉，不该被当成未声明")
	}
	for _, value := range []string{"", "prod", "Production", "staging", "false"} {
		t.Setenv(DataEnvVar, value)
		if businessRatesPublished() {
			t.Fatalf("%q 不该被当成生产库", value)
		}
	}
}
