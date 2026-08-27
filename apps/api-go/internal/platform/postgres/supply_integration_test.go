package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/supply"
)

func TestSupplyPostgresExpiryBlocksEligibility(t *testing.T) {
	pool := testPool(t)
	// pool lifetime owned by test helper
	ctx := context.Background()
	repo := NewSupplyRepository(pool)
	svc := supply.NewWithRepository(repo)
	// Clean up previous test data
	agentID := "agent_pg_exp_" + time.Now().Format("150405.000")
	// profile
	if err := repo.CreateProfile(ctx, supply.AgentProfile{AgentID: agentID, Name: "PG Exp", Status: "ACTIVE", CreatedAt: time.Now(), UpdatedAt: time.Now()}); err != nil {
		t.Fatalf("create profile: %v", err)
	}
	if err := repo.CreateService(ctx, supply.AgentService{AgentID: agentID, ServiceType: "CITY_COMPANION", Status: "ACTIVE", ReferencePrice: 900000, Currency: "VND", Markets: []string{"hn"}, UpdatedAt: time.Now()}); err != nil {
		t.Fatalf("create service: %v", err)
	}
	// capability declared+verified but verification expired
	if err := repo.SetCapability(ctx, supply.Capability{AgentID: agentID, Capability: "ZH", Declared: true, Verified: true, UpdatedAt: time.Now()}); err != nil {
		t.Fatalf("set cap: %v", err)
	}
	if err := repo.CreateVerification(ctx, supply.CapabilityVerification{
		ID: "cv_pg_exp_" + agentID, AgentID: agentID, Capability: "ZH", Status: "VERIFIED", Method: "INTERVIEW",
		VerifiedBy: "ops_001", VerifiedAt: time.Now().Add(-48 * time.Hour), ExpiresAt: time.Now().Add(-24 * time.Hour), CreatedAt: time.Now().Add(-48 * time.Hour),
	}); err != nil {
		t.Fatalf("create verification: %v", err)
	}
	// window
	if err := repo.CreateWindow(ctx, supply.AvailabilityWindow{
		ID: "aw_pg_exp_" + agentID, AgentID: agentID, StartAt: time.Now().Add(24 * time.Hour), EndAt: time.Now().Add(34 * time.Hour), MarketID: "hn", Status: "AVAILABLE", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("create window: %v", err)
	}
	start := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	r := svc.Handle(supplyEnvelope("QuerySuppliers", map[string]any{
		"marketId": "hn", "startAt": start, "durationH": 8, "serviceType": "CITY_COMPANION", "languages": []string{"ZH"},
	}, agentID))
	// Should be shortage because expired
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("query failed: %v", r.Error)
	}
	if !containsPayload(r.OperationRef, "\"shortage\":true") {
		t.Fatalf("expired must be shortage, got %s", r.OperationRef)
	}
	// Passport should reflect expired
	r2 := svc.Handle(supplyEnvelope("GetAgentPassport", map[string]any{"agentId": agentID}, agentID))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("passport: %v", r2.Error)
	}
	if !containsPayload(r2.OperationRef, "\"expired\":1") {
		t.Fatalf("passport expired count wrong: %s", r2.OperationRef)
	}
	// cleanup
	pool.Exec(ctx, `DELETE FROM supply.availability_windows WHERE agent_id=$1`, agentID)
	pool.Exec(ctx, `DELETE FROM supply.capability_verifications WHERE agent_id=$1`, agentID)
	pool.Exec(ctx, `DELETE FROM supply.capabilities WHERE agent_id=$1`, agentID)
	pool.Exec(ctx, `DELETE FROM supply.agent_services WHERE agent_id=$1`, agentID)
	pool.Exec(ctx, `DELETE FROM supply.agent_profiles WHERE agent_id=$1`, agentID)
}

func supplyEnvelope(commandType string, payload map[string]any, principalID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "BUSINESS", ID: principalID},
		Target:         command.Target{Type: "Supply", ID: principalID},
		IdempotencyKey: "test_key_123456_" + commandType,
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func containsPayload(s, substr string) bool {
	return len(s) >= len(substr) && (func() bool {
		for i := 0; i <= len(s)-len(substr); i++ {
			if s[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	})()
}

// TestSupplyPostgresVerificationLifecycle covers the second axis of
// supply.M3: CapabilityVerification write/read round-trip via real
// PostgreSQL. The first test (TestSupplyPostgresExpiryBlocksEligibility)
// exercises the eligibility path end-to-end; this test focuses on
// the schema (supply.capability_verifications) and the
// GetVerifications read-back path, which is what the Operator
// "verification flow" depends on for listing an agent's verified
// capabilities.
func TestSupplyPostgresVerificationLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepository(pool)

	agentID := "agent_verify_pg_" + itoa(time.Now().UnixNano())
	// 1. Seed an agent profile so the FK chain
	// capability_verifications -> agents is satisfied.
	if err := repo.CreateProfile(ctx, supply.AgentProfile{
		AgentID: agentID, Name: "Test Agent", Status: "ACTIVE",
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM supply.capability_verifications WHERE agent_id=$1`, agentID)
		_, _ = pool.Exec(ctx, `DELETE FROM supply.agents WHERE id=$1`, agentID)
	})

	// 2. Three verifications: one VERIFIED (still valid), one
	// EXPIRED (past expires_at), one PENDING (waiting on operator).
	now := time.Now().UTC()
	verifications := []supply.CapabilityVerification{
		{ID: "v_pg_a", AgentID: agentID, Capability: "TOUR_GUIDE", Status: "VERIFIED", Method: "DOCUMENT", VerifiedBy: "operator_alice", VerifiedAt: now.Add(-1 * time.Hour), ExpiresAt: now.Add(720 * time.Hour)},
		{ID: "v_pg_b", AgentID: agentID, Capability: "PHOTOGRAPHY", Status: "EXPIRED", Method: "INTERVIEW", VerifiedBy: "operator_bob", VerifiedAt: now.Add(-720 * time.Hour), ExpiresAt: now.Add(-1 * time.Hour)},
		{ID: "v_pg_c", AgentID: agentID, Capability: "TRANSLATION", Status: "PENDING", Method: "TEST", VerifiedBy: "", VerifiedAt: time.Time{}, ExpiresAt: time.Time{}},
	}
	for _, v := range verifications {
		if err := repo.CreateVerification(ctx, v); err != nil {
			t.Fatalf("CreateVerification %s: %v", v.ID, err)
		}
	}

	// 3. GetVerifications returns all three (the read is the full
	// history, not the eligible-only projection; eligibility is
	// derived in service.IsEligibleForOrder which the
	// expiry-blocks-eligibility test already covers).
	got, err := repo.GetVerifications(ctx, agentID)
	if err != nil {
		t.Fatalf("GetVerifications: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("GetVerifications count: want 3 got %d", len(got))
	}

	// 4. Direct SQL: confirm the rows carry the right status so
	// the Operator UI can colour-code VERIFIED vs PENDING vs
	// EXPIRED without re-deriving from the service.
	var verifiedCount, expiredCount, pendingCount int
	if err := pool.QueryRow(ctx,
		`SELECT
		   COUNT(*) FILTER (WHERE status = 'VERIFIED'),
		   COUNT(*) FILTER (WHERE status = 'EXPIRED'),
		   COUNT(*) FILTER (WHERE status = 'PENDING')
		 FROM supply.capability_verifications WHERE agent_id=$1`, agentID,
	).Scan(&verifiedCount, &expiredCount, &pendingCount); err != nil {
		t.Fatalf("status counts: %v", err)
	}
	if verifiedCount != 1 || expiredCount != 1 || pendingCount != 1 {
		t.Fatalf("status mix: want 1/1/1 got VERIFIED=%d EXPIRED=%d PENDING=%d", verifiedCount, expiredCount, pendingCount)
	}
}
