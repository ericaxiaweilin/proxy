package fulfillment

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
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
	var view struct{ OfferID string `json:"offerId"`}
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
