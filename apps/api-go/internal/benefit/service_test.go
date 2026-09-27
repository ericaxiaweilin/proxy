package benefit

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

type testClock struct {
	now time.Time
}

func (c *testClock) Now() time.Time { return c.now }

// allowAllMerchantVerifier is a test-only MerchantVerifier stand-in for
// tests that aren't exercising BENEFIT-REDEEM-002 itself — it always
// confirms the caller's membership, so existing redemption-flow assertions
// keep testing what they were written to test instead of tripping over
// the new fail-closed identity gate.
type allowAllMerchantVerifier struct{}

func (allowAllMerchantVerifier) MerchantRedemptionIdentity(ctx context.Context, businessID, userID string) (string, bool) {
	return "verified", true
}

// denyMerchantVerifier is a test-only MerchantVerifier that rejects every
// caller — used to prove the fail-closed path (BENEFIT-REDEEM-002) actually
// blocks a caller who has no real role at the merchant, even when they
// supply the merchant's real, correct ID.
type denyMerchantVerifier struct{}

func (denyMerchantVerifier) MerchantRedemptionIdentity(ctx context.Context, businessID, userID string) (string, bool) {
	return "", false
}

func TestCreateCampaign(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)

	ctx := context.Background()
	e := command.Envelope{
		Actor:    command.Actor{Type: "MERCHANT", ID: "merchant_1"},
		Payload: map[string]any{
			"type":        "SCENE_IGNITION",
			"ownerType":   "merchant",
			"ownerId":     "merchant_1",
			"sceneIds":    []string{"scene_1"},
			"goal":        "Ignite Three Beans coffee scene",
			"budgetMinor": 5000000,
			"currency":    "VND",
			"startAt":     "2026-09-03T00:00:00Z",
			"endAt":       "2026-09-30T23:59:59Z",
		},
	}

	result := svc.HandleCreateCampaign(ctx, e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s: %s", result.Outcome, result.Error)
	}
	if result.Aggregate == nil || result.Aggregate.ID == "" {
		t.Fatal("expected campaign ID")
	}
}

func TestClaimAndRedeemBenefit(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	svc.WithMerchantVerifier(allowAllMerchantVerifier{})
	ctx := context.Background()

	// Create campaign
	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "merchant_1"},
		Payload: map[string]any{
			"type":        "SCENE_IGNITION",
			"ownerType":   "merchant",
			"ownerId":     "merchant_1",
			"sceneIds":    []string{"scene_1"},
			"budgetMinor": 5000000,
			"currency":    "VND",
			"startAt":     "2026-09-03T00:00:00Z",
			"endAt":       "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID

	// Create benefit definition
	benefit := &BenefitDefinition{
		ID:               "ben_1",
		CampaignID:       campaignID,
		Kind:             FreeDrink,
		Label:            "Free Coffee",
		RetailValueMinor: 45000,
		UserPayMinor:     0,
		Currency:         "VND",
		CreatedAt:        clock.Now(),
	}
	_ = repo.CreateBenefitDefinition(ctx, benefit)

	// Create capacity pool
	pool := &CapacityPool{
		ID:            "pool_1",
		CampaignID:    campaignID,
		TotalCapacity: 50,
		Claimed:       0,
		Redeemed:      0,
		CreatedAt:     clock.Now(),
		UpdatedAt:     clock.Now(),
		Version:       1,
	}
	_ = repo.UpsertCapacityPool(ctx, pool)

	// Activate campaign
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{
		Actor:  command.Actor{Type: "MERCHANT", ID: "merchant_1"},
		Payload: map[string]any{"campaignId": campaignID},
	})

	// Claim benefit
	claimResult := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "INDIVIDUAL", ID: "user_1"},
		Payload: map[string]any{
			"campaignId": campaignID,
			"benefitId":  "ben_1",
		},
	})
	if claimResult.Outcome != "ACCEPTED" {
		t.Fatalf("claim expected ACCEPTED, got %s: %s", claimResult.Outcome, claimResult.Error)
	}
	claimToken := claimResult.Body["claimToken"].(string)

	// Redeem benefit
	redeemResult := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_1"},
		Payload: map[string]any{
			"claimToken":     claimToken,
			"merchantId":     "merchant_1",
			"staffId":        "staff_1",
			"evidenceType":   "MERCHANT_SCAN",
			"idempotencyKey": "idem_123",
		},
	})
	if redeemResult.Outcome != "ACCEPTED" {
		t.Fatalf("redeem expected ACCEPTED, got %s: %s", redeemResult.Outcome, redeemResult.Error)
	}

	// Verify idempotency
	redeemResult2 := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_1"},
		Payload: map[string]any{
			"claimToken":     claimToken,
			"merchantId":     "merchant_1",
			"staffId":        "staff_1",
			"evidenceType":   "MERCHANT_SCAN",
			"idempotencyKey": "idem_123",
		},
	})
	if redeemResult2.Body == nil {
		t.Fatal("expected idempotent response with redemption body")
	}
}

// BENEFIT-ELIG-001: max_redemptions 必须真的生效 —— 而且是通过**服务**生效，
// 不是只在引擎的单元测试里生效。
//
// 此前 claim / redeem 两条路径调 EligibilityEngine 时都没填 TotalRedemptions，
// 它恒为 0，于是 `0 >= N` 永不成立：活动方写了「每人最多 N 次」，
// 系统照发不误。引擎本身是对的（eligibility_test.go 用真实信号测过），
// 错的是**调用方没喂数据** —— 而引擎的单测给了虚假的安全感，
// 因为它从不经过服务这条路径。
func TestMaxRedemptionsIsEnforcedThroughTheService(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	svc.WithMerchantVerifier(allowAllMerchantVerifier{})
	ctx := context.Background()

	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "m1",
			"budgetMinor": 100000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID

	benefit := &BenefitDefinition{ID: "b1", CampaignID: campaignID, Kind: FreeDrink, Label: "Coffee", RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND", CreatedAt: clock.Now()}
	_ = repo.CreateBenefitDefinition(ctx, benefit)
	// 容量给足，确保下面被拒是资格门拦的，不是容量拦的。
	pool := &CapacityPool{ID: "p1", CampaignID: campaignID, TotalCapacity: 50, Claimed: 0, Redeemed: 0, CreatedAt: clock.Now(), UpdatedAt: clock.Now(), Version: 1}
	_ = repo.UpsertCapacityPool(ctx, pool)
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{Actor: command.Actor{Type: "MERCHANT", ID: "m1"}, Payload: map[string]any{"campaignId": campaignID}})

	// 每人最多 1 次。
	_ = repo.UpsertCampaignAudience(ctx, &CampaignAudience{
		CampaignID:     campaignID,
		LifecyclePreds: map[string]any{"max_redemptions": float64(1)},
	})

	// 第一次：领 + 核销，都该成功。
	r1 := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if r1.Outcome != "ACCEPTED" {
		t.Fatalf("first claim should succeed, got %s: %v", r1.Outcome, r1.Error)
	}
	token := r1.Body["claimToken"].(string)
	redeem := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_1"},
		Payload: map[string]any{
			"claimToken": token, "merchantId": "m1", "staffId": "staff_1",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_1",
		},
	})
	if redeem.Outcome != "ACCEPTED" {
		t.Fatalf("first redeem should succeed, got %s: %v", redeem.Outcome, redeem.Error)
	}

	// 第二次：**必须**被资格门拦住（已核销 1 次 >= 上限 1）。
	r2 := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if r2.Outcome != "REJECTED" {
		t.Fatalf("second claim must be blocked by max_redemptions, got %s", r2.Outcome)
	}
	if r2.Error == nil || r2.Error.ErrorCode != "ELIGIBILITY_FAILED" {
		t.Fatalf("expected ELIGIBILITY_FAILED, got %v", r2.Error)
	}
	if got := r2.Error.SafeDetails["reasonCode"]; got != "MAX_REDEMPTIONS_REACHED" {
		t.Fatalf("expected MAX_REDEMPTIONS_REACHED, got %v", got)
	}
}

// BENEFIT-REDEEM-001: 别的商家不能把这笔核销记到自己名下。
//
// p.MerchantID 由调用方传入，直接写进 Redemption 并据此结算。缺少归属校验时，
// 任何商家扫到别人的券码都能把核销记成自己的 —— 钱也就结给了他。
func TestRedeemRequiresTheCampaignOwner(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	svc.WithMerchantVerifier(allowAllMerchantVerifier{})
	ctx := context.Background()

	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "owner_1",
			"budgetMinor": 100000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID
	_ = repo.CreateBenefitDefinition(ctx, &BenefitDefinition{ID: "b1", CampaignID: campaignID, Kind: FreeDrink, Label: "Coffee", RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND", CreatedAt: clock.Now()})
	_ = repo.UpsertCapacityPool(ctx, &CapacityPool{ID: "p1", CampaignID: campaignID, TotalCapacity: 10, CreatedAt: clock.Now(), UpdatedAt: clock.Now(), Version: 1})
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"}, Payload: map[string]any{"campaignId": campaignID}})

	claim := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim.Outcome != "ACCEPTED" {
		t.Fatalf("claim should succeed, got %s: %v", claim.Outcome, claim.Error)
	}
	token := claim.Body["claimToken"].(string)

	// 归属商家的核销必须成功。
	ok := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_1"},
		Payload: map[string]any{
			"claimToken": token, "merchantId": "owner_1", "staffId": "staff_1",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_owner",
		},
	})
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("own merchant must be able to redeem, got %s: %v", ok.Outcome, ok.Error)
	}

	// 换个商家再来一次：券已被核销，先领一张新的，再用别人的 merchantId 核销。
	claim2 := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u2"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim2.Outcome != "ACCEPTED" {
		t.Fatalf("second claim should succeed, got %s: %v", claim2.Outcome, claim2.Error)
	}
	token2 := claim2.Body["claimToken"].(string)
	intruder := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_2"},
		Payload: map[string]any{
			"claimToken": token2, "merchantId": "other_merchant", "staffId": "staff_2",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_intruder",
		},
	})
	if intruder.Outcome != "REJECTED" {
		t.Fatalf("another merchant must not redeem this campaign's claim, got %s", intruder.Outcome)
	}
	if intruder.Error == nil || intruder.Error.ErrorCode != "MERCHANT_NOT_CAMPAIGN_OWNER" {
		t.Fatalf("expected MERCHANT_NOT_CAMPAIGN_OWNER, got %v", intruder.Error)
	}
}

// BENEFIT-REDEEM-002: the MERCHANT_NOT_CAMPAIGN_OWNER check above only
// catches a merchantId that doesn't belong to this campaign. It never
// verified that the caller (e.Actor.ID) actually holds a role at the
// merchant they claim to be acting for — a consumer who knows the real,
// correct merchantId (it's not a secret; it's on every claim) could
// self-confirm their own redemption by supplying it. This test proves
// the fix: a caller with no real membership at the campaign's own
// merchant is rejected even though the merchantId they supplied is
// genuinely correct.
func TestRedeemRejectsCallerWithoutMerchantMembership(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	svc.WithMerchantVerifier(denyMerchantVerifier{})
	ctx := context.Background()

	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "owner_1",
			"budgetMinor": 100000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID
	_ = repo.CreateBenefitDefinition(ctx, &BenefitDefinition{ID: "b1", CampaignID: campaignID, Kind: FreeDrink, Label: "Coffee", RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND", CreatedAt: clock.Now()})
	_ = repo.UpsertCapacityPool(ctx, &CapacityPool{ID: "p1", CampaignID: campaignID, TotalCapacity: 10, CreatedAt: clock.Now(), UpdatedAt: clock.Now(), Version: 1})
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"}, Payload: map[string]any{"campaignId": campaignID}})

	claim := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim.Outcome != "ACCEPTED" {
		t.Fatalf("claim should succeed, got %s: %v", claim.Outcome, claim.Error)
	}
	token := claim.Body["claimToken"].(string)

	// The consumer supplies the campaign's real, correct merchantId
	// ("owner_1") but is not actually a member of that business.
	forbidden := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{
			"claimToken": token, "merchantId": "owner_1", "staffId": "u1",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_self_confirm",
		},
	})
	if forbidden.Outcome != "REJECTED" {
		t.Fatalf("caller with no merchant membership must not self-confirm redemption, got %s", forbidden.Outcome)
	}
	if forbidden.Error == nil || forbidden.Error.ErrorCode != "MERCHANT_FORBIDDEN" {
		t.Fatalf("expected MERCHANT_FORBIDDEN, got %v", forbidden.Error)
	}
}

// BENEFIT-REDEEM-002: fail closed, not open. A merchant-owned campaign's
// redemption must be rejected — never silently allowed — if the service
// was never wired with a MerchantVerifier at all (a deploy/config bug),
// so a missing verifier can't quietly degrade into "anyone can redeem."
func TestRedeemFailsClosedWithoutMerchantVerifierConfigured(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock) // no WithMerchantVerifier call
	ctx := context.Background()

	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "owner_1",
			"budgetMinor": 100000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID
	_ = repo.CreateBenefitDefinition(ctx, &BenefitDefinition{ID: "b1", CampaignID: campaignID, Kind: FreeDrink, Label: "Coffee", RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND", CreatedAt: clock.Now()})
	_ = repo.UpsertCapacityPool(ctx, &CapacityPool{ID: "p1", CampaignID: campaignID, TotalCapacity: 10, CreatedAt: clock.Now(), UpdatedAt: clock.Now(), Version: 1})
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{Actor: command.Actor{Type: "MERCHANT", ID: "owner_1"}, Payload: map[string]any{"campaignId": campaignID}})

	claim := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim.Outcome != "ACCEPTED" {
		t.Fatalf("claim should succeed, got %s: %v", claim.Outcome, claim.Error)
	}
	token := claim.Body["claimToken"].(string)

	unavailable := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "staff_1"},
		Payload: map[string]any{
			"claimToken": token, "merchantId": "owner_1", "staffId": "staff_1",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_no_verifier",
		},
	})
	if unavailable.Outcome != "REJECTED" {
		t.Fatalf("redemption must fail closed with no verifier configured, got %s", unavailable.Outcome)
	}
	if unavailable.Error == nil || unavailable.Error.ErrorCode != "MERCHANT_VERIFIER_UNAVAILABLE" {
		t.Fatalf("expected MERCHANT_VERIFIER_UNAVAILABLE, got %v", unavailable.Error)
	}
}

func TestCapacityExhausted(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	ctx := context.Background()

	// Setup campaign with capacity 1
	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "m1",
			"budgetMinor": 100000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID

	benefit := &BenefitDefinition{ID: "b1", CampaignID: campaignID, Kind: FreeDrink, Label: "Coffee", RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND", CreatedAt: clock.Now()}
	_ = repo.CreateBenefitDefinition(ctx, benefit)

	pool := &CapacityPool{ID: "p1", CampaignID: campaignID, TotalCapacity: 1, Claimed: 0, Redeemed: 0, CreatedAt: clock.Now(), UpdatedAt: clock.Now(), Version: 1}
	_ = repo.UpsertCapacityPool(ctx, pool)

	_ = svc.HandleActivateCampaign(ctx, command.Envelope{Actor: command.Actor{Type: "MERCHANT", ID: "m1"}, Payload: map[string]any{"campaignId": campaignID}})

	// First claim succeeds
	r1 := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if r1.Outcome != "ACCEPTED" {
		t.Fatalf("first claim should succeed, got %s", r1.Outcome)
	}

	// Second claim fails (capacity exhausted)
	r2 := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u2"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if r2.Outcome != "REJECTED" {
		t.Fatalf("second claim should be rejected, got %s", r2.Outcome)
	}
}

func TestAllocateAndList(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	ctx := context.Background()

	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "PROXY", ID: "proxy"},
		Payload: map[string]any{
			"type": "CREATOR_SEED", "ownerType": "proxy", "ownerId": "proxy",
			"budgetMinor": 1000000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID

	// Allocate to creator
	allocResult := svc.HandleAllocateBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "PROXY", ID: "proxy"},
		Payload: map[string]any{
			"campaignId":      campaignID,
			"benefitId":       "ben_1",
			"distributorType": "CREATOR",
			"distributorId":   "creator_mai",
			"quota":           20,
		},
	})
	if allocResult.Outcome != "ACCEPTED" {
		t.Fatalf("allocate expected ACCEPTED, got %s: %s", allocResult.Outcome, allocResult.Error)
	}

	// List allocations
	allocs, err := repo.ListAllocationsByDistributor(ctx, DistributorCreator, "creator_mai")
	if err != nil {
		t.Fatal(err)
	}
	if len(allocs) != 1 {
		t.Fatalf("expected 1 allocation, got %d", len(allocs))
	}
	if allocs[0].Quota != 20 {
		t.Fatalf("expected quota 20, got %d", allocs[0].Quota)
	}
}

// TestEligibilityEngineWiredInClaimPath proves the eligibility
// engine actually fires inside HandleClaimBenefit / HandleRedeemBenefit.
// Before the wiring (07ec788 era) the engine was dead code; this
// test is the tripwire that fails loud if the engine is ever
// accidentally bypassed again.
func TestEligibilityEngineWiredInClaimPath(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	ctx := context.Background()

	// 1. Build a campaign + benefit + capacity pool + activate it.
	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "m1",
			"budgetMinor": 1000000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID
	_ = repo.CreateBenefitDefinition(ctx, &BenefitDefinition{
		ID: "b1", CampaignID: campaignID, Kind: FreeDrink,
		RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND",
		CreatedAt: clock.Now(),
	})
	_ = repo.UpsertCapacityPool(ctx, &CapacityPool{
		ID: "p1", CampaignID: campaignID, TotalCapacity: 5, Version: 1,
		CreatedAt: clock.Now(), UpdatedAt: clock.Now(),
	})
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{
		Actor:  command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{"campaignId": campaignID},
	})

	// 2. Replace the engine with a stub that always rejects. If the
	// wiring is in place the claim must be rejected.
	svc.WithEligibility(&stubEngine{eligible: false, reason: "RISK_FLAGGED"})
	claimResult := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claimResult.Outcome != "REJECTED" {
		t.Fatalf("eligibility should block claim, got %s", claimResult.Outcome)
	}
	if claimResult.Error == nil || claimResult.Error.ErrorCode != "ELIGIBILITY_FAILED" {
		t.Fatalf("expected ELIGIBILITY_FAILED, got %+v", claimResult.Error)
	}
	// The reasonCode is propagated through Error.SafeDetails for clients.
	if claimResult.Error == nil || claimResult.Error.SafeDetails["reasonCode"] != "RISK_FLAGGED" {
		t.Fatalf("expected reasonCode=RISK_FLAGGED in SafeDetails, got %+v", claimResult.Error)
	}

	// 3. Switch the stub to eligible=true and confirm the claim
	// succeeds. This proves the engine is not just blindly rejecting.
	svc.WithEligibility(&stubEngine{eligible: true})
	okResult := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "INDIVIDUAL", ID: "u2"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if okResult.Outcome != "ACCEPTED" {
		t.Fatalf("eligible=true should allow claim, got %s: %+v", okResult.Outcome, okResult.Error)
	}
}

// stubEngine is a test-only EligibilityEngine replacement.
type stubEngine struct {
	eligible bool
	reason   string
}

func (s *stubEngine) Evaluate(ctx context.Context, ec *EligibilityContext) (*EligibilityResult, error) {
	return &EligibilityResult{Eligible: s.eligible, ReasonCode: s.reason}, nil
}

// TestEligibilityEngineWiredInRedeemPath proves the same gate
// runs at redemption time. A claim made when the user was eligible
// can be blocked at redemption when the signal flips (lifecycle
// rules, max_redemptions reached, etc.).
func TestEligibilityEngineWiredInRedeemPath(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	svc.WithMerchantVerifier(allowAllMerchantVerifier{})
	ctx := context.Background()

	// Build + claim a benefit (default engine is open-campaign).
	campResult := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "m1",
			"budgetMinor": 1000000, "currency": "VND",
			"startAt": "2026-09-03T00:00:00Z", "endAt": "2026-09-30T23:59:59Z",
		},
	})
	campaignID := campResult.Aggregate.ID
	_ = repo.CreateBenefitDefinition(ctx, &BenefitDefinition{
		ID: "b1", CampaignID: campaignID, Kind: FreeDrink,
		RetailValueMinor: 45000, UserPayMinor: 0, Currency: "VND",
		CreatedAt: clock.Now(),
	})
	_ = repo.UpsertCapacityPool(ctx, &CapacityPool{
		ID: "p1", CampaignID: campaignID, TotalCapacity: 5, Version: 1,
		CreatedAt: clock.Now(), UpdatedAt: clock.Now(),
	})
	_ = svc.HandleActivateCampaign(ctx, command.Envelope{
		Actor:  command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{"campaignId": campaignID},
	})
	claim := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim.Outcome != "ACCEPTED" {
		t.Fatalf("claim expected ACCEPTED, got %s", claim.Outcome)
	}
	token := claim.Body["claimToken"].(string)

	// Now flip the engine to reject. The redemption must be blocked.
	svc.WithEligibility(&stubEngine{eligible: false, reason: "MAX_REDEMPTIONS_REACHED"})
	redeem := svc.HandleRedeemBenefit(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT_STAFF", ID: "s1"},
		Payload: map[string]any{
			"claimToken": token, "merchantId": "m1", "staffId": "s1",
			"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "k1",
		},
	})
	if redeem.Outcome != "REJECTED" {
		t.Fatalf("eligibility should block redeem, got %s", redeem.Outcome)
	}
	if redeem.Error == nil || redeem.Error.ErrorCode != "ELIGIBILITY_FAILED" {
		t.Fatalf("expected ELIGIBILITY_FAILED, got %+v", redeem.Error)
	}
}

// BENEFIT-READ-001: ListCampaigns/GetCampaign/ListClaims/GetClaim used to be
// called by the mobile client but were never registered in Supports() —
// every call rejected with BENEFIT_UNSUPPORTED. This locks in that the
// read surface actually works end to end, and that claim reads are scoped
// to the caller, not a client-supplied userID/claimId.
func TestListAndGetCampaignsAndClaims(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)}
	svc := NewServiceWithClock(repo, clock)
	ctx := context.Background()

	create := svc.HandleCreateCampaign(ctx, command.Envelope{
		Actor: command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{
			"type": "SCENE_IGNITION", "ownerType": "merchant", "ownerId": "m1",
			"sceneIds": []string{"scene_1"}, "goal": "test", "budgetMinor": 1000,
			"currency": "VND", "startAt": "2026-09-24T00:00:00Z", "endAt": "2026-09-30T00:00:00Z",
		},
	})
	if create.Outcome != "ACCEPTED" {
		t.Fatalf("create campaign expected ACCEPTED, got %s: %+v", create.Outcome, create.Error)
	}
	campaignID := create.Aggregate.ID

	if !svc.Supports("ListCampaigns") || !svc.Supports("GetCampaign") || !svc.Supports("ListClaims") || !svc.Supports("GetClaim") {
		t.Fatal("expected the four read commands to be registered in Supports()")
	}

	list := svc.HandleListCampaigns(ctx, command.Envelope{Actor: command.Actor{Type: "INDIVIDUAL", ID: "u1"}})
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("ListCampaigns expected ACCEPTED, got %s: %+v", list.Outcome, list.Error)
	}
	campaigns, _ := list.Body["campaigns"].([]Campaign)
	if len(campaigns) != 1 || campaigns[0].ID != campaignID {
		t.Fatalf("expected the created campaign back, got %+v", list.Body["campaigns"])
	}

	get := svc.HandleGetCampaign(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID},
	})
	if get.Outcome != "ACCEPTED" {
		t.Fatalf("GetCampaign expected ACCEPTED, got %s: %+v", get.Outcome, get.Error)
	}

	_ = svc.HandleActivateCampaign(ctx, command.Envelope{
		Actor:   command.Actor{Type: "MERCHANT", ID: "m1"},
		Payload: map[string]any{"campaignId": campaignID},
	})
	claim := svc.HandleClaimBenefit(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": "b1"},
	})
	if claim.Outcome != "ACCEPTED" {
		t.Fatalf("claim expected ACCEPTED, got %s: %+v", claim.Outcome, claim.Error)
	}
	claimID := claim.Aggregate.ID

	// The owning user sees their claim in ListClaims/GetClaim.
	listClaims := svc.HandleListClaims(ctx, command.Envelope{Actor: command.Actor{Type: "INDIVIDUAL", ID: "u1"}})
	if listClaims.Outcome != "ACCEPTED" {
		t.Fatalf("ListClaims expected ACCEPTED, got %s: %+v", listClaims.Outcome, listClaims.Error)
	}
	claims, _ := listClaims.Body["claims"].([]Claim)
	if len(claims) != 1 || claims[0].ID != claimID {
		t.Fatalf("expected u1's own claim back, got %+v", listClaims.Body["claims"])
	}

	getClaim := svc.HandleGetClaim(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u1"},
		Payload: map[string]any{"claimId": claimID},
	})
	if getClaim.Outcome != "ACCEPTED" {
		t.Fatalf("GetClaim expected ACCEPTED for the owner, got %s: %+v", getClaim.Outcome, getClaim.Error)
	}

	// A different user must not be able to read u1's claim by ID, and
	// ListClaims must not leak it into someone else's list either.
	otherGet := svc.HandleGetClaim(ctx, command.Envelope{
		Actor:   command.Actor{Type: "INDIVIDUAL", ID: "u2"},
		Payload: map[string]any{"claimId": claimID},
	})
	if otherGet.Outcome != "REJECTED" || otherGet.Error == nil || otherGet.Error.ErrorCode != "CLAIM_NOT_FOUND" {
		t.Fatalf("expected another user's GetClaim to reject as not-found, got %s: %+v", otherGet.Outcome, otherGet.Error)
	}
	otherList := svc.HandleListClaims(ctx, command.Envelope{Actor: command.Actor{Type: "INDIVIDUAL", ID: "u2"}})
	otherClaims, _ := otherList.Body["claims"].([]Claim)
	if len(otherClaims) != 0 {
		t.Fatalf("expected u2's claim list to be empty, got %+v", otherClaims)
	}
}
