package main

import (
	"context"
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
		for _, m := range re.FindAllStringSubmatch(string(b), -1) {
			out[m[1]] = true
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
