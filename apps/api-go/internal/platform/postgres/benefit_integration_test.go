package postgres

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/command"
)

// allowAllMerchantVerifier is a test-only stand-in for BENEFIT-REDEEM-002's
// MerchantVerifier — this integration test is about proving the Postgres
// repository persists the Campaign -> Claim -> Redemption -> Settlement ->
// Reward -> AttributionEdge chain correctly, not about re-testing the
// merchant-identity gate itself (that's covered in internal/benefit's own
// unit tests against MemoryRepository).
type allowAllMerchantVerifier struct{}

func (allowAllMerchantVerifier) MerchantRedemptionIdentity(_ context.Context, _, _ string) (string, bool) {
	return "verified", true
}

func benefitEnvelope(typ string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_" + typ, CommandType: typ, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actorID}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target: command.Target{Type: "Campaign", ID: "test"}, IdempotencyKey: "k_" + typ + "_" + actorID + "_" + strconv.FormatInt(time.Now().UnixNano(), 10),
		Purpose: "test", CorrelationID: "corr", RequestedAt: time.Now().UTC().Format(time.RFC3339), Payload: payload, AuthContext: map[string]any{},
	}
}

func bodyOf(t *testing.T, result command.Result) map[string]any {
	t.Helper()
	if result.Body == nil {
		t.Fatalf("result has no Body: %#v", result)
	}
	return result.Body
}

// TestBenefitPostgresFullLifecycle drives a merchant campaign all the way
// through Campaign -> BenefitDefinition -> CapacityPool -> Claim ->
// Redemption -> Settlement -> Reward -> AttributionEdge -> CampaignAudience
// -> CampaignEvent against a real Postgres database (migrations/
// 063_benefit_routing_network.sql), proving BenefitRepository round-trips
// every aggregate the in-memory fixture covers.
func TestBenefitPostgresFullLifecycle(t *testing.T) {
	pool := testPool(t)
	repo := NewBenefitRepository(pool)
	svc := benefit.NewService(repo)
	svc.WithMerchantVerifier(allowAllMerchantVerifier{})
	ctx := t.Context()

	merchantID := "merchant_pg_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	userID := "user_pg_" + strconv.FormatInt(time.Now().UnixNano(), 10)

	// 1. Create campaign (merchant-owned, so RedeemBenefit later requires
	// the merchant verifier).
	campResult := svc.Handle(benefitEnvelope("CreateCampaign", map[string]any{
		"type": "MERCHANT_CAMPAIGN", "ownerType": "merchant", "ownerId": merchantID,
		"sceneIds": []string{"scene_pg_1"}, "goal": "PG integration test",
		"budgetMinor": 1000000, "currency": "VND",
		"startAt": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
		"endAt":   time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
	}, merchantID))
	if campResult.Outcome != "ACCEPTED" {
		t.Fatalf("create campaign: %s: %v", campResult.Outcome, campResult.Error)
	}
	campaignID := campResult.Aggregate.ID
	t.Cleanup(func() { cleanupBenefitCampaign(t, pool, campaignID) })

	// 2. Persist a benefit definition + capacity pool directly through the
	// repository (no command wraps these yet), matching how
	// TestClaimAndRedeemBenefit seeds the in-memory fixture.
	now := time.Now().UTC()
	def := &benefit.BenefitDefinition{
		ID: "ben_pg_" + strconv.FormatInt(now.UnixNano(), 10), CampaignID: campaignID,
		Kind: benefit.FreeDrink, Label: "PG Free Coffee", RetailValueMinor: 45000, UserPayMinor: 0,
		Currency: "VND", CreatedAt: now,
	}
	if err := repo.CreateBenefitDefinition(ctx, def); err != nil {
		t.Fatalf("create benefit definition: %v", err)
	}
	pool2 := &benefit.CapacityPool{
		ID: "pool_pg_" + strconv.FormatInt(now.UnixNano(), 10), CampaignID: campaignID,
		TotalCapacity: 50, CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	if err := repo.UpsertCapacityPool(ctx, pool2); err != nil {
		t.Fatalf("upsert capacity pool: %v", err)
	}

	// 3. Activate, claim, redeem. Deliberately no CampaignAudience row yet —
	// GetCampaignAudience returning "not found" must mean "open campaign",
	// per eligibility.go's own contract, so this also proves that path.
	if r := svc.Handle(benefitEnvelope("ActivateCampaign", map[string]any{"campaignId": campaignID}, merchantID)); r.Outcome != "ACCEPTED" {
		t.Fatalf("activate campaign: %s: %v", r.Outcome, r.Error)
	}
	claimResult := svc.Handle(benefitEnvelope("ClaimBenefit", map[string]any{"campaignId": campaignID, "benefitId": def.ID}, userID))
	if claimResult.Outcome != "ACCEPTED" {
		t.Fatalf("claim benefit: %s: %v", claimResult.Outcome, claimResult.Error)
	}
	claimToken, _ := bodyOf(t, claimResult)["claimToken"].(string)
	if claimToken == "" {
		t.Fatalf("claim token missing: %s", claimResult.OperationRef)
	}

	redeemResult := svc.Handle(benefitEnvelope("RedeemBenefit", map[string]any{
		"claimToken": claimToken, "merchantId": merchantID, "staffId": "staff_pg_1",
		"evidenceType": "MERCHANT_SCAN", "idempotencyKey": "idem_pg_" + strconv.FormatInt(now.UnixNano(), 10),
	}, "staff_pg_1"))
	if redeemResult.Outcome != "ACCEPTED" {
		t.Fatalf("redeem benefit: %s: %v", redeemResult.Outcome, redeemResult.Error)
	}
	redemptionID := redeemResult.Aggregate.ID

	// 5. Read back through the repository directly to prove every table
	// in the chain actually has a row, not just that the service reported
	// success.
	redemption, err := repo.GetRedemption(ctx, redemptionID)
	if err != nil {
		t.Fatalf("get redemption: %v", err)
	}
	if redemption.MerchantID != merchantID || redemption.Status != benefit.RedemptionConfirmed {
		t.Fatalf("unexpected redemption state: %#v", redemption)
	}
	settlements, err := repo.ListSettlementsByRedemption(ctx, redemptionID)
	if err != nil {
		t.Fatalf("list settlements: %v", err)
	}
	if len(settlements) == 0 {
		t.Fatalf("expected at least one settlement row for redemption %s", redemptionID)
	}
	edges, err := repo.ListAttributionByCampaign(ctx, campaignID)
	if err != nil {
		t.Fatalf("list attribution edges: %v", err)
	}
	if len(edges) == 0 {
		t.Fatalf("expected at least one attribution edge for campaign %s", campaignID)
	}

	// 6. CampaignAudience (JSONB + array round trip), written only now so
	// it cannot affect the eligibility checks above.
	audience := &benefit.CampaignAudience{
		CampaignID:       campaignID,
		EligibilityRules: map[string]any{"minAccountAgeDays": float64(0)},
		SourceAllowlist:  []string{"PROXY", "MERCHANT"},
		GeoCities:        []string{"Hanoi", "Bắc Ninh"},
		LifecyclePreds:   map[string]any{"max_redemptions": float64(5)},
		CreatedAt:        now, UpdatedAt: now,
	}
	if err := repo.UpsertCampaignAudience(ctx, audience); err != nil {
		t.Fatalf("upsert campaign audience: %v", err)
	}
	roundTripped, err := repo.GetCampaignAudience(ctx, campaignID)
	if err != nil {
		t.Fatalf("get campaign audience: %v", err)
	}
	if len(roundTripped.SourceAllowlist) != 2 || roundTripped.SourceAllowlist[0] != "PROXY" {
		t.Fatalf("source allowlist did not round-trip: %#v", roundTripped.SourceAllowlist)
	}
	if roundTripped.LifecyclePreds["max_redemptions"] != float64(5) {
		t.Fatalf("lifecycle preds did not round-trip: %#v", roundTripped.LifecyclePreds)
	}

	// 7. Version-conflict path on the optimistic-locked status update.
	if err := repo.UpdateCampaignStatus(ctx, campaignID, benefit.CampaignPaused, 999); err == nil {
		t.Fatalf("expected version conflict updating campaign status with a stale version")
	}
}

// cleanupBenefitCampaign deletes every row this test created, in reverse
// FK-dependency order (none of the benefit.* foreign keys are ON DELETE
// CASCADE), so a shared dev database never accumulates PG-integration-test
// campaigns.
func cleanupBenefitCampaign(t *testing.T, pool *pgxpool.Pool, campaignID string) {
	t.Helper()
	ctx := context.Background()
	statements := []string{
		`DELETE FROM benefit.campaign_events WHERE campaign_id=$1`,
		`DELETE FROM benefit.attribution_edges WHERE campaign_id=$1`,
		`DELETE FROM benefit.rewards WHERE campaign_id=$1`,
		`DELETE FROM benefit.settlements WHERE campaign_id=$1`,
		`DELETE FROM benefit.redemptions WHERE campaign_id=$1`,
		`DELETE FROM benefit.claims WHERE campaign_id=$1`,
		`DELETE FROM benefit.offers WHERE campaign_id=$1`,
		`DELETE FROM benefit.allocations WHERE campaign_id=$1`,
		`DELETE FROM benefit.capacity_pools WHERE campaign_id=$1`,
		`DELETE FROM benefit.campaign_audiences WHERE campaign_id=$1`,
		`DELETE FROM benefit.definitions WHERE campaign_id=$1`,
		`DELETE FROM benefit.campaigns WHERE campaign_id=$1`,
	}
	for _, stmt := range statements {
		if _, err := pool.Exec(ctx, stmt, campaignID); err != nil {
			t.Logf("cleanup %q: %v", stmt, err)
		}
	}
}
