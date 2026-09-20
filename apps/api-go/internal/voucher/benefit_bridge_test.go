package voucher

import (
	"context"
	"testing"
	"time"
)

// stubBenefitBridge is a test-only BenefitBridge — the real adapter
// (benefitBridge, wrapping a benefit.Service) is exercised end-to-end by
// TestBenefitBridgeShowsRealClaimInWallet in
// internal/platform/postgres/benefit_bridge_integration_test.go, which is
// the one that actually proves the Campaign -> Claim projection is
// correct. This stub is only for testing voucher.Service's own gating
// logic (list merge, get/settlement read-through, write-path rejection).
type stubBenefitBridge struct {
	wallet map[string]Voucher // keyed by bft_ voucherID
	err    error
}

func (b *stubBenefitBridge) ListWallet(_ context.Context, userID string) ([]Voucher, error) {
	if b.err != nil {
		return nil, b.err
	}
	out := make([]Voucher, 0, len(b.wallet))
	for _, v := range b.wallet {
		out = append(out, v)
	}
	return out, nil
}

func (b *stubBenefitBridge) GetWallet(_ context.Context, userID, voucherID string) (*Voucher, bool, error) {
	if b.err != nil {
		return nil, false, b.err
	}
	v, ok := b.wallet[voucherID]
	if !ok {
		return nil, false, nil
	}
	return &v, true, nil
}

func testBridgedVoucher() Voucher {
	return Voucher{
		ID: BenefitBridgePrefix + "claim_1", Family: Coffee, DisplayValue: 45000, Currency: "VND",
		ScopeName: "PG integration test", ScopeDetail: "Free Coffee", ValidFrom: "2026-09-01", ValidUntil: "2026-09-30",
		RedeemTimeWindow: "活动有效期内", MinimumSpend: "无", PerPersonLimit: 1,
		Status: "AVAILABLE", IssuerLabel: "merchant_1", SettlementValue: 45000, Version: 1,
	}
}

// VOUCHER-DEFAULTS-001: a new actor's wallet is no longer pre-loaded with
// free vouchers, but it must still show whatever real benefit claims the
// bridge reports.
func TestListMergesBenefitBridgeVouchers(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC) }
	bridged := testBridgedVoucher()
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{bridged.ID: bridged}})

	result := s.Handle(envelope("ListVouchers", map[string]any{}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list: %#v", result)
	}
	body := payload(t, result)
	items, _ := body["vouchers"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected exactly the bridged voucher, got %#v", items)
	}
	first, _ := items[0].(map[string]any)
	if first["voucherId"] != bridged.ID {
		t.Fatalf("expected bridged voucher %s, got %#v", bridged.ID, first)
	}
}

func TestGetReadsBenefitBridgeVoucher(t *testing.T) {
	s := New()
	bridged := testBridgedVoucher()
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{bridged.ID: bridged}})

	result := s.Handle(envelope("GetVoucher", map[string]any{"voucherId": bridged.ID}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("get: %#v", result)
	}
	body := payload(t, result)
	v, _ := body["voucher"].(map[string]any)
	if v["voucherId"] != bridged.ID {
		t.Fatalf("expected %s, got %#v", bridged.ID, v)
	}
}

func TestGetBenefitBridgeVoucherNotFound(t *testing.T) {
	s := New()
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{}})
	result := s.Handle(envelope("GetVoucher", map[string]any{"voucherId": BenefitBridgePrefix + "does_not_exist"}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_NOT_FOUND" {
		t.Fatalf("expected VOUCHER_NOT_FOUND, got %#v", result)
	}
}

// BENEFIT-REDEEM-002 / bridge write-path gate: none of the self-tap
// redemption actions may operate on a benefit-bridged voucher, because
// there is no real merchant party in this consumer-facing flow. See the
// doc comment on BenefitBridgePrefix for the full reasoning.
func TestOpenRedemptionRejectsBenefitBridgeVoucher(t *testing.T) {
	s := New()
	bridged := testBridgedVoucher()
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{bridged.ID: bridged}})
	result := s.Handle(envelope("OpenVoucherRedemption", map[string]any{"voucherId": bridged.ID}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE" {
		t.Fatalf("expected VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE, got %#v", result)
	}
}

func TestSettleRejectsBenefitBridgeVoucher(t *testing.T) {
	s := New()
	bridged := testBridgedVoucher()
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{bridged.ID: bridged}})
	result := s.Handle(envelope("SettleVoucher", map[string]any{"voucherId": bridged.ID}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE" {
		t.Fatalf("expected VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE, got %#v", result)
	}
}

// GetVoucherSettlement is a pure status read (not a self-tap action), so it
// is safe to bridge through — a benefit claim is already AVAILABLE or
// SETTLED (RedeemBenefit redeems+settles atomically), never a
// half-finished "redeemed but not settled" state.
func TestSettlementReadsThroughBenefitBridge(t *testing.T) {
	s := New()
	bridged := testBridgedVoucher()
	bridged.Status = "SETTLED"
	s.SetBenefitBridge(&stubBenefitBridge{wallet: map[string]Voucher{bridged.ID: bridged}})
	result := s.Handle(envelope("GetVoucherSettlement", map[string]any{"voucherId": bridged.ID}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("settlement: %#v", result)
	}
	if result.Aggregate == nil || result.Aggregate.State != "SETTLED" {
		t.Fatalf("expected SETTLED, got %#v", result.Aggregate)
	}
}
