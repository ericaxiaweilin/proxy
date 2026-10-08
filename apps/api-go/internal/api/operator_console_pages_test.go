package api

import (
	"context"
	"encoding/json"
	"github.com/proxy-app/proxy-api/internal/tagging"
	"net/http"
	"strings"
	"testing"
	"time"
)

// OPS-CONSOLE-PAGES-001（2026-10-07）：运营后台里那四页**打不开**的页面。
//
// 它们原来是 NOT_CONNECTED 桩，而页面 JSX 直接读桩不发的字段（data.engine.* / d.safety /
// data.gates / d.intent_funnel）⇒ 一打开就 TypeError。最省事的修法是给桩补上假字段让它
// 不崩 —— 那会让页面显示一排看起来正常的零，正是 OPS-REAL-001 要禁的东西。
// 所以这里钉的是**给的是真东西、没给的不许回来**：
//   - 决策引擎：给状态分档；不许回来旧的假遥测字段（evaluate_calls_30d / p99_ms /
//     lineage_complete…），那几个数从来没被查过；
//   - 信任与风险：给证据与处置事实；**不许有风险分**（risk_scores）—— 没有风险模型，
//     摆一个分数会让人以为系统在评估风险；
//   - 澄清门：给产出漏斗；断链要作为**数**出现（draftsWithBatch / draftsWithOrder）；
//   - 意图编排：只给引力与候选批次两层，编排那一层明确没有数据。

func consolePageGet(t *testing.T, path string) []byte {
	t.Helper()
	rec := consoleGet(operatorConsoleServer(), path, "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("%s status %d %s", path, rec.Code, rec.Body.String())
	}
	return rec.Body.Bytes()
}

func TestOperatorDecisionEngineServesEligibilityAndRefusesFakeThroughput(t *testing.T) {
	body := consolePageGet(t, "decision-engine")
	var p struct {
		DataSource string `json:"dataSource"`
		States     []struct {
			State       string  `json:"state"`
			People      int64   `json:"people"`
			AvgConf     float64 `json:"avg_confidence"`
			AvgEvidence float64 `json:"avg_evidence_coverage"`
		} `json:"states"`
		EventTypes []struct {
			EventType string `json:"event_type"`
			People    int64  `json:"people"`
		} `json:"eventTypes"`
		Totals struct {
			People            int64    `json:"people"`
			ActiveOrchestrate int64    `json:"activeOrchestrate"`
			ModelVersions     []string `json:"modelVersions"`
			LastComputedAt    *string  `json:"lastComputedAt"`
		} `json:"totals"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if len(p.States) != 3 || len(p.EventTypes) != 3 {
		t.Fatalf("states=%d eventTypes=%d, want 3/3 (OBSERVE/LEARN_ONLY/PASSIVE)", len(p.States), len(p.EventTypes))
	}
	// §12/§13 不自动进入主动编排（gravity 包里 TestNeverAutoActiveOrchestrate 钉着）。
	if p.Totals.ActiveOrchestrate != 0 {
		t.Errorf("activeOrchestrate = %d, want 0 —— §12/§13 不自动进入主动编排", p.Totals.ActiveOrchestrate)
	}
	if p.Totals.People != 38 {
		t.Errorf("people = %d, want 38", p.Totals.People)
	}
	joined := strings.Join(p.Notes, "\n")
	if !strings.Contains(joined, "/v1/decisions/evaluate") || !strings.Contains(joined, "没有注册路由") {
		t.Errorf("必须说明引擎的调用面不存在（否则运营会把状态分档当成引擎吞吐）: %q", p.Notes)
	}
	// 旧的假遥测字段一个都不许回来。查 JSON 键不是散文 —— note 里提到它们是对的，
	// 禁的是「又变成了一个字段」。
	for _, banned := range []string{"evaluate_calls_30d", "p99_ms", "evidence_pass", "active_orchestrate", "human_value_block", "lineage_complete"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里又出现了假遥测字段 %q —— 那几个数从来没被查过", banned)
		}
	}
	if strings.Contains(joined, "**") {
		t.Errorf("说明文字里有 markdown 星号，界面会原样显示: %q", joined)
	}
}

// 这一页原来显示 `risk_scores: [{segment, score}]` —— 逐人群的 0–1 风险分。
// 仓里没有任何风险模型，那个数是编出来的。编出来的风险分比没有风险分坏得多。
func TestOperatorTrustRefusesToInventARiskScore(t *testing.T) {
	body := consolePageGet(t, "trust")
	var p struct {
		DataSource  string           `json:"dataSource"`
		Evidence    map[string]int64 `json:"evidence"`
		Signals     map[string]int64 `json:"signals"`
		Disposition map[string]int64 `json:"disposition"`
		Notes       []string         `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if p.Evidence["realNameVerified"] != 7 || p.Evidence["realNameExpired"] != 6 {
		t.Errorf("证据数 = %v, want verified 7 / expired 6", p.Evidence)
	}
	// 核心：有举报、零处置 —— 必须讲出来，不能让 0 处置被读成「都处理完了」。
	joined := strings.Join(p.Notes, "\n")
	if p.Signals["reportsAll"] > 0 && p.Disposition["dispositionsAll"] == 0 && !strings.Contains(joined, "处置") {
		t.Errorf("有举报零处置时必须说明处置链路没接: %q", p.Notes)
	}
	if !strings.Contains(joined, "没有风险分") {
		t.Errorf("必须明说没有风险分: %q", p.Notes)
	}
	for _, banned := range []string{"risk_scores", "riskScore", "score"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里出现了 %q —— 没有风险模型，不许有风险分", banned)
		}
	}
}

// 断链要作为**数**出现在页面上：谁把键接上了它会动，谁只是改了措辞它不动。
func TestOperatorClarificationReportsTheBrokenLinksAsNumbers(t *testing.T) {
	body := consolePageGet(t, "clarification-gate")
	var p struct {
		DataSource string           `json:"dataSource"`
		Funnel     map[string]int64 `json:"funnel"`
		Notes      []string         `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if p.Funnel["drafts"] != 54 || p.Funnel["draftsCommitted"] != 45 || p.Funnel["canonicalTasks"] != 0 {
		t.Errorf("funnel = %v, want drafts 54 / committed 45 / tasks 0", p.Funnel)
	}
	// 这两个键必须存在（不是「字段缺失」），值是 0 才叫断链。
	if _, ok := p.Funnel["draftsWithBatch"]; !ok {
		t.Error("缺少 draftsWithBatch —— 断链必须是一个数，不是一句散文")
	}
	if _, ok := p.Funnel["draftsWithOrder"]; !ok {
		t.Error("缺少 draftsWithOrder —— 断链必须是一个数，不是一句散文")
	}
	joined := strings.Join(p.Notes, "\n")
	if !strings.Contains(joined, "键") {
		t.Errorf("必须点明是键没接上，不是转化差: %q", p.Notes)
	}
}

func TestOperatorOrchestrationServesTheTwoRealLayers(t *testing.T) {
	body := consolePageGet(t, "intent-orchestration")
	var p struct {
		DataSource string `json:"dataSource"`
		Gravity    struct {
			States            []map[string]any `json:"states"`
			ActiveOrchestrate int64            `json:"activeOrchestrate"`
			TotalPeople       int64            `json:"totalPeople"`
		} `json:"gravity"`
		Retrieval struct {
			Batches           int64 `json:"batches"`
			BatchesWithSupply int64 `json:"batchesWithSupply"`
		} `json:"retrieval"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if len(p.Gravity.States) == 0 || p.Retrieval.Batches == 0 {
		t.Fatalf("引力与候选批次这两层都是真的，必须有数: %+v", p)
	}
	joined := strings.Join(p.Notes, "\n")
	if !strings.Contains(joined, "编排") {
		t.Errorf("必须说明编排那一层没有数据: %q", p.Notes)
	}
	// 编排那一层不许被填成 0 —— 「0 次干预」会被读成「没有干预过」，
	// 而事实是「干预这件事根本没被记录」。
	for _, banned := range []string{"interventions", "suppressed", "ignitionLevel", "budgetSpent"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里出现了 %q —— 编排动作没有落库，不许有这个字段", banned)
		}
	}
}

// OPS-TAG-VOCAB-001：标签中心给的是**词典盘点**，不是热度榜 —— 标签体系不存在，
// 库里只有 7 个轴在当标签用。这一页的失败模式有两种，都要钉住：
//  1. 回到 notConnected 桩（页面读 d.kpis 会崩）；
//  2. 编一个「标签热度」「兴趣画像」—— 那些要 tag-service 才成立。
func TestOperatorTagsServesVocabularyInventoryAndRefusesAHeatmap(t *testing.T) {
	body := consolePageGet(t, "tags")
	var p struct {
		DataSource string           `json:"dataSource"`
		Kpis       map[string]int64 `json:"kpis"`
		TopTags    []struct {
			Tag   string `json:"tag"`
			Type  string `json:"type"`
			Count int64  `json:"count"`
			Unit  string `json:"unit"`
		} `json:"top_tags"`
		Axes []struct {
			Axis       string  `json:"axis"`
			Side       string  `json:"side"`
			Vocabulary string  `json:"vocabulary"`
			Terms      int64   `json:"terms"`
			Coverage   float64 `json:"coverage"`
		} `json:"axes"`
		Totals struct {
			Agents            int64    `json:"agents"`
			Posts             int64    `json:"posts"`
			Terms             int      `json:"terms"`
			TermsShown        int      `json:"termsShown"`
			LanguageRawTerms  int64    `json:"languageRawTerms"`
			LanguageNormTerms int64    `json:"languageNormTerms"`
			CaseCollisions    []string `json:"caseCollisions"`
			ContextPosts      int64    `json:"contextPosts"`
			ContextIdTerms    int64    `json:"contextIdTerms"`
			InterestRows      int64    `json:"interestRows"`
		} `json:"totals"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if p.Totals.Agents != 107 || p.Totals.Posts != 1461 {
		t.Errorf("agents=%d posts=%d, want 107/1461", p.Totals.Agents, p.Totals.Posts)
	}
	if len(p.Axes) != 6 {
		t.Fatalf("axes = %d, want 6（4 供给侧 + 2 内容侧：语境类型 / 语境值；帖子没有场景类型）", len(p.Axes))
	}
	// 两个词表质量信号必须是轴的**属性**，不是散文：谁治理了它们，值会跟着变。
	byAxis := map[string]string{}
	for _, a := range p.Axes {
		byAxis[a.Axis] = a.Vocabulary
	}
	if byAxis["language"] != "dirty" {
		t.Errorf("language 轴的 vocabulary = %q, want dirty（vi/VI 未归一）", byAxis["language"])
	}
	if byAxis["context_id"] != "free_text" {
		t.Errorf("context_id 轴的 vocabulary = %q, want free_text（自由文本不是词典）", byAxis["context_id"])
	}
	// 大小写碰撞要按**名字**给（运营要去做归一），不能只有一个数量。
	found := map[string]bool{}
	for _, c := range p.Totals.CaseCollisions {
		found[c] = true
	}
	if !found["VI/vi"] || !found["ZH/zh"] {
		t.Errorf("caseCollisions = %v, want VI/vi 与 ZH/zh 逐个点名", p.Totals.CaseCollisions)
	}
	if p.Totals.TermsShown > p.Totals.Terms {
		t.Errorf("termsShown %d > terms %d", p.Totals.TermsShown, p.Totals.Terms)
	}
	for _, x := range p.TopTags {
		if x.Unit == "" {
			t.Errorf("词 %q 没带单位 —— 不同轴的 count 不是同一量级，混排必须带单位", x.Tag)
		}
	}
	joined := strings.Join(p.Notes, "\n")
	// TAG-SYSTEM-001：标签层已经存在。没接存储时必须明说「没接入」，而不是假装有。
	if !strings.Contains(joined, "用户标签层没有接入") {
		t.Errorf("没配标签存储时必须说明用户标签层没接入: %q", p.Notes)
	}
	if p.Totals.InterestRows < 10 && !strings.Contains(joined, "兴趣") {
		t.Errorf("兴趣事件几乎为零时必须说明需求侧兴趣没有数据源: %q", p.Notes)
	}
	// 热度榜 / 兴趣画像 / 标签关系 —— 那些要标签体系才成立，不许被编出来。
	for _, banned := range []string{"interest_profiles", "trending_tags", "tag_relations", "tag_affinity", "interest_scores"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里出现了 %q —— 标签体系不存在，不许有这个字段", banned)
		}
	}
	if strings.Contains(joined, "**") {
		t.Errorf("说明文字里有 markdown 星号，界面会原样显示: %q", joined)
	}
}

// OPS-DATA-QUALITY-001：「谱系完整率无从计算」这个拒绝本身就是错的 —— 谱系断不断恰恰
// 是可数的。这一页钉的是：
//
//	① 谱系列覆盖必须成对给（窗口内 + 全量）—— 只报全量会把「写入方刚接上」埋进旧种子里；
//	② 每一条主要断点要讲成话（req_id=0 / candidate_source unknown / server 生成的占比）；
//	③ 旧的假字段（workbench / saved_queries / cross_analysis）一个都不许回来。
func TestOperatorDataQualityNamesTheBrokenLineage(t *testing.T) {
	body := consolePageGet(t, "quality")
	var p struct {
		DataSource string `json:"dataSource"`
		Events     struct {
			Window              int64   `json:"window"`
			All                 int64   `json:"all"`
			SkewSecondsOver5Min int64   `json:"skewSecondsOver5Min"`
			MaxSkewSeconds      float64 `json:"maxSkewSeconds"`
			DuplicateEventIds   int64   `json:"duplicateEventIds"`
		} `json:"events"`
		Lineage []struct {
			Field    string  `json:"field"`
			Window   string  `json:"window"`
			Filled   int64   `json:"filled"`
			Total    int64   `json:"total"`
			Coverage float64 `json:"coverage"`
		} `json:"lineage"`
		EventSource []struct {
			Value string `json:"value"`
			Count int64  `json:"count"`
		} `json:"event_source"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if p.Events.All != 1453 || p.Events.Window != 1432 {
		t.Errorf("events = %d/%d, want 1432/1453", p.Events.Window, p.Events.All)
	}
	// 6 个谱系列 × 2 个口径，缺一半就是只报了一个故事。
	fields := map[string]int{}
	for _, f := range p.Lineage {
		fields[f.Field+":"+f.Window]++
		if f.Total <= 0 {
			t.Errorf("谱系列 %s(%s) 的 total = %d", f.Field, f.Window, f.Total)
		}
	}
	for _, field := range []string{"recommendation_request_id", "impression_id", "feed_session_id", "candidate_source", "client_time", "need_id"} {
		if fields[field+":all"] != 1 || fields[field+":window"] != 1 {
			t.Errorf("谱系列 %s 缺口径：all=%d window=%d, want 1/1", field, fields[field+":all"], fields[field+":window"])
		}
	}
	server := int64(0)
	for _, x := range p.EventSource {
		if x.Value == "server" {
			server = x.Count
		}
	}
	joined := strings.Join(p.Notes, "\n")
	if server > p.Events.All/2 && !strings.Contains(joined, "server") {
		t.Errorf("绝大多数事件是 server 生成时必须讲出来（样本量问题）: %q", p.Notes)
	}
	if !strings.Contains(joined, "request_id") {
		t.Errorf("主断点（recommendation_request_id=0）必须点名: %q", p.Notes)
	}
	// 旧假字段不许回来。
	for _, banned := range []string{"workbench", "saved_queries", "cross_analysis"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里出现了 %q —— 那是从来没存在过的假功能", banned)
		}
	}
	if strings.Contains(joined, "**") {
		t.Errorf("说明文字里有 markdown 星号，界面会原样显示: %q", joined)
	}
}

// OPS-ATTRIBUTION-AUDIT-001：归因链不给逐单明细（造不出来），给三段键审计。
// 断链必须作为**数**出现：segments 里每个键都要在 —— 谁把键接上了数会动。
func TestOperatorAttributionAuditNamesEachBrokenSegment(t *testing.T) {
	body := consolePageGet(t, "fulfillment-attribution")
	var p struct {
		DataSource string `json:"dataSource"`
		Segments   struct {
			DecisionToExposure struct {
				Events       int64 `json:"events"`
				Attributable int64 `json:"attributable"`
			} `json:"decisionToExposure"`
			MatchingToOrder struct {
				Batches         int64 `json:"batches"`
				BatchesWithNeed int64 `json:"batchesWithNeed"`
				Orders          int64 `json:"orders"`
				OrdersWithNeed  int64 `json:"ordersWithNeed"`
				JoinedKeys      int64 `json:"joinedKeys"`
			} `json:"matchingToOrder"`
			Outcome struct {
				Rows int64 `json:"rows"`
			} `json:"outcome"`
		} `json:"segments"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode: %v (%s)", err, string(body))
	}
	if p.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", p.DataSource)
	}
	if p.Segments.DecisionToExposure.Events != 1453 || p.Segments.DecisionToExposure.Attributable != 0 {
		t.Errorf("段一 = %d/%d, want 0/1453", p.Segments.DecisionToExposure.Attributable, p.Segments.DecisionToExposure.Events)
	}
	if p.Segments.MatchingToOrder.Batches == 0 || p.Segments.MatchingToOrder.Orders == 0 {
		t.Errorf("段二的批次/订单是两边的基数，不许是 0: %+v", p.Segments.MatchingToOrder)
	}
	if p.Segments.MatchingToOrder.JoinedKeys != 0 || p.Segments.Outcome.Rows != 0 {
		t.Errorf("段二/段三本机应为 0（键没接 / 无写入方）: joined=%d outcome=%d",
			p.Segments.MatchingToOrder.JoinedKeys, p.Segments.Outcome.Rows)
	}
	joined := strings.Join(p.Notes, "\n")
	for _, seg := range []string{"段一", "段二", "段三"} {
		if !strings.Contains(joined, seg) {
			t.Errorf("断的三段必须逐段点名（缺 %s）: %q", seg, p.Notes)
		}
	}
	// 逐单明细表的字段一个都不许回来 —— 那是要等键接上才造得出的东西。
	for _, banned := range []string{"delta_id", "surface_plan_id", "attribution"} {
		if strings.Contains(string(body), `"`+banned+`"`) {
			t.Errorf("响应里出现了 %q —— 归因明细今天造不出来，不许有这个字段", banned)
		}
	}
}

// 没有库的时候七页都要回 NOT_CONNECTED，且不许带任何指标字段 —— 更不许崩。
func TestOperatorConsolePagesWithoutADBAreNotConnected(t *testing.T) {
	server := operatorConsoleServer()
	server.OpsMetrics = nil
	for _, path := range []string{"decision-engine", "trust", "clarification-gate", "intent-orchestration", "tags", "quality", "fulfillment-attribution"} {
		rec := consoleGet(server, path, "ops_token")
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body["dataSource"] != OperatorNotConnectedSource || body["missing"] == "" {
			t.Fatalf("%s 没有库却给了别的东西: %v", path, body)
		}
		for key := range body {
			if key != "dataSource" && key != "missing" && key != "spec" {
				t.Fatalf("%s 在 NOT_CONNECTED 状态下不许带指标字段，发现 %q", path, key)
			}
		}
	}
}

// TAG-SYSTEM-001：接了标签存储，页面给真实覆盖；一个人都没有时明说「还没有任何标签」。
func TestOperatorTagsShowsTheUserTagLayerWhenWired(t *testing.T) {
	store := tagging.NewMemory()
	server := operatorConsoleServer()
	server.TagStore = store
	rec := consoleGet(server, "tags", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "还没有任何标签") {
		t.Fatalf("an empty tag layer must say so: %s", rec.Body.String())
	}
	now := time.Now().UTC()
	_ = store.ReplaceUserTags(context.Background(), "u1", []tagging.Tag{{Axis: tagging.AxisInterestTopic, Value: "COFFEE", Strength: 0.7, Confidence: 0.8, ExpiresAt: now.Add(time.Hour), ComputedAt: now}})
	rec = consoleGet(server, "tags", "ops_token")
	var body struct {
		UserTags *tagging.Stats `json:"userTags"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.UserTags == nil {
		t.Fatalf("decode userTags: %v %s", err, rec.Body.String())
	}
	if body.UserTags.UsersWithTags != 1 || body.UserTags.TotalTags != 1 || body.UserTags.LastComputedAt == nil {
		t.Fatalf("stats: %+v", body.UserTags)
	}
}
