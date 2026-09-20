package postgres

import (
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/voucher"
)

func decodeVoucherBody(t *testing.T, result command.Result) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &value); err != nil {
		t.Fatalf("decode OperationRef: %v (raw=%s)", err, result.OperationRef)
	}
	return value
}

// TestBenefitBridgeShowsRealClaimInWallet is the end-to-end proof for
// VOUCHER-DEFAULTS-001's replacement: build one real, merchant-owned
// benefit.Campaign against Postgres (the same production wiring as
// cmd/api/main.go — postgres.NewBenefitRepository), claim it for a test
// user, and confirm voucher.Service's wallet (via voucher.NewBenefitBridge)
// actually shows that real claim instead of the free defaults this
// package no longer mints.
func TestBenefitBridgeShowsRealClaimInWallet(t *testing.T) {
	pool := testPool(t)
	benefitRepo := NewBenefitRepository(pool)
	benefitSvc := benefit.NewService(benefitRepo)
	benefitSvc.WithMerchantVerifier(allowAllMerchantVerifier{})

	voucherSvc := voucher.New()
	voucherSvc.SetBenefitBridge(voucher.NewBenefitBridge(benefitSvc))

	merchantID := "merchant_bridge_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	userID := "user_bridge_" + strconv.FormatInt(time.Now().UnixNano(), 10)

	campResult := benefitSvc.Handle(benefitEnvelope("CreateCampaign", map[string]any{
		"type": "MERCHANT_CAMPAIGN", "ownerType": "merchant", "ownerId": merchantID,
		"goal": "Bridge integration test coffee", "budgetMinor": 500000, "currency": "VND",
		"startAt": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
		"endAt":   time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
	}, merchantID))
	if campResult.Outcome != "ACCEPTED" {
		t.Fatalf("create campaign: %s: %v", campResult.Outcome, campResult.Error)
	}
	campaignID := campResult.Aggregate.ID
	t.Cleanup(func() { cleanupBenefitCampaign(t, pool, campaignID) })

	now := time.Now().UTC()
	def := &benefit.BenefitDefinition{
		ID: "ben_bridge_" + strconv.FormatInt(now.UnixNano(), 10), CampaignID: campaignID,
		Kind: benefit.FreeDrink, Label: "Bridge Free Coffee", RetailValueMinor: 45000, UserPayMinor: 0,
		Currency: "VND", CreatedAt: now,
	}
	if err := benefitRepo.CreateBenefitDefinition(t.Context(), def); err != nil {
		t.Fatalf("create benefit definition: %v", err)
	}
	if err := benefitRepo.UpsertCapacityPool(t.Context(), &benefit.CapacityPool{
		ID: "pool_bridge_" + strconv.FormatInt(now.UnixNano(), 10), CampaignID: campaignID,
		TotalCapacity: 10, CreatedAt: now, UpdatedAt: now, Version: 1,
	}); err != nil {
		t.Fatalf("upsert capacity pool: %v", err)
	}
	if r := benefitSvc.Handle(benefitEnvelope("ActivateCampaign", map[string]any{"campaignId": campaignID}, merchantID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("activate campaign: %s: %v", r.Outcome, r.Error)
	}
	claimResult := benefitSvc.Handle(benefitEnvelope("ClaimBenefit", map[string]any{"campaignId": campaignID, "benefitId": def.ID}, userID))
	if claimResult.Outcome != "ACCEPTED" {
		t.Fatalf("claim benefit: %s: %v", claimResult.Outcome, claimResult.Error)
	}
	claimID := claimResult.Aggregate.ID
	bridgedVoucherID := voucher.BenefitBridgePrefix + claimID

	// 1. ListVouchers must show the real claim, correctly projected.
	listResult := voucherSvc.Handle(voucherEnvelope("ListVouchers", map[string]any{}, userID))
	if listResult.Outcome != "ACCEPTED" {
		t.Fatalf("list vouchers: %s: %v", listResult.Outcome, listResult.Error)
	}
	body := decodeVoucherBody(t, listResult)
	items, _ := body["vouchers"].([]any)
	var found map[string]any
	for _, raw := range items {
		v, _ := raw.(map[string]any)
		if v["voucherId"] == bridgedVoucherID {
			found = v
			break
		}
	}
	if found == nil {
		t.Fatalf("expected wallet to contain %s, got %#v", bridgedVoucherID, items)
	}
	if found["status"] != "AVAILABLE" {
		t.Fatalf("expected AVAILABLE (claimed, not yet redeemed), got %#v", found["status"])
	}
	if found["displayValue"] != float64(45000) {
		t.Fatalf("expected displayValue 45000 from the real BenefitDefinition, got %#v", found["displayValue"])
	}

	// 2. GetVoucher on the bridged ID must resolve the same projection.
	getResult := voucherSvc.Handle(voucherEnvelope("GetVoucher", map[string]any{"voucherId": bridgedVoucherID}, userID))
	if getResult.Outcome != "ACCEPTED" {
		t.Fatalf("get voucher: %s: %v", getResult.Outcome, getResult.Error)
	}

	// 3. A wallet action needing a real merchant party must be honestly
	// unavailable, not silently faked (see BenefitBridgePrefix doc comment).
	openResult := voucherSvc.Handle(voucherEnvelope("OpenVoucherRedemption", map[string]any{"voucherId": bridgedVoucherID}, userID))
	if openResult.Error == nil || openResult.Error.ErrorCode != "VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE" {
		t.Fatalf("expected VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE, got %#v", openResult)
	}

	// 4. Another user must never see this claim in their own wallet.
	otherUser := "user_bridge_other_" + strconv.FormatInt(now.UnixNano(), 10)
	otherList := voucherSvc.Handle(voucherEnvelope("ListVouchers", map[string]any{}, otherUser))
	otherBody := decodeVoucherBody(t, otherList)
	otherItems, _ := otherBody["vouchers"].([]any)
	for _, raw := range otherItems {
		v, _ := raw.(map[string]any)
		if v["voucherId"] == bridgedVoucherID {
			t.Fatalf("another user's wallet must not see this claim: %#v", v)
		}
	}
}
