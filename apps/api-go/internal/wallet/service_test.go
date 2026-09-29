package wallet

import (
	"context"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_wallet_test",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Wallet", ID: "user_001"},
		IdempotencyKey: "wallet_test_key",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_wallet_1",
		RequestedAt:    "2026-09-29T00:00:00Z",
		Payload:        payload,
	}
}

func TestGetWalletStartsEmptyWithCatalogs(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("GetWallet", map[string]any{}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("get: %s/%+v", r.Outcome, r.Error)
	}
	if len(RechargePackages) != 4 || len(ExchangeCatalog) != 3 {
		t.Fatalf("catalog changed: recharge=%d exchange=%d", len(RechargePackages), len(ExchangeCatalog))
	}
	// 真渠道默认全关；SIMULATED 默认也关（dev 明确打开才可用）。
	for _, p := range s.providers() {
		if p.Enabled {
			t.Fatalf("provider %s must be disabled by default", p.ID)
		}
	}
}

func TestExchangeBeansForDiamonds(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.GrantBeans(ctx, "user_001", 10, ReasonGrant, "test"); err != nil {
		t.Fatal(err)
	}
	r := s.Handle(envelopeFor("ExchangeBeans", map[string]any{"itemId": "diamonds_1"}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("exchange: %s/%+v", r.Outcome, r.Error)
	}
	balances, err := s.repository.Balances(ctx, "user_001")
	if err != nil {
		t.Fatal(err)
	}
	if balances[CurrencyBean] != 7 || balances[CurrencyDiamond] != 1 {
		t.Fatalf("balances wrong: %+v", balances)
	}
}

func TestExchangeBeansInsufficient(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("ExchangeBeans", map[string]any{"itemId": "vip_7d"}))
	if r.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INSUFFICIENT_BEANS" {
		t.Fatalf("want INSUFFICIENT_BEANS, got %+v", r.Error)
	}
}

func TestExchangeDisabledItemRejected(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.GrantBeans(ctx, "user_001", 1000, ReasonGrant, "test"); err != nil {
		t.Fatal(err)
	}
	r := s.Handle(envelopeFor("ExchangeBeans", map[string]any{"itemId": "voucher_gift"}))
	if r.Outcome != "REJECTED" {
		t.Fatalf("want REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "EXCHANGE_UNAVAILABLE" {
		t.Fatalf("want EXCHANGE_UNAVAILABLE, got %+v", r.Error)
	}
}

func TestConfirmRechargeSimulatedGated(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("ConfirmRecharge", map[string]any{"packageId": "r120", "provider": "SIMULATED"}))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "PROVIDER_UNCONFIGURED" {
		t.Fatalf("simulated must be closed by default: %s/%+v", r.Outcome, r.Error)
	}
	s.SetSimulatedRecharge(true)
	r = s.Handle(envelopeFor("ConfirmRecharge", map[string]any{"packageId": "r120", "provider": "SIMULATED"}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("simulated open: %s/%+v", r.Outcome, r.Error)
	}
	balances, err := s.repository.Balances(context.Background(), "user_001")
	if err != nil {
		t.Fatal(err)
	}
	if balances[CurrencyDiamond] != 140 {
		t.Fatalf("120+20 bonus expected, got %+v", balances)
	}
}

func TestConfirmRechargeRealProvidersUnconfigured(t *testing.T) {
	s := New()
	s.SetSimulatedRecharge(true)
	for _, provider := range []string{"MOMO", "ZALOPAY", "BANKCARD", "IAP"} {
		r := s.Handle(envelopeFor("ConfirmRecharge", map[string]any{"packageId": "r120", "provider": provider}))
		if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "PROVIDER_UNCONFIGURED" {
			t.Fatalf("%s: want PROVIDER_UNCONFIGURED, got %s/%+v", provider, r.Outcome, r.Error)
		}
	}
}

func TestVipExtendedOnRepeatExchange(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.GrantBeans(ctx, "user_001", 20000, ReasonGrant, "test"); err != nil {
		t.Fatal(err)
	}
	first := s.Handle(envelopeFor("ExchangeBeans", map[string]any{"itemId": "vip_7d"}))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first: %s/%+v", first.Outcome, first.Error)
	}
	g1, _ := s.repository.GetVipGrant(ctx, "user_001")
	second := s.Handle(envelopeFor("ExchangeBeans", map[string]any{"itemId": "vip_7d"}))
	if second.Outcome != "ACCEPTED" {
		t.Fatalf("second: %s/%+v", second.Outcome, second.Error)
	}
	g2, _ := s.repository.GetVipGrant(ctx, "user_001")
	if g1 == nil || g2 == nil || !g2.ExpiresAt.After(g1.ExpiresAt) {
		t.Fatalf("vip not extended: %+v -> %+v", g1, g2)
	}
}
