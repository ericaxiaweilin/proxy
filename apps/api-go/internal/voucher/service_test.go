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

// seedTestVoucher inserts a single AVAILABLE voucher directly into the
// service's in-memory store. VOUCHER-DEFAULTS-001 (2026-09-20): ensureDefaults
// used to hand every actor these same 3 vouchers unconditionally and for
// free — no merchant agreement, no campaign, no eligibility check. That
// unconditional grant was itself the compliance problem, so ensureDefaults
// is now a no-op (see service.go) and tests seed the voucher they need
// directly, the same way a real merchant-authorized benefit claim would
// populate the wallet in production.
func seedTestVoucher(s *Service, actorID string, v Voucher) {
	s.vouchers[s.key(actorID, v.ID)] = &v
}

func testCoffeeVoucher() Voucher {
	return Voucher{
		ID: "CV2508210001", Family: Coffee, DisplayValue: 50000, Currency: "VND",
		ScopeName: "Cafe A", ScopeDetail: "Bắc Ninh", ValidFrom: "2026-08-21", ValidUntil: "2026-08-31",
		RedeemTimeWindow: "14:00 – 18:00", MinimumSpend: "无", PerPersonLimit: 1,
		Status: "AVAILABLE", IssuerLabel: "Cafe A", SettlementValue: 30000,
		Funding: Funding{Proxy: 10000, Creator: 10000, Merchant: 10000}, Version: 1,
	}
}

func TestRedemptionAndSettlementAreSeparateFacts(t *testing.T) {
	s := New()
	now := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	s.clock = func() time.Time { return now }
	seedTestVoucher(s, "u1", testCoffeeVoucher())
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
	seedTestVoucher(s, "u1", testCoffeeVoucher())
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
	seedTestVoucher(s, "u1", testCoffeeVoucher())
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

// VOUCHER-CONFIRM-001: the redemption receipt used to claim
// "evidenceStatus": "MERCHANT_CONFIRMED" even though this command is called
// by the same consumer actor who opened the redemption — no merchant ever
// verifies anything. This test locks in the honest label so a real
// merchant-verified evidenceStatus can never be silently reintroduced as a
// false claim.
func TestConfirmRedemptionReceiptDoesNotClaimMerchantConfirmation(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	seedTestVoucher(s, "u1", testCoffeeVoucher())
	opened := s.Handle(envelope("OpenVoucherRedemption", map[string]any{"voucherId": "CV2508210001"}))
	redemption := payload(t, opened)["redemption"].(map[string]any)
	confirmed := s.Handle(envelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": redemption["redemptionId"]}))
	receipt, ok := payload(t, confirmed)["receipt"].(map[string]any)
	if !ok {
		t.Fatalf("receipt missing in payload: %s", confirmed.OperationRef)
	}
	if receipt["evidenceStatus"] == "MERCHANT_CONFIRMED" {
		t.Fatalf("receipt must not falsely claim merchant confirmation, got %#v", receipt)
	}
	if receipt["evidenceStatus"] != "SELF_REPORTED_NO_MERCHANT_VERIFICATION" {
		t.Fatalf("expected an honest self-reported evidenceStatus, got %#v", receipt["evidenceStatus"])
	}
}

// VOUCHER-FRAUD-001: MaxPerPerson/IsFraudBatch (fraud.go) were declared and
// never called anywhere, so neither guard actually did anything. These tests
// prove CreateVoucher now enforces both.
func TestCreateVoucherRejectsFraudulentBatchSize(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	result := s.Handle(envelope("CreateVoucher", map[string]any{
		"family": "COFFEE", "displayValue": 50000, "quantity": MaxBatchClaim + 1,
		"scopeName": "Cafe A", "validFrom": "2026-08-21", "validUntil": "2026-08-31",
	}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_BATCH_TOO_LARGE" {
		t.Fatalf("expected VOUCHER_BATCH_TOO_LARGE, got %#v", result)
	}
}

func TestCreateVoucherRejectsExcessivePerPersonLimit(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	result := s.Handle(envelope("CreateVoucher", map[string]any{
		"family": "COFFEE", "displayValue": 50000, "quantity": 5, "perPersonLimit": MaxPerPerson + 1,
		"scopeName": "Cafe A", "validFrom": "2026-08-21", "validUntil": "2026-08-31",
	}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_PER_PERSON_LIMIT_TOO_HIGH" {
		t.Fatalf("expected VOUCHER_PER_PERSON_LIMIT_TOO_HIGH, got %#v", result)
	}
}

// VOUCHER-DEFAULTS-001: a brand-new actor's wallet must come back empty,
// not pre-loaded with 3 free vouchers nobody funded. This is the regression
// test for the compliance fix — see the doc comment on ensureDefaults.
func TestNewActorWalletStartsEmpty(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	list := s.Handle(envelope("ListVouchers", map[string]any{}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %#v", list)
	}
	body := payload(t, list)
	vouchers, _ := body["vouchers"].([]any)
	if len(vouchers) != 0 {
		t.Fatalf("expected an empty wallet for a never-seen actor, got %#v", vouchers)
	}
}

func TestCreateVoucherAcceptsSaneBatchAndLimit(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC) }
	result := s.Handle(envelope("CreateVoucher", map[string]any{
		"family": "COFFEE", "displayValue": 50000, "quantity": MaxBatchClaim, "perPersonLimit": MaxPerPerson,
		"scopeName": "Cafe A", "validFrom": "2026-08-21", "validUntil": "2026-08-31",
	}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED at the boundary, got %#v", result)
	}
}

func stampedIssueEnvelope(merchantID, merchantName string, payload map[string]any) command.Envelope {
	e := envelope("IssueVoucherDefinition", payload)
	if merchantID != "" {
		e.AuthContext = map[string]any{"merchantID": merchantID, "merchantName": merchantName}
	}
	return e
}

func validDefinitionPayload() map[string]any {
	return map[string]any{
		"family": "COFFEE", "faceValueMinor": 50000, "scopeName": "木光咖啡",
		"validFrom": "2026-09-20", "validUntil": "2026-12-31",
		"perPersonLimit": 1, "merchantUnitCostMinor": 30000,
	}
}

// VOUCHER-ISSUE-001: 无服务端标注 = 没验过商户成员 → fail-closed。
// 注意 payload 里就算带了 merchantId 也必须被无视（service 根本不读它）。
func TestIssueDefinitionRequiresMerchantAnnotation(t *testing.T) {
	s := New()
	result := s.Handle(stampedIssueEnvelope("", "", map[string]any{
		"merchantId": "biz_forged", "family": "COFFEE", "faceValueMinor": 50000,
		"scopeName": "木光咖啡", "validFrom": "2026-09-20", "validUntil": "2026-12-31",
		"perPersonLimit": 1, "merchantUnitCostMinor": 30000,
	}))
	if result.Error == nil || result.Error.ErrorCode != "VOUCHER_MERCHANT_REQUIRED" {
		t.Fatalf("expected VOUCHER_MERCHANT_REQUIRED, got %#v", result)
	}
}

// VOUCHER-ISSUE-001: 归属只认标注。payload 谎称另一家商户，定义必须落在
// 验过的那家 —— 这就是 B-5 冒名洞的终态修法。
func TestIssueDefinitionStampsMerchantFromAnnotationOnly(t *testing.T) {
	s := New()
	s.clock = func() time.Time { return time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC) }
	p := validDefinitionPayload()
	p["merchantId"] = "biz_forged"
	result := s.Handle(stampedIssueEnvelope("biz_real", "木光咖啡", p))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", result)
	}
	def, _ := payload(t, result)["definition"].(map[string]any)
	if def["merchantId"] != "biz_real" || def["merchantName"] != "木光咖啡" {
		t.Fatalf("definition must carry the verified merchant, got %#v", def)
	}
	if len(s.definitions) != 1 {
		t.Fatalf("expected 1 stored definition, got %d", len(s.definitions))
	}
}

// VOUCHER-ISSUE-001: 非法发行参数全部拒绝（枚举/金额/日期倒置/限额）。
func TestIssueDefinitionRejectsInvalidPayload(t *testing.T) {
	cases := []map[string]any{
		{"family": "TEA", "faceValueMinor": 50000, "scopeName": "木光", "validFrom": "2026-09-20", "validUntil": "2026-12-31", "perPersonLimit": 1, "merchantUnitCostMinor": 0},
		{"family": "COFFEE", "faceValueMinor": 0, "scopeName": "木光", "validFrom": "2026-09-20", "validUntil": "2026-12-31", "perPersonLimit": 1, "merchantUnitCostMinor": 0},
		{"family": "COFFEE", "faceValueMinor": 50000, "scopeName": "木光", "validFrom": "2026-12-31", "validUntil": "2026-09-20", "perPersonLimit": 1, "merchantUnitCostMinor": 0},
		{"family": "COFFEE", "faceValueMinor": 50000, "scopeName": "", "validFrom": "2026-09-20", "validUntil": "2026-12-31", "perPersonLimit": 0, "merchantUnitCostMinor": -1},
	}
	for i, p := range cases {
		s := New()
		result := s.Handle(stampedIssueEnvelope("biz_real", "木光咖啡", p))
		if result.Error == nil || result.Error.ErrorCode != "INVALID_DEFINITION" {
			t.Fatalf("case %d: expected INVALID_DEFINITION, got %#v", i, result)
		}
		if len(s.definitions) != 0 {
			t.Fatalf("case %d: rejected definition must not be stored", i)
		}
	}
}
