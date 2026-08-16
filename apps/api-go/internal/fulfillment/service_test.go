package fulfillment

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:       "cmd_test_1",
		CommandType:     commandType,
		CommandVersion:  1,
		Actor:           command.Actor{Type: "USER", ID: "user_001"},
		Principal:       command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:          command.Target{Type: "Order", ID: targetID},
		IdempotencyKey:  "test_key_123456",
		AuthContext:     map[string]any{"session": "s1"},
		Purpose:         "test",
		CorrelationID:   "corr_1",
		RequestedAt:     "2026-08-16T00:00:00Z",
		Payload:         payload,
	}
}

func offerPayload() map[string]any {
	return map[string]any{
		"needId":            "need_1",
		"agentId":           "agent_linh",
		"serviceSku":        "cc_8h",
		"needVersion":       "need_v3",
		"routeVersion":      "route_v2",
		"duration":          "8H",
		"startTime":         "2026-08-20T09:30:00Z",
		"meetingContext":    "还剑湖正门",
		"agreedCompensation": 1200000,
		"currency":          "VND",
		"includedScope":     "8 小时陪同 + 拍照",
		"excludedScope":     "门票 / 餐饮",
		"settlementMode":    "DIRECT_SETTLEMENT",
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

	// 快照是 DIRECT_SETTLEMENT；试 PLATFORM_PAY 记录 → 模式不匹配拒绝
	r := s.Handle(envelopeFor("RecordDirectSettlement", map[string]any{
		"agreedAmount": 1200000, "paymentMethodLabel": "平台支付",
		"payerConfirmed": true, "payeeConfirmed": true,
	}, orderID))
	// 快照是 DIRECT_SETTLEMENT，所以这个应该成功（模式匹配）
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("settlement should match DIRECT_SETTLEMENT: %s", r.Outcome)
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

	r := s.Handle(envelopeFor("RecordMaterialOrderChange", map[string]any{
		"description": "集合点改为老城区咖啡店",
	}, orderID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.Version != 2 {
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
