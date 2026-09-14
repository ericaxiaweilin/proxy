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
