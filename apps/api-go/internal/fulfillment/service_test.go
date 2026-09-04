package fulfillment

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Order", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func offerPayload() map[string]any {
	return map[string]any{
		"needId":             "need_1",
		"agentId":            "agent_linh",
		"serviceSku":         "cc_8h",
		"needVersion":        "need_v3",
		"routeVersion":       "route_v2",
		"duration":           "8H",
		"startTime":          "2026-08-20T09:30:00Z",
		"meetingContext":     "还剑湖正门",
		"agreedCompensation": 1200000,
		"currency":           "VND",
		"includedScope":      "8 小时陪同 + 拍照",
		"excludedScope":      "门票 / 餐饮",
		"settlementMode":     "DIRECT_SETTLEMENT",
		"paymentMethodLabel": "线下现金",
	}
}

func createOffer(t *testing.T, s *Service) string {
	t.Helper()
	r := s.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: got %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		OrderID  string        `json:"orderId"`
		Snapshot OrderSnapshot `json:"snapshot"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	// Gate G：快照冻结
	if view.Snapshot.AgreedCompensation != 1200000 || view.Snapshot.Agent != "agent_linh" {
		t.Fatalf("snapshot not frozen: %+v", view.Snapshot)
	}
	return view.OrderID
}

// Traceable Human Order：Offer → Confirm → Execute → Settlement → Outcome。
func TestTraceableHumanOrder(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)

	// Confirm
	r := s.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "CONFIRMED" {
		t.Fatalf("confirm: got %s/%s", r.Outcome, r.Aggregate.State)
	}

	// Execute
	r = s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "EXECUTING" {
		t.Fatalf("execute: got %s/%s", r.Outcome, r.Aggregate.State)
	}

	// Direct Settlement（Gate H：不创建 Platform 假记录）
	r = s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "paymentMethodLabel": "线下现金",
		"payerConfirmed": true, "payeeConfirmed": true,
	}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("settlement: got %s (%+v)", r.Outcome, r.Error)
	}

	// Outcome
	r = s.Handle(envelopeFor("RecordOutcome", map[string]any{
		"onTime": true, "actualStart": "09:35", "actualEnd": "17:40",
		"materialChanges": 1, "scopeCompleted": true, "objectiveNote": "按约完成",
	}, orderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "COMPLETED" {
		t.Fatalf("outcome: got %s/%s", r.Outcome, r.Aggregate.State)
	}

	// Satisfaction
	r = s.Handle(envelopeFor("RecordSatisfaction", map[string]any{
		"resolved": "FULL", "repeatIntent": "REUSE",
	}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("satisfaction: got %s (%+v)", r.Outcome, r.Error)
	}
}

func TestListMyOrdersOnlyReturnsActorOrdersWithViewerRole(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)

	requester := envelopeFor("ListMyOrders", map[string]any{}, "mine")
	r := s.Handle(requester)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("requester list: %s (%+v)", r.Outcome, r.Error)
	}
	var requesterView struct {
		Orders []struct {
			OrderID    string `json:"orderId"`
			ViewerRole string `json:"viewerRole"`
		} `json:"orders"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &requesterView); err != nil {
		t.Fatal(err)
	}
	if len(requesterView.Orders) != 1 || requesterView.Orders[0].OrderID != orderID || requesterView.Orders[0].ViewerRole != "REQUESTER" {
		t.Fatalf("unexpected requester view: %+v", requesterView.Orders)
	}

	agent := envelopeFor("ListMyOrders", map[string]any{}, "mine")
	agent.Actor.ID = "agent_linh"
	r = s.Handle(agent)
	var agentView struct {
		Orders []struct {
			ViewerRole string `json:"viewerRole"`
		} `json:"orders"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &agentView); err != nil {
		t.Fatal(err)
	}
	if len(agentView.Orders) != 1 || agentView.Orders[0].ViewerRole != "AGENT" {
		t.Fatalf("unexpected agent view: %+v", agentView.Orders)
	}

	outsider := envelopeFor("ListMyOrders", map[string]any{}, "mine")
	outsider.Actor.ID = "other_user"
	r = s.Handle(outsider)
	var outsiderView struct {
		Orders []json.RawMessage `json:"orders"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &outsiderView); err != nil {
		t.Fatal(err)
	}
	if len(outsiderView.Orders) != 0 {
		t.Fatalf("outsider saw private orders: %+v", outsiderView.Orders)
	}
}

func TestSettlementModeIsolation(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)

	// 新加固：OFFERED 状态不可结算 → 先确认+执行
	r := s.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("execute: %s", r.Outcome)
	}

	// 快照是 DIRECT_SETTLEMENT，所以这个应该成功（模式匹配）
	r = s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "paymentMethodLabel": "平台支付",
		"payerConfirmed": true, "payeeConfirmed": true,
	}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("settlement should match DIRECT_SETTLEMENT: %s (%+v)", r.Outcome, r.Error)
	}
	// 重复记录 → 拒绝
	r2 := s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "paymentMethodLabel": "线下现金",
	}, orderID))
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "SETTLEMENT_ALREADY_RECORDED" {
		t.Fatalf("want SETTLEMENT_ALREADY_RECORDED, got %s/%+v", r2.Outcome, r2.Error)
	}
}

// Gate G：Material Change 产生 amendment，不静默覆盖。
func TestMaterialChangeAmendment(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)

	// 新加固：OFFERED 不可变更 → 先确认
	r := s.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r.Outcome)
	}
	r = s.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{
		"description": "集合点改为老城区咖啡店",
	}, orderID))
	// Confirm 已是 v2，变更后 v3（版本递增 = amendment 记录，不覆盖原快照）
	if r.Outcome != "ACCEPTED" || r.Aggregate.Version != 3 {
		t.Fatalf("material change: got %s v%d", r.Outcome, r.Aggregate.Version)
	}
	// 版本递增 = amendment 记录，不覆盖原快照
}

func TestLifecycleGate(t *testing.T) {
	s := New()
	orderID := createOffer(t, s)

	// 未确认直接执行 → 拒绝
	r := s.Handle(envelopeFor("StartExecution", map[string]any{}, orderID))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "ORDER_NOT_EXECUTABLE" {
		t.Fatalf("want ORDER_NOT_EXECUTABLE, got %s/%+v", r.Outcome, r.Error)
	}
}

func createSlotOffer(t *testing.T, s *Service, taskID, slotID, agentID string) string {
	t.Helper()
	r := s.Handle(command.Envelope{
		CommandID: "cmd_slot_offer", CommandType: "CreateSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "user_001"}, Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target: command.Target{Type: "Offer", ID: "new"}, IdempotencyKey: "idem_slot_" + agentID + "_" + slotID,
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_slot", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"taskId": taskID, "slotId": slotID, "agentId": agentID, "agreedCompensation": int64(1200000)},
	})
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create slot offer: %s %+v", r.Outcome, r.Error)
	}
	var view struct {
		OfferID string `json:"offerId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.OfferID == "" {
		view.OfferID = r.Aggregate.ID
	}
	return view.OfferID
}

func TestSlotOfferAcceptAndTTL(t *testing.T) {
	s := New()
	taskID := "task_001"
	slotID := "slot_001"
	agentID := "agent_linh"
	offerID := createSlotOffer(t, s, taskID, slotID, agentID)
	// GetOffer should be OFFERED
	r := s.Handle(envelopeFor("GetOffer", map[string]any{"offerId": offerID}, offerID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "OFFERED" {
		t.Fatalf("get offer: %s %s", r.Outcome, r.Aggregate.State)
	}
	// Accept
	r = s.Handle(command.Envelope{
		CommandID: "cmd_accept", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: agentID}, Principal: command.Principal{Type: "INDIVIDUAL", ID: agentID},
		Target: command.Target{Type: "Offer", ID: offerID}, IdempotencyKey: "idem_accept_" + offerID,
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_accept", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerID},
	})
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %s %+v", r.Outcome, r.Error)
	}
	// Second accept same offer -> not available
	r2 := s.Handle(command.Envelope{
		CommandID: "cmd_accept2", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: agentID}, Principal: command.Principal{Type: "INDIVIDUAL", ID: agentID},
		Target: command.Target{Type: "Offer", ID: offerID}, IdempotencyKey: "idem_accept2_" + offerID,
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_accept2", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerID},
	})
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "OFFER_NOT_AVAILABLE" {
		t.Fatalf("second accept want OFFER_NOT_AVAILABLE got %s %+v", r2.Outcome, r2.Error)
	}
}

func TestOfferExpiredTTL(t *testing.T) {
	s := New()
	// direct repo insert expired offer
	offerID := "off_expired"
	now := s.clock.Now().UTC()
	expired := Offer{ID: offerID, TaskID: "task_1", SlotID: "slot_exp", RequesterID: "user_001", AgentID: "agent_exp", Status: "OFFERED", ExpiresAt: now.Add(-1 * time.Minute), Version: 1, CreatedAt: now.Add(-10 * time.Minute), UpdatedAt: now.Add(-10 * time.Minute)}
	_ = s.repository.CreateOffer(nil, expired)
	r := s.Handle(command.Envelope{
		CommandID: "cmd_accept_exp", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_exp"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_exp"},
		Target: command.Target{Type: "Offer", ID: offerID}, IdempotencyKey: "idem_exp",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_exp", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerID},
	})
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OFFER_EXPIRED" {
		t.Fatalf("want OFFER_EXPIRED got %s %+v", r.Outcome, r.Error)
	}
}

func TestConcurrentAcceptSameSlot(t *testing.T) {
	s := New()
	taskID := "task_conc"
	slotID := "slot_conc"
	// two offers for same slot to two agents
	offerA := createSlotOffer(t, s, taskID, slotID, "agent_a")
	offerB := createSlotOffer(t, s, taskID, slotID, "agent_b")
	// agent A accepts first -> success
	rA := s.Handle(command.Envelope{
		CommandID: "cmd_a", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_a"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_a"},
		Target: command.Target{Type: "Offer", ID: offerA}, IdempotencyKey: "idem_a",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_a", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerA},
	})
	if rA.Outcome != "ACCEPTED" {
		t.Fatalf("agent A accept: %s %+v", rA.Outcome, rA.Error)
	}
	// agent B accept same slot -> should be slot unavailable (or offer not available due to slot taken)
	rB := s.Handle(command.Envelope{
		CommandID: "cmd_b", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_b"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_b"},
		Target: command.Target{Type: "Offer", ID: offerB}, IdempotencyKey: "idem_b",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_b", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerB},
	})
	if rB.Outcome != "REJECTED" {
		t.Fatalf("agent B should be rejected due to slot taken, got %s", rB.Outcome)
	}
	if rB.Error.ErrorCode != "SLOT_UNAVAILABLE" && rB.Error.ErrorCode != "OFFER_NOT_AVAILABLE" && rB.Error.ErrorCode != "ACCEPT_OFFER_FAILED" {
		t.Fatalf("want SLOT_UNAVAILABLE got %s", rB.Error.ErrorCode)
	}
}

func TestCheckInAndEvidence(t *testing.T) {
	s := New()
	// reuse slot offer flow to get an order
	taskID := "task_exec"
	slotID := "slot_exec"
	offerID := createSlotOffer(t, s, taskID, slotID, "agent_exec")
	r := s.Handle(command.Envelope{
		CommandID: "cmd_accept_exec", CommandType: "AcceptSlotOffer", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_exec"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_exec"},
		Target: command.Target{Type: "Offer", ID: offerID}, IdempotencyKey: "idem_accept_exec",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_exec", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"offerId": offerID},
	})
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("accept: %s %+v", r.Outcome, r.Error)
	}
	var view struct {
		OrderID string `json:"orderId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	orderID := view.OrderID
	// offline check-in denied: try CheckIn with CONFIRMED -> should succeed and move to EXECUTING
	r2 := s.Handle(command.Envelope{
		CommandID: "cmd_checkin", CommandType: "CheckInOrder", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_exec"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_exec"},
		Target: command.Target{Type: "Order", ID: orderID}, IdempotencyKey: "idem_checkin",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_checkin", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"marketId": "hn", "locationLabel": "D1"},
	})
	if r2.Outcome != "ACCEPTED" || r2.Aggregate.State != "EXECUTING" {
		t.Fatalf("checkin: %s %+v", r2.Outcome, r2.Error)
	}
	// duplicate evidence submit: first should succeed, second with same order but different media should also succeed? For now we allow multiple
	r3 := s.Handle(command.Envelope{
		CommandID: "cmd_evidence", CommandType: "SubmitEvidence", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "agent_exec"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "agent_exec"},
		Target: command.Target{Type: "Order", ID: orderID}, IdempotencyKey: "idem_evidence",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_ev", RequestedAt: "2026-08-16T00:00:00Z",
		Payload: map[string]any{"mediaAssetId": "seed_media_hoankiem", "evidenceType": "PHOTO"},
	})
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("evidence: %s %+v", r3.Outcome, r3.Error)
	}
	// completion vs cancellation race is handled via Order lifecycle, but for now test that after evidence, RecordOutcome can complete
	r4 := s.Handle(envelopeFor("RecordOutcome", map[string]any{"onTime": true, "scopeCompleted": true, "materialChanges": 0}, orderID))
	if r4.Outcome != "ACCEPTED" {
		t.Fatalf("outcome after evidence: %s %+v", r4.Outcome, r4.Error)
	}
}

// R16.7-P1-B (LC-28) regression suite.
// A paid Order (PLATFORM_PAY settlement) must have a
// policy_decision_id stamped on it before it can transition
// from OFFERED to CONFIRMED. DIRECT_SETTLEMENT Orders skip
// the gate (the platform never touches the funds).
// We use a stub policydecisionsService that records the
// Evaluate / Stamp calls so the assertions do not depend on
// the policydecisions package internals.

type stubPolicyDecisions struct {
	mu             sync.Mutex
	decisions      map[string]stubDecision
	evaluateCalls  int
	stampCalls     int
	stampsForOrder map[string][]policydecisions.OrderStamp
}

type stubDecision struct {
	id            string
	userID        string
	category      policydecisions.CategoryCode
	termsVersion  string
	privacyVersion string
}

func newStubPolicyDecisions() *stubPolicyDecisions {
	return &stubPolicyDecisions{
		decisions:      map[string]stubDecision{},
		stampsForOrder: map[string][]policydecisions.OrderStamp{},
	}
}

func (s *stubPolicyDecisions) Evaluate(_ context.Context, userID string, category policydecisions.CategoryCode) (*policydecisions.Decision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.evaluateCalls++
	// Reuse-or-create on the (user, category) tuple, matching
	// the real Service contract.
	for _, d := range s.decisions {
		if d.userID == userID && d.category == category {
			return &policydecisions.Decision{ID: d.id, UserID: d.userID, CategoryCode: d.category, TermsVersion: d.termsVersion, PrivacyVersion: d.privacyVersion}, nil
		}
	}
	id := fmt.Sprintf("pdec_test_%d", s.evaluateCalls)
	s.decisions[id] = stubDecision{id: id, userID: userID, category: category, termsVersion: "terms-1.0.0", privacyVersion: "privacy-1.0.0"}
	return &policydecisions.Decision{ID: id, UserID: userID, CategoryCode: category, TermsVersion: "terms-1.0.0", PrivacyVersion: "privacy-1.0.0"}, nil
}

func (s *stubPolicyDecisions) Stamp(_ context.Context, stamp policydecisions.OrderStamp) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stampCalls++
	s.stampsForOrder[stamp.OrderID] = append(s.stampsForOrder[stamp.OrderID], stamp)
	return nil
}

func (s *stubPolicyDecisions) StampsForOrder(_ context.Context, orderID string) ([]policydecisions.OrderStamp, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]policydecisions.OrderStamp(nil), s.stampsForOrder[orderID]...), nil
}

func TestLC28ConfirmRequiresPolicyDecisionForPlatformPay(t *testing.T) {
	svc := New().WithPolicyDecisions(newStubPolicyDecisions())
	// Build an Order with PLATFORM_PAY settlement.
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: %s %+v", r.Outcome, r.Error)
	}
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	orderID := view.OrderID
	// Confirm — should succeed because the policy gate stamps a decision.
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, orderID))
	if r2.Outcome != "ACCEPTED" || r2.Aggregate.State != "CONFIRMED" {
		t.Fatalf("confirm: %s %+v", r.Outcome, r2.Error)
	}
	// Read back the Order and assert the decision id was stamped.
	order, err := svc.repository.GetOrder(context.Background(), orderID)
	if err != nil {
		t.Fatalf("read order: %v", err)
	}
	if order.PolicyDecisionID == "" {
		t.Fatal("PLATFORM_PAY Order must carry a PolicyDecisionID after Confirm")
	}
	// The (order, decision, lifecycle) stamp must be present.
	stub := svc.policyDecisions.(*stubPolicyDecisions)
	stamps, err := stub.StampsForOrder(context.Background(), orderID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stamps) != 1 || stamps[0].StampedLifecycle != "CONFIRMED" || stamps[0].DecisionID != order.PolicyDecisionID {
		t.Fatalf("stamps wrong: %+v", stamps)
	}
}

func TestLC28ConfirmRejectsWhenPolicyGateUnconfigured(t *testing.T) {
	// Service with no policyDecisions wired: PLATFORM_PAY must
	// be rejected (fail-closed). DIRECT_SETTLEMENT still
	// passes because the gate is settlement-mode scoped.
	svc := New()
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: %s %+v", r.Outcome, r.Error)
	}
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for unconfigured gate, got %s", r2.Outcome)
	}
	if r2.Error == nil || r2.Error.ErrorCode != "POLICY_GATE_NOT_CONFIGURED" {
		t.Fatalf("expected POLICY_GATE_NOT_CONFIGURED, got %+v", r2.Error)
	}
}

func TestLC28ConfirmSkipsGateForDirectSettlement(t *testing.T) {
	// DIRECT_SETTLEMENT Orders do not need a policy decision
	// (the platform never touches the funds). Even with the
	// gate unconfigured, the confirm must succeed.
	svc := New()
	r := svc.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: %s %+v", r.Outcome, r.Error)
	}
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("DIRECT_SETTLEMENT confirm should pass with unconfigured gate, got %s", r2.Outcome)
	}
}

func TestLC28ReusePolicyDecisionAcrossOrders(t *testing.T) {
	// Two Orders for the same requester should reuse the
	// same decision id (no TermsVersion change in between).
	// The stub returns the same id on repeated Evaluate.
	svc := New().WithPolicyDecisions(newStubPolicyDecisions())
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("first confirm: %s", r2.Outcome)
	}
	order1, _ := svc.repository.GetOrder(context.Background(), view.OrderID)
	decisionID1 := order1.PolicyDecisionID
	if decisionID1 == "" {
		t.Fatal("first order missing policy decision")
	}
	// Second Order, same requester.
	r = svc.Handle(envelopeFor("CreateOffer", payload, ""))
	var view2 struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view2)
	r2 = svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view2.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("second confirm: %s", r2.Outcome)
	}
	order2, _ := svc.repository.GetOrder(context.Background(), view2.OrderID)
	if order2.PolicyDecisionID != decisionID1 {
		t.Fatalf("second order should reuse decision id %q, got %q", decisionID1, order2.PolicyDecisionID)
	}
}

// R16.7-P1-C (LC-30) regression suite.
// A Material Change (RecordMaterialOrderChange) on a PLATFORM_PAY
// Order must re-run EvaluateBoundary and update the Order's
// stamped policy decision. The old decision row stays in
// policy.order_decisions as a history stamp; the Order's
// PolicyDecisionID is overwritten with the new one (which is
// the same id if TermsVersion is unchanged — the dev server
// keeps one version, so the test asserts on Stamp calls rather
// than a different id).

func TestLC30MaterialChangeReevaluatesPolicyDecisionForPlatformPay(t *testing.T) {
	stub := newStubPolicyDecisions()
	svc := New().WithPolicyDecisions(stub)
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: %s %+v", r.Outcome, r.Error)
	}
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r2.Outcome)
	}
	order, _ := svc.repository.GetOrder(context.Background(), view.OrderID)
	originalDecision := order.PolicyDecisionID
	if originalDecision == "" {
		t.Fatal("expected stamped decision before amendment")
	}
	// Now record a Material Change.
	r3 := svc.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{"description": "地点改为河内西湖"}, view.OrderID))
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("material change: %s %+v", r3.Outcome, r3.Error)
	}
	// Re-read the Order; the policy decision id must still
	// be set (re-evaluation ran). With a constant
	// TermsVersion the id is the same as before; we assert
	// that the Stamp was called an additional time (initial
	// CONFIRMED stamp + amendment stamp = 2).
	order, _ = svc.repository.GetOrder(context.Background(), view.OrderID)
	if order.PolicyDecisionID == "" {
		t.Fatal("expected policy decision after amendment")
	}
	stamps, _ := stub.StampsForOrder(context.Background(), view.OrderID)
	if len(stamps) < 2 {
		t.Fatalf("expected at least 2 stamps (CONFIRMED + amendment), got %d: %+v", len(stamps), stamps)
	}
	// The most recent stamp must point at the current
	// decision id, regardless of whether it changed.
	last := stamps[len(stamps)-1]
	if last.DecisionID != order.PolicyDecisionID {
		t.Fatalf("last stamp decision %q does not match order policy decision %q", last.DecisionID, order.PolicyDecisionID)
	}
}

func TestLC30MaterialChangeSkipsForDirectSettlement(t *testing.T) {
	// DIRECT_SETTLEMENT Orders never carry a policy decision;
	// the re-evaluation branch must not be entered.
	stub := newStubPolicyDecisions()
	svc := New().WithPolicyDecisions(stub)
	r := svc.Handle(envelopeFor("CreateOffer", offerPayload(), ""))
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r2.Outcome)
	}
	stub.mu.Lock()
	callsBefore := stub.evaluateCalls
	stub.mu.Unlock()
	r3 := svc.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{"description": "DIRECT change"}, view.OrderID))
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("material change: %s", r3.Outcome)
	}
	stub.mu.Lock()
	callsAfter := stub.evaluateCalls
	stub.mu.Unlock()
	if callsAfter != callsBefore {
		t.Fatalf("DIRECT_SETTLEMENT should not re-evaluate; evaluate calls %d -> %d", callsBefore, callsAfter)
	}
}

func TestLC30MaterialChangePermissiveWhenGateUnconfigured(t *testing.T) {
	// PLATFORM_PAY Order + nil policy service + Material
	// Change: the amendment must still go through (the Order
	// is already paid for; we cannot roll back the user's
	// payment just because the policy service died). The
	// existing PolicyDecisionID on the Order is preserved,
	// and the audit log gets no new stamp. The trade-off is
	// deliberate: blocking every amendment on a degraded
	// policy service is worse than letting the amendment
	// through with a stale decision id. Operators see this
	// via the missing-stamp anomaly in their audit queries.
	svc := New()
	payload := offerPayload()
	payload["settlementMode"] = "PLATFORM_PAY"
	payload["paymentMethodLabel"] = "Proxy 钱包"
	stub := newStubPolicyDecisions()
	svc.WithPolicyDecisions(stub)
	r := svc.Handle(envelopeFor("CreateOffer", payload, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create offer: %s", r.Outcome)
	}
	var view struct{ OrderID string `json:"orderId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	r2 := svc.Handle(envelopeFor("ConfirmCooperation", map[string]any{}, view.OrderID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %s", r2.Outcome)
	}
	order, _ := svc.repository.GetOrder(context.Background(), view.OrderID)
	decisionBefore := order.PolicyDecisionID
	// Simulate the gate being unconfigured for the next call.
	svc.WithPolicyDecisions(nil)
	r3 := svc.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{"description": "test"}, view.OrderID))
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("amendment must be permissive when gate is unconfigured, got %s %+v", r3.Outcome, r3.Error)
	}
	order, _ = svc.repository.GetOrder(context.Background(), view.OrderID)
	if order.PolicyDecisionID != decisionBefore {
		t.Fatalf("decision id must be preserved when re-evaluation is skipped")
	}
	// The stub's Stamp count must not have grown (no
	// additional audit row written by this amendment).
	stampCount := 0
	for _, s := range stub.stampsForOrder {
		stampCount += len(s)
	}
	if stampCount != 1 {
		t.Fatalf("expected 1 stamp (from the original Confirm), got %d", stampCount)
	}
}
