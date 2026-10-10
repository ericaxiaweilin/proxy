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
	"github.com/proxy-app/proxy-api/internal/research"
)

// OPS-REAL-001（取代 OPS-TELEMETRY-001 的「自报占位」）：运营控制台的 17 个端点
//   - 没会话 401、不是运营 403 —— 以前任何人都能读；
//   - 没有数据源的页面只回 NOT_CONNECTED + 缺的模块，**一个数字都不给**（以前是写死的 428K / 2.75M / 18.6M）；
//   - 用户构成 / 行为信号走真实查询（LIVE）。

var operatorConsolePaths = []string{
	"context-field", "surface-plans", "execution-runtime", "decision-engine", "clarification-gate", "supply-health",
	"fulfillment-attribution", "behavior", "research", "population", "tags", "intent-orchestration", "engine-api",
	"merchant", "retention", "trust", "quality", "matching", "matching/trace", "north-star",
}

// OPS-CONSOLE-PAGES-001：决策引擎 / 澄清门 / 意图编排 / 信任与风险 四页接上了真读模型，
// 从这里挪到下面 liveConsolePaths。
//
// OPS-RESEARCH-001（2026-10-08）把**最后一个**（research）也接上了：迁移 181 的两张表 +
// internal/research + 四个端点。所以这个列表现在是**空的**。
//
// 它没有被删掉，是因为它是一条口令而不是一份清单：「列在这里的页**必须**回
// NOT_CONNECTED，而且不许夹带任何数字」。空列表 = 今天没有这样的页；哪天再出现一个
// 没数据源的页，它该进这里，而不是被塞进 live 组、然后靠一个编出来的数字让测试变绿。
var notConnectedConsolePaths = []string{}

// merchant 曾经是桩，OPS-MERCHANT-001 把它换成真实读模型；这里断言它**不再**属于
// "必须回 NOT_CONNECTED" 那一组，而属于下面的 LIVE 组 —— 挪走要留下痕迹，
// 不然下一次有人把它塞回桩也没人拦。
//
// matching / matching/trace 是 OPS-MATCHING-TUNABLES-001 接上去的：旋钮来自库
// （没有行就是出厂默认），轨迹读的是 supply.candidate_batches 里存着的快照。
// OPS-NORTH-STAR-001 把 north-star 接上真读模型（四个格子各带口径与缺口说明）。
// OPS-RESEARCH-001 把 research 接上（实验注册表 + 影子评估）。
var liveConsolePaths = []string{"population", "behavior", "merchant", "matching", "matching/trace", "retention", "supply-health", "north-star",
	"decision-engine", "clarification-gate", "intent-orchestration", "trust", "tags",
	"fulfillment-attribution", "quality", "engine-api", "research"}

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

// Retention 用本机库的真实形状：窗口内 196 个下单人、117 个下过 ≥2 次，
// 而**没有人在窗口之前下过单**（priorWindowRequesters=0）—— 这一页必须因此拒绝
// 给同期群留存率，而不是摆一个 100% 上去。
func (stubOpsMetrics) Retention(_ context.Context, _ time.Time) (opsmetrics.Retention, error) {
	return opsmetrics.Retention{
		WindowDays: 30, Orders: 415, Requesters: 196, RepeatRequests: 117,
		RepeatRequesterRate: ratePtr(22.9), SamePairRepeatGroups: 117, AgentsWithOrders: 191,
		// 可归因口径：这台库里一半以上是集成测试留下的行（请求方不是真账号）。
		OrdersAttributable: 268, OrdersUnattributed: 147, RealRequesters: 48, RealRepeatRequesters: 11,
		Completed: 12, Cancelled: 12,
		Lifecycle:     map[string]int64{"CONFIRMED": 336, "OFFERED": 49, "EXECUTING": 6, "COMPLETED": 12, "CANCELLED": 12},
		ActiveLast14d: 9, ActivePrev14d: 1, ReturnedUsers: 1, PriorWindowRequesters: 0,
	}, nil
}

// SupplyHealth 用本机库的真实形状：106 个 ACTIVE 服务者、实名核验 7 通过 / 6 过期，
// 而需求侧正式任务是 0 —— 这一页必须因此拒绝给供需比。
func (stubOpsMetrics) SupplyHealth(_ context.Context, _ time.Time) (opsmetrics.SupplyHealth, error) {
	return opsmetrics.SupplyHealth{
		WindowDays: 30, Agents: 107, AgentsActive: 106, AgentsDraft: 1, AgentsNew: 12,
		AgentsWithBio: 61, AgentsWithLanguages: 88,
		AgentsWithAvailability: 106, AgentsWithOpenWindow: 41,
		RealNameVerified: 7, RealNameExpired: 6, CapabilityVerified: 6,
		AgentsWithOrders: 0, OrdersWindow: 355,
		DemandTaskDrafts: 54, DemandTasks: 0, CityCompanionNeeds: 5,
	}, nil
}

// NorthStar 用本机库的真实形状，且**刻意带上两个「对不上」**：
//   - 45 条草案已 COMMITTED 但 demand.tasks 是 0 行（发布链路缺口）；
//   - 撮合批次 5 批、找到供给 5 批，但 outcome.* 是 0 行、回连命中 0（归因断链）。
//
// 这两处正是「0 和 0 不是一回事」的样本：读模型把数给对了，handler 必须把话也说了。
func (stubOpsMetrics) NorthStar(_ context.Context, _ time.Time) (opsmetrics.NorthStar, error) {
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
	}, nil
}

// DecisionEligibility 用本机库的真实形状：38 行，OBSERVE 24 / LEARN_ONLY 11 / PASSIVE 3，
// **没有一个 ACTIVE_ORCHESTRATE**（§12/§13 不自动进入主动编排）。
func (stubOpsMetrics) DecisionEligibility(context.Context, time.Time) (opsmetrics.DecisionEligibility, error) {
	fresh := time.Now().UTC().Add(-time.Hour)
	return opsmetrics.DecisionEligibility{
		States: []opsmetrics.EligibilityStateRow{
			{State: "OBSERVE", People: 24, AvgConfidence: 0.065, AvgEvidence: 0.219, AvgSampleEvents: 5.6},
			{State: "LEARN_ONLY", People: 11, AvgConfidence: 0.042, AvgEvidence: 0.25, AvgSampleEvents: 2.1},
			{State: "PASSIVE", People: 3, AvgConfidence: 0.687, AvgEvidence: 0.833, AvgSampleEvents: 539.7},
		},
		EventTypes: []opsmetrics.EligibilityEventRow{
			{EventType: "CHAT_ACTIVE", People: 26},
			{EventType: "BROWSE_ACTIVE", People: 11},
			{EventType: "SCENE_VISIT", People: 1},
		},
		ActiveOrchestrate: 0,
		ModelVersions:     []string{"gravity-hist-v1"},
		LastComputedAt:    &fresh,
		FirstComputedAt:   &fresh,
		TotalPeople:       38,
	}, nil
}

// TrustEvidence 用本机库的真实形状，刻意带上那条最有信息量的**不一致**：
// 1 条举报、0 条处置 —— 「0 处置」不是「举报都处理完了」。
func (stubOpsMetrics) TrustEvidence(context.Context, time.Time) (opsmetrics.TrustEvidence, error) {
	return opsmetrics.TrustEvidence{
		WindowDays:         30,
		Agents:             107,
		RealNameVerified:   7,
		RealNameExpired:    6,
		RealNameMissing:    94,
		CapabilityVerified: 6,
		Reports30d:         0,
		ReportsAll:         1,
		MutedAuthors30d:    0,
		MutedAuthorsAll:    0,
		PostReportsAll:     2,
		Dispositions30d:    0,
		DispositionsAll:    0,
		AppealsAll:         0,
		SafetyIncidentsAll: 0,
		SafetyBlocksAll:    0,
	}, nil
}

// ClarificationFunnel 用本机库的真实形状：54 条草案、45 条 COMMITTED、0 条 canonical task，
// 且**下游两条回连都是 0** —— 那是键没接上，不是转化差。
func (stubOpsMetrics) ClarificationFunnel(context.Context, time.Time) (opsmetrics.ClarificationFunnel, error) {
	return opsmetrics.ClarificationFunnel{
		WindowDays: 30,
		Drafts:     54, DraftsOpen: 9, DraftsCommitted: 45, CanonicalTasks: 0,
		DraftsWithBatch: 0, DraftsWithOrder: 0,
		Needs: 5,
	}, nil
}

// TagVocabulary 用本机库的真实形状：7 个轴、语种 5 个原始 token 归一后 3 个（vi/VI、zh/ZH）、
// 90 条 scene_type=UNKNOWN、只有 50/1461 条帖子带语境标签、activity.interests 只有 1 行。
func (stubOpsMetrics) TagVocabulary(context.Context, time.Time) (opsmetrics.TagVocabulary, error) {
	return opsmetrics.TagVocabulary{
		Agents: 107, Posts: 1461,
		Axes: []opsmetrics.TagAxis{
			{Axis: "capability", Side: "supply", Vocabulary: "controlled", Terms: 3, Carriers: 12, Universe: 107},
			{Axis: "service", Side: "supply", Vocabulary: "controlled", Terms: 1, Carriers: 6, Universe: 107},
			{Axis: "vertical", Side: "supply", Vocabulary: "controlled", Terms: 2, Carriers: 5, Universe: 107},
			{Axis: "language", Side: "supply", Vocabulary: "dirty", Terms: 5, Carriers: 105, Universe: 107},
			{Axis: "context_type", Side: "content", Vocabulary: "controlled", Terms: 8, Carriers: 50, Universe: 1461},
			{Axis: "context_id", Side: "content", Vocabulary: "free_text", Terms: 27, Carriers: 50, Universe: 1461},
		},
		Terms: []opsmetrics.TagTerm{
			{Tag: "vi", Type: "language", Count: 100, Unit: "agents"},
			{Tag: "en", Type: "language", Count: 50, Unit: "agents"},
			{Tag: "zh", Type: "language", Count: 50, Unit: "agents"},
			{Tag: "日常", Type: "context_id", Count: 25, Unit: "refs"},
			{Tag: "VI", Type: "language", Count: 5, Unit: "agents"},
			{Tag: "ZH", Type: "language", Count: 5, Unit: "agents"},
		},
		LanguageRawTerms: 5, LanguageNormTerms: 3,
		CaseCollisions: []string{"VI/vi", "ZH/zh"},
		ContextPosts:   50, ContextIdTerms: 27,
		InterestRows: 1,
	}, nil
}

// DataQuality 用本机库的真实形状：1453 条事件、谱系四列基本全空（req_id 0 / impression 0 /
// session 1 / 已知通道 1）、1452 条 server 生成、1 条重复也没有、client_time 只有 1 条。
func (stubOpsMetrics) DataQuality(context.Context, time.Time) (opsmetrics.DataQuality, error) {
	cov := func(field string, filled, total int64) opsmetrics.FieldCoverage {
		return opsmetrics.FieldCoverage{Field: field, Window: "all", Filled: filled, Total: total, Coverage: float64(filled) / float64(total)}
	}
	covW := func(field string, filled, total int64) opsmetrics.FieldCoverage {
		return opsmetrics.FieldCoverage{Field: field, Window: "window", Filled: filled, Total: total, Coverage: float64(filled) / float64(total)}
	}
	return opsmetrics.DataQuality{
		WindowDays: 30, EventsWindow: 1432, EventsAll: 1453,
		Lineage: []opsmetrics.FieldCoverage{
			cov("recommendation_request_id", 0, 1453), covW("recommendation_request_id", 0, 1432),
			cov("impression_id", 0, 1453), covW("impression_id", 0, 1432),
			cov("feed_session_id", 1, 1453), covW("feed_session_id", 1, 1432),
			cov("candidate_source", 1, 1453), covW("candidate_source", 1, 1432),
			cov("client_time", 1, 1453), covW("client_time", 1, 1432),
			cov("need_id", 10, 1453), covW("need_id", 10, 1432),
		},
		CandidateSource:  []opsmetrics.Distribution{{Value: "unknown", Count: 1452}, {Value: "chronological_keyset", Count: 1}},
		EventSource:      []opsmetrics.Distribution{{Value: "server", Count: 1452}, {Value: "client", Count: 1}},
		EventTypes:       []opsmetrics.Distribution{{Value: "POST_IMPRESSION", Count: 1323}, {Value: "PROFILE_OPEN", Count: 106}},
		ClientTimeFilled: 1, SkewOver5Min: 0, MaxSkewSeconds: 31.7,
		DuplicateEventIds: 0,
	}, nil
}

// AttributionAudit 用本机库的真实形状：三段键全是 0 —— 链没接，不是没有生意。
func (stubOpsMetrics) AttributionAudit(context.Context, time.Time) (opsmetrics.AttributionAudit, error) {
	return opsmetrics.AttributionAudit{
		WindowDays: 30,
		EventsAll:  1453, EventsAttributable: 0,
		BatchesAll: 5, BatchesWithNeedId: 5,
		OrdersAll: 819, OrdersWithNeedId: 819,
		KeysJoined: 0, OutcomeRows: 0,
	}, nil
}

func operatorConsoleServer() *Server {
	return &Server{
		RateLimit:  NewRateLimiter(0, 100),
		Operator:   NewStaticOperatorGate([]string{"user_ops"}),
		OpsMetrics: stubOpsMetrics{},
		Gravity:    gravity.NewMemory(),
		// 撮合引擎管理（OPS-MATCHING-TUNABLES-001）：假存储只证明 handler 与门，
		// SQL 由 internal/platform/postgres 的集成测试对真库钉。
		Matching: &fakeMatching{},
		// 实验 / 影子流量（OPS-RESEARCH-001）：同上 —— 这里用 Memory 证明门与状态码，
		// 阶段机 / 乐观锁在 internal/research 的单元测试，列名与 jsonb 在 postgres 包的
		// 集成测试里对真库钉。
		Research: research.NewService(research.NewMemory()),
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
