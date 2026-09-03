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
