package postgres

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/voucher"
)

func TestVoucherPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	repo := NewVoucherRepository(pool)
	svc := voucher.NewWithRepository(repo)
	actorID := "user_voucher_pg_" + strconv.Itoa(99999)
	// Create a fresh voucher with future ValidUntil to avoid expiry on 2026-09-01
	r := svc.HandleContext(t.Context(), voucherEnvelope("CreateVoucher", map[string]any{
		"family": "COFFEE", "displayValue": 50000, "quantity": 1,
		"scopeName": "Test Cafe", "scopeDetail": "Test", "validFrom": "2026-09-01", "validUntil": "2026-12-31",
		"redeemTimeWindow": "any", "minimumSpend": "无", "perPersonLimit": 1,
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %v", r.Error)
	}
	var created struct {
		Voucher struct {
			ID string `json:"voucherId"`
		} `json:"voucher"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)
	voucherID := created.Voucher.ID
	if voucherID == "" {
		// Fallback: try to extract from OperationRef directly
		var raw map[string]any
		_ = json.Unmarshal([]byte(r.OperationRef), &raw)
		if v, ok := raw["voucher"].(map[string]any); ok {
			voucherID, _ = v["voucherId"].(string)
		}
	}
	if voucherID == "" {
		t.Fatal("voucherId missing after create")
	}
	// List should succeed
	r = svc.HandleContext(t.Context(), voucherEnvelope("ListVouchers", map[string]any{}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list: %v", r.Error)
	}
	// Open redemption on the newly created voucher
	r = svc.HandleContext(t.Context(), voucherEnvelope("OpenVoucherRedemption", map[string]any{"voucherId": voucherID}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("open: %v", r.Error)
	}
	var payload struct {
		Redemption map[string]any `json:"redemption"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &payload)
	rid, _ := payload.Redemption["redemptionId"].(string)
	if rid == "" {
		t.Fatal("redemptionId missing")
	}
	// Confirm
	r = svc.HandleContext(t.Context(), voucherEnvelope("ConfirmVoucherRedemption", map[string]any{"redemptionId": rid}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm: %v", r.Error)
	}
	// Settle
	r = svc.HandleContext(t.Context(), voucherEnvelope("SettleVoucher", map[string]any{"voucherId": voucherID}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("settle: %v", r.Error)
	}
	// Verify settlement persisted
	var count int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM voucher.settlements WHERE actor_id=$1 AND voucher_id=$2`, actorID, voucherID).Scan(&count); err != nil {
		t.Fatalf("query settlements: %v", err)
	}
	if count != 1 {
		t.Fatalf("want 1 settlement, got %d", count)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM voucher.settlements WHERE actor_id=$1`, actorID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM voucher.redemptions WHERE actor_id=$1`, actorID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM voucher.vouchers WHERE actor_id=$1`, actorID)
	})
}

func voucherEnvelope(typ string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_" + typ, CommandType: typ, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actorID}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target: command.Target{Type: "Voucher", ID: "test"}, IdempotencyKey: "k_" + typ + "_" + actorID,
		Purpose: "test", CorrelationID: "corr", RequestedAt: "2026-08-21T00:00:00Z", Payload: payload, AuthContext: map[string]any{},
	}
}

// TestVoucherDefinitionPostgresRoundTrip proves migration 107 is live and
// the repository persists merchant-issued definitions (VOUCHER-ISSUE-001):
// a real business.accounts row accepts the insert, and the FK rejects a
// definition for a nonexistent merchant. Run-scoped rows only, cleaned up.
func TestVoucherDefinitionPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	repo := NewVoucherRepository(pool)
	svc := voucher.NewWithRepository(repo)
	ctx := t.Context()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	merchantID := "biz_def_pg_" + suffix
	actorID := "user_def_pg_" + suffix

	seedBusinessUsersPG(t, pool, []string{actorID})
	t.Cleanup(func() { cleanupBusinessUsersPG(t, pool, []string{actorID}) })
	if _, err := pool.Exec(ctx, `INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$2,'PG Def Cafe','ACTIVE',now())`, merchantID, actorID); err != nil {
		t.Fatalf("seed business account: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM voucher.definitions WHERE merchant_id=$1`, merchantID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM business.accounts WHERE id=$1`, merchantID)
	})

	env := voucherEnvelope("IssueVoucherDefinition", map[string]any{
		"family": "COFFEE", "faceValueMinor": 45000, "scopeName": "PG Def Cafe",
		"validFrom": "2026-09-20", "validUntil": "2026-12-31",
		"perPersonLimit": 2, "merchantUnitCostMinor": 30000,
	}, actorID)
	env.AuthContext = map[string]any{"merchantID": merchantID, "merchantName": "PG Def Cafe"}
	r := svc.HandleContext(ctx, env)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("issue: %v", r.Error)
	}
	var row struct {
		MerchantID string `json:"merchant_id"`
		Status     string `json:"status"`
	}
	var created struct {
		Definition struct {
			ID string `json:"definitionId"`
		} `json:"definition"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &created)
	if created.Definition.ID == "" {
		t.Fatal("definitionId missing after issue")
	}
	if err := pool.QueryRow(ctx, `SELECT merchant_id, status FROM voucher.definitions WHERE definition_id=$1`, created.Definition.ID).Scan(&row.MerchantID, &row.Status); err != nil {
		t.Fatalf("definition row missing: %v", err)
	}
	if row.MerchantID != merchantID || row.Status != "DRAFT" {
		t.Fatalf("unexpected row: %+v", row)
	}

	// FK second lock: unknown merchant cannot hold a definition.
	env2 := voucherEnvelope("IssueVoucherDefinition", map[string]any{
		"family": "COFFEE", "faceValueMinor": 45000, "scopeName": "Ghost",
		"validFrom": "2026-09-20", "validUntil": "2026-12-31",
		"perPersonLimit": 1, "merchantUnitCostMinor": 0,
	}, actorID)
	env2.AuthContext = map[string]any{"merchantID": "biz_nope_" + suffix, "merchantName": "Ghost"}
	r2 := svc.HandleContext(ctx, env2)
	if r2.Error == nil || r2.Error.ErrorCode != "VOUCHER_STORAGE_FAILED" {
		t.Fatalf("expected VOUCHER_STORAGE_FAILED on FK violation, got %#v", r2)
	}
}
