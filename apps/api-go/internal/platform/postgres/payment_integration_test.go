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
//
// TEST-HYGIENE-001: this test runs against the SHARED dev database
// (testdb_test.go's bootSharedPostgres prefers DATABASE_URL), so it must not
// leave rows behind and must not depend on a key that a previous run already
// consumed. Both were violated: provider event ids were fixed literals
// (evt_pay_pg_1 / evt_pay_pg_2) instead of run-scoped, and cleanup ran only on
// the success path. The dev DB still held the first one from 2026-09-03, so
// every run after the first short-circuited at the dedupe check and failed
// with "ledger len must be 2, got 0". A fresh temp cluster never sees this,
// which is why the failure only showed up against the real database.
func TestPaymentPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewPaymentRepository(pool, NewOutboxRepository(pool))
	svc := payment.NewWithProvider(repo, payment.NewVietQRProvider())

	run := time.Now().UnixNano()
	orderID := "order_pay_pg_" + itoa(run)
	// Provider event ids MUST be run-scoped. payment.provider_events is a shared
	// dedupe table in the dev DB, and confirmIntent's very first step is
	// ProviderEventExists -> a row left behind by an earlier run short-circuits
	// to ALREADY_PROCESSED. Step 3 below only asserted Outcome=="ACCEPTED",
	// which that short-circuit also satisfies, so the test went red much later
	// with "ledger len must be 2, got 0" and nothing pointed at the real cause.
	evtConfirmed := "evt_pay_pg_" + itoa(run) + "_1"
	evtMismatch := "evt_pay_pg_" + itoa(run) + "_2"

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

	// Register cleanup through t.Cleanup so it runs even when an assertion
	// fails: t.Fatalf skips the remainder of the function, which is exactly how
	// the earlier failures leaked rows (3 stale PENDING intents were found in
	// the dev DB). holdID is captured by reference and filled in later.
	holdID := ""
	t.Cleanup(func() {
		cleanupPaymentPG(t, pool, []any{orderID, piID, holdID}, []string{evtConfirmed, evtMismatch})
	})

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
		"paymentIntentId": piID, "providerEventId": evtConfirmed, "status": "SUCCEEDED",
	}, "user_001", piID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ConfirmPaymentIntent: %+v", r.Error)
	}
	// ACCEPTED alone cannot tell a real confirm from the dedupe short-circuit;
	// ALREADY_PROCESSED here means a stale provider_events row won.
	if r.Aggregate.State != "SUCCEEDED" {
		t.Fatalf("first confirm must reach SUCCEEDED, got %s (stale provider_events row?)", r.Aggregate.State)
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
		"paymentIntentId": piID, "providerEventId": evtConfirmed, "status": "SUCCEEDED",
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
		"paymentIntentId": piID, "providerEventId": evtMismatch,
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
	holdID = r.Aggregate.ID
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

	// cleanup runs via t.Cleanup registered above (also on failure paths).
}

func cleanupPaymentPG(t *testing.T, pool *pgxpool.Pool, ids []any, providerEventIDs []string) {
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
	// provider_events is the webhook dedupe table. Leaving rows behind is what
	// made this test fail on its second run: the next run's confirm hit the
	// leftover row and short-circuited before writing the ledger.
	for _, id := range providerEventIDs {
		if _, err := pool.Exec(ctx, `DELETE FROM payment.provider_events WHERE provider_event_id=$1`, id); err != nil {
			t.Logf("cleanup provider_events: %v", err)
		}
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
