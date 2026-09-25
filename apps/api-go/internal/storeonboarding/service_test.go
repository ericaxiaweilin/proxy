package storeonboarding

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

func envelopeFor(cmd string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandType:   cmd,
		Payload:       payload,
		Actor:         command.Actor{ID: actorID},
		CorrelationID: "corr_test",
		CommandID:     "cmd_test",
	}
}

func fixedClock() func() time.Time {
	t := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	return func() time.Time { return t }
}

func TestRecommendStoreAcceptedAndAttributed(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Three Beans Cau Giay",
		"city":      "河内",
		"category":  "咖啡",
		"reason":    "朋友常去，适合聊天与 Afterwork 场景",
		"origin":    "USER",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("recommend: %+v", r)
	}
	rows := repo.Recommendations()
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	rec := rows[0]
	if rec.StoreName != "Three Beans Cau Giay" || rec.RecommendedBy != "user_001" || rec.Origin != "USER" {
		t.Fatalf("wrong recommendation: %+v", rec)
	}
	if !rec.CreatedAt.Equal(fixedClock()()) {
		t.Fatalf("createdAt must come from service clock, got %v", rec.CreatedAt)
	}
}

func TestRecommendStoreRequiresStoreCityReason(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	svc.SetClock(fixedClock())
	for _, tc := range []struct {
		name    string
		payload map[string]any
	}{
		{"missing store", map[string]any{"city": "河内", "reason": "x"}},
		{"missing city", map[string]any{"storeName": "店", "reason": "x"}},
		{"missing reason", map[string]any{"storeName": "店", "city": "河内"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := svc.Handle(envelopeFor("RecommendStore", tc.payload, "user_001"))
			if r.Outcome != "REJECTED" {
				t.Fatalf("want rejected, got %+v", r)
			}
		})
	}
}

func TestRecommendStoreRejectedWhenActorMissing(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "店", "city": "河内", "reason": "x",
	}, ""))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR" {
		t.Fatalf("want actor rejection, got %+v", r)
	}
}

func TestRecommendStoreFailedWhenRepositoryDown(t *testing.T) {
	repo := NewMemoryRepository()
	repo.SetFail(true)
	svc := NewWithRepository(repo)
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "店", "city": "河内", "reason": "x",
	}, "user_001"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "RECOMMENDATION_FAILED" {
		t.Fatalf("want repository-down rejection, got %+v", r)
	}
}

func TestRecommendStoreSupportsOnlyItsCommand(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if !svc.Supports("RecommendStore") {
		t.Fatal("must support RecommendStore")
	}
	for _, other := range []string{"ReportTarget", "FileAppeal", "CreatePost"} {
		if svc.Supports(other) {
			t.Fatalf("must not support %s", other)
		}
	}
}

// ---- STORE-REC-002: 运营评估队列（读路径） ----
//
// STORE-REC-001 只做了受理，记录写进去后没有任何读路径 —— 运营在 bdash 里
// 评估这件事在数据层做不到，「推荐商铺进体系」变成只进不出的黑洞。
// 下面这组测试锁住读路径存在、且不会静默给出错的结论。

func addRec(t *testing.T, repo *MemoryRepository, id, store, city, origin string, created time.Time) {
	t.Helper()
	if err := repo.AddRecommendation(context.Background(), StoreRecommendation{
		ID: id, StoreName: store, City: city, Reason: "理由", Origin: origin,
		RecommendedBy: "user_001", CreatedAt: created,
	}); err != nil {
		t.Fatalf("seed %s: %v", id, err)
	}
}

func listRef(t *testing.T, svc *Service, payload map[string]any) (string, command.Result) {
	t.Helper()
	r := svc.Handle(envelopeFor("ListStoreRecommendations", payload, "operator_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list rejected: %+v", r)
	}
	return r.OperationRef, r
}

func TestListStoreRecommendationsNewestFirst(t *testing.T) {
	repo := NewMemoryRepository()
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	addRec(t, repo, "sr_old", "老店", "河内", "USER", base)
	addRec(t, repo, "sr_new", "新店", "河内", "USER", base.Add(time.Hour))

	svc := NewWithRepository(repo)
	ref, _ := listRef(t, svc, map[string]any{})

	var decoded struct {
		Recommendations []StoreRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(ref), &decoded); err != nil {
		t.Fatalf("operationRef must be the queue JSON, got %q", ref)
	}
	if len(decoded.Recommendations) != 2 {
		t.Fatalf("want 2 rows, got %d (%s)", len(decoded.Recommendations), ref)
	}
	// 运营队列要的是最新的在前 —— 倒过来等于每天先翻旧账。
	if decoded.Recommendations[0].ID != "sr_new" {
		t.Fatalf("newest must come first, got %+v", decoded.Recommendations)
	}
}

func TestListStoreRecommendationsFiltersByCityAndOrigin(t *testing.T) {
	repo := NewMemoryRepository()
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	addRec(t, repo, "sr_a", "河内店", "河内", "USER", base)
	addRec(t, repo, "sr_b", "胡志明店", "胡志明市", "USER", base)
	addRec(t, repo, "sr_c", "AI 河内店", "河内", "AI", base)

	svc := NewWithRepository(repo)

	ref, _ := listRef(t, svc, map[string]any{"city": "河内"})
	if !strings.Contains(ref, "sr_a") || strings.Contains(ref, "sr_b") {
		t.Fatalf("city filter leaked: %s", ref)
	}

	ref, _ = listRef(t, svc, map[string]any{"origin": "AI"})
	if !strings.Contains(ref, "sr_c") || strings.Contains(ref, "sr_a") {
		t.Fatalf("origin filter leaked: %s", ref)
	}
}

func TestListStoreRecommendationsClampsOversizedLimit(t *testing.T) {
	repo := NewMemoryRepository()
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	// 201 条：超过上限，用来证明「读路径自带上限」是真的，
	// 而不是靠客户端自觉。
	for i := 0; i < 201; i++ {
		addRec(t, repo, "sr_"+string(rune('a'+i%26))+string(rune('a'+i/26)), "店", "河内", "USER", base.Add(time.Duration(i)*time.Second))
	}
	svc := NewWithRepository(repo)
	ref, _ := listRef(t, svc, map[string]any{"limit": 100000})

	var decoded struct {
		Recommendations []StoreRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(ref), &decoded); err != nil {
		t.Fatalf("bad ref: %v", err)
	}
	if len(decoded.Recommendations) != ListLimitMax {
		t.Fatalf("limit must clamp to %d, got %d", ListLimitMax, len(decoded.Recommendations))
	}
}

func TestListStoreRecommendationsRejectsUnknownOriginInsteadOfReturningEverything(t *testing.T) {
	repo := NewMemoryRepository()
	addRec(t, repo, "sr_a", "店", "河内", "USER", time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC))
	svc := NewWithRepository(repo)

	r := svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{"origin": "ROBOT"}, "operator_001"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_RECOMMENDATION_ORIGIN" {
		t.Fatalf("unknown origin must be rejected (not silently widen to all), got %+v", r)
	}
}

func TestListStoreRecommendationsReturnsArrayWhenEmpty(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	ref, _ := listRef(t, svc, map[string]any{})
	// 客户端 fail-closed 解析要求数组：null 会让运营端的 .map() 直接炸。
	if !strings.Contains(ref, `"recommendations":[]`) {
		t.Fatalf("empty queue must serialise as [], got %s", ref)
	}
}

func TestListStoreRecommendationsRejectedWhenReadFails(t *testing.T) {
	repo := NewMemoryRepository()
	repo.SetFail(true)
	svc := NewWithRepository(repo)
	r := svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{}, "operator_001"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "RECOMMENDATION_READ_FAILED" {
		t.Fatalf("read failure must not look like an empty queue, got %+v", r)
	}
}

func TestServiceSupportsListStoreRecommendations(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	if !svc.Supports("ListStoreRecommendations") {
		t.Fatal("must support ListStoreRecommendations")
	}
}

func TestRecommendStoreAIOriginAccepted(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Truc Bach Lake Cafe",
		"city":      "河内",
		"category":  "咖啡",
		"reason":    "湖景好，适合湖边慢聊场景（AI 小美推荐）",
		"origin":    "AI",
	}, "ai_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("AI recommend: %+v", r)
	}
	if repo.Recommendations()[0].Origin != "AI" {
		t.Fatalf("origin must be AI, got %+v", repo.Recommendations()[0])
	}
}

// ---------- STORE-REC-003: 小美（AI）推荐 ----------

// stubSuggestStack 是脚本化的 modelstack.Port。
type stubSuggestStack struct {
	reply string
	err   error
}

func (s stubSuggestStack) Available() bool { return true }
func (s stubSuggestStack) Complete(_ context.Context, taskID string, msgs []modelstack.ChatMessage) (modelstack.Completion, error) {
	if s.err != nil {
		return modelstack.Completion{}, s.err
	}
	// 任务 id 必须是本域注册的 id —— 拿错 id 说明接错底座任务。
	if taskID != suggestionTaskID {
		return modelstack.Completion{}, modelstack.ErrTaskNotRoutable
	}
	return modelstack.Completion{Content: s.reply}, nil
}

// wiredUnavailableStack 模拟「注入了适配器但底座不可用」。
type wiredUnavailableStack struct{}

func (wiredUnavailableStack) Available() bool { return false }
func (wiredUnavailableStack) Complete(context.Context, string, []modelstack.ChatMessage) (modelstack.Completion, error) {
	return modelstack.Completion{}, nil
}

// STORE-REC-003: 小美把用户随口说的话整理成推荐草稿。
// 关键行为：①合法 JSON → 返回结构化草稿；②markdown 围栏也能抽出；
// ③底座未配置 → AI_NOT_CONFIGURED（fail-closed，前端据此隐藏入口）；
// ④模型报错 / 输出非 JSON → 分别以 SUGGESTION_FAILED / SUGGESTION_MALFORMED 拒。
func TestSuggestStoreRecommendationStructuresTheNote(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())

	svc.SetModelStack(stubSuggestStack{reply: `{"storeName":"Three Beans","city":"河内","category":"咖啡","reason":"适合 afterwork，老板愿意合作活动"}`})
	res := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{
		"note": "Cầu Giấy 那家 Three Beans 咖啡不错，适合 afterwork，老板愿意合作活动",
	}, "user_1"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("suggest should be accepted: %+v", res)
	}
	var draft SuggestedRecommendation
	if err := json.Unmarshal([]byte(res.OperationRef), &draft); err != nil {
		t.Fatal(err)
	}
	if draft.StoreName != "Three Beans" || draft.City != "河内" || draft.Category != "咖啡" {
		t.Fatalf("draft not structured: %+v", draft)
	}
	if !strings.Contains(draft.Reason, "afterwork") {
		t.Fatalf("reason lost: %q", draft.Reason)
	}

	// markdown 代码围栏包裹的回复同样能抽出 JSON。
	svc.SetModelStack(stubSuggestStack{reply: "```json\n{\"storeName\":\"A\",\"city\":\"河内\",\"category\":\"\",\"reason\":\"好\"}\n```"})
	fenced := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "A 不错"}, "user_1"))
	if fenced.Outcome != "ACCEPTED" || !strings.Contains(fenced.OperationRef, `"storeName":"A"`) {
		t.Fatalf("fenced reply must still parse: %+v", fenced)
	}
}

// 最重要的一条：**不许编造**。用户没说城市，模型就不该给城市；
// 即便模型硬塞了一个，服务端也不补全 —— 缺的字段留空，交给用户补。
// 一旦这里退化成「随便填个默认值」，运营就会按一条假推荐去做评估。
func TestSuggestStoreRecommendationDoesNotInventUnsaidFields(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())
	svc.SetModelStack(stubSuggestStack{reply: `{"storeName":"某家店","city":"","category":"","reason":"环境好"}`})
	res := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "有家店环境挺好"}, "user_1"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("partial draft should still be accepted: %+v", res)
	}
	var draft SuggestedRecommendation
	if err := json.Unmarshal([]byte(res.OperationRef), &draft); err != nil {
		t.Fatal(err)
	}
	if draft.City != "" || draft.Category != "" {
		t.Fatalf("unsaid fields must stay empty, got %+v", draft)
	}
	if draft.StoreName == "" || draft.Reason == "" {
		t.Fatalf("said fields must survive: %+v", draft)
	}
}

// fail-closed：没注入 / 注入了但不可用，一律 AI_NOT_CONFIGURED。
// 这是「前端隐藏入口」的依据 —— 不能静默返回一个假草稿。
func TestSuggestStoreRecommendationFailsClosedWhenAIUnavailable(t *testing.T) {
	unwired := NewWithRepository(NewMemoryRepository())
	res := unwired.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "有家店不错"}, "user_1"))
	if res.Outcome != "REJECTED" || res.Error == nil || res.Error.ErrorCode != "AI_NOT_CONFIGURED" {
		t.Fatalf("unwired stack must fail closed: %+v", res)
	}

	wired := NewWithRepository(NewMemoryRepository())
	wired.SetModelStack(wiredUnavailableStack{})
	res2 := wired.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "有家店不错"}, "user_1"))
	if res2.Outcome != "REJECTED" || res2.Error == nil || res2.Error.ErrorCode != "AI_NOT_CONFIGURED" {
		t.Fatalf("unavailable stack must fail closed: %+v", res2)
	}
}

// 模型故障（SUGGESTION_FAILED）与输出非法（SUGGESTION_MALFORMED）必须是
// 两个不同的错误码：前者可以安全重试，后者重试大概率还是同样坏的输出。
func TestSuggestStoreRecommendationDistinguishesFailureFromMalformed(t *testing.T) {
	svc := NewWithRepository(NewMemoryRepository())

	svc.SetModelStack(stubSuggestStack{err: modelstack.ErrGatewayFailure})
	failed := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "有家店不错"}, "user_1"))
	if failed.Outcome != "REJECTED" || failed.Error == nil || failed.Error.ErrorCode != "SUGGESTION_FAILED" {
		t.Fatalf("gateway failure must be SUGGESTION_FAILED: %+v", failed)
	}

	svc.SetModelStack(stubSuggestStack{reply: "我觉得这家店很不错，你应该去看看"})
	malformed := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "有家店不错"}, "user_1"))
	if malformed.Outcome != "REJECTED" || malformed.Error == nil || malformed.Error.ErrorCode != "SUGGESTION_MALFORMED" {
		t.Fatalf("prose instead of JSON must be SUGGESTION_MALFORMED: %+v", malformed)
	}

	// 空 note：连问都不问模型，直接参数校验拒。
	svc.SetModelStack(stubSuggestStack{reply: `{"storeName":"x","city":"y","category":"","reason":"z"}`})
	empty := svc.Handle(envelopeFor("SuggestStoreRecommendation", map[string]any{"note": "   "}, "user_1"))
	if empty.Outcome != "REJECTED" || empty.Error == nil || empty.Error.ErrorCode != "INVALID_SUGGESTION_NOTE" {
		t.Fatalf("empty note must be rejected: %+v", empty)
	}
}

// ---------- STORE-REC-004: 运营评估结论 ----------

func seedRecommendation(t *testing.T, svc *Service, repo *MemoryRepository) string {
	t.Helper()
	res := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Three Beans", "city": "河内", "category": "咖啡", "reason": "适合 afterwork", "origin": "USER",
	}, "user_1"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("seed recommendation: %+v", res)
	}
	rows := repo.Recommendations()
	if len(rows) == 0 {
		t.Fatal("recommendation was not stored")
	}
	return rows[0].ID
}

func parseQueue(t *testing.T, res command.Result) []StoreRecommendation {
	t.Helper()
	var view struct {
		Recommendations []StoreRecommendation `json:"recommendations"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &view); err != nil {
		t.Fatal(err)
	}
	return view.Recommendations
}

// STORE-REC-004: 运营能记录「采纳 / 不采纳」，而不是看完什么都不留下。
// 钉死：不采纳必须给理由；拼错的 decision 不能被当成 ACCEPT；匿名处置要拒。
func TestDecideStoreRecommendationRecordsTheDecision(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	id := seedRecommendation(t, svc, repo)

	accept := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "ACCEPT",
	}, "operator_1"))
	if accept.Outcome != "ACCEPTED" {
		t.Fatalf("accept must succeed: %+v", accept)
	}
	rows := repo.Dispositions()
	if len(rows) != 1 || rows[0].Decision != AcceptDecision || rows[0].DecidedBy != "operator_1" {
		t.Fatalf("disposition not recorded with its decider: %+v", rows)
	}

	noReason := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "REJECT",
	}, "operator_1"))
	if noReason.Outcome != "REJECTED" || noReason.Error == nil || noReason.Error.ErrorCode != "DISPOSITION_REJECT_REQUIRES_REASON" {
		t.Fatalf("reject without a reason must be refused: %+v", noReason)
	}

	typo := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "MAYBE",
	}, "operator_1"))
	if typo.Outcome != "REJECTED" || typo.Error == nil || typo.Error.ErrorCode != "INVALID_DISPOSITION_DECISION" {
		t.Fatalf("unknown decision must be refused, not silently treated as ACCEPT: %+v", typo)
	}

	anon := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "ACCEPT",
	}, ""))
	if anon.Outcome != "REJECTED" || anon.Error == nil || anon.Error.ErrorCode != "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR" {
		t.Fatalf("anonymous disposition must be refused: %+v", anon)
	}
}

// 队列要能看见结论，并且默认（pendingOnly）把已评估的过滤掉 ——
// 否则运营每评估完一条它还杵在列表里，队列越用越长。
func TestQueueShowsDecisionAndHonoursPendingOnly(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	id := seedRecommendation(t, svc, repo)

	reject := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "REJECT", "reason": "同品类已接入三家",
	}, "operator_1"))
	if reject.Outcome != "ACCEPTED" {
		t.Fatalf("reject with reason must succeed: %+v", reject)
	}

	all := parseQueue(t, svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{}, "operator_1")))
	if len(all) != 1 {
		t.Fatalf("expected the recommendation to still be listable, got %d", len(all))
	}
	if all[0].Decision != RejectDecision || all[0].DecisionReason != "同品类已接入三家" {
		t.Fatalf("queue must carry the decision: %+v", all[0])
	}
	if all[0].DecidedBy != "operator_1" || all[0].DecidedAt == nil {
		t.Fatalf("queue must carry who decided and when: %+v", all[0])
	}

	pending := parseQueue(t, svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{"pendingOnly": true}, "operator_1")))
	if len(pending) != 0 {
		t.Fatalf("decided recommendation must leave the pending queue, got %d", len(pending))
	}
}

// STORE-REC-005: 采纳之后，这条推荐必须还能被查出来。
//
// 队列默认只看待评估，采纳完一条它就从默认视图消失 —— 而 status 此前只有
// 「待评估 / 全部」两种看法（一个 bool 表达不了四态），运营没有任何办法把
// 「我批过的」单独列出来。于是采纳等于把这条推荐扔进黑洞：结论存下来了，
// 却读不回来，既看不到自己批过什么，也没法跟进商家实际入驻。
// 这是本仓库第七次「通道建好了，没有调用方」，只是这次死在**读**的一侧。
func TestAcceptedRecommendationsStayReachable(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())

	for _, name := range []string{"采纳店", "否决店", "待评估店"} {
		res := svc.Handle(envelopeFor("RecommendStore", map[string]any{
			"storeName": name, "city": "河内", "category": "咖啡", "reason": "值得进", "origin": "USER",
		}, "user_1"))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("seed %s: %+v", name, res)
		}
	}
	byName := map[string]string{}
	for _, rec := range repo.Recommendations() {
		byName[rec.StoreName] = rec.ID
	}

	mustDecide := func(name, decision, reason string) {
		t.Helper()
		payload := map[string]any{"recommendationId": byName[name], "decision": decision}
		if reason != "" {
			payload["reason"] = reason
		}
		if res := svc.Handle(envelopeFor("DecideStoreRecommendation", payload, "operator_1")); res.Outcome != "ACCEPTED" {
			t.Fatalf("decide %s: %+v", name, res)
		}
	}
	mustDecide("采纳店", "ACCEPT", "")
	mustDecide("否决店", "REJECT", "同品类已接入三家")

	queue := func(status string) []string {
		t.Helper()
		payload := map[string]any{}
		if status != "" {
			payload["status"] = status
		}
		rows := parseQueue(t, svc.Handle(envelopeFor("ListStoreRecommendations", payload, "operator_1")))
		names := make([]string, 0, len(rows))
		for _, r := range rows {
			names = append(names, r.StoreName)
		}
		return names
	}

	// 核心断言：采纳的这家店必须能单独查出来，而不是只剩下「全部」里那一堆。
	if got := queue(StatusAccepted); len(got) != 1 || got[0] != "采纳店" {
		t.Fatalf("accepted queue must show the accepted recommendation, got %v", got)
	}
	if got := queue(StatusRejected); len(got) != 1 || got[0] != "否决店" {
		t.Fatalf("rejected queue must show the rejected recommendation, got %v", got)
	}
	if got := queue(StatusPending); len(got) != 1 || got[0] != "待评估店" {
		t.Fatalf("pending queue must show only undecided ones, got %v", got)
	}
	if got := queue(StatusAny); len(got) != 3 {
		t.Fatalf("no status must mean all three, got %v", got)
	}

	// 拼错的 status 必须明确拒绝，不能静默返回全量 —— 否则运营会照着
	// 一份错误的清单去跟进商家。
	typo := svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{"status": "ACCEPTEDD"}, "operator_1"))
	if typo.Outcome != "REJECTED" || typo.Error == nil || typo.Error.ErrorCode != "INVALID_RECOMMENDATION_STATUS" {
		t.Fatalf("unknown status must be refused, not silently ignored: %+v", typo)
	}
}

// STORE-REC-007: 推荐人能看见**自己**那条的进展，且只能看见自己的。
//
// 采纳只代表运营批准接入，商家真正入驻是另一件事 —— 而能完成入驻的人（推荐人，
// 通常就是店主）此前**看不到自己那条推荐怎么样了**：提交完再无回音，自然不知道
// 「该去建店了」，于是「已采纳 · 待接入」那一列永远等不到人。
// 队列（ListStoreRecommendations）是 operator-only，解决不了这件事。
func TestRecommenderCanSeeOnlyTheirOwnStatus(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())

	recommend := func(store, by string) {
		t.Helper()
		if res := svc.Handle(envelopeFor("RecommendStore", map[string]any{
			"storeName": store, "city": "河内", "category": "咖啡", "reason": "值得进", "origin": "USER",
		}, by)); res.Outcome != "ACCEPTED" {
			t.Fatalf("seed %s: %+v", store, res)
		}
	}
	recommend("我的店", "user_1")
	recommend("别人的店", "user_2")

	byName := map[string]string{}
	for _, rec := range repo.Recommendations() {
		byName[rec.StoreName] = rec.ID
	}
	if res := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": byName["我的店"], "decision": "ACCEPT",
	}, "operator_1")); res.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", res)
	}

	mine := parseQueue(t, svc.Handle(envelopeFor("ListMyStoreRecommendations", map[string]any{}, "user_1")))
	if len(mine) != 1 || mine[0].StoreName != "我的店" {
		t.Fatalf("user_1 must see only their own recommendation, got %+v", mine)
	}
	// 关键：他必须能看见「被采纳了」—— 否则他不知道该去建店。
	if mine[0].Decision != AcceptDecision {
		t.Fatalf("recommender must see the decision: %+v", mine[0])
	}

	theirs := parseQueue(t, svc.Handle(envelopeFor("ListMyStoreRecommendations", map[string]any{}, "user_2")))
	if len(theirs) != 1 || theirs[0].StoreName != "别人的店" {
		t.Fatalf("user_2 must see only their own recommendation, got %+v", theirs)
	}

	// 传参不能改变作用域：试图指定别人的 id（或任何筛选）都只看到自己的。
	spoof := parseQueue(t, svc.Handle(envelopeFor("ListMyStoreRecommendations", map[string]any{
		"city": "河内", "recommendedBy": "user_2", "origin": "USER",
	}, "user_1")))
	if len(spoof) != 1 || spoof[0].StoreName != "我的店" {
		t.Fatalf("caller must not be able to widen the scope: %+v", spoof)
	}

	anon := svc.Handle(envelopeFor("ListMyStoreRecommendations", map[string]any{}, ""))
	if anon.Outcome != "REJECTED" || anon.Error == nil || anon.Error.ErrorCode != "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR" {
		t.Fatalf("anonymous read must be refused: %+v", anon)
	}
}

// STORE-REC-006: 结论必须落在一条真实存在的推荐上。
//
// 少了这个校验，id 打错也会写进一条结论 —— 它永远 join 不到任何推荐，于是那条
// 推荐在队列里永远还是「待评估」。运营看到的是「我点了采纳但没反应」，会反复点，
// append-only 的举证链里就堆满谁也解释不了的孤儿结论（删不掉，因为 append-only）。
func TestDispositionOnUnknownRecommendationIsRefused(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	real := seedRecommendation(t, svc, repo)

	orphan := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": "rec_does_not_exist", "decision": "ACCEPT",
	}, "operator_1"))
	if orphan.Outcome != "REJECTED" || orphan.Error == nil || orphan.Error.ErrorCode != "DISPOSITION_RECOMMENDATION_NOT_FOUND" {
		t.Fatalf("disposition on an unknown recommendation must be refused: %+v", orphan)
	}
	// 关键：不能留下一条对不上任何推荐的结论。append-only 表删不掉，
	// 写进去就是永久垃圾。
	if got := repo.Dispositions(); len(got) != 0 {
		t.Fatalf("no orphan disposition may be written: %+v", got)
	}

	// 真实存在的推荐仍然要能出结论 —— 校验不能误伤正常路径。
	ok := svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": real, "decision": "REJECT", "reason": "位置不合适",
	}, "operator_1"))
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("disposition on a real recommendation must still work: %+v", ok)
	}
}

// 改主意 = 追加一条新结论，以最新一条为准（append-only，不改旧记录）。
func TestLatestDispositionWinsWhenOperatorChangesMind(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	// 递增时钟，确保两条结论时间不同。
	now := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { now = now.Add(time.Minute); return now })
	id := seedRecommendation(t, svc, repo)

	svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "ACCEPT",
	}, "operator_1"))
	svc.Handle(envelopeFor("DecideStoreRecommendation", map[string]any{
		"recommendationId": id, "decision": "REJECT", "reason": "再看了下，位置不合适",
	}, "operator_1"))

	if len(repo.Dispositions()) != 2 {
		t.Fatalf("changing mind must append, not replace: %+v", repo.Dispositions())
	}
	all := parseQueue(t, svc.Handle(envelopeFor("ListStoreRecommendations", map[string]any{}, "operator_1")))
	if len(all) != 1 {
		t.Fatalf("LEFT JOIN must not duplicate the row, got %d", len(all))
	}
	if all[0].Decision != RejectDecision || all[0].DecisionReason != "再看了下，位置不合适" {
		t.Fatalf("latest disposition must win: %+v", all[0])
	}
}

// STORE-REC-ADDRESS-001：推荐带上门牌地址与地图落点。
//
// 重点不是「字段存得下」，而是**「没选点」和「选了点」必须能分开**：
// (0,0) 是几内亚湾上的一个真实坐标，实现里若拿 0 当「没填」，一条在河内的
// 推荐会被画到西非去。所以坐标走指针 + NULL，缺省是「没有」而不是「零」。
func TestRecommendStoreCarriesAddressAndPin(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "Three Beans Cau Giay",
		"city":      "河内",
		"category":  "咖啡",
		"reason":    "适合 afterwork",
		"address":   "  12 Trần Duy Hưng, Cầu Giấy  ",
		"latitude":  21.0113,
		"longitude": 105.7985,
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("recommend with pin: %+v", r)
	}
	rec := repo.Recommendations()[0]
	if rec.Address != "12 Trần Duy Hưng, Cầu Giấy" {
		t.Fatalf("address must be trimmed, got %q", rec.Address)
	}
	if rec.Latitude == nil || rec.Longitude == nil {
		t.Fatalf("pin must be kept: %+v", rec)
	}
	if *rec.Latitude != 21.0113 || *rec.Longitude != 105.7985 {
		t.Fatalf("pin must round-trip unchanged: %v,%v", *rec.Latitude, *rec.Longitude)
	}
}

// 不填地址、不选点也必须能提交 —— 这是 092 时代就有的路径，而且小美草稿
// （SuggestStoreRecommendation）不可能给出坐标，必填会让 AI 那条路直接废掉。
func TestRecommendStoreWithoutLocationIsStillAccepted(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetClock(fixedClock())
	r := svc.Handle(envelopeFor("RecommendStore", map[string]any{
		"storeName": "店", "city": "河内", "reason": "x",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("location is optional: %+v", r)
	}
	rec := repo.Recommendations()[0]
	if rec.Address != "" || rec.Latitude != nil || rec.Longitude != nil {
		t.Fatalf("absent location must stay absent, got %+v", rec)
	}
}

// 只有一半的坐标画不出点：存下来只会让队列显示「有坐标」却定位不到任何地方，
// 而没人看得出它是坏的。出界的坐标同理。两种都当场拒绝 ——
// 别留给 postgres 那条 CHECK，那样返回的是 INTERNAL 500，长得像故障。
func TestRecommendStoreRefusesHalfOrOutOfRangeCoordinate(t *testing.T) {
	for _, tc := range []struct {
		name    string
		payload map[string]any
	}{
		{"latitude only", map[string]any{"storeName": "店", "city": "河内", "reason": "x", "latitude": 21.0}},
		{"longitude only", map[string]any{"storeName": "店", "city": "河内", "reason": "x", "longitude": 105.0}},
		{"latitude out of range", map[string]any{"storeName": "店", "city": "河内", "reason": "x", "latitude": 91.0, "longitude": 105.0}},
		{"longitude out of range", map[string]any{"storeName": "店", "city": "河内", "reason": "x", "latitude": 21.0, "longitude": 181.0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := NewMemoryRepository()
			svc := NewWithRepository(repo)
			r := svc.Handle(envelopeFor("RecommendStore", tc.payload, "user_001"))
			if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_RECOMMENDATION_LOCATION" {
				t.Fatalf("want location rejection, got %+v", r)
			}
			if len(repo.Recommendations()) != 0 {
				t.Fatalf("a rejected recommendation must not be stored")
			}
		})
	}
}
