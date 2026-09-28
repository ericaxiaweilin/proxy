package fulfillment

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

func proposeChange(s *Service, actor, orderID string, changes map[string]any) (command.Result, string) {
	r := s.Handle(asActor(envelopeFor("RecordMaterialOrderChange", map[string]any{"description": "变更条款", "changes": changes}, orderID), actor))
	var view struct {
		AmendmentID string `json:"amendmentId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	return r, view.AmendmentID
}

func respondChange(s *Service, actor, orderID, amendmentID, decision string) command.Result {
	return s.Handle(asActor(envelopeFor("RespondMaterialOrderChange", map[string]any{"amendmentId": amendmentID, "decision": decision, "reason": "test"}, orderID), actor))
}

// ORDER-AMEND-001：以前 RecordMaterialOrderChange 只记一句描述、快照原样复制 ——
// 条款改不了，也不需要对方同意。现在：一方提出新条款，另一方接受才生效；
// 拒绝 / 撤回保留旧条款；每一版条款都留在 amendment 上可还原。
func TestMaterialChangeRequiresCounterpartyAndKeepsHistory(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	confirmAsAgent(s, orderID)

	if r := s.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{"description": "只有描述"}, orderID)); errorCode(r) != "NO_MATERIAL_CHANGE" {
		t.Fatalf("a change without new terms must be NO_MATERIAL_CHANGE, got %s %+v", r.Outcome, r.Error)
	}
	r, amendmentID := proposeChange(s, "user_001", orderID, map[string]any{"agreedCompensation": 1500000, "meetingContext": "老城区"})
	if r.Outcome != "ACCEPTED" || amendmentID == "" {
		t.Fatalf("propose: %s %+v", r.Outcome, r.Error)
	}
	order, _ := s.repository.GetOrder(context.Background(), orderID)
	if order.Snapshot.AgreedCompensation != 1200000 {
		t.Fatalf("a proposal must not change the terms before acceptance: %+v", order.Snapshot)
	}
	if r, _ := proposeChange(s, "agent_linh", orderID, map[string]any{"duration": "4H"}); errorCode(r) != "AMENDMENT_PENDING" {
		t.Fatalf("only one pending proposal at a time, got %+v", r.Error)
	}
	if r := respondChange(s, "user_001", orderID, amendmentID, "ACCEPT"); errorCode(r) != "COUNTERPARTY_MUST_DECIDE" {
		t.Fatalf("the proposer must not accept their own proposal, got %+v", r.Error)
	}
	if r := respondChange(s, "agent_linh", orderID, amendmentID, "ACCEPT"); r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %+v", r.Error)
	}
	order, _ = s.repository.GetOrder(context.Background(), orderID)
	accepted := order.Amendments[len(order.Amendments)-1]
	if order.Snapshot.AgreedCompensation != 1500000 || order.Snapshot.MeetingContext != "老城区" {
		t.Fatalf("accepted terms must be applied: %+v", order.Snapshot)
	}
	if accepted.Status != AmendmentAccepted || accepted.PreviousSnapshot == nil || accepted.PreviousSnapshot.AgreedCompensation != 1200000 || accepted.DecidedBy != "agent_linh" {
		t.Fatalf("accepted amendment must keep the previous terms for rollback: %+v", accepted)
	}
	if r := respondChange(s, "agent_linh", orderID, amendmentID, "REJECT"); errorCode(r) != "AMENDMENT_NOT_PENDING" {
		t.Fatalf("a decided amendment is final, got %+v", r.Error)
	}

	// 拒绝：旧条款不变。
	_, second := proposeChange(s, "agent_linh", orderID, map[string]any{"duration": "4H"})
	if r := respondChange(s, "user_001", orderID, second, "REJECT"); r.Outcome != "ACCEPTED" {
		t.Fatalf("reject: %+v", r.Error)
	}
	// 撤回：只有提出方能撤回。
	_, third := proposeChange(s, "agent_linh", orderID, map[string]any{"duration": "6H"})
	if r := respondChange(s, "user_001", orderID, third, "WITHDRAW"); errorCode(r) != "ONLY_PROPOSER_WITHDRAWS" {
		t.Fatalf("only the proposer withdraws, got %+v", r.Error)
	}
	if r := respondChange(s, "agent_linh", orderID, third, "WITHDRAW"); r.Outcome != "ACCEPTED" {
		t.Fatalf("withdraw: %+v", r.Error)
	}
	order, _ = s.repository.GetOrder(context.Background(), orderID)
	if order.Snapshot.Duration != "8H" {
		t.Fatalf("rejected / withdrawn proposals must leave the terms alone: %+v", order.Snapshot)
	}
	statuses := []string{}
	for _, a := range order.Amendments {
		statuses = append(statuses, a.Status)
	}
	if len(statuses) != 3 || statuses[0] != AmendmentAccepted || statuses[1] != AmendmentRejected || statuses[2] != AmendmentWithdrawn {
		t.Fatalf("every amendment stays on the order as history: %v", statuses)
	}
}

// ORDER-AMEND-001：改价重新过现金门；有结算声明后不能再改价；订单进终态时未决提议作废留痕。
func TestMaterialChangeGuardsMoneyAndLapsesOnTerminal(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	confirmAsAgent(s, orderID)
	if r, _ := proposeChange(s, "user_001", orderID, map[string]any{"agreedCompensation": 6000000}); errorCode(r) != "CASH_ELIGIBILITY_REVIEW" {
		t.Fatalf("a re-price above the cash pilot limit must be CASH_ELIGIBILITY_REVIEW, got %s %+v", r.Outcome, r.Error)
	}
	s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID))
	s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{"agreedAmount": 1200000}, orderID))
	if r, _ := proposeChange(s, "agent_linh", orderID, map[string]any{"agreedCompensation": 1300000}); errorCode(r) != "AMENDMENT_AFTER_SETTLEMENT" {
		t.Fatalf("no re-pricing once a settlement is declared, got %+v", r.Error)
	}
	if r, _ := proposeChange(s, "agent_linh", orderID, map[string]any{"objectiveNote": "x", "meetingContext": "改地点"}); r.Outcome != "ACCEPTED" {
		t.Fatalf("non-money change after settlement: %+v", r.Error)
	}
	if r := s.Handle(asActor(envelopeFor("CancelOrder", map[string]any{"reason": "late"}, orderID), "agent_linh")); r.Outcome != "ACCEPTED" {
		t.Fatalf("cancel: %+v", r.Error)
	}
	order, _ := s.repository.GetOrder(context.Background(), orderID)
	last := order.Amendments[len(order.Amendments)-1]
	if last.Status != AmendmentLapsed || last.DecidedAt == nil {
		t.Fatalf("pending proposal must lapse (not vanish) when the order is cancelled: %+v", last)
	}
}

// ORDER-FSM-001：状态机只有一张迁移表；commitOrder 在写库前按它和不变量兜底。
func TestOrderTransitionGuard(t *testing.T) {
	now := time.Now().UTC()
	base := Order{ID: "ord_x", RequesterID: "r", AgentID: "a", NeedID: "n", Lifecycle: "CONFIRMED", Version: 2, CreatedAt: now,
		Snapshot: OrderSnapshot{AgreedCompensation: 100, SettlementMode: "DIRECT_SETTLEMENT"}}
	next := func(mutate func(*Order)) Order {
		o := cloneOrder(base)
		o.Version++
		mutate(&o)
		return o
	}
	legal := []Order{
		next(func(o *Order) { o.Lifecycle = "EXECUTING" }),
		next(func(o *Order) { o.Lifecycle = "CANCELLED" }),
		next(func(o *Order) {
			o.Amendments = append(o.Amendments, Amendment{AmendmentID: "amd_1", Status: AmendmentProposed})
		}),
	}
	for i, after := range legal {
		if err := checkOrderTransition(base, after); err != nil {
			t.Fatalf("legal case %d rejected: %v", i, err)
		}
	}
	cancelled := cloneOrder(base)
	cancelled.Lifecycle = "CANCELLED"
	illegalCases := map[string][2]Order{
		"skip to COMPLETED":         {base, next(func(o *Order) { o.Lifecycle = "COMPLETED" })},
		"back to OFFERED":           {base, next(func(o *Order) { o.Lifecycle = "OFFERED" })},
		"version skip":              {base, next(func(o *Order) { o.Version++ })},
		"identity change":           {base, next(func(o *Order) { o.AgentID = "someone_else" })},
		"silent snapshot overwrite": {base, next(func(o *Order) { o.Snapshot.AgreedCompensation = 1 })},
		"cancelled is frozen":       {cancelled, func() Order { o := cloneOrder(cancelled); o.Version++; return o }()},
	}
	for name, pair := range illegalCases {
		if err := checkOrderTransition(pair[0], pair[1]); err == nil {
			t.Fatalf("%s must be rejected", name)
		}
	}
	settled := cloneOrder(base)
	settled.Settlement = &SettlementRecord{AgreedAmount: 100, PayerConfirmed: true}
	withdrawn := cloneOrder(settled)
	withdrawn.Version++
	withdrawn.Settlement = &SettlementRecord{AgreedAmount: 100}
	if err := checkOrderTransition(settled, withdrawn); err == nil {
		t.Fatal("a settlement confirmation must not be withdrawn")
	}
}

// ORDER-AUDIT-001：订单双方能读到完整变更轨迹（谁、哪条命令、前后状态）；外人看到「不存在」。
func TestOrderAuditTrailForParties(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)
	confirmAsAgent(s, orderID)
	s.Handle(asActor(envelopeFor("CancelOrder", map[string]any{"reason": "x"}, orderID), "agent_linh"))
	if r := s.Handle(asActor(envelopeFor("GetOrderAuditTrail", map[string]any{}, orderID), "stranger")); errorCode(r) != "ORDER_NOT_FOUND" {
		t.Fatalf("outsider must get ORDER_NOT_FOUND, got %+v", r.Error)
	}
	r := s.Handle(envelopeFor("GetOrderAuditTrail", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("audit trail: %+v", r.Error)
	}
	var view struct {
		Entries []AuditEntry `json:"entries"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	want := [][3]string{{"CreateOffer", "user_001", "OFFERED"}, {"ConfirmCooperation", "agent_linh", "CONFIRMED"}, {"CancelOrder", "agent_linh", "CANCELLED"}}
	if len(view.Entries) != len(want) {
		t.Fatalf("expected %d audit entries, got %+v", len(want), view.Entries)
	}
	for i, w := range want {
		got := view.Entries[i]
		if got.CommandType != w[0] || got.ActorID != w[1] || got.NewState != w[2] {
			t.Fatalf("entry %d: got %+v want %v", i, got, w)
		}
	}
}

type failingStampPolicy struct{ *stubPolicyDecisions }

func (failingStampPolicy) Stamp(context.Context, policydecisions.OrderStamp) error {
	return errors.New("stamp storage unavailable")
}

// POLICY-STAMP-DURABLE-001：盖章以前在写库之后、错误被丢弃 —— 订单进了 CONFIRMED
// 却没有 LC-28 记录。现在盖章失败 = 确认失败，订单停在 OFFERED。
func TestStampFailureRejectsConfirmation(t *testing.T) {
	svc := New().WithPolicyDecisions(failingStampPolicy{newStubPolicyDecisions()})
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	var view struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if r := confirmAsAgent(svc, view.OrderID); r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "POLICY_STAMP_FAILED" {
		t.Fatalf("a failed stamp must reject the confirmation, got %s %+v", r.Outcome, r.Error)
	}
	order, _ := svc.repository.GetOrder(context.Background(), view.OrderID)
	if order.Lifecycle != "OFFERED" || order.Version != 1 {
		t.Fatalf("order must stay OFFERED v1 after a failed stamp: %s v%d", order.Lifecycle, order.Version)
	}
}
