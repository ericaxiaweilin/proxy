package fulfillment

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// 订单状态机回归（2026-09-28 订单管线审计）。每个测试头上写回归 ID，
// scripts/check-regression-contracts.sh 按名字跑。

func asActor(e command.Envelope, id string) command.Envelope {
	e.Actor = command.Actor{Type: "USER", ID: id}
	e.Principal = command.Principal{Type: "INDIVIDUAL", ID: id}
	return e
}

// confirmAsAgent 由订单的服务方确认合作（ORDER-CONFIRM-AGENT-001 之后唯一合法的确认人）。
func confirmAsAgent(s *Service, orderID string) command.Result {
	order, _ := s.repository.GetOrder(context.Background(), orderID)
	return s.Handle(asActor(envelopeFor("ConfirmCooperation", map[string]any{}, orderID), order.AgentID))
}

func errorCode(r command.Result) string {
	if r.Error == nil {
		return ""
	}
	return r.Error.ErrorCode
}

// ORDER-CONFIRM-AGENT-001：需求方自己下单后能自己「确认合作」，一个人把订单从
// OFFERED 走到 COMPLETED 并打满分，满意度进撮合排序和店铺统计 —— 刷分通道。
// 确认合作必须由服务方（订单的另一方）做。
func TestConfirmCooperationRequiresAgent(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	if r := s.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, orderID)); r.Outcome != "REJECTED" || errorCode(r) != "ONLY_AGENT_CONFIRMS" {
		t.Fatalf("requester self-confirm must be ONLY_AGENT_CONFIRMS, got %s %+v", r.Outcome, r.Error)
	}
	if r := s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID)); r.Outcome != "REJECTED" {
		t.Fatalf("an unconfirmed order must not start executing")
	}
	if r := s.Handle(asActor(envelopeFor("ConfirmCooperation", map[string]any{}, orderID), "stranger")); r.Outcome != "REJECTED" || errorCode(r) != "NOT_ORDER_PARTY" {
		t.Fatalf("outsider confirm must be NOT_ORDER_PARTY, got %+v", r.Error)
	}
	if r := confirmAsAgent(s, orderID); r.Outcome != "ACCEPTED" || r.Aggregate.State != "CONFIRMED" {
		t.Fatalf("agent confirm must succeed, got %s %+v", r.Outcome, r.Error)
	}
}

// ORDER-OFFER-COMP-001：档位报价的金额校验后被丢掉，接单生成的订单金额写死 0、
// 现金资格为空，直接进 CONFIRMED 绕过 R8 现金门。金额必须随报价落库并进订单快照；
// 超现金试点限额的报价在创建时就拒掉（接单即 CONFIRMED，没有复核的机会）。
func TestSlotOfferCarriesCompensationIntoOrder(t *testing.T) {
	s := New()
	offerID := createSlotOffer(t, s, "task_comp", "slot_comp", "agent_comp")
	accept := asActor(envelopeFor("AcceptSlotOffer", map[string]any{"offerId": offerID}, ""), "agent_comp")
	r := s.Handle(accept)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", r.Error)
	}
	order, err := s.repository.GetOrder(context.Background(), r.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if order.Snapshot.AgreedCompensation != 1200000 || order.Snapshot.Currency != "VND" {
		t.Fatalf("order must carry the offered compensation, got %d %s", order.Snapshot.AgreedCompensation, order.Snapshot.Currency)
	}
	if order.Snapshot.CashEligibilityStatus != CashEligibilityAllow {
		t.Fatalf("accepted cash order must carry an ALLOW cash eligibility, got %q", order.Snapshot.CashEligibilityStatus)
	}

	over := envelopeFor("CreateSlotOffer", map[string]any{"taskId": "task_big", "slotId": "slot_big", "agentId": "agent_comp", "agreedCompensation": 9000000}, "")
	if r := s.Handle(over); r.Outcome != "REJECTED" || errorCode(r) != "CASH_ELIGIBILITY_REVIEW" {
		t.Fatalf("slot offer above the cash pilot limit must be CASH_ELIGIBILITY_REVIEW, got %s %+v", r.Outcome, r.Error)
	}
}

// ORDER-SETTLE-GUARD-001：结算记录由一方同时勾「付款方确认」「收款方确认」，金额不对快照；
// 结算后还能取消。每一方只能确认自己那一侧，金额必须对上快照 / 对方已登记的金额；
// 双方都确认过结算的订单不能再取消。
func TestDirectSettlementEachPartyConfirmsOwnSide(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	if r := confirmAsAgent(s, orderID); r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %+v", r.Error)
	}
	if r := s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("execute: %+v", r.Error)
	}
	settle := func(actor string, payload map[string]any) command.Result {
		return s.Handle(asActor(envelopeFor("RecordDirectSettlement", payload, orderID), actor))
	}
	if r := settle("user_001", map[string]any{"agreedAmount": 1200000, "payeeConfirmed": true}); errorCode(r) != "SETTLEMENT_FLAG_NOT_OWNED" {
		t.Fatalf("payer must not confirm on behalf of the payee, got %+v", r.Error)
	}
	if r := settle("user_001", map[string]any{"agreedAmount": 1}); errorCode(r) != "SETTLEMENT_AMOUNT_MISMATCH" {
		t.Fatalf("amount off the frozen snapshot must be SETTLEMENT_AMOUNT_MISMATCH, got %+v", r.Error)
	}
	if r := settle("user_001", map[string]any{"agreedAmount": 1200000, "payerConfirmed": true}); r.Outcome != "ACCEPTED" {
		t.Fatalf("payer settlement: %+v", r.Error)
	}
	order, _ := s.repository.GetOrder(context.Background(), orderID)
	if order.Settlement == nil || !order.Settlement.PayerConfirmed || order.Settlement.PayeeConfirmed {
		t.Fatalf("only the payer side may be confirmed so far: %+v", order.Settlement)
	}
	// 单方声明不锁订单：服务方仍然可以取消（否则需求方能用假结算把对方锁死）。
	if r := settle("user_001", map[string]any{"agreedAmount": 1200000}); errorCode(r) != "SETTLEMENT_ALREADY_RECORDED" {
		t.Fatalf("payer confirming twice must be SETTLEMENT_ALREADY_RECORDED, got %+v", r.Error)
	}
	if r := settle("agent_linh", map[string]any{"agreedAmount": 1100000}); errorCode(r) != "SETTLEMENT_AMOUNT_MISMATCH" {
		t.Fatalf("payee countersign with another amount must be SETTLEMENT_AMOUNT_MISMATCH, got %+v", r.Error)
	}
	if r := settle("agent_linh", map[string]any{"agreedAmount": 1200000, "payeeConfirmed": true}); r.Outcome != "ACCEPTED" {
		t.Fatalf("payee countersign: %+v", r.Error)
	}
	order, _ = s.repository.GetOrder(context.Background(), orderID)
	if !order.Settlement.PayerConfirmed || !order.Settlement.PayeeConfirmed {
		t.Fatalf("both sides must be confirmed after countersign: %+v", order.Settlement)
	}
	if r := s.Handle(asActor(envelopeFor("CancelOrder", map[string]any{"reason": "late"}, orderID), "agent_linh")); errorCode(r) != "ORDER_SETTLED_NOT_CANCELLABLE" {
		t.Fatalf("a mutually settled order must not be cancellable, got %s %+v", r.Outcome, r.Error)
	}
}

// ORDER-SETTLE-GUARD-001：只有一方声明过结算时，另一方仍能取消。
func TestOneSidedSettlementDoesNotLockCancellation(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	confirmAsAgent(s, orderID)
	s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID))
	if r := s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{"agreedAmount": 1200000}, orderID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("payer settlement: %+v", r.Error)
	}
	if r := s.Handle(asActor(envelopeFor("CancelOrder", map[string]any{}, orderID), "agent_linh")); r.Outcome != "ACCEPTED" {
		t.Fatalf("one-sided settlement must not block cancellation: %+v", r.Error)
	}
}

// ORDER-OFFER-READ-001：GetOffer 不校验身份，任何人拿到 offerId 就能读留言和需求方 id。
// 只有报价双方可读；外人看到的是「不存在」（不泄露存在性）。
func TestGetOfferOnlyVisibleToParties(t *testing.T) {
	s := New()
	offerID := createSlotOffer(t, s, "task_read", "slot_read", "agent_read")
	for _, id := range []string{"user_001", "agent_read"} {
		if r := s.Handle(asActor(envelopeFor("GetOffer", map[string]any{"offerId": offerID}, offerID), id)); r.Outcome != "ACCEPTED" {
			t.Fatalf("%s must read own offer: %+v", id, r.Error)
		}
	}
	if r := s.Handle(asActor(envelopeFor("GetOffer", map[string]any{"offerId": offerID}, offerID), "stranger")); errorCode(r) != "OFFER_NOT_FOUND" {
		t.Fatalf("outsider must get OFFER_NOT_FOUND, got %s %+v", r.Outcome, r.Error)
	}
}

type conflictingRepository struct{ *MemoryRepository }

func (conflictingRepository) UpdateOrderAndPublish(context.Context, Order, int, []event.DomainEvent) error {
	return ErrVersionConflict
}

// ORDER-CONFLICT-CODE-001：并发改同一订单的版本冲突被报成 INTERNAL「更新失败」，
// 客户端没法区分「刷新重试」和「服务坏了」。版本冲突必须是 CONCURRENCY。
func TestOrderVersionConflictIsReportedAsConcurrency(t *testing.T) {
	memory := NewMemoryRepository()
	seed := New()
	seed.repository = memory
	orderID := createOffer(t, seed)
	s := NewWithRepository(conflictingRepository{memory})
	r := confirmAsAgent(s, orderID)
	if errorCode(r) != "ORDER_VERSION_CONFLICT" || r.Error.Category != "CONCURRENCY" {
		t.Fatalf("version conflict must be ORDER_VERSION_CONFLICT/CONCURRENCY, got %+v", r.Error)
	}
}

// ORDER-OFFER-COMP-001：主题邀约没有金额，接受后订单金额 0 且现金资格 ALLOW（面议）。
func TestTopicInviteOrderHasAllowCashEligibility(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("CreateTopicInvite", map[string]any{"agentId": "agent_topic", "topicKey": "coffee"}, ""))
	var view struct {
		OfferID string `json:"offerId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r = s.Handle(asActor(envelopeFor("RespondTopicInvite", map[string]any{"offerId": view.OfferID, "accept": true}, ""), "agent_topic"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept topic invite: %+v", r.Error)
	}
	order, _ := s.repository.GetOrder(context.Background(), r.Aggregate.ID)
	if order.Snapshot.AgreedCompensation != 0 || order.Snapshot.CashEligibilityStatus != CashEligibilityAllow {
		t.Fatalf("topic order snapshot: %+v", order.Snapshot)
	}
}
