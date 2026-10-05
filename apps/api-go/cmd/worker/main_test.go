package main

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/notification"
)

func testEvent(eventType, principalID, aggregateID string, payload map[string]any) event.DomainEvent {
	return event.DomainEvent{
		EventID:     "evt-test-1",
		EventType:   eventType,
		AggregateID: aggregateID,
		PrincipalID: principalID,
		Payload:     payload,
	}
}

// NOTIF-INVITE-OFFER-001: offer 必须投给 5 分钟内要行动的 agent，
// 而不是发起 offer 的 requester（以前收件人写反了，等于把信送给发信人）。
func TestInboxForEventRoutesOfferToAgent(t *testing.T) {
	recipient, title, _, deepLink, ok := inboxForEvent(testEvent(
		"SlotOfferCreated", "requester-u1", "off_1",
		map[string]any{"agentId": "agent-xiaomei"},
	))
	if !ok {
		t.Fatal("SlotOfferCreated must produce an inbox item")
	}
	if recipient != "agent-xiaomei" {
		t.Fatalf("offer routed to %q, want the acting agent", recipient)
	}
	if title == "" || deepLink == "" {
		t.Fatal("offer inbox needs a title and a deep link")
	}
}

func TestInboxForEventFallsBackWhenAgentMissing(t *testing.T) {
	recipient, _, _, _, ok := inboxForEvent(testEvent(
		"SlotOfferCreated", "requester-u1", "off_1", nil,
	))
	if !ok || recipient != "requester-u1" {
		t.Fatalf("missing agentId must fall back to principal, got %q ok=%v", recipient, ok)
	}
}

func TestInboxForEventRoutesInvitations(t *testing.T) {
	recipient, _, _, _, ok := inboxForEvent(testEvent(
		"InvitationCreated", "host-u1", "inv_1",
		map[string]any{"inviteeId": "invitee-u2"},
	))
	if !ok || recipient != "invitee-u2" {
		t.Fatalf("invitation must reach the invitee, got %q ok=%v", recipient, ok)
	}
	recipient, _, body, _, ok := inboxForEvent(testEvent(
		"InvitationResponded", "invitee-u2", "inv_1",
		map[string]any{"decision": "ACCEPTED", "hostId": "host-u1"},
	))
	if !ok || recipient != "host-u1" {
		t.Fatalf("response must reach the inviter, got %q ok=%v", recipient, ok)
	}
	if body == "" {
		t.Fatal("response inbox needs a body")
	}
}

func TestInboxForEventSkipsUnknown(t *testing.T) {
	if _, _, _, _, ok := inboxForEvent(testEvent("SomethingElse", "u1", "x_1", nil)); ok {
		t.Fatal("unknown events must stay silent")
	}
	if _, _, _, _, ok := inboxForEvent(testEvent("TaskSlotsCreated", "u1", "x_1", nil)); ok {
		t.Fatal("noisy events must stay skipped")
	}
}

// NOTIF-PIPELINE-001：worker 必须**经过统一管线**写通知，不再自己写 SQL。
//
// 上面那四条钉的是「映射对不对」（收件人是谁）。这一条钉的是**接线**：
// 映射对了但没接到管线上，用户依然收不到推送 —— 而那种回归在
// inboxForEvent 的单测里是完全看不见的（函数本身仍然全绿）。
//
// 之所以能用假 Producer 测：businessInboxDelivery 依赖的是
// notification.Producer 接口而不是具体的 *Pipeline（也不再依赖 *pgxpool.Pool）。
type recordingProducer struct {
	got []notification.Notification
}

func (p *recordingProducer) Emit(_ context.Context, n notification.Notification) (notification.InboxItem, bool, error) {
	p.got = append(p.got, n)
	return notification.InboxItem{ID: "inbox_test"}, true, nil
}

func TestWorkerDeliveryGoesThroughPipeline(t *testing.T) {
	rec := &recordingProducer{}
	d := businessInboxDelivery{inner: logDelivery{}, producer: rec}

	e := testEvent("OfferCreated", "requester-u1", "off_1", map[string]any{"agentId": "agent-xiaomei"})
	e.EventID = "evt_route_1"
	if err := d.createInboxForEvent(context.Background(), e); err != nil {
		t.Fatalf("createInboxForEvent: %v", err)
	}
	if len(rec.got) != 1 {
		t.Fatalf("the worker must emit exactly one notification, got %d", len(rec.got))
	}
	got := rec.got[0]
	if got.RecipientID != "agent-xiaomei" {
		t.Fatalf("recipient must come from inboxForEvent, got %q", got.RecipientID)
	}
	if got.Type != "OfferCreated" {
		t.Fatalf("type must be the event type, got %q", got.Type)
	}
	// 幂等键必须是 event:<EventID> —— outbox 会重放整批，键错了重放就变成
	// 用户 inbox 里的第二条「收到 Offer」。
	if want := notification.EventDedupeKey("evt_route_1"); got.DedupeKey != want {
		t.Fatalf("dedupe key = %q, want %q", got.DedupeKey, want)
	}
}

// 未知事件（inboxForEvent 返回 ok=false）必须**一次 Emit 都不发** ——
// 空收件人会被管线拒掉，但那是拒收而不是跳过，日志里会多一行噪音。
func TestWorkerDeliverySkipsUnknownEvents(t *testing.T) {
	rec := &recordingProducer{}
	d := businessInboxDelivery{inner: logDelivery{}, producer: rec}
	if err := d.createInboxForEvent(context.Background(), testEvent("SomethingElse", "u1", "x_1", nil)); err != nil {
		t.Fatalf("unknown events must be a silent no-op, got %v", err)
	}
	if len(rec.got) != 0 {
		t.Fatalf("unknown events must not reach the pipeline, got %d", len(rec.got))
	}
}

// 没配管线（本地裸跑、无 DATABASE_URL）不能 panic —— worker 是 best-effort。
func TestWorkerDeliveryWithoutPipelineIsSafe(t *testing.T) {
	d := businessInboxDelivery{inner: logDelivery{}}
	if err := d.createInboxForEvent(context.Background(), testEvent("OfferCreated", "u1", "off_1", nil)); err != nil {
		t.Fatalf("a nil producer must be a no-op, got %v", err)
	}
}

// NOTIF-EVENT-PRODUCER-001（2026-10-02）：inboxForEvent 里**每一个**事件名都必须
// 真的有人发。
//
// 2026-10-02 扫出来的实况：`OrderCreated` / `VoucherRedeemed` / `VoucherSettled`
// 三个分支在**非测试代码**里一个 `event.New(` 都没有 —— 也就是说「订单已成立」
// 和「凭证动态」这两类通知从来没发出去过。而那时 switch 本身看起来完全正常、
// 上面那四条单测也全绿 —— 因为它们测的是「映射对不对」，不是「事件存不存在」。
//
// 这类洞只有把**映射表**和**事件生产者**对起来才看得见，所以这里直接扫源码：
// 从 main.go 抽出 inboxForEvent 的 case 标签，再去全仓找 `event.New("X"`。
//
// 反向：加分支前先跑这一条。名字写错（比如把 OrderCreatedFromOffer 写成
// OrderCreated）会在这里红，而不是等用户问「为什么我从来没收到过订单通知」。
func TestInboxForEventOnlyMapsEventTypesThatAreActuallyEmitted(t *testing.T) {
	mapped := inboxForEventCaseLabels(t)
	if len(mapped) == 0 {
		t.Fatal("extracted 0 event types from inboxForEvent — the extractor is broken, not the mapping")
	}
	emitted := emittedEventTypes(t)
	if len(emitted) == 0 {
		t.Fatal("found 0 event.New( calls in apps/api-go — the scanner is broken")
	}
	for _, name := range mapped {
		if !emitted[name] {
			t.Errorf(
				"inboxForEvent maps %q, but no non-test code in apps/api-go emits it "+
					"(no event.New(%q) anywhere) — this notification can never fire",
				name, name,
			)
		}
	}
}

// inboxForEventCaseLabels 从 main.go 里抽出 inboxForEvent 的 case 标签。
// 不写一份硬编码清单：那份清单会跟 switch 漂移，漂移了还全绿。
func inboxForEventCaseLabels(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	start := strings.Index(string(src), "func inboxForEvent(")
	if start < 0 {
		t.Fatal("inboxForEvent not found in main.go")
	}
	body := string(src)[start:]
	// 只取 switch 部分：default 之后是收尾，也可能有别的东西。
	if end := strings.Index(body, "\ndefault:"); end >= 0 {
		body = body[:end]
	}
	caseRe := regexp.MustCompile(`case((?:\s*"[A-Za-z]+"\s*,?)+):`)
	nameRe := regexp.MustCompile(`"([A-Za-z]+)"`)
	var out []string
	for _, c := range caseRe.FindAllStringSubmatch(body, -1) {
		for _, n := range nameRe.FindAllStringSubmatch(c[1], -1) {
			out = append(out, n[1])
		}
	}
	return out
}

// emittedEventTypes 扫 apps/api-go 下**非测试**文件里所有 event.New("X" 的名字。
// 排掉 _test.go：测试里自己造一个事件，会让一个永不发生的分支看起来有人发。
func emittedEventTypes(t *testing.T) map[string]bool {
	t.Helper()
	root := filepath.Join("..", "..")
	re := regexp.MustCompile(`event\.New\(\s*"([A-Za-z]+)"`)
	out := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		for _, line := range strings.Split(string(b), "\n") {
			// 只认代码行：注释里的 event.New("X")（比如门禁自己的说明文字）
			// 会被扫成一个叫 "X" 的事件，然后逼着人把它加进 no-notify 清单 ——
			// 那是在给一个不存在的事件编理由，比扫错更坏。
			if strings.HasPrefix(strings.TrimSpace(line), "//") {
				continue
			}
			for _, m := range re.FindAllStringSubmatch(line, -1) {
				out[m[1]] = true
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk apps/api-go: %v", err)
	}
	return out
}

// 深链必须指向**事件自己的聚合**。以前 `OfferAccepted` 和 `OrderCreated` 共用
// `/orders/` + AggregateID，而 OfferAccepted 的 Aggregate 是 offer ⇒ 发出去的是
// `/orders/off_…`：offer id 挂在 orders 前缀下，跳过去没有这个资源。
// 现在订单通知只由 OrderCreatedFromOffer（Aggregate 是 order）出。
func TestInboxForEventPointsTheOrderLinkAtTheOrder(t *testing.T) {
	_, title, _, deepLink, ok := inboxForEvent(testEvent("OrderCreatedFromOffer", "agent-1", "ord_9", nil))
	if !ok {
		t.Fatal("OrderCreatedFromOffer must produce an inbox item — it is the only real order-created event")
	}
	if deepLink != "/orders/ord_9" {
		t.Fatalf("order deep link = %q, want /orders/ord_9", deepLink)
	}
	if title == "" {
		t.Fatal("order inbox needs a title")
	}
	// 反向臂：OfferAccepted 的 Aggregate 是 offer，不能再单独出一条 ——
	// 它和 OrderCreatedFromOffer 在同一批里，留着就是同一件事收两条，
	// 而且拿 offer id 拼 /orders/ 是错链。
	if _, _, _, _, ok := inboxForEvent(testEvent("OfferAccepted", "agent-1", "off_9", nil)); ok {
		t.Fatal("OfferAccepted must not produce its own inbox row (its aggregate is the offer, so /orders/off_… would be a wrong link)")
	}
}

type failingProducer struct{ err error }

func (p *failingProducer) Emit(_ context.Context, n notification.Notification) (notification.InboxItem, bool, error) {
	return notification.InboxItem{}, false, p.err
}

// MERCHANT-CREATOR-NOTIFY-001：通知投递失败**不让**这一批 outbox 失败。
//
// 这个取舍是对的：让一条标题写错的通知把「需求已发布」拖进 DEAD_LETTER，
// 是用业务事件的可投递性去换一个本该被挡住的错误。
// 但**不失败 ≠ 不留痕** —— 改之前这里是 `_ = d.createInboxForEvent(ctx, e)`，
// 失败连日志都没有、事件照样 MarkSent ⇒ 通知永久丢失且无痕迹。
func TestWorkerDeliveryKeepsBatchAliveButCountsMissedNotifications(t *testing.T) {
	boom := errors.New("insert inbox: duplicate key value violates unique constraint")
	d := newBusinessInboxDelivery(logDelivery{}, &failingProducer{err: boom})

	e := testEvent("OfferCreated", "requester-u1", "off_1", map[string]any{"agentId": "agent-xiaomei"})
	e.EventID = "evt_missed_1"
	if err := d.Deliver(context.Background(), e); err != nil {
		t.Fatalf("notification failure must not fail the outbox batch, got %v", err)
	}
	if got := d.missedTotal(); got != 1 {
		t.Fatalf("missed notifications must be counted, got %d", got)
	}
	// 心跳计数：第一次报 1，之后没有新失败就不该再报（否则每 tick 刷一行噪音）。
	if got := d.reportMissedNotifications(); got != 1 {
		t.Fatalf("first report must be the delta since last report, got %d", got)
	}
	if got := d.reportMissedNotifications(); got != 0 {
		t.Fatalf("report must not repeat without new failures, got %d", got)
	}
	_ = d.Deliver(context.Background(), e)
	if got := d.reportMissedNotifications(); got != 1 {
		t.Fatalf("a new failure must show up in the next report, got %d", got)
	}
	if got := d.missedTotal(); got != 2 {
		t.Fatalf("cumulative count must keep growing, got %d", got)
	}
}

// 没配计数器的实例（老构造路径）不能 panic —— worker 是 best-effort 的进程。
func TestWorkerDeliveryWithoutMissCountersIsSafe(t *testing.T) {
	d := businessInboxDelivery{inner: logDelivery{}, producer: &failingProducer{err: errors.New("boom")}}
	if err := d.Deliver(context.Background(), testEvent("OfferCreated", "u1", "off_1", map[string]any{"agentId": "agent-x"})); err != nil {
		t.Fatalf("delivery must still succeed, got %v", err)
	}
	if got := d.reportMissedNotifications(); got != 0 || d.missedTotal() != 0 {
		t.Fatalf("nil counters must degrade to zero, got report=%d total=%d", got, d.missedTotal())
	}
}

// MERCHANT-CREATOR-NOTIFY-001：**反向**门禁 —— 有人发的事件必须都被映射，
// 或者被**显式**声明成「不发通知」。
//
// 正向门禁（上面那条）只能抓「映射了但没人发」。这次漏掉的是反过来的方向：
// supply 域发的 CollabInvitationCreated / CollabInvitationResponded /
// MerchantCreatorPromo* / Promo* 全都**没人映射**，而正向门禁对此一句话都
// 不会说 —— 它只看 switch 里有的名字。于是商家发活单、creator 收不到任何东西，
// 而所有测试全绿。
//
// 为什么这里不能简单要求「全仓每个事件都得映射」：仓库有 150+ 种事件，其中
// 大半是内部投影（MediaAssetReady、MaterialRouteChangeRecorded）、安全/隐私
// 事件（LegalHoldCreated、SafetyBlockCreated）、以及高频噪音（ConversationStarted）。
// 强行全映射不是「更严谨」，是把门禁变成可以随手 disable 的形式。
//
// 所以规则是：**新事件必须是一个显式决定**。要么映射成通知，要么带着理由写进
// eventsWithoutNotification。漏 = 门禁红。新增事件类型时你被迫想清楚
// 「这个人需不需要知道」，而不是默认安静跳过。
func TestEveryPublishedEventIsMappedOrExplicitlyNotNotified(t *testing.T) {
	mapped := map[string]bool{}
	for _, name := range inboxForEventCaseLabels(t) {
		mapped[name] = true
	}
	emitted := emittedEventTypes(t)
	// 两份清单都要：条目必须真有人发、必须写理由、不能已经被映射。
	for _, list := range []struct {
		name string
		m    map[string]string
	}{{"eventsWithoutNotification", eventsWithoutNotification}, {"eventsPendingNotificationDecision", eventsPendingNotificationDecision}} {
		for name, reason := range list.m {
			if !emitted[name] {
				t.Errorf("%s 里的 %q 已经没人发了（该事件已删除或改名），把它删掉", list.name, name)
			}
			if mapped[name] {
				t.Errorf("%q 既在 %s 里、又被 inboxForEvent 映射了 —— 清单该更新了", name, list.name)
			}
			if strings.TrimSpace(reason) == "" {
				t.Errorf("%q 在 %s 里但没有写理由 —— 空理由等于把这个决定推迟给下一个人", name, list.name)
			}
		}
	}
	for name := range emitted {
		if mapped[name] {
			continue
		}
		if _, declared := eventsWithoutNotification[name]; declared {
			continue
		}
		if _, owed := eventsPendingNotificationDecision[name]; owed {
			continue
		}
		t.Errorf(
			"事件 %q 有人发，但 inboxForEvent 没映射它、eventsWithoutNotification 也没声明「不发通知」\n"+
				"       ⇒ 它落进 default 被安静跳过。两种修法：\n"+
				"         1. 在 inboxForEvent 里加 case（收件人从 payload.notifyPrincipalId 取，别回退 PrincipalID）；\n"+
				"         2. 确实不需要用户知道 → 加进 eventsWithoutNotification，并在注释里写清为什么。\n"+
				"       选 2 之前先确认一遍：这个人是不是真的不需要知道？",
			name,
		)
	}
}

// eventsWithoutNotification 是「已决定不发通知」的事件清单，**每条都要有理由**。
//
// 归三类：
//
//	· 内部投影/技术事件：没有「谁该收到」这个概念（媒体处理、撮合批次、聚合 upsert）；
//	· 隐私/安全事件：正确出口是审计与执法面，不是用户收件箱
//	  （LegalHold、SafetyBlock、ScreenshotDetected…）—— 把司法/风控事件塞进
//	  收件箱等于给平台盖章一个可被伪造的通知渠道；
//	· 内部故障：PersistFailed 这类必须是日志/监控告警，推给用户既没信息量，
//	  又把一次内部重试失败变成用户眼里的「平台坏了」。
//
// 有一条特别值得单说：InboxItemCreated / InboxItemRead 是**通知系统自己**的事件。
// 给它们配映射会造成通知自增殖（写一条通知 → 产生一个事件 → 再写一条通知 →…），
// 所以「不映射」在这里不是省事，是防环。
var eventsWithoutNotification = map[string]string{
	// ── 通知系统自身：映射会造成自增殖 ────────────────────────────────────
	"InboxItemCreated": "通知系统自己的事件：映射它会让通知自增殖（写通知→产生事件→再写通知）",
	"InboxItemRead":    "已读回执不该再变成一条待读通知",

	// ── 用户改自己的东西：界面里立刻可见，收件箱没有新增信息 ──────────────
	"AgentProfileCreated":       "creator 改自己的资料，资料页立刻可见",
	"AgentProfileUpdated":       "同上",
	"AgentServiceCreated":       "creator 改自己的服务项，服务页立刻可见",
	"AgentServiceUpdated":       "同上",
	"CapabilityDeclared":        "自己声明能力，能力页立刻可见",
	"AvailabilityWindowSet":     "自己设档期，档期页立刻可见",
	"AvailabilityWindowBlocked": "自己挡档期，同上",
	"ProfileUpdated":            "自己改资料，资料页立刻可见",

	// ── 商户/商家后台：正确出口是后台，不是每个人的收件箱 ─────────────────
	"BusinessAccountCreated": "开户：正确出口是商户后台，不是收件箱",
	"BusinessMemberAdded":    "成员变更：正确出口是商户后台的成员管理",
	"BusinessStoreCreated":   "建店：正确出口是商户后台",
	"BusinessStoreUpdated":   "改店资料：同上，且一次可能改几十个字段",

	// ── 撮合/内容/场景的内部投影 ──────────────────────────────────────────
	"CandidateBatchCreated":      "撮合批次是内部投影，用户看到的是最终结果",
	"SceneCreated":               "场景是运营内容，不是要通知谁的事件",
	"SceneUpdated":               "同上",
	"ScenePublished":             "同上",
	"SceneCommerceVisitRecorded": "访问计数是内部统计",
	"OutcomeRecorded":            "结果记录是内部统计",
	"OutcomeObservationRecorded": "同上",
	"OutcomeComparisonCreated":   "结果对比是内部统计",
	"OutcomeLearningConfirmed":   "学习确认是内部流程",
	"OutcomeLearningDismissed":   "学习忽略是内部流程",
	"ContributionValueCreated":   "贡献体系的值创建是内部流程",
	"ContributionActivated":      "同上",
	"ContributionSubmitted":      "贡献提交有专门的提交流程反馈",
	"ContributionReviewed":       "贡献审核结果有审核页",
	"ContributionRewardGranted":  "贡献奖励：金额类变化要走账务通知（见 pending 里的 PaymentIntentSucceeded 说明），不是这个无模板通道",
	"MediaAssetReviewed":         "审核结果有专门界面",
	"MediaReviewDecisionAmended": "审核决定修订是审计动作",

	// ── 内部故障：必须是日志/监控，推给用户是错的 ─────────────────────────
	"MediaReviewDecisionPersistFailed":      "内部持久化失败：这是运维告警，推给用户既没信息量又像平台坏了",
	"MediaReviewDecisionAmendPersistFailed": "同上",

	// ── 登录/设备：正确出口是设备管理与安全页 ─────────────────────────────
	"SessionCreated":           "登录流程内部事件",
	"GoogleSessionCreated":     "同上",
	"LoginChallengeRequested":  "登录挑战请求：正确出口是登录页本身",
	"LoginChallengeVerified":   "同上",
	"LoginChallengeConsumed":   "同上",
	"LoginChallengeSuperseded": "同上",
	"SessionPrincipalSwitched": "主体切换是安全状态，不该在收件箱播报",
	"DeviceRegistered":         "设备注册：正确出口是设备管理页",
	"DeviceTokenRegistered":    "推送令牌注册：正确出口是通知设置页",
	"ExactLocationGranted":     "精确位置授权由系统权限弹窗呈现，收件箱是错的位置",

	// ── 高频互动：逐条通知等于轰炸 ───────────────────────────────────────
	"PostCreated":         "发帖由用户自己发起，界面立刻可见",
	"PostReplied":         "回复互动在量级上来后是噪音（应由设置里的开关决定，而设置本身还没有）",
	"PostReposted":        "同上",
	"PostBookmarked":      "收藏是用户自己的动作",
	"PostPinned":          "置顶是作者自己的动作",
	"PostUnpinned":        "同上",
	"PostPollVoted":       "投票是用户自己的动作",
	"PostAudienceUpdated": "受众设置由作者自己操作",
	"AIReplySent":         "AI 回复是内容里的东西，不是独立通知事件",
	"AuthorMuted":         "静音是用户自己点的",
	"AuthorUnmuted":       "同上",

	// ── 每日聚合 upsert ──────────────────────────────────────────────────
	"SpendDailyUpserted": "每日聚合 upsert，纯内部写入，频率高且无人可通知",

	// ── 内部投影：媒体/上下文/草稿/聚合 ───────────────────────────────────
	"AnonymousSessionCreated":     "匿名会话创建是内部投影，用户不需要被告知自己被建了个匿名会话",
	"AttributionRecorded":         "归因记录是内部数据，用户看到的是结果不是归因",
	"DisplayIdentityCreated":      "显示身份的创建是系统内部步骤",
	"DisplayIdentityBurned":       "显示身份的销毁是内部生命周期事件",
	"LocalContextSet":             "本地上下文由用户自己设置",
	"NeedDraftCreated":            "需求草稿是用户自己刚建的，不需要通知自己",
	"TaskDraftCreated":            "同上",
	"TaskDraftUpdated":            "同上",
	"ObservationSetCreated":       "观察集创建是内部数据准备",
	"ObservationSetFinalized":     "观察集收尾是内部状态机推进",
	"ObservationTemplateCreated":  "观察模板是配置，不是事件",
	"MemberDirectoryUpdated":      "成员目录变更是商家后台的数据维护，不需要推给每个成员",
	"MaterialOrderChangeProposed": "内部流程提案，还没有用户该做的动作",
	"MaterialRouteChangeRecorded": "内部路由记录",

	// ── 隐私/安全：正确出口是执法面，不是用户收件箱 ──────────────────────
	// 把司法/风控事件塞进收件箱，等于给平台盖一个可被伪造的章：用户在收件箱里
	// 看到「你的账号已被风控处置」时，没有任何办法分辨那是系统通知还是攻击者
	// 用别处泄漏的凭据塞进来的。
	"LegalHoldCreated":            "法务保全：正确出口是执法/审计面",
	"LegalHoldReleased":           "法务保全解除，同上",
	"SafetyBlockCreated":          "风控处置：正确出口是执法面",
	"ScreenshotDetected":          "风控检测：正确出口是执法面",
	"SecurityAlert":               "安全告警：发给用户等于把攻击面细节交给客户端",
	"JITGrantCreated":             "临时提权是审计记录，通知它等于向攻击者播报攻击进度",
	"OperatorCaseCreated":         "运营工单是内部流程",
	"IncidentCreated":             "事件工单是内部流程",
	"ConsentRecorded":             "同意记录是合规账本，双向通知都不改事实",
	"TrustedDeviceSessionCreated": "设备信任是安全状态，用户不需要被打扰",
	"SessionRevoked":              "会话撤销有独立的设备管理界面，收件箱不是它的出口",

	// ── 媒体内部状态机 ──────────────────────────────────────────────────
	"MediaAssetCreated":    "媒体创建是上传流程的内部步骤，不是要通知谁的成果",
	"MediaUploadCompleted": "上传完成由上传方自己在界面上看到",
	"MediaAssetReady":      "转码就绪是内部状态机推进",

	// ── 商家后台的数据维护 ───────────────────────────────────────────────
	"StoreLinesUpdated":               "商品行批量更新不该逐条通知商家（一次几百行）",
	"StoreProductCreated":             "商家自己建品，自己看得到",
	"StoreProductUpdated":             "同上，且一次可能改几十个字段",
	"StoreProductHotChanged":          "热度变化是排序信号，不是要告诉用户的事件",
	"StoreProductAvailabilityChanged": "库存变化由前台列表实时反映",
	"StorePhotoAdded":                 "商家自己传图，自己看得到",
	"StorePhotoDeleted":               "商家自己删图，自己看得到",

	// ── 认证结果：出口是认证页/状态更新 ──────────────────────────────────
	"CapabilityVerified":     "能力认证结果是审核动作，出口是认证页，不是收件箱",
	"SellerRealNameAttested": "实名认证结果在认证流程页已有展示",

	// ── 私信/关注：高频互动 ─────────────────────────────────────────────
	"MessageSent":         "每条私信都通知等于把收件箱变成聊天记录",
	"MessageRead":         "已读回执逐条通知是骚扰",
	"MessageForwarded":    "转发是高频动作",
	"ConversationStarted": "开始会话由会话列表自己呈现",
	"ConvoCreated":        "同上",
	"PostReacted":         "点赞逐条通知等于轰炸",
	"ProfileFollowed":     "关注通知在量级上来后就是噪音（应由设置里的开关决定，而设置本身还没有）",
	"ProfileUnfollowed":   "取消关注后用户没有可做的动作",
}

// eventsPendingNotificationDecision 是「**确实该通知，但还没做完**」的显式欠账。
//
// 为什么要单列一份而不是直接进 no-notify 清单：把 MeetupProposed /
// PaymentIntentSucceeded / FriendRequestSent 这种事件标成「不发通知」，
// 是在给一个还没做的决定编理由 —— 而这几个恰恰是真该通知用户的。
//
// 放在这里的效果：新事件仍然必须被分类（门禁会红），但「已知的欠账」是
// 可见、可数、可逐条消掉的，而不是散落在 default 分支里的沉默。
//
// 每条写清**缺的是什么**（收件人 / 文案 / 深链 / 金额口径），这样下次接着做的人
// 知道从哪儿下手，而不是重新判断一遍「这个到底要不要通知」。
var eventsPendingNotificationDecision = map[string]string{
	// ── 见面/撮合：这些是用户明确在等的消息 ──────────────────────────────
	"MeetupProposed":              "该通知：收件人=对方；缺 deep link（meetups/ 不在白名单）+ 文案",
	"MeetupAccepted":              "该通知：收件人=提议方",
	"MeetupStarted":               "该通知：收件人=双方",
	"MeetupCompleted":             "该通知：收件人=双方（行程结束）",
	"MeetupNudged":                "该通知：收件人=被提醒方（已有 ContentTaskNudged 的先例可循）",
	"CityCompanionNeedCreated":    "该通知：收件人=可接单的 creator 群（要分批/扇出，不能一人一条）",
	"CityCompanionConfirmed":      "该通知：收件人=发起需求方",
	"CityCompanionRouteAccepted":  "该通知：收件人=双方",
	"CityCompanionRouteGenerated": "该通知：收件人=发起方（路线生成完成）",
	"CityCompanionCompleted":      "该通知：收件人=双方",

	// ── 订单/履约 ────────────────────────────────────────────────────────
	"OrderMaterialized":             "该通知：缺 deep link（orders/ 在白名单，但聚合是 order_materialized，路由要确认）",
	"OrderCancelled":                "该通知：收件人=下单方",
	"OrderCheckedIn":                "该通知：收件人=对方（打卡是协作动作）",
	"ExecutionStarted":              "该通知：收件人=双方",
	"EvidenceSubmitted":             "该通知：收件人=审核方",
	"SatisfactionRecorded":          "该通知：收件人=被评价方（评价是该知道的）",
	"CooperationConfirmed":          "该通知：收件人=双方（合作达成）",
	"OfferAccepted":                 "刻意不发：它和 OrderCreatedFromOffer 在同一批 domainEvents 里，单发会让同件事收两条（见 inboxForEvent 头注释第 4 条）",
	"NeedConfirmedFromConversation": "该通知：收件人=发需求方",
	"NeedCreatedFromPost":           "该通知：收件人=从帖子转需求的发帖人",

	// ── 账务：需要独立设计（金额/币种/对账口径），不能塞进现在这个无模板通道 ──
	"PaymentIntentSucceeded": "该通知但**需要独立设计**：金额/币种/失败重试文案，通知域目前没有模板层",
	"PaymentRefunded":        "同上",
	"PaymentIntentCreated":   "内部状态机推进（真正该通知的是 Succeeded/Refunded）",
	"PayoutReleased":         "该通知但需要独立设计：出账是财务口径",
	"WalletChanged":          "该通知但需要独立设计：余额变化要带金额与方向",

	// ── 社交邀请：该通知，且优先级高 ─────────────────────────────────────
	"ReferralInviteCreated": "该通知：收件人=被邀请方",
	"TopicInviteCreated":    "该通知：收件人=被邀请方",
}

// MERCHANT-CREATOR-NOTIFY-001：商家↔creator 的映射。
//
// 这组事件以前**一个 case 都没有**，全落进 default 被安静跳过 —— 商家发活单、
// creator 收不到；creator 还价、商家收不到。而正向门禁对「switch 里没有的东西」
// 一句话都不会说，所以没有任何测试会红。
//
// 两条最要紧的不变量：
//
//	① 收件人是 payload.notifyPrincipalId，**绝不是** PrincipalID（那是 actor）；
//	② notifyPrincipalId 缺失时不回退、不猜，直接不投（历史行没有这个字段）。
func TestInboxForEventRoutesMerchantCreatorEventsToTheCounterparty(t *testing.T) {
	cases := []struct {
		name        string
		eventType   string
		principalID string
		payload     map[string]any
		want        string
	}{
		{
			name: "邀约发给 creator", eventType: "CollabInvitationCreated", principalID: "user_merchant_1",
			payload: map[string]any{"merchantId": "m_1", "agentId": "agent_1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			// creator 接受 → 收件人是发活单的商家，绝不是 creator 自己
			name: "creator 接受后通知商家", eventType: "CollabInvitationResponded", principalID: "agent_1",
			payload: map[string]any{"decision": "ACCEPTED", "agentId": "agent_1", "merchantId": "m_1", "notifyPrincipalId": "user_merchant_1"},
			want:    "user_merchant_1",
		},
		{
			name: "creator 还价后通知商家", eventType: "CollabInvitationResponded", principalID: "agent_1",
			payload: map[string]any{"decision": "COUNTERED", "notifyPrincipalId": "user_merchant_1"},
			want:    "user_merchant_1",
		},
		{
			name: "商家还价后通知 creator", eventType: "CollabInvitationResponded", principalID: "user_merchant_1",
			payload: map[string]any{"decision": "COUNTERED", "agentId": "agent_1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			name: "商家撤回通知 creator", eventType: "CollabInvitationCancelled", principalID: "user_merchant_1",
			payload: map[string]any{"agentId": "agent_1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			name: "专属码发给 creator", eventType: "MerchantCreatorPromoIssued", principalID: "user_merchant_1",
			payload: map[string]any{"agentId": "agent_1", "code": "PT1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			name: "专属码调整通知 creator", eventType: "MerchantCreatorPromoAdjusted", principalID: "user_merchant_1",
			payload: map[string]any{"agentId": "agent_1", "code": "PT1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			name: "发券通知码的主人", eventType: "PromoCouponIssued", principalID: "user_merchant_1",
			payload: map[string]any{"agentId": "agent_1", "code": "PT1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			// 唯一一条收件人是商家的：creator 报码 ⇒ 商家要知道自己被报了
			name: "报码通知商家", eventType: "PromoCodeQuoted", principalID: "agent_1",
			payload: map[string]any{"merchantId": "m_1", "agentId": "agent_1", "code": "PT1", "notifyPrincipalId": "user_merchant_1"},
			want:    "user_merchant_1",
		},
		{
			name: "认领码通知本人", eventType: "PromoCodeClaimed", principalID: "agent_1",
			payload: map[string]any{"agentId": "agent_1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
		{
			name: "绑权益通知码的主人", eventType: "PromoBenefitBound", principalID: "user_merchant_1",
			payload: map[string]any{"merchantId": "m_1", "code": "PT1", "notifyPrincipalId": "agent_1"},
			want:    "agent_1",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recipient, title, body, _, ok := inboxForEvent(testEvent(tc.eventType, tc.principalID, "agg_1", tc.payload))
			if !ok {
				t.Fatalf("%s must produce a notification (it used to fall into default and be skipped)", tc.eventType)
			}
			if recipient != tc.want {
				t.Fatalf("recipient = %q, want %q", recipient, tc.want)
			}
			if recipient == tc.principalID && tc.principalID != tc.want {
				t.Fatalf("the notification went back to the actor (%q) — 发信人收自己的信", recipient)
			}
			if title == "" || body == "" {
				t.Fatalf("title/body must be filled: %q / %q", title, body)
			}
		})
	}
}

// 收件人未知（历史行没有 notifyPrincipalId）时**不投**，而且绝不回退到 actor。
// 回退过去等于把「你的活单被还价了」发给还价那个人 —— 函数头第 1 条就是它。
func TestInboxForEventDoesNotGuessRecipientForMerchantCreatorEvents(t *testing.T) {
	for _, eventType := range []string{
		"CollabInvitationCreated", "CollabInvitationResponded", "CollabInvitationCancelled",
		"MerchantCreatorPromoIssued", "MerchantCreatorPromoAdjusted", "PromoCouponIssued",
		"PromoCodeQuoted", "PromoCodeClaimed", "PromoBenefitBound",
	} {
		recipient, _, _, _, ok := inboxForEvent(testEvent(eventType, "actor_u1", "agg_1", map[string]any{
			"agentId": "agent_1", "merchantId": "m_1",
		}))
		if ok {
			t.Fatalf("%s without notifyPrincipalId must not be delivered (it went to %q)", eventType, recipient)
		}
	}
}
