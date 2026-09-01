package voucher

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelope(kind string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "test", CommandType: kind, CommandVersion: 1, Actor: command.Actor{Type: "USER", ID: "u1"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "u1"}, Target: command.Target{Type: "Voucher", ID: "test"}, IdempotencyKey: "voucher-test-key", AuthContext: map[string]any{}, Purpose: "test", CorrelationID: "corr", RequestedAt: "2026-08-21T00:00:00Z", Payload: payload}
}

func payload(t *testing.T, result command.Result) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestRedemptionAndSettlementAreSeparateFacts(t *testing.T) {
	s := New()
	now := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	s.clock = func() time.Time { return now }
	list := s.Handle(envelope("ListVouchers", map[string]any{}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %#v", list)
	}
	opened := s.Handle(envelope("OpenVoucherRedemption", map[string]any{"voucherId": "CV2508210001"}))
	redemption := payload(t, opened)["redemption"].(map[string]any)
	confirmed := s.Handle(envelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": redemption["redemptionId"]}))
	if confirmed.Aggregate == nil || confirmed.Aggregate.State != "REDEEMED" {
		t.Fatalf("expected redeemed, got %#v", confirmed)
	}
	state := s.Handle(envelope("GetVoucherSettlement", map[string]any{"voucherId": "CV2508210001"}))
	if state.Aggregate == nil || state.Aggregate.State != "PENDING" {
		t.Fatalf("expected settlement pending, got %#v", state)
	}
	settled := s.Handle(envelope("SettleVoucher", map[string]any{"voucherId": "CV2508210001"}))
	if settled.Aggregate == nil || settled.Aggregate.State != "SETTLED" {
		t.Fatalf("expected settled, got %#v", settled)
	}
}

func TestDynamicRedemptionCodeExpires(t *testing.T) {
	s := New()
	now := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	s.clock = func() time.Time { return now }
	opened := s.Handle(envelope("OpenVoucherRedemption", map[string]any{"voucherId": "CV2508210001"}))
	redemption := payload(t, opened)["redemption"].(map[string]any)
	now = now.Add(61 * time.Second)
	result := s.Handle(envelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": redemption["redemptionId"]}))
	if result.Error == nil || result.Error.ErrorCode != "REDEMPTION_TOKEN_EXPIRED" {
		t.Fatalf("expected expiry, got %#v", result)
	}
}

func TestRedemptionIsNotReplayable(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	opened := s.Handle(envelope("OpenVoucherRedemption", map[string]any{"voucherId": "CV2508210001"}))
	if opened.Outcome != "ACCEPTED" {
		t.Fatalf("open must succeed, got %#v Error=%+v", opened, opened.Error)
	}
	redemptionRaw, ok := payload(t, opened)["redemption"].(map[string]any)
	if !ok {
		t.Fatalf("redemption missing in payload: %s", opened.OperationRef)
	}
	rid, _ := redemptionRaw["redemptionId"].(string)
	if rid == "" {
		t.Fatalf("redemptionId missing")
	}
	first := s.Handle(envelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": rid}))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first confirm must succeed, got %#v", first)
	}
	second := s.Handle(envelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": rid}))
	if second.Error == nil || second.Error.ErrorCode != "REDEMPTION_ALREADY_USED" {
		t.Fatalf("replay must be rejected, got %#v", second)
	}
	// Redemption already used must not allow a second voucher state transition
	settled := s.Handle(envelope("SettleVoucher", map[string]any{"voucherId": "CV2508210001"}))
	if settled.Outcome != "ACCEPTED" {
		t.Fatalf("settle after first confirm must succeed, got %#v", settled)
	}
}
