package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

// OPS-NORTH-STAR-001：North Star 落地页那四个格子守的是**数别被读错**。
//
// 四个格子名字都很响（有效意图 / 成功撮合 / 完成履约 / 负反馈率），最容易出的事故是
// 「有数就行」：撮合给个转化率、履约给个成交额、负反馈给个 0.0%。这些数在今天的库里
// 都算不出来（归因断链 / 支付未接入 / 样本不足），所以本测试盯的是**话有没有跟着数走**：
//   - 数对得上（tile.value 就是读模型给的数）；
//   - 没给的那一半必须在同一个响应里说明白，且说明里不许出现 markdown（界面原样渲染）；
//   - 分母不够大时宁可不给率 —— 「0.0%」会被读成「一切正常」。

// 嵌 stubOpsMetrics：Source 以后再加指标，这里不用跟着补空方法。
type northStarStubSource struct {
	stubOpsMetrics
	ns  opsmetrics.NorthStar
	err error
}

func (s northStarStubSource) NorthStar(context.Context, time.Time) (opsmetrics.NorthStar, error) {
	return s.ns, s.err
}

func northStarServer(ns opsmetrics.NorthStar, err error) *Server {
	server := operatorConsoleServer()
	server.OpsMetrics = northStarStubSource{ns: ns, err: err}
	return server
}

type northStarPayload struct {
	DataSource string `json:"dataSource"`
	WindowDays int64  `json:"windowDays"`
	Tiles      []struct {
		Key        string   `json:"key"`
		Label      string   `json:"label"`
		Value      *float64 `json:"value"`
		Unit       string   `json:"unit"`
		DataSource string   `json:"dataSource"`
		Definition string   `json:"definition"`
		Meta       string   `json:"meta"`
		Notes      []string `json:"notes"`
	} `json:"tiles"`
}

func (p northStarPayload) tile(key string) (int, bool) {
	for i, t := range p.Tiles {
		if t.Key == key {
			return i, true
		}
	}
	return 0, false
}

func decodeNorthStar(t *testing.T, body []byte) northStarPayload {
	t.Helper()
	var p northStarPayload
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	return p
}

// 本机库的真实形状：四个格子全部有数，但每个格子都有「没给的那一半」。
func northStarFixture() opsmetrics.NorthStar {
	return opsmetrics.NorthStar{
		WindowDays: 30,
		Intent: opsmetrics.IntentFunnel{
			Drafts: 54, DraftsOpen: 9, DraftsCommitted: 45, CanonicalTasks: 0,
		},
		Matching: opsmetrics.MatchAttempts{Batches: 5, BatchesWithSupply: 5, ShortageBatches: 0},
		Fulfillment: opsmetrics.FulfillmentFunnel{
			Orders: 819, Offered: 49, Confirmed: 739, Executing: 6, Completed: 13, Cancelled: 12,
		},
		Negative: opsmetrics.NegativeFeedback{Exposures: 1453, StrongNegative: 2, WeakNegative: 0},
	}
}

func TestOperatorNorthStarServesFourTilesAndNamesEveryGap(t *testing.T) {
	rec := consoleGet(northStarServer(northStarFixture(), nil), "north-star", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	p := decodeNorthStar(t, rec.Body.Bytes())
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q, want LIVE", p.DataSource)
	}
	if len(p.Tiles) != 4 {
		t.Fatalf("want 4 tiles, got %d: %+v", len(p.Tiles), p.Tiles)
	}

	// ① 有效意图：数就是草案数，全量口径必须写出来（表没有 created_at）。
	i, ok := p.tile("intent")
	if !ok {
		t.Fatal("no intent tile")
	}
	if p.Tiles[i].Value == nil || *p.Tiles[i].Value != 54 {
		t.Errorf("intent value = %v, want 54", p.Tiles[i].Value)
	}
	if !strings.Contains(p.Tiles[i].Definition, "全量") {
		t.Errorf("intent 口径没说清是全量（demand.task_drafts 没有 created_at）：%q", p.Tiles[i].Definition)
	}
	// 45 条 COMMITTED / 0 条 canonical task —— 必须被讲出来，不能留给运营去猜。
	if joined := strings.Join(p.Tiles[i].Notes, "\n"); !strings.Contains(joined, "demand.tasks") {
		t.Errorf("intent 没说明 COMMITTED 草案与 canonical task 对不上：%q", p.Tiles[i].Notes)
	}

	// ② 成功撮合：这一格是 PARTIAL —— 有真数，但「撮合成功」的完整含义缺一半。
	m, ok := p.tile("match")
	if !ok {
		t.Fatal("no match tile")
	}
	if p.Tiles[m].DataSource != OperatorPartialSource {
		t.Errorf("match dataSource = %q, want PARTIAL（找到供给是真的，成交归因不是）", p.Tiles[m].DataSource)
	}
	if p.Tiles[m].Value == nil || *p.Tiles[m].Value != 5 {
		t.Errorf("match value = %v, want 5", p.Tiles[m].Value)
	}
	if joined := strings.Join(p.Tiles[m].Notes, "\n"); !strings.Contains(joined, "outcome") {
		t.Errorf("match 没点名归因缺的是 outcome-service：%q", p.Tiles[m].Notes)
	}

	// ③ 完成履约：单量真，金额没有来源 —— 这一格最容易被填成 GMV。
	f, ok := p.tile("fulfillment")
	if !ok {
		t.Fatal("no fulfillment tile")
	}
	if p.Tiles[f].Value == nil || *p.Tiles[f].Value != 13 {
		t.Errorf("fulfillment value = %v, want 13 (COMPLETED)", p.Tiles[f].Value)
	}
	if joined := strings.Join(p.Tiles[f].Notes, "\n"); !strings.Contains(joined, "成交额") || !strings.Contains(joined, "支付") {
		t.Errorf("fulfillment 没说明成交额为什么没有来源：%q", p.Tiles[f].Notes)
	}

	// ④ 负反馈率：1453 次曝光 ≥ 门槛，所以给率；同时必须说明 §10 的熔断没做。
	n, ok := p.tile("negative")
	if !ok {
		t.Fatal("no negative tile")
	}
	if p.Tiles[n].Value == nil {
		t.Fatalf("曝光 1453 ≥ 门槛，应当给率：%+v", p.Tiles[n])
	}
	if want := 2.0 / 1453 * 100; *p.Tiles[n].Value < want-0.01 || *p.Tiles[n].Value > want+0.01 {
		t.Errorf("negative rate = %v, want ≈%v", *p.Tiles[n].Value, want)
	}
	if joined := strings.Join(p.Tiles[n].Notes, "\n"); !strings.Contains(joined, "熔断") {
		t.Errorf("negative 没说明熔断策略没实现：%q", p.Tiles[n].Notes)
	}

	// 说明文字是给界面**原样渲染**的（2026-10-06 在浏览器里看到过 markdown 星号），
	// 所以任何 note 里都不许有 ** 或 markdown 链接。
	for _, tl := range p.Tiles {
		all := tl.Definition + "\n" + tl.Meta + "\n" + strings.Join(tl.Notes, "\n")
		if strings.Contains(all, "**") {
			t.Errorf("tile %s 的说明里出现了 markdown 星号，界面会原样显示：%q", tl.Key, all)
		}
	}

	// 反过来：编出来的**字段**一个都不许有。查 JSON 键而不是散文 ——
	// note 里写「成交额没有事实来源」是这页最该说的话，禁词会把诚实的说明一起禁掉。
	for _, banned := range []string{"gmv", "revenue", "conversionRate", "supplyDemandRatio"} {
		if strings.Contains(rec.Body.String(), `"`+banned+`"`) {
			t.Errorf("响应里出现了字段 %q —— 没有来源的指标不能成为一个字段", banned)
		}
	}
}

// 分母不够大时宁可只给计数：40 次曝光里 2 次举报不是「5% 负反馈率」，
// 是「40 次曝光什么都说明不了」。而如果这一格摆 0.0%，运营会读成「一切正常」。
func TestOperatorNorthStarWithholdsTheRateBelowTheExposureFloor(t *testing.T) {
	ns := northStarFixture()
	ns.Negative = opsmetrics.NegativeFeedback{Exposures: 40, StrongNegative: 2, WeakNegative: 1}
	p := decodeNorthStar(t, consoleGet(northStarServer(ns, nil), "north-star", "ops_token").Body.Bytes())
	i, ok := p.tile("negative")
	if !ok {
		t.Fatal("no negative tile")
	}
	if p.Tiles[i].Value != nil {
		t.Fatalf("曝光 40 < 门槛，不许给率，got %v", *p.Tiles[i].Value)
	}
	joined := strings.Join(p.Tiles[i].Notes, "\n")
	if !strings.Contains(joined, "40") || !strings.Contains(joined, "门槛") {
		t.Errorf("不给率时必须说出分母和门槛，否则空格子会被读成漏做：%q", p.Tiles[i].Notes)
	}
	// 计数还在 —— 不给率不等于这一格是空的。
	if !strings.Contains(p.Tiles[i].Meta, "40") || !strings.Contains(p.Tiles[i].Meta, "2") {
		t.Errorf("不给率的时候计数必须还在：%q", p.Tiles[i].Meta)
	}
}

// 分母为 0（服务器库今天就是这样）时不能出现 0/0。
func TestOperatorNorthStarOnAnEmptyDatabase(t *testing.T) {
	var zero opsmetrics.NorthStar
	zero.WindowDays = 30
	p := decodeNorthStar(t, consoleGet(northStarServer(zero, nil), "north-star", "ops_token").Body.Bytes())
	if len(p.Tiles) != 4 {
		t.Fatalf("空库也要四个格子（0 是「查过了没有」，不是「没测」）：%+v", p.Tiles)
	}
	for _, tl := range p.Tiles {
		if tl.Key == "negative" {
			if tl.Value != nil {
				t.Errorf("0 次曝光不许算率（0/0）: %v", *tl.Value)
			}
			continue
		}
		if tl.Value == nil || *tl.Value != 0 {
			t.Errorf("tile %s: 空库应当给 0，got %v", tl.Key, tl.Value)
		}
	}
	i, _ := p.tile("fulfillment")
	if joined := strings.Join(p.Tiles[i].Notes, "\n"); !strings.Contains(joined, "查过了没有") {
		t.Errorf("空库的 0 必须说明是「查过了没有」：%q", p.Tiles[i].Notes)
	}
}

func TestOperatorNorthStarWithoutADBIsNotConnected(t *testing.T) {
	server := operatorConsoleServer()
	server.OpsMetrics = nil
	rec := consoleGet(server, "north-star", "ops_token")
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

// 查询失败必须是 500，不是一屏 0 —— 一屏 0 会被读成「生意停了」。
func TestOperatorNorthStarQueryFailureIsAnErrorNotZeroes(t *testing.T) {
	rec := consoleGet(northStarServer(opsmetrics.NorthStar{}, errors.New("boom")), "north-star", "ops_token")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("query failure must be 500, got %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"tiles"`) {
		t.Fatalf("查询失败时不许返回格子: %s", rec.Body.String())
	}
}
