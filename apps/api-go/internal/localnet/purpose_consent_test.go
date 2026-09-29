package localnet

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// COMP-PURPOSE-CONSENT-001（2026-09-27 越南合规扫描）。
//
// 这一组测的是**架构**：行为追踪的同意闸原来只在客户端
// （apps/mobile 的隐私开关），服务端照收不误。而 Nghị định 356/2025/NĐ-CP
// 把举证责任放在控制者身上 —— Art. 6.1 同意须可验证、Art. 6.2 控制者须保存同意、
// Art. 6.3 禁止默认同意机制、Art. 4.1(l) 把社交网络上的行为追踪数据列为敏感个人数据。
//
// 在改动之前，用户说「我从没同意过」，平台拿不出任何记录 —— 唯一的记录在他
// 自己的设备里。下面每一条都钉住改动之后的一个不变量。

// grantBehaviorAnalytics 走**真正的同意流程**（而不是直接写 repository），
// 这样调用它的测试同时也验证了写侧是通的。
func grantBehaviorAnalytics(t *testing.T, s *Service, actors ...string) {
	t.Helper()
	for _, actor := range actors {
		res := as(s, actor, "RecordPurposeConsent", map[string]any{
			"purpose": PurposeBehaviorAnalytics, "granted": true, "source": "TEST",
		})
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("grant consent for %s: got %s (%+v)", actor, res.Outcome, res.Error)
		}
	}
}

// purposeConsentStateOf 读某个人的同意状态并解出结构化 body。
// localnet 域的读命令都把结构化数据放在 OperationRef 里（客户端
// localnet-client.ts 也只有这一条解析路径），所以这里跟着解码。
func purposeConsentStateOf(t *testing.T, s *Service, actor string) map[string]any {
	t.Helper()
	res := as(s, actor, "GetPurposeConsent", map[string]any{"purpose": PurposeBehaviorAnalytics})
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("GetPurposeConsent(%s): got %s (%+v)", actor, res.Outcome, res.Error)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(res.OperationRef), &body); err != nil {
		t.Fatalf("decode consent state for %s: %v", actor, err)
	}
	return body
}

// behaviouralCommandToEventType 把「命令」映射到它落库的「事件类型」。
// 它和 behaviouralTrackingEventTypes 必须一一对应（见下面的结构性钉）。
var behaviouralCommandToEventType = map[string]string{
	"RecordPostImpression":  "POST_IMPRESSION",
	"RecordMediaImpression": "MEDIA_IMPRESSION",
	"RecordMediaZoom":       "MEDIA_ZOOM",
	"RecordProfileOpen":     "PROFILE_OPEN",
	"RecordCandidateViewed": "CANDIDATE_VIEWED",
}

// 结构性钉：被闸住的事件类型集合，必须和测试里列出的命令集合完全一致。
//
// 这一条是防「新加一条行为追踪事件忘了挂闸」的。有人加了一个新的追踪事件类型
// 并正确地把它放进 behaviouralTrackingEventTypes，这条会红 —— 提醒他补一个
// 端到端用例；反过来，如果有人把某个事件类型从闸里**删掉**，这条也会红。
// 无论往哪个方向走，都不会悄悄出现一条不设防的通道。
func TestEveryGatedEventTypeHasAnEndToEndCase(t *testing.T) {
	listed := map[string]bool{}
	for _, eventType := range behaviouralCommandToEventType {
		listed[eventType] = true
	}
	if len(listed) != len(behaviouralTrackingEventTypes) {
		t.Fatalf("测试列了 %d 个被闸事件类型，实现里有 %d 个 —— 两边必须一一对应",
			len(listed), len(behaviouralTrackingEventTypes))
	}
	for eventType, purpose := range behaviouralTrackingEventTypes {
		if !listed[eventType] {
			t.Errorf("事件类型 %q 被闸住了，但测试里没有对应命令 —— 补一个端到端用例", eventType)
		}
		if purpose != PurposeBehaviorAnalytics {
			t.Errorf("事件类型 %q 挂到了目的 %q；目前只有 %q 有同意写入口，挂别的目的等于挂了个没人能给的同意",
				eventType, purpose, PurposeBehaviorAnalytics)
		}
	}
}

// 没有同意 ⇒ 拒收，且**一个事件都不落库**。
func TestBehavioralTrackingIsRefusedWithoutConsent(t *testing.T) {
	s := New()
	post := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER", "body": "夜跑", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	if post.Outcome != "ACCEPTED" {
		t.Fatalf("create post: %+v", post.Error)
	}

	for commandType, eventType := range behaviouralCommandToEventType {
		res := as(s, "viewer_x", commandType, map[string]any{"targetId": "target_1", "watchMs": 3000})
		if res.Outcome != "REJECTED" {
			t.Errorf("%s（%s）在没有同意时被接受了 —— 这就是那条不设防的通道", commandType, eventType)
			continue
		}
		if res.Error == nil || res.Error.ErrorCode != "CONSENT_REQUIRED" {
			t.Errorf("%s 的拒绝理由应该是 CONSENT_REQUIRED，实际 %+v", commandType, res.Error)
			continue
		}
		// COMPLIANCE 分类很重要：这不是「参数写错了」，重试也没用。
		if res.Error.Category != "COMPLIANCE" {
			t.Errorf("%s 的分类应为 COMPLIANCE，实际 %q", commandType, res.Error.Category)
		}
	}

	// 拒收之后必须**真的没有数据**：拒绝不能只发生在返回值上。
	events, err := s.repository.ListInteractionEvents(context.Background(), "viewer_x", 50)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("被拒的事件仍然落库了 %d 条 —— 闸只挡住了返回值，没挡住写入", len(events))
	}
}

// 同意之后能采；撤回之后**立刻**又不能采 —— 撤回必须是有效的，不是装饰。
func TestConsentCanBeGrantedAndWithdrawn(t *testing.T) {
	fixed := clock.NewFixed(time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC))
	s := NewWithRepositoryAndClock(NewMemoryRepository(), fixed)
	grantBehaviorAnalytics(t, s, "viewer_a")

	if res := as(s, "viewer_a", "RecordPostImpression", map[string]any{"targetId": "post_1", "watchMs": 3000}); res.Outcome != "ACCEPTED" {
		t.Fatalf("有同意时应当接受: %+v", res.Error)
	}

	withdraw := as(s, "viewer_a", "RecordPurposeConsent", map[string]any{
		"purpose": PurposeBehaviorAnalytics, "granted": false, "source": "TEST",
	})
	if withdraw.Outcome != "ACCEPTED" {
		t.Fatalf("撤回应当成功: %+v", withdraw.Error)
	}

	res := as(s, "viewer_a", "RecordPostImpression", map[string]any{"targetId": "post_2", "watchMs": 3000})
	if res.Outcome != "REJECTED" || res.Error.ErrorCode != "CONSENT_REQUIRED" {
		t.Fatalf("撤回之后必须立刻停止采集，实际 %s (%+v)", res.Outcome, res.Error)
	}

	// 撤回不删行：状态仍在，只是最新一次动作是 WITHDRAW。
	state := purposeConsentStateOf(t, s, "viewer_a")
	if state["found"] != true || state["active"] != false {
		t.Fatalf("撤回后的状态应为 found=true/active=false（撤回不删行），实际 %+v", state)
	}
	if state["action"] != ConsentActionWithdraw {
		t.Errorf("最新一次动作应当是 WITHDRAW，实际 %+v", state)
	}
	if _, ok := state["actedAt"]; !ok {
		t.Errorf("动作时间必须回放得出来（举证责任在平台），实际 state=%+v", state)
	}
}

// 「从未表过态」和「表过态又撤回」必须是两种可区分的结果。
//
// 本仓反复踩的那条线：没有数据 / 没有权限 / 没有这条记录 不能长成一个样子。
// 压成一个布尔，用户就永远分不清「我没开过」和「我开过又关了」。
func TestConsentStateDistinguishesNeverSetFromWithdrawn(t *testing.T) {
	s := New()

	never := purposeConsentStateOf(t, s, "user_new")
	if never["found"] != false || never["active"] != false {
		t.Fatalf("从未表过态应为 found=false/active=false，实际 %+v", never)
	}
	if _, ok := never["action"]; ok {
		t.Errorf("从未表过态不该有 action —— 那会让人以为他同意过，state=%+v", never)
	}
	if history, ok := never["consentHistory"].([]any); !ok || len(history) != 0 {
		t.Errorf("从未表过态的历史必须是空的，实际 %+v", never["consentHistory"])
	}

	grantBehaviorAnalytics(t, s, "user_seen")
	as(s, "user_seen", "RecordPurposeConsent", map[string]any{
		"purpose": PurposeBehaviorAnalytics, "granted": false, "source": "TEST",
	})

	withdrawn := purposeConsentStateOf(t, s, "user_seen")
	if withdrawn["found"] != true {
		t.Fatalf("表过态之后 found 必须是 true（否则和从未表过态分不开），实际 %+v", withdrawn)
	}
}

// 同意是**按人**的：A 同意了，不能让 B 也被采。
func TestConsentIsScopedToTheActor(t *testing.T) {
	s := New()
	grantBehaviorAnalytics(t, s, "viewer_ok")

	if res := as(s, "viewer_ok", "RecordPostImpression", map[string]any{"targetId": "p1", "watchMs": 1000}); res.Outcome != "ACCEPTED" {
		t.Fatalf("同意了的人应当能采: %+v", res.Error)
	}
	res := as(s, "viewer_other", "RecordPostImpression", map[string]any{"targetId": "p1", "watchMs": 1000})
	if res.Outcome != "REJECTED" || res.Error.ErrorCode != "CONSENT_REQUIRED" {
		t.Fatalf("别人的同意不能给这个人用，实际 %s (%+v)", res.Outcome, res.Error)
	}
}

// 同意按 (purpose, policy_version) 绑定：换一个版本 = 旧同意失效，必须重新同意。
//
// 这是「同意与所述目的绑定」的机制本身 —— 服务端改 PurposePolicyVersion 时，
// 用户看到的说明文案必须同步改，否则就是「用户同意的是一段他没见过的话」。
func TestConsentIsScopedToThePolicyVersion(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	grantBehaviorAnalytics(t, s, "viewer_v")

	// 当前版本有活跃同意。
	active, err := s.hasActivePurposeConsent(context.Background(), "viewer_v", PurposeBehaviorAnalytics)
	if err != nil || !active {
		t.Fatalf("当前版本应当有活跃同意: active=%v err=%v", active, err)
	}
	// 换一个版本号去问，就查不到 —— 也就是说改常量会让所有人重新同意。
	other, found, err := repo.PurposeConsentState(context.Background(), "viewer_v", PurposeBehaviorAnalytics, "1999-01-01")
	if err != nil {
		t.Fatalf("read other version: %v", err)
	}
	if found {
		t.Fatalf("旧版本号的同意不该被当成有效，实际 %+v", other)
	}
}

// 授予与撤回都要**留在表里**：举证责任在平台，
// 「他什么时候同意的、什么时候撤的」必须能回放。
//
// ⚠️ 这条测试原本断言的是 domain event（`s.repository.(*MemoryRepository).events`），
// 结果红了 —— 因为那个字段**全仓零写入**，本仓也没有可持久化的 event log
// （`Result.EventRefs` 只是一串 id，没人落库）。也就是说我当时在注释里写的
// 「审计交给事件流」是**假的**。改成断言这张表本身，它才是真证据。
func TestConsentActionsArePersistedAsAnAppendOnlyLog(t *testing.T) {
	s := New()
	ctx := context.Background()
	repo := s.repository.(*MemoryRepository)

	grantBehaviorAnalytics(t, s, "user_audit")
	as(s, "user_audit", "RecordPurposeConsent", map[string]any{
		"purpose": PurposeBehaviorAnalytics, "granted": false, "source": "TEST",
	})
	// 再授予一次：必须是**追加第三行**，不是把第二行改回去。
	grantBehaviorAnalytics(t, s, "user_audit")

	history, err := repo.PurposeConsentHistory(ctx, "user_audit", PurposeBehaviorAnalytics, PurposePolicyVersion)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history) != 3 {
		t.Fatalf("授予→撤回→再授予 应当是 3 条追加记录（append-only），实际 %d 条: %+v", len(history), history)
	}
	// 倒序：最新的在最前。
	want := []string{ConsentActionGrant, ConsentActionWithdraw, ConsentActionGrant}
	for i, action := range want {
		if history[i].Action != action {
			t.Errorf("history[%d].Action = %q, want %q", i, history[i].Action, action)
		}
	}
	// 最新一条是 GRANT ⇒ 当前有效。
	active, err := s.hasActivePurposeConsent(ctx, "user_audit", PurposeBehaviorAnalytics)
	if err != nil || !active {
		t.Fatalf("重新授予之后应当恢复采集: active=%v err=%v", active, err)
	}
	// 读侧也要能拿到这串历史（它是平台举证时唯一拿得出手的东西）。
	state := purposeConsentStateOf(t, s, "user_audit")
	acts, ok := state["consentHistory"].([]any)
	if !ok || len(acts) != 3 {
		t.Fatalf("读侧应当返回 3 条同意历史，实际 %+v", state["consentHistory"])
	}
}

// consentReadFailingRepository 让「读同意状态」永远失败。
// 用来证明第三种结果（查不出来）是 **fail-closed**，而不是 fail-open。
type consentReadFailingRepository struct {
	*MemoryRepository
}

func (r consentReadFailingRepository) PurposeConsentState(context.Context, string, string, string) (PurposeConsent, bool, error) {
	return PurposeConsent{}, false, errors.New("consent store unavailable")
}

// 同意存储读不出来 ⇒ 拒收。不能默认「有」（那就是没闸），
// 也不能悄悄默认「没有」然后让调用方以为那是用户的意愿。
func TestConsentStoreFailureIsFailClosed(t *testing.T) {
	s := NewWithRepository(consentReadFailingRepository{NewMemoryRepository()})

	for commandType := range behaviouralCommandToEventType {
		res := as(s, "viewer_f", commandType, map[string]any{"targetId": "t1", "watchMs": 1000})
		if res.Outcome != "REJECTED" {
			t.Errorf("%s：同意存储读不出来时被接受了 —— 这是 fail-open", commandType)
			continue
		}
		// 用**不同的**错误码：这不是「用户没同意」，是「我们查不出来」。
		// 两者的处置完全不同（前者要用户去授权，后者要运维去修存储）。
		if res.Error.ErrorCode != "CONSENT_STATE_UNAVAILABLE" {
			t.Errorf("%s 的错误码应为 CONSENT_STATE_UNAVAILABLE（区别于 CONSENT_REQUIRED），实际 %q",
				commandType, res.Error.ErrorCode)
		}
	}
}

// 写侧校验：purpose 必须显式给，不能默认成任何目的。
func TestConsentRequiresAnExplicitPurpose(t *testing.T) {
	s := New()
	res := as(s, "user_p", "RecordPurposeConsent", map[string]any{"granted": true})
	if res.Outcome != "REJECTED" || res.Error.ErrorCode != "INVALID_CONSENT" {
		t.Fatalf("缺 purpose 应当被拒，实际 %s (%+v)", res.Outcome, res.Error)
	}
}
