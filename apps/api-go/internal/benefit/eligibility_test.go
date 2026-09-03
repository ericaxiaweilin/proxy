package benefit

import (
	"context"
	"testing"
	"time"
)

func TestEligibilityOpenCampaign(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	engine := NewEligibilityEngine(repo, clock)
	ctx := context.Background()

	// No audience rules = open campaign
	result, err := engine.Evaluate(ctx, &EligibilityContext{
		UserID:     "user_1",
		CampaignID: "camp_1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Eligible {
		t.Fatalf("expected eligible, got reason: %s", result.ReasonCode)
	}
	if result.ReasonCode != "OPEN_CAMPAIGN" {
		t.Fatalf("expected OPEN_CAMPAIGN, got %s", result.ReasonCode)
	}
}

func TestEligibilitySourceAllowlist(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	engine := NewEligibilityEngine(repo, clock)
	ctx := context.Background()

	// Create audience with source allowlist
	_ = repo.UpsertCampaignAudience(ctx, &CampaignAudience{
		CampaignID:       "camp_1",
		EligibilityRules: map[string]any{},
		SourceAllowlist:  []string{"CREATOR", "STAFF"},
	})

	// Creator is allowed
	result, _ := engine.Evaluate(ctx, &EligibilityContext{
		UserID:          "user_1",
		CampaignID:      "camp_1",
		DistributorType: DistributorCreator,
		DistributorID:   "creator_1",
	})
	if !result.Eligible {
		t.Fatalf("creator should be eligible, got: %s", result.ReasonCode)
	}

	// Scout is not allowed
	result, _ = engine.Evaluate(ctx, &EligibilityContext{
		UserID:          "user_1",
		CampaignID:      "camp_1",
		DistributorType: DistributorScout,
		DistributorID:   "scout_1",
	})
	if result.Eligible {
		t.Fatal("scout should not be eligible")
	}
	if result.ReasonCode != "SOURCE_NOT_ALLOWED" {
		t.Fatalf("expected SOURCE_NOT_ALLOWED, got %s", result.ReasonCode)
	}
}

func TestEligibilityGeoFilter(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	engine := NewEligibilityEngine(repo, clock)
	ctx := context.Background()

	_ = repo.UpsertCampaignAudience(ctx, &CampaignAudience{
		CampaignID:       "camp_1",
		EligibilityRules: map[string]any{},
		GeoCities:        []string{"Hanoi", "BacNinh"},
	})

	// Hanoi user is eligible
	result, _ := engine.Evaluate(ctx, &EligibilityContext{
		UserID:     "user_1",
		CampaignID: "camp_1",
		UserCity:   "Hanoi",
	})
	if !result.Eligible {
		t.Fatalf("hanoi user should be eligible, got: %s", result.ReasonCode)
	}

	// HCMC user is not eligible
	result, _ = engine.Evaluate(ctx, &EligibilityContext{
		UserID:     "user_2",
		CampaignID: "camp_1",
		UserCity:   "HCMC",
	})
	if result.Eligible {
		t.Fatal("hcmc user should not be eligible")
	}
	if result.ReasonCode != "GEO_NOT_ALLOWED" {
		t.Fatalf("expected GEO_NOT_ALLOWED, got %s", result.ReasonCode)
	}
}

func TestEligibilityLifecyclePredicates(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	engine := NewEligibilityEngine(repo, clock)
	ctx := context.Background()

	_ = repo.UpsertCampaignAudience(ctx, &CampaignAudience{
		CampaignID: "camp_1",
		LifecyclePreds: map[string]any{
			"min_account_age_days": float64(7),
			"max_redemptions":     float64(3),
		},
	})

	// New account (< 7 days) is not eligible
	result, _ := engine.Evaluate(ctx, &EligibilityContext{
		UserID:     "user_1",
		CampaignID: "camp_1",
		AccountAge: 3 * 24 * time.Hour,
	})
	if result.Eligible {
		t.Fatal("new account should not be eligible")
	}
	if result.ReasonCode != "ACCOUNT_TOO_NEW" {
		t.Fatalf("expected ACCOUNT_TOO_NEW, got %s", result.ReasonCode)
	}

	// Old account with too many redemptions
	result, _ = engine.Evaluate(ctx, &EligibilityContext{
		UserID:            "user_2",
		CampaignID:        "camp_1",
		AccountAge:        30 * 24 * time.Hour,
		TotalRedemptions:  5,
	})
	if result.Eligible {
		t.Fatal("user with too many redemptions should not be eligible")
	}
	if result.ReasonCode != "MAX_REDEMPTIONS_REACHED" {
		t.Fatalf("expected MAX_REDEMPTIONS_REACHED, got %s", result.ReasonCode)
	}

	// Eligible user
	result, _ = engine.Evaluate(ctx, &EligibilityContext{
		UserID:            "user_3",
		CampaignID:        "camp_1",
		AccountAge:        30 * 24 * time.Hour,
		TotalRedemptions:  1,
	})
	if !result.Eligible {
		t.Fatalf("eligible user should be eligible, got: %s", result.ReasonCode)
	}
}

func TestEligibilityRiskCheck(t *testing.T) {
	repo := NewMemoryRepository()
	clock := &testClock{now: time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)}
	engine := NewEligibilityEngine(repo, clock)
	ctx := context.Background()

	// Multi-device user is flagged
	result, _ := engine.Evaluate(ctx, &EligibilityContext{
		UserID:      "user_1",
		CampaignID:  "camp_1",
		DeviceCount: 5,
	})
	if result.Eligible {
		t.Fatal("multi-device user should not be eligible")
	}
	if result.ReasonCode != "RISK_FLAGGED" {
		t.Fatalf("expected RISK_FLAGGED, got %s", result.ReasonCode)
	}

	// Multi-account user is flagged
	result, _ = engine.Evaluate(ctx, &EligibilityContext{
		UserID:       "user_2",
		CampaignID:   "camp_1",
		AccountCount: 2,
	})
	if result.Eligible {
		t.Fatal("multi-account user should not be eligible")
	}
}
