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
