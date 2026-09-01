package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/command"
)

// TestBusinessPostgresRoundTrip exercises the M9 business workspace
// against real PostgreSQL: account create / list / cross-owner isolation
// / membership RBAC (owner-only) / store create / store list.
//
// M9 acceptance cross-cutting with the chapter PRD:
//   - only OWNER/ADMIN can add a member
//   - a member of business A cannot create a store on business B
//   - ListMyBusinessAccounts only returns accounts the caller owns
func TestBusinessPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewBusinessRepository(pool)
	svc := business.NewWithRepository(repo)

	run := time.Now().UnixNano()
	ownerA := "user_biz_pg_ownerA_" + itoa(run)
	ownerB := "user_biz_pg_ownerB_" + itoa(run)
	stranger := "user_biz_pg_stranger_" + itoa(run)
	staff := "user_biz_pg_staff_" + itoa(run)
	imposter := "user_biz_pg_imposter_" + itoa(run)
	invalidRoleUser := "user_biz_pg_x_" + itoa(run)
	users := []string{ownerA, ownerB, stranger, staff, imposter, invalidRoleUser}
	seedBusinessUsersPG(t, pool, users)
	t.Cleanup(func() { cleanupBusinessUsersPG(t, pool, users) })

	// 1. Create a business account for owner A.
	r := svc.HandleContext(ctx, bizEnvelope("CreateBusinessAccount", map[string]any{
		"name": "An's Coffee",
	}, ownerA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessAccount: %+v", r.Error)
	}
	bizA := readStringBiz(r.OperationRef, "businessId")
	if bizA == "" {
		t.Fatalf("CreateBusinessAccount: missing businessId in payload, op=%s", r.OperationRef)
	}

	// 2. ListMyBusinessAccounts for owner A must return at least bizA.
	r = svc.HandleContext(ctx, bizEnvelope("ListMyBusinessAccounts", map[string]any{}, ownerA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListMyBusinessAccounts: %+v", r.Error)
	}
	if !bizListHasID(r.OperationRef, bizA) {
		t.Fatalf("ListMyBusinessAccounts must include %s, got %s", bizA, r.OperationRef)
	}

	// 3. Cross-owner isolation: a stranger must NOT see bizA in their list.
	r = svc.HandleContext(ctx, bizEnvelope("ListMyBusinessAccounts", map[string]any{}, stranger))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListMyBusinessAccounts stranger: %+v", r.Error)
	}
	if bizListHasID(r.OperationRef, bizA) {
		t.Fatalf("cross-owner leak: stranger can see %s", bizA)
	}

	// 4. AddBusinessMember as owner A — must ACCEPT.
	r = svc.HandleContext(ctx, bizEnvelope("AddBusinessMember", map[string]any{
		"businessId": bizA, "userId": staff, "role": "OPERATOR",
	}, ownerA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("AddBusinessMember as owner: %+v", r.Error)
	}

	// 5. AddBusinessMember as a stranger — must be REJECTED with
	// BUSINESS_ADMIN_REQUIRED.
	r = svc.HandleContext(ctx, bizEnvelope("AddBusinessMember", map[string]any{
		"businessId": bizA, "userId": imposter, "role": "ADMIN",
	}, stranger))
	if r.Outcome != "REJECTED" {
		t.Fatalf("stranger AddBusinessMember must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "BUSINESS_ADMIN_REQUIRED" {
		t.Fatalf("expected BUSINESS_ADMIN_REQUIRED, got %+v", r.Error)
	}

	// 6. AddBusinessMember with a role outside the allow-list must be
	// REJECTED (validation, not authorization).
	r = svc.HandleContext(ctx, bizEnvelope("AddBusinessMember", map[string]any{
		"businessId": bizA, "userId": invalidRoleUser, "role": "GOD_MODE",
	}, ownerA))
	if r.Outcome != "REJECTED" {
		t.Fatalf("invalid role must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_BUSINESS_ROLE" {
		t.Fatalf("expected INVALID_BUSINESS_ROLE, got %+v", r.Error)
	}

	// 7. CreateBusinessStore as owner A on bizA — ACCEPT.
	r = svc.HandleContext(ctx, bizEnvelope("CreateBusinessStore", map[string]any{
		"businessId": bizA, "name": "An's Coffee · West Lake", "address": "12 Quang An, Tay Ho, Hanoi",
	}, ownerA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessStore: %+v", r.Error)
	}
	storeA := readStringBiz(r.OperationRef, "storeId")
	if storeA == "" {
		t.Fatalf("CreateBusinessStore: missing storeId, op=%s", r.OperationRef)
	}

	// 8. CreateBusinessStore on bizA by the stranger — REJECTED
	// (BUSINESS_WRITE_REQUIRED).
	r = svc.HandleContext(ctx, bizEnvelope("CreateBusinessStore", map[string]any{
		"businessId": bizA, "name": "hostile takeover", "address": "nowhere",
	}, stranger))
	if r.Outcome != "REJECTED" {
		t.Fatalf("stranger CreateBusinessStore must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "BUSINESS_WRITE_REQUIRED" {
		t.Fatalf("expected BUSINESS_WRITE_REQUIRED, got %+v", r.Error)
	}

	// 9. Create a second business for owner B and ensure cross-tenant
	// store creation cannot accidentally land on it.
	r = svc.HandleContext(ctx, bizEnvelope("CreateBusinessAccount", map[string]any{
		"name": "B's Noodle Bar",
	}, ownerB))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateBusinessAccount B: %+v", r.Error)
	}
	bizB := readStringBiz(r.OperationRef, "businessId")
	// owner A tries to create a store on bizB → REJECTED
	r = svc.HandleContext(ctx, bizEnvelope("CreateBusinessStore", map[string]any{
		"businessId": bizB, "name": "hostile on B", "address": "nowhere",
	}, ownerA))
	if r.Outcome != "REJECTED" {
		t.Fatalf("cross-tenant CreateBusinessStore must be REJECTED, got %s", r.Outcome)
	}
	// ListBusinessStores for bizB must NOT include storeA.
	r = svc.HandleContext(ctx, bizEnvelope("ListBusinessStores", map[string]any{
		"businessId": bizB,
	}, ownerB))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListBusinessStores B: %+v", r.Error)
	}
	if bizListHasID(r.OperationRef, storeA) {
		t.Fatalf("cross-tenant store leak: bizB lists storeA=%s", storeA)
	}

	// 10. AddSpend through the repo (the service does not surface it as
	// a command; SpendSummary just sums spend_records). Then
	// SpendSummary must return the total for bizA but not include bizB's
	// spend.
	if err := repo.AddSpend(ctx, bizA, "order_pg_a_1", 250000); err != nil {
		t.Fatalf("AddSpend bizA: %v", err)
	}
	if err := repo.AddSpend(ctx, bizA, "order_pg_a_2", 175000); err != nil {
		t.Fatalf("AddSpend bizA[2]: %v", err)
	}
	if err := repo.AddSpend(ctx, bizB, "order_pg_b_1", 999999); err != nil {
		t.Fatalf("AddSpend bizB: %v", err)
	}
	sumA, err := repo.SpendSummary(ctx, bizA)
	if err != nil {
		t.Fatalf("SpendSummary bizA: %v", err)
	}
	if sumA != 425000 {
		t.Fatalf("SpendSummary bizA wrong: got %d want 425000", sumA)
	}
	sumB, err := repo.SpendSummary(ctx, bizB)
	if err != nil {
		t.Fatalf("SpendSummary bizB: %v", err)
	}
	if sumB != 999999 {
		t.Fatalf("SpendSummary bizB wrong: got %d want 999999", sumB)
	}

	// cleanup
	cleanupBusinessPG(t, pool, []string{bizA, bizB, storeA})
}

func cleanupBusinessPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM business.spend_records WHERE business_id = ANY($1)`, ids); err != nil {
		t.Logf("cleanup spend: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM business.stores WHERE business_id = ANY($1)`, ids); err != nil {
		t.Logf("cleanup stores: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM business.memberships WHERE business_id = ANY($1)`, ids); err != nil {
		t.Logf("cleanup memberships: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM business.accounts WHERE id = ANY($1)`, ids); err != nil {
		t.Logf("cleanup accounts: %v", err)
	}
}

func seedBusinessUsersPG(t *testing.T, pool *pgxpool.Pool, userIDs []string) {
	t.Helper()
	for _, userID := range userIDs {
		if _, err := pool.Exec(context.Background(), `
			INSERT INTO identity.user_accounts (id, status)
			VALUES ($1, 'ACTIVE') ON CONFLICT (id) DO NOTHING`, userID); err != nil {
			t.Fatalf("seed business user %s: %v", userID, err)
		}
	}
}

func cleanupBusinessUsersPG(t *testing.T, pool *pgxpool.Pool, userIDs []string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		DELETE FROM identity.user_accounts WHERE id = ANY($1)`, userIDs); err != nil {
		t.Logf("cleanup business users: %v", err)
	}
}

func bizEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_biz_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "BUSINESS", ID: actorID},
		Target:         command.Target{Type: "BusinessAccount", ID: actorID},
		IdempotencyKey: "test_biz_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_biz_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}
