package fulfillment

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/notification"
)

// MERCHANT-CREATOR-NOTIFY-001：Offer 通知的收件人必须是**可投递**的 id。
//
// OfferCreated 的时效是 5 分钟 —— 收件人算不出来，等于这条通知对所有人都不存在，
// 而订单照样创建成功、没有任何报错、门禁全绿。
//
// 之前这条通知拿 payload 里的 agentId 当收件人，而 agentId 既不是 user account
// 也不是任何会话的 principal（本地库 121 个 creator，0 个的 agent_id 是 user account）。
func TestOfferCreatedCarriesADeliverableRecipientNotAnAgentId(t *testing.T) {
	if got := (&Service{}).inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_x"); got != "" {
		t.Fatalf("with no resolver wired there must be NO recipient (never a guess), got %q", got)
	}

	s := New()
	s.SetAgentInboxRecipient(notification.AgentInboxRecipientOf(func(_ context.Context, agentID string) string {
		if agentID == "agent_known" {
			return "user_account_known"
		}
		return "" // 查不到 ⇒ 不发，不拿 agentId 兜底
	}))
	if got := s.inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_known"); got != "user_account_known" {
		t.Fatalf("recipient = %q, want user_account_known", got)
	}
	if got := s.inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_unknown"); got != "" {
		t.Fatalf("an unresolvable creator must produce NO recipient, got %q（拿 agentId 兜底就是重犯那个错）", got)
	}
}

// MERCHANT-CREATOR-NOTIFY-001：订单履约的六个事件要通知**对手方**。
//
// 三条性质，每条都对应一个真实的坑：
//
//	① 去掉 actor —— 否则「你取消了订单」会回到取消的人自己收件箱里；
//	② 两方各一条 —— 打卡/评价/凭证提交，对方必须知道；
//	③ 收件人必须是**可投递** id —— 订单里的 requester/agent 命名空间是混合的
//	   （实测 819 条：requester 694 条是 user_account、agent 134 条是 user_account、
//	   1 条是 agent id、其余 684 条 fixture 脏数据），所以要用宽松版解析。
func TestOrderCounterpartyNotificationsExcludeTheActorAndCoverBothSides(t *testing.T) {
	s := New()
	s.SetAgentInboxRecipient(stubPersonResolver{})

	order := Order{
		ID: "ord_n1", OrderNo: "N1", RequesterID: "user_req", AgentID: "agent_ag",
		Lifecycle: "CONFIRMED", Version: 3,
	}

	// creator（agent）打卡 ⇒ 只通知 requester。
	got := s.orderPartyRecipients(context.Background(), order, "agent_ag")
	if len(got) != 1 || got[0].recipient != "user_req" || got[0].role != "REQUESTER" {
		t.Fatalf("agent acting ⇒ notify the requester only, got %+v", got)
	}
	// requester 打卡 ⇒ 只通知 agent。
	got = s.orderPartyRecipients(context.Background(), order, "user_req")
	if len(got) != 1 || got[0].recipient != "user_ag" || got[0].role != "AGENT" {
		t.Fatalf("requester acting ⇒ notify the agent only, got %+v", got)
	}
	// 第三方（不是订单任何一方）⇒ 通知双方。
	got = s.orderPartyRecipients(context.Background(), order, "user_someone_else")
	if len(got) != 2 {
		t.Fatalf("a third party acting ⇒ notify both sides, got %+v", got)
	}
	// agent id 必须经过解析（agent_ag → user_ag），不能原样投递。
	for _, party := range got {
		if party.recipient == "agent_ag" {
			t.Fatal("the agent id must be resolved to its user account, never used as-is")
		}
	}
}

// 没接解析器 ⇒ 没有收件人（绝不猜），而订单照常能写。
func TestOrderNotificationsWithoutResolverProduceNoRecipient(t *testing.T) {
	s := New()
	order := Order{ID: "ord_n2", RequesterID: "user_req", AgentID: "agent_ag", Lifecycle: "CONFIRMED"}
	if got := s.orderPartyRecipients(context.Background(), order, "user_x"); len(got) != 0 {
		t.Fatalf("without a resolver there must be NO recipient, got %+v", got)
	}
}

// 同一个 user 在订单两方都出现（自己给自己下单的极端情况）⇒ 只通知一次。
func TestOrderNotificationDoesNotDuplicateTheSameRecipient(t *testing.T) {
	s := New()
	s.SetAgentInboxRecipient(stubPersonResolver{})
	order := Order{ID: "ord_n3", RequesterID: "user_same", AgentID: "agent_same", Lifecycle: "CONFIRMED"}
	got := s.orderPartyRecipients(context.Background(), order, "user_other")
	if len(got) != 1 {
		t.Fatalf("the same person on both sides must get one notification, got %+v", got)
	}
}

// stubPersonResolver：agent_* → user_ag（模拟真实桥接），其余原样返回。
type stubPersonResolver struct{}

func (stubPersonResolver) AgentInboxRecipient(_ context.Context, agentID string) string {
	return stubPersonResolver{}.InboxRecipientFor(context.Background(), agentID)
}

func (stubPersonResolver) InboxRecipientFor(_ context.Context, id string) string {
	// agent_same 解析成 user_same（订单两方其实是同一个人）—— 去重那条要验的就是
	// 「解析之后才发现是同一个人」，所以解析表必须真的把它们映到同一个 id。
	switch id {
	case "agent_ag":
		return "user_ag"
	case "agent_same":
		return "user_same"
	default:
		return id
	}
}

// 推不出收件人时**仍然要发事件** —— 它是业务事实，审计表要记它。
//
// 这条是被既有测试抓出来的：我一度在 orderEvents 里直接返回空切片，于是
// TestOrderTransitionIsStampedAndAuditedPostgres 的审计行 Events 字段变空。
// 「通知投递不出去」一路影响到了审计链，而审计链跟通知可投递性毫无关系。
func TestOrderEventIsStillEmittedWhenNoRecipientIsResolvable(t *testing.T) {
	s := New() // 没接 resolver ⇒ 推不出任何收件人
	order := Order{ID: "ord_n4", RequesterID: "user_req", AgentID: "agent_ag", Lifecycle: "CONFIRMED", Version: 2}

	events := orderEvents(s, context.Background(), order, command.Envelope{
		Principal: command.Principal{ID: "user_req"}, Actor: command.Actor{ID: "user_req"},
		CorrelationID: "corr", CommandID: "cmd",
	}, time.Now().UTC(), nil,
		func(_ orderPartyRecipient, orderID string, _ int, at time.Time, payload map[string]any) event.DomainEvent {
			return event.New("CooperationConfirmed", "Order", orderID, 2, "u", "c", "d", at, payload)
		})
	if len(events) != 1 {
		t.Fatalf("the business fact must still be emitted, got %d events", len(events))
	}
	if events[0].EventType != "CooperationConfirmed" {
		t.Fatalf("event type = %q — the audit trail keys off it", events[0].EventType)
	}
	if recipient, _ := events[0].Payload["notifyPrincipalId"].(string); recipient != "" {
		t.Fatalf("with no resolver the recipient must be empty (the mapping layer then skips it), got %q", recipient)
	}
}

// MERCHANT-CREATOR-NOTIFY-001：TopicInviteCreated 的收件人是被邀请的 creator。
//
// 创建时就校验了 `e.Actor.ID != agentID`（不能自己邀请自己），所以收件人一定
// 是对方、不会是回声。而 offer.AgentID 是 agent id ⇒ 必须解析。
func TestTopicInviteNotificationResolvesTheInvitedCreator(t *testing.T) {
	s := New()
	if got := s.inboxRecipientForPerson(context.Background(), "agent_x"); got != "" {
		t.Fatalf("without a resolver there must be NO recipient, got %q", got)
	}
	s.SetAgentInboxRecipient(stubPersonResolver{})
	// stubPersonResolver 只认 agent_ag / agent_same 这两个 id（它就是个替身，不是真的解析器）。
	if got := s.inboxRecipientForPerson(context.Background(), "agent_ag"); got != "user_ag" {
		t.Fatalf("recipient = %q, want user_ag（agent id 必须解析成 user account）", got)
	}
	if got := s.inboxRecipientForPerson(context.Background(), "agent_unknown"); got != "agent_unknown" {
		t.Fatalf("an unknown id passes through unchanged (the permissive resolver's contract), got %q", got)
	}
	if got := s.inboxRecipientForPerson(context.Background(), "user_direct"); got != "user_direct" {
		t.Fatalf("an id that is already a principal must pass through, got %q", got)
	}
}
