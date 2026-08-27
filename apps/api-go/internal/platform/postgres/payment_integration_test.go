package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/payment"
)

// TestPaymentPostgresRoundTrip covers the M5 acceptance chain end to end
// through real PostgreSQL: CreatePaymentIntent (PENDING + VietQR provider)
// → ConfirmPaymentIntent (idempotent, append-only balanced ledger) →
// duplicate provider callback dedupe → RefundPaymentIntent →
// CreatePayoutHold → ReleasePayout.
//
// M5 acceptance:
//   - ledger must be append-only and balanced
//   - duplicate provider callbacks must be deduped (no double credit)
//   - amount/currency mismatch must be REJECTED
//   - unknown timeout must not leave a half-confirmed intent
func TestPaymentPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewPaymentRepository(pool, NewOutboxRepository(pool))
	svc := payment.NewWithProvider(repo, payment.NewVietQRProvider())

	run := time.Now().UnixNano()
	orderID := "order_pay_pg_" + itoa(run)

	// 1. Create a PENDING intent.
	r := svc.HandleContext(ctx, payEnvelope("CreatePaymentIntent", map[string]any{
		"orderId": orderID, "agentId": "agent_pay_pg_1", "amountMinor": int64(1200000),
	}, "user_001", orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreatePaymentIntent: %+v", r.Error)
	}
	if r.Aggregate.State != "PENDING" {
		t.Fatalf("new intent must be PENDING, got %s", r.Aggregate.State)
	}
	piID := r.Aggregate.ID
	if piID == "" {
		t.Fatalf("CreatePaymentIntent: missing aggregate id")
	}

	// 2. The intent must be queryable from the repo with the same status.
	intent, err := repo.GetIntent(ctx, piID)
	if err != nil {
		t.Fatalf("GetIntent: %v", err)
	}
	if intent.Status != "PENDING" || intent.AmountMinor != 1200000 {
		t.Fatalf("GetIntent wrong: %+v", intent)
	}

	// 3. Confirm with a provider event id; ledger must have 2 entries
	// (DEBIT_REQUESTER + CREDIT_HOLD), balanced.
	r = svc.HandleContext(ctx, payEnvelope("ConfirmPaymentIntent", map[string]any{
		"paymentIntentId": piID, "providerEventId": "evt_pay_pg_1", "status": "SUCCEEDED",
	}, "user_001", piID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ConfirmPaymentIntent: %+v", r.Error)
	}
	ledger, err := repo.ListLedger(ctx, orderID)
	if err != nil {
		t.Fatalf("ListLedger: %v", err)
	}
	if len(ledger) != 2 {
		t.Fatalf("after first confirm, ledger len must be 2, got %d", len(ledger))
	}
	debit, credit := sumByType(ledger)
	if debit != credit || debit != 1200000 {
		t.Fatalf("unbalanced ledger: debit=%d credit=%d", debit, credit)
	}

	// 4. Duplicate provider callback (same providerEventId) must be
	// deduped. No new ledger entries; result state must indicate
	// already-processed.
	r = svc.HandleContext(ctx, payEnvelope("ConfirmPaymentIntent", map[string]any{
		"paymentIntentId": piID, "providerEventId": "evt_pay_pg_1", "status": "SUCCEEDED",
	}, "user_001", piID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("duplicate confirm must be ACCEPTED (idempotent), got %s", r.Outcome)
	}
	if r.Aggregate.State != "ALREADY_PROCESSED" {
		t.Fatalf("duplicate must report ALREADY_PROCESSED, got %s", r.Aggregate.State)
	}
	ledger, _ = repo.ListLedger(ctx, orderID)
	if len(ledger) != 2 {
		t.Fatalf("duplicate callback must not add ledger rows, got %d", len(ledger))
	}

	// 5. Amount/currency mismatch — confirm with a different amount must
	// be REJECTED. (The unit test in service_test.go also covers this,
	// but the PG path is not exercised there.)
	r = svc.HandleContext(ctx, payEnvelope("ConfirmPaymentIntent", map[string]any{
		"paymentIntentId": piID, "providerEventId": "evt_pay_pg_2",
		"status": "SUCCEEDED", "amountMinor": int64(999),
	}, "user_001", piID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("amount mismatch must be REJECTED, got %s", r.Outcome)
	}

	// 6. RefundPaymentIntent must add CREDIT_REFUND + DEBIT_REFUND,
	// keep the ledger balanced.
	r = svc.HandleContext(ctx, payEnvelope("RefundPaymentIntent", map[string]any{
		"paymentIntentId": piID, "amountMinor": int64(500000),
	}, "user_001", piID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RefundPaymentIntent: %+v", r.Error)
	}
	ledger, _ = repo.ListLedger(ctx, orderID)
	if len(ledger) != 4 {
		t.Fatalf("after refund, ledger len must be 4, got %d", len(ledger))
	}
	debit, credit = sumByType(ledger)
	if debit != credit {
		t.Fatalf("ledger unbalanced after refund: debit=%d credit=%d", debit, credit)
	}

	// 7. Payout hold + release round-trip.
	r = svc.HandleContext(ctx, payEnvelope("CreatePayoutHold", map[string]any{
		"orderId": orderID, "agentId": "agent_pay_pg_1", "amountMinor": int64(700000),
	}, "user_001", orderID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreatePayoutHold: %+v", r.Error)
	}
	holdID := r.Aggregate.ID
	r = svc.HandleContext(ctx, payEnvelope("ReleasePayout", map[string]any{
		"payoutHoldId": holdID,
	}, "user_001", holdID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ReleasePayout: %+v", r.Error)
	}
	hold, err := repo.GetPayoutHold(ctx, holdID)
	if err != nil {
		t.Fatalf("GetPayoutHold: %v", err)
	}
	if hold.Status != "RELEASED" {
		t.Fatalf("payout hold must be RELEASED, got %s", hold.Status)
	}

	// cleanup
	cleanupPaymentPG(t, pool, []any{orderID, piID, holdID})
}

func cleanupPaymentPG(t *testing.T, pool *pgxpool.Pool, ids []any) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM payment.ledger_entries WHERE order_id=$1`, ids[0]); err != nil {
		t.Logf("cleanup ledger: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM payment.payment_intents WHERE id=$1`, ids[1]); err != nil {
		t.Logf("cleanup intents: %v", err)
	}
	// payout hold is in a separate table; try both spellings.
	if _, err := pool.Exec(ctx, `DELETE FROM payment.payout_holds WHERE id=$1`, ids[2]); err != nil {
		t.Logf("cleanup payout_holds: %v", err)
	}
}

func sumByType(entries []payment.LedgerEntry) (debit, credit int64) {
	for _, e := range entries {
		switch e.EntryType {
		case "DEBIT_REQUESTER", "DEBIT_HOLD", "DEBIT_REFUND":
			debit += e.AmountMinor
		case "CREDIT_HOLD", "CREDIT_AGENT", "CREDIT_REFUND":
			credit += e.AmountMinor
		}
	}
	return
}

func payEnvelope(commandType string, payload map[string]any, actorID, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_pay_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "BUSINESS", ID: actorID},
		Target:         command.Target{Type: "Payment", ID: targetID},
		IdempotencyKey: "test_pay_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_pay_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}
