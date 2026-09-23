package twininsight

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TWIN-INSIGHT-002 的纯函数测试。
//
// 这些用例钉的是**判定口径**：同样的信号必须永远得到同样的分数/verdict，
// 且任何一条输出都不能是编出来的。评分和文案是本包最容易被"顺手调一下"
// 的地方（改个权重、加一句更动听的推断），所以钉死在这里。

func fixedTime() time.Time {
	return time.Date(2026, 9, 22, 9, 0, 0, 0, time.UTC)
}

// allowAllViewers 是测试里给使用权门禁的放行桩（TWIN-INSIGHT-ENTITLEMENT-001
// 之后 ListInsights 默认拒绝，没接这行就进不去）。门禁本身的拒绝路径
// 由下面的 TestListInsights*Entitlement* 专门钉，这里只放行。
func allowAllViewers(context.Context, string) error { return nil }

func TestScoreIsDeterministicAndBounded(t *testing.T) {
	// 全零 = 0 分，不是"没有分数"。
	if got := ScoreOf(Signals{}); got != 0 {
		t.Errorf("empty signals should score 0, got %d", got)
	}
	// 全部饱和 = 100 分（四项权重和 = 1）。
	full := Signals{Views7d: 999, Messages7d: 999, AvgStaySec: 9999, Likes7d: 999}
	if got := ScoreOf(full); got != 100 {
		t.Errorf("saturated signals should score 100, got %d", got)
	}
	// 同样的输入两次结果必须一致。
	mid := Signals{Views7d: 5, Messages7d: 12, AvgStaySec: 90, Likes7d: 2}
	first, second := ScoreOf(mid), ScoreOf(mid)
	if first != second {
		t.Errorf("score is not deterministic: %d then %d", first, second)
	}
	if first <= 0 || first >= 100 {
		t.Errorf("mid signals should be strictly between 0 and 100, got %d", first)
	}
}

func TestScoreWeightsConversationAboveImpressions(t *testing.T) {
	// 语义：主动发消息是最强信号，点赞最廉价。
	// 同样"饱和度"下，消息多的那个必须更高 —— 否则"看了很多但没聊过"
	// 会被判成比"聊了很多"更值得运营。
	messagesOnly := ScoreOf(Signals{Messages7d: 30})
	likesOnly := ScoreOf(Signals{Likes7d: 6})
	if messagesOnly <= likesOnly {
		t.Errorf("30 saturated messages (%d) must outrank 6 saturated likes (%d)", messagesOnly, likesOnly)
	}
	viewsOnly := ScoreOf(Signals{Views7d: 10})
	if messagesOnly <= viewsOnly {
		t.Errorf("30 saturated messages (%d) must outrank 10 saturated views (%d)", messagesOnly, viewsOnly)
	}
}

func TestVerdictFollowsThresholdsNotClientConstants(t *testing.T) {
	thresholds := Thresholds{OperateAt: 60, ObserveAt: 30, ConfigVersion: 3}
	now := fixedTime()
	// 老好友（不在宽限期里）且零信号 → 不是 new，是 skip。
	oldSince := now.Add(-30 * 24 * time.Hour)
	verdict, _ := VerdictOf(Signals{}, 0, oldSince, now, thresholds)
	if verdict != VerdictSkip {
		t.Errorf("zero-signal old friend should be skip, got %s", verdict)
	}
	// 刚加的好友零信号 → new（数据还没积累，判"暂不推荐"是误伤）。
	newSince := now.Add(-2 * 24 * time.Hour)
	if verdict, _ := VerdictOf(Signals{}, 0, newSince, now, thresholds); verdict != VerdictNew {
		t.Errorf("zero-signal new friend should be new, got %s", verdict)
	}
	// 阈值边界：>= operateAt → worth；>= observeAt → watch。
	if v, _ := VerdictOf(Signals{Views7d: 1}, 60, oldSince, now, thresholds); v != VerdictWorth {
		t.Errorf("score 60 with operateAt 60 should be worth, got %s", v)
	}
	if v, _ := VerdictOf(Signals{Views7d: 1}, 30, oldSince, now, thresholds); v != VerdictWatch {
		t.Errorf("score 30 with observeAt 30 should be watch, got %s", v)
	}
	if v, _ := VerdictOf(Signals{Views7d: 1}, 29, oldSince, now, thresholds); v != VerdictSkip {
		t.Errorf("score 29 should be skip, got %s", v)
	}
}

func TestSignalNeverContradictsVerdict(t *testing.T) {
	// 同一个分数不能既是 hot 又是"暂不推荐"。点颜色和 verdict 必须一致。
	thresholds := Thresholds{OperateAt: 60, ObserveAt: 30, ConfigVersion: 1}
	cases := []struct {
		verdict Verdict
		score   int
		want    Signal
	}{
		{VerdictWorth, 70, SignalHot},
		{VerdictWatch, 45, SignalWarm},
		{VerdictSkip, 10, SignalCold},
		{VerdictNew, 0, SignalNew},
	}
	for _, c := range cases {
		if got := SignalOf(c.verdict, c.score, thresholds); got != c.want {
			t.Errorf("SignalOf(%s, %d) = %s, want %s", c.verdict, c.score, got, c.want)
		}
	}
}

// TestAdviceNeverInventsMotives 钉住诚实性边界：advice 只能陈述可核对的
// 事实，不能写"他可能只是路过"这类心理推断。
//
// 这条用例是防回归的：一旦有人为了让建议"更像 AI"而加入推断性措辞，
// 它就是编数据 —— 跟原来那份 demo 的虚构好友同类。
func TestAdviceNeverInventsMotives(t *testing.T) {
	now := fixedTime()
	oldSince := now.Add(-30 * 24 * time.Hour)
	signals := []Signals{
		{},
		{Views7d: 12, Messages7d: 0},
		{Views7d: 3, Messages7d: 40, AvgStaySec: 300, Likes7d: 9},
		{Messages7d: 25},
	}
	// 原型里的主观措辞（一旦出现就说明又有人在编）。
	banned := []string{"可能", "也许", "大概是", "不像在找", "随手", "好奇", "有兴趣但"}
	for _, s := range signals {
		advices := AdvicesOf(s, oldSince, now)
		if len(advices) == 0 {
			t.Fatalf("AdvicesOf(%+v) returned nothing — the UI would show an empty card", s)
		}
		if len(advices) > 5 {
			t.Errorf("AdvicesOf(%+v) returned %d entries, contract caps at 5", s, len(advices))
		}
		for _, a := range advices {
			if strings.TrimSpace(a.Text) == "" {
				t.Errorf("empty advice text in %+v", s)
			}
			for _, word := range banned {
				if strings.Contains(a.Text, word) {
					t.Errorf("advice %q contains speculative wording %q — advice must state verifiable facts only", a.Text, word)
				}
			}
		}
	}
}

func TestAdviceFactsMatchSignals(t *testing.T) {
	// advice 里出现的数字必须等于真实信号值，不能是另一个量级。
	now := fixedTime()
	oldSince := now.Add(-30 * 24 * time.Hour)
	signals := Signals{Views7d: 7, Messages7d: 0}
	joined := strings.Join(adviceTexts(AdvicesOf(signals, oldSince, now)), " ")
	if !strings.Contains(joined, "7 次") {
		t.Errorf("advice should report the real view count 7, got %q", joined)
	}
	if strings.Contains(joined, "消息 0 条") {
		// 「没有对话记录」是对的；把"0 条消息"当成一个正面数字列出来才错。
		t.Logf("note: advice mentions 0 messages as %q", joined)
	}
}

func adviceTexts(advices []Advice) []string {
	out := make([]string, 0, len(advices))
	for _, a := range advices {
		out = append(out, a.Text)
	}
	return out
}

func TestEveryInsightSurvivesContractValidation(t *testing.T) {
	// 契约（packages/contracts/src/twin-insight.ts）里这些字段是 min 1：
	// targetId / displayName / initial / verdictLabel / summaryHint / summaryText。
	// 空串会让客户端 Zod 解析**整个 payload** 失败（fail-closed），
	// 一个名字缺失不该让整屏挂掉。这里逐个钉住兜底。
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{{ActorID: "friend_1", LastSignalAt: now.Add(-time.Hour), Views7d: 2}},
		Events:  []RecentEvent{{ActorID: "friend_1", Kind: EventProfileOpen, At: now.Add(-time.Hour)}},
	})
	friends := NewMemoryFriendSource()
	// 故意不给 DisplayName —— 名字解析失败的常见形态。
	friends.Set("owner_1", []Friend{{UserID: "friend_1", DisplayName: "", Since: now.Add(-48 * time.Hour)}})

	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 {
		t.Fatalf("expected 1 insight, got %d", len(payload.Insights))
	}
	insight := payload.Insights[0]
	if insight.TargetID == "" {
		t.Error("targetId must not be empty")
	}
	if insight.DisplayName == "" {
		t.Error("displayName must fall back to the account id, never empty")
	}
	if insight.DisplayName != "friend_1" {
		t.Errorf("displayName should fall back to the id, got %q", insight.DisplayName)
	}
	if len([]rune(insight.Initial)) < 1 || len([]rune(insight.Initial)) > 2 {
		t.Errorf("initial must be 1-2 runes, got %q", insight.Initial)
	}
	if insight.VerdictLabel == "" || insight.SummaryHint == "" || insight.SummaryText == "" {
		t.Errorf("empty required text field: verdictLabel=%q summaryHint=%q summaryText=%q",
			insight.VerdictLabel, insight.SummaryHint, insight.SummaryText)
	}
	if !strings.Contains(insight.SummaryText, "访问主页 2 次") {
		t.Errorf("summary should report the real view count, got %q", insight.SummaryText)
	}
}

func TestInitialIsRuneSafeForVietnamese(t *testing.T) {
	// 契约限制 initial 1..2 字符。按 byte 切中文/越南文会切出半个字。
	cases := map[string]int{
		"Nguyễn": 1,
		"陈先生":    1,
		"Ánh":    1,
		"A":      1,
	}
	for input, want := range cases {
		got := InitialOf(input)
		if n := len([]rune(got)); n != want {
			t.Errorf("InitialOf(%q) = %q (%d runes), want %d", input, got, n, want)
		}
		if strings.ContainsRune(got, utf8Replacement) {
			t.Errorf("InitialOf(%q) produced a broken rune: %q", input, got)
		}
	}
	if InitialOf("") != "?" {
		t.Errorf("empty name must still yield a non-empty initial, got %q", InitialOf(""))
	}
}

const utf8Replacement = '�'

func TestTimelineExcludesOwnActions(t *testing.T) {
	// 这一屏回答的是"他在做什么"。把 owner 自己的行为混进来会让
	// "最近互动"看起来比实际热 —— 那是把单向动作当成双向互动。
	now := fixedTime()
	events := []RecentEvent{
		{ActorID: "f1", Kind: EventMessage, ByOwner: false, At: now.Add(-time.Hour)},
		{ActorID: "f1", Kind: EventMessage, ByOwner: true, At: now.Add(-2 * time.Hour)},
		{ActorID: "f1", Kind: EventProfileOpen, ByOwner: false, At: now.Add(-3 * time.Hour)},
	}
	items := TimelineOf(events, now)
	if len(items) != 2 {
		t.Fatalf("expected 2 items (owner action dropped), got %d", len(items))
	}
	for _, item := range items {
		if item.Time == "" {
			t.Error("timeline time must never be empty (contract min 1)")
		}
	}
}

func TestTimelineCapsAtTenAndGreysOldItems(t *testing.T) {
	now := fixedTime()
	events := make([]RecentEvent, 0, 15)
	for i := 0; i < 15; i++ {
		events = append(events, RecentEvent{
			ActorID: "f1", Kind: EventProfileOpen,
			At: now.Add(-time.Duration(i) * 24 * time.Hour),
		})
	}
	items := TimelineOf(events, now)
	if len(items) != 10 {
		t.Errorf("timeline must cap at 10 (contract max), got %d", len(items))
	}
	if items[0].Gray {
		t.Error("a 0-day-old event must not be greyed")
	}
	if !items[len(items)-1].Gray {
		t.Error("an event older than 3 days must be greyed")
	}
}

func TestRelativeTimeNeverEmpty(t *testing.T) {
	now := fixedTime()
	for _, d := range []time.Duration{0, time.Minute, 3 * time.Hour, 30 * time.Hour, 10 * 24 * time.Hour} {
		if got := RelativeTime(now.Add(-d), now); got == "" {
			t.Errorf("RelativeTime(-%v) returned empty", d)
		}
	}
}

func TestFriendsWithNoFactsStillAppearWithZeros(t *testing.T) {
	// 关键行为：好友在列表里，但没有任何行为数据 → 出现且全是 0，
	// 不是"消失"，也不是"编一个数字"。
	now := fixedTime()
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "quiet_friend", DisplayName: "Mai", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 {
		t.Fatalf("friend with no facts must still be listed, got %d", len(payload.Insights))
	}
	got := payload.Insights[0]
	if got.Score != 0 || got.Signals.Views7d != 0 || got.Signals.Messages7d != 0 {
		t.Errorf("no facts must mean zeros, got score=%d signals=%+v", got.Score, got.Signals)
	}
	if got.Verdict != VerdictSkip {
		t.Errorf("a long-standing friend with zero signal should be skip, got %s", got.Verdict)
	}
	if payload.TotalTargets != 1 {
		t.Errorf("totalTargets should be 1, got %d", payload.TotalTargets)
	}
}

func TestListInsightsSortsByScoreThenRecency(t *testing.T) {
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "low", Messages7d: 3, LastSignalAt: now.Add(-time.Hour)},
			{ActorID: "high", Messages7d: 28, LastSignalAt: now.Add(-3 * time.Hour)},
			{ActorID: "tie_a", Messages7d: 10, LastSignalAt: now.Add(-5 * time.Hour)},
			{ActorID: "tie_b", Messages7d: 10, LastSignalAt: now.Add(-time.Minute)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "low", DisplayName: "Low", Since: now.Add(-90 * 24 * time.Hour)},
		{UserID: "high", DisplayName: "High", Since: now.Add(-90 * 24 * time.Hour)},
		{UserID: "tie_a", DisplayName: "TieA", Since: now.Add(-90 * 24 * time.Hour)},
		{UserID: "tie_b", DisplayName: "TieB", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	want := []string{"high", "tie_b", "tie_a", "low"}
	for i, id := range want {
		if payload.Insights[i].TargetID != id {
			t.Fatalf("order = %v, want %v", payload.Insights, want)
		}
	}
}

// TWIN-INSIGHT-TARGETS-001：目标集 = 好友 ∪ 有过互动的陌生人。
//
// 用户原话："是所有聊天、查看过主页的人，并不是说只有添加好友的人"。
// 之前 ListInsights 只迭代 friends，facts 里聊过天 / 看过主页的陌生 actor
// 被直接丢掉 —— 明明刚跟这个人说过话，洞察页却显示"还没有好友洞察"。
// 以下四条钉住：聊过天的陌生人出现、只看过主页的陌生人出现、
// 陌生人不重不漏（已是好友的不重复）、名字解析接上/没接上都不坏屏。
func TestNonFriendChatterAppearsInInsights(t *testing.T) {
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "chatter", Messages7d: 12, LastSignalAt: now.Add(-time.Hour)},
		},
		Events: []RecentEvent{
			{ActorID: "chatter", Kind: EventMessage, At: now.Add(-time.Hour)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "quiet_friend", DisplayName: "Mai", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 2 || payload.TotalTargets != 2 {
		t.Fatalf("chatter must be listed alongside the friend, got %d insights", len(payload.Insights))
	}
	byID := map[string]Insight{}
	for _, in := range payload.Insights {
		byID[in.TargetID] = in
	}
	got, ok := byID["chatter"]
	if !ok {
		t.Fatalf("non-friend chatter is missing from insights: %v", payload.Insights)
	}
	if got.Signals.Messages7d != 12 {
		t.Errorf("chatter messages = %d, want 12", got.Signals.Messages7d)
	}
	if got.Score <= 0 {
		t.Errorf("12 messages must score above 0, got %d", got.Score)
	}
	if len(got.Timeline) != 1 || got.Timeline[0].Text != "发了一条消息" {
		t.Errorf("chatter timeline = %+v, want one sent-message item", got.Timeline)
	}
}

func TestNonFriendViewerAppearsInInsights(t *testing.T) {
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "viewer", Views7d: 5, LastSignalAt: now.Add(-2 * time.Hour)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 || payload.Insights[0].TargetID != "viewer" {
		t.Fatalf("profile viewer without friendship must be listed, got %v", payload.Insights)
	}
	if payload.Insights[0].Signals.Views7d != 5 {
		t.Errorf("viewer views = %d, want 5", payload.Insights[0].Signals.Views7d)
	}
}

func TestStrangerAppearingAsFriendAndActorIsListedOnce(t *testing.T) {
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "both", Messages7d: 4, LastSignalAt: now.Add(-time.Hour)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "both", DisplayName: "Both", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetViewerGate(allowAllViewers)
	svc.SetClock(fixedTime)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 {
		t.Fatalf("friend who also chatted must appear exactly once, got %d", len(payload.Insights))
	}
	if payload.Insights[0].DisplayName != "Both" {
		t.Errorf("friend identity must win over stranger fallback, got %q", payload.Insights[0].DisplayName)
	}
}

func TestStrangerDisplayNameResolvesOrFallsBackToID(t *testing.T) {
	now := fixedTime()
	seed := Facts{
		Signals: []SignalFact{
			{ActorID: "stranger", Messages7d: 6, LastSignalAt: now.Add(-time.Hour)},
		},
	}
	newSvc := func() (*Service, *MemoryFriendSource) {
		repo := NewMemoryRepository()
		repo.Seed("owner_1", seed)
		friends := NewMemoryFriendSource()
		friends.Set("owner_1", []Friend{})
		svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
		svc.SetViewerGate(allowAllViewers)
		svc.SetClock(fixedTime)
		return svc, friends
	}
	// 没接名字源：回落成账号 id，不断屏（契约 displayName min 1）。
	svc, _ := newSvc()
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 || payload.Insights[0].DisplayName != "stranger" {
		t.Fatalf("without name source DisplayName must fall back to id, got %v", payload.Insights)
	}
	// 接上名字源：显示真名。
	svc, _ = newSvc()
	svc.SetDisplayNameSource(func(context.Context, string) (string, bool) { return "Linh", true })
	payload, err = svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 || payload.Insights[0].DisplayName != "Linh" {
		t.Fatalf("with name source DisplayName must resolve, got %v", payload.Insights)
	}
	// 名字源解析失败：同样回落 id，不坏屏。
	svc, _ = newSvc()
	svc.SetDisplayNameSource(func(context.Context, string) (string, bool) { return "", false })
	payload, err = svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	if len(payload.Insights) != 1 || payload.Insights[0].DisplayName != "stranger" {
		t.Fatalf("failed resolution must fall back to id, got %v", payload.Insights)
	}
}

// TWIN-INSIGHT-ENTITLEMENT-001：洞察工具只向后端发放了使用权的账号开放。
//
// 这是撮合小美/小帅、卖小美合法时间的精准投流工具，不是人人可见的公开页。
// 发放凭证 = 实名核验 VERIFIED 行（operator 写行即发放，见 main.go 接线）。
// 三条：没接门禁拒绝、明确拒绝、放行才给数。顺序在最前 —— 没使用权的账号
// 连"参数对不对"的信息都不该拿到。
func TestListInsightsDeniedWithoutViewerGate(t *testing.T) {
	repo := NewMemoryRepository()
	friends := NewMemoryFriendSource()
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetClock(fixedTime)
	// 故意不 SetViewerGate。
	if _, err := svc.ListInsights(context.Background(), "twin_1", "owner_1"); err != ErrInsightViewerForbidden {
		t.Fatalf("ListInsights without viewer gate must refuse with ErrInsightViewerForbidden, got %v", err)
	}
}

func TestListInsightsDeniedWhenViewerGateRefuses(t *testing.T) {
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "chatter", Messages7d: 12, LastSignalAt: now.Add(-time.Hour)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "chatter", DisplayName: "Chatter", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetClock(fixedTime)
	svc.SetViewerGate(func(context.Context, string) error { return ErrInsightViewerForbidden })
	if _, err := svc.ListInsights(context.Background(), "twin_1", "owner_1"); err != ErrInsightViewerForbidden {
		t.Fatalf("refused viewer must get ErrInsightViewerForbidden even with friends and facts, got %v", err)
	}
}

func TestOwnerNeverAppearsAsOwnTarget(t *testing.T) {
	// 真机实测：owner 自己进了目标集（两人会话里自己既是 owner 又是 peer 的
	// 历史脏数据）。投流工具给自己画像是噪音，必须滤掉。
	now := fixedTime()
	repo := NewMemoryRepository()
	repo.Seed("owner_1", Facts{
		Signals: []SignalFact{
			{ActorID: "owner_1", Messages7d: 9, LastSignalAt: now.Add(-time.Hour)},
			{ActorID: "chatter", Messages7d: 5, LastSignalAt: now.Add(-2 * time.Hour)},
		},
	})
	friends := NewMemoryFriendSource()
	friends.Set("owner_1", []Friend{
		{UserID: "owner_1", DisplayName: "Me", Since: now.Add(-90 * 24 * time.Hour)},
		{UserID: "chatter", DisplayName: "Chatter", Since: now.Add(-90 * 24 * time.Hour)},
	})
	svc := New(repo, friends, func(context.Context) (Thresholds, error) { return DefaultThresholds(), nil })
	svc.SetClock(fixedTime)
	svc.SetViewerGate(allowAllViewers)
	payload, err := svc.ListInsights(context.Background(), "twin_1", "owner_1")
	if err != nil {
		t.Fatalf("ListInsights: %v", err)
	}
	for _, in := range payload.Insights {
		if in.TargetID == "owner_1" {
			t.Fatalf("owner must never be its own insight target, got %v", payload.Insights)
		}
	}
	if len(payload.Insights) != 1 || payload.Insights[0].TargetID != "chatter" {
		t.Fatalf("only the real chatter should remain, got %v", payload.Insights)
	}
}
