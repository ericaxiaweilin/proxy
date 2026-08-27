package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/outbox"
)

// TestOutboxPostgresLifecycle covers the outbox contract through real
// PostgreSQL: dedupe on event_id, claim with FOR UPDATE SKIP LOCKED,
// ack (MarkSent), retry with backoff (MarkFailed → FAILED with future
// available_at), and dead-letter (MarkFailed with deadLetter=true →
// DEAD_LETTER). This is the core guarantee that the M1/M2/M4 domain
// services rely on: every domain event committed in the same
// transaction as the aggregate mutation is durably enqueued and
// delivered at-least-once.
func TestOutboxPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewOutboxRepository(pool)

	run := time.Now().UnixNano()
	now := time.Now().UTC().Truncate(time.Microsecond)
	mkEvent := func(id, typ string) event.DomainEvent {
		return event.DomainEvent{
			EventID:         "evt_pg_" + itoa(run) + "_" + id,
			EventType:       typ,
			EventVersion:    1,
			AggregateType:   "Test",
			AggregateID:     "agg_pg_" + itoa(run),
			AggregateVersion: 1,
			PrincipalID:     "user_pg_1",
			OccurredAt:      now,
			CorrelationID:   "corr_pg_outbox",
			Payload:         map[string]any{"k": "v"},
		}
	}

	// The shared PG cluster holds outbox rows from other tests in the
	// same package. Pre-clean any stale rows that share our unique
	// aggregate id so the Claim count is exact.
	_, _ = pool.Exec(ctx, `DELETE FROM integration.outbox_messages WHERE aggregate_id=$1`, "agg_pg_"+itoa(run))

	// 1. Publish a domain event. The row must exist in
	// integration.outbox_messages with status=PENDING.
	e1 := mkEvent("e1", "OrderCreated")
	if err := repo.Publish(ctx, e1); err != nil {
		t.Fatalf("Publish e1: %v", err)
	}
	gotStatus, gotAttempts := outboxStatusPG(t, pool, e1.EventID)
	if gotStatus != "PENDING" || gotAttempts != 0 {
		t.Fatalf("after Publish, want PENDING/0, got %s/%d", gotStatus, gotAttempts)
	}

	// 2. Duplicate publish on the same event_id is deduped (ON CONFLICT
	// DO NOTHING). The row count must remain 1.
	if err := repo.Publish(ctx, e1); err != nil {
		t.Fatalf("Publish e1 again (dedupe): %v", err)
	}
	if n := outboxRowCountPG(t, pool, e1.EventID); n != 1 {
		t.Fatalf("dedupe failed, row count=%d", n)
	}

	// 3. Claim by worker A. We pull a batch (limit=200) and find OUR
	// event among the other test rows in the shared cluster. After
	// this step, our event must be in PROCESSING with attempts=1.
	claimed, err := repo.Claim(ctx, "worker_A", 200, now.Add(time.Second))
	if err != nil {
		t.Fatalf("Claim worker_A: %v", err)
	}
	foundE1 := false
	for _, m := range claimed {
		if m.Event.EventID == e1.EventID {
			foundE1 = true
			if m.Status != "PROCESSING" || m.Attempts != 1 {
				t.Fatalf("Claimed e1 must be PROCESSING/1, got %s/%d", m.Status, m.Attempts)
			}
		}
	}
	if !foundE1 {
		t.Fatalf("Claim worker_A must return e1 among %d messages", len(claimed))
	}
	if claimed[0].Status != "PROCESSING" || claimed[0].Attempts != 1 {
		t.Fatalf("Claimed must be PROCESSING/1, got %s/%d", claimed[0].Status, claimed[0].Attempts)
	}
	if got, _ := outboxStatusPG(t, pool, e1.EventID); got != "PROCESSING" {
		t.Fatalf("after Claim, row must be PROCESSING, got %s", got)
	}

	// 4. A second Claim by worker B in the same instant must not see
	// OUR event (SKIP LOCKED prevents double-claim on the row we just
	// claimed). We filter by eventID rather than asserting len=0,
	// because other test rows in the shared cluster may also be
	// claimable.
	claimedB, err := repo.Claim(ctx, "worker_B", 50, now.Add(time.Second))
	if err != nil {
		t.Fatalf("Claim worker_B: %v", err)
	}
	for _, m := range claimedB {
		if m.Event.EventID == e1.EventID {
			t.Fatalf("concurrent Claim must not return e1, got it from worker_B")
		}
	}

	// 5. MarkSent flips to SENT. Wrong worker must NOT succeed
	// (status remains PROCESSING, last_error unset).
	if err := repo.MarkSent(ctx, "worker_B", e1.EventID, now); err == nil {
		t.Fatalf("MarkSent from wrong worker must fail, got nil")
	}
	if err := repo.MarkSent(ctx, "worker_A", e1.EventID, now); err != nil {
		t.Fatalf("MarkSent worker_A: %v", err)
	}
	gotStatus, _ = outboxStatusPG(t, pool, e1.EventID)
	if gotStatus != "SENT" {
		t.Fatalf("after MarkSent, want SENT, got %s", gotStatus)
	}

	// 6. Publish e2, claim, MarkFailed with backoff (FAILED status
	// with future available_at). After backoff window passes, a
	// follow-up Claim must pick it up again and bump attempts.
	e2 := mkEvent("e2", "OfferAccepted")
	if err := repo.Publish(ctx, e2); err != nil {
		t.Fatalf("Publish e2: %v", err)
	}
	claimed, err = repo.Claim(ctx, "worker_A", 50, now.Add(time.Second))
	if err != nil {
		t.Fatalf("Claim e2: %v", err)
	}
	foundE2 := false
	for _, m := range claimed {
		if m.Event.EventID == e2.EventID {
			foundE2 = true
		}
	}
	if !foundE2 {
		t.Fatalf("Claim after Publish e2 must return e2, did not find it in %d messages", len(claimed))
	}
	futureAvail := now.Add(2 * time.Hour)
	if err := repo.MarkFailed(ctx, "worker_A", e2.EventID, "synthetic transient", futureAvail, false); err != nil {
		t.Fatalf("MarkFailed e2: %v", err)
	}
	gotStatus, _ = outboxStatusPG(t, pool, e2.EventID)
	if gotStatus != "FAILED" {
		t.Fatalf("after MarkFailed non-deadletter, want FAILED, got %s", gotStatus)
	}
	// Within the backoff window, e2 is NOT re-claimable.
	claimed, err = repo.Claim(ctx, "worker_A", 50, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("Claim during backoff: %v", err)
	}
	for _, m := range claimed {
		if m.Event.EventID == e2.EventID {
			t.Fatalf("e2 must NOT be claimable during backoff window, got attempts=%d", m.Attempts)
		}
	}
	// After the backoff window passes, e2 IS re-claimable and attempts
	// increments to 2.
	claimed, err = repo.Claim(ctx, "worker_A", 50, futureAvail.Add(time.Second))
	if err != nil {
		t.Fatalf("Claim after backoff: %v", err)
	}
	foundRetry := false
	for _, m := range claimed {
		if m.Event.EventID == e2.EventID {
			foundRetry = true
			if m.Attempts != 2 {
				t.Fatalf("retry attempts must be 2, got %d", m.Attempts)
			}
			if m.LastError != "synthetic transient" {
				t.Fatalf("last_error must persist, got %q", m.LastError)
			}
		}
	}
	if !foundRetry {
		t.Fatalf("e2 must be re-claimable after backoff window")
	}

	// 7. MarkFailed with deadLetter=true flips to DEAD_LETTER. After
	// that, the row must NOT be re-claimable even past the backoff
	// window — DEAD_LETTER is terminal.
	if err := repo.MarkFailed(ctx, "worker_A", e2.EventID, "permanent", futureAvail, true); err != nil {
		t.Fatalf("MarkFailed e2 deadletter: %v", err)
	}
	gotStatus, _ = outboxStatusPG(t, pool, e2.EventID)
	if gotStatus != "DEAD_LETTER" {
		t.Fatalf("after MarkFailed deadletter, want DEAD_LETTER, got %s", gotStatus)
	}
	claimed, err = repo.Claim(ctx, "worker_A", 10, futureAvail.Add(time.Hour))
	if err != nil {
		t.Fatalf("Claim after deadletter: %v", err)
	}
	for _, m := range claimed {
		if m.Event.EventID == e2.EventID {
			t.Fatalf("DEAD_LETTER must NOT be re-claimable, got %s", m.Status)
		}
	}

	// 8. Stale claim recovery: a message left in PROCESSING with
	// claimed_until in the past must be reclaimed by the next Claim
	// (i.e. another worker can pick it up). We simulate this by
	// publishing e3, claiming, then advancing time past claimed_until.
	e3 := mkEvent("e3", "StaleRecovery")
	if err := repo.Publish(ctx, e3); err != nil {
		t.Fatalf("Publish e3: %v", err)
	}
	claimed, err = repo.Claim(ctx, "worker_A", 50, now.Add(time.Second))
	if err != nil {
		t.Fatalf("Claim e3: %v", err)
	}
	foundE3 := false
	for _, m := range claimed {
		if m.Event.EventID == e3.EventID {
			foundE3 = true
		}
	}
	if !foundE3 {
		t.Fatalf("Claim after Publish e3 must return e3")
	}
	// Now move time 10 minutes forward (past the 5-min claim TTL) and
	// have a different worker claim. The stale claim must be released
	// and e3 must be re-claimable with attempts=2.
	claimedLater, err := repo.Claim(ctx, "worker_B", 50, now.Add(10*time.Minute))
	if err != nil {
		t.Fatalf("Claim after TTL: %v", err)
	}
	foundStale := false
	for _, m := range claimedLater {
		if m.Event.EventID == e3.EventID {
			foundStale = true
			if m.Attempts != 2 {
				t.Fatalf("stale-claim recovery must bump attempts to 2, got %d", m.Attempts)
			}
		}
	}
	if !foundStale {
		t.Fatalf("stale PROCESSING message must be reclaimable after TTL, got %d messages", len(claimedLater))
	}

	// 9. MarkSent on a missing event_id must return ErrMessageNotClaimed.
	err = repo.MarkSent(ctx, "worker_B", "evt_pg_does_not_exist", now)
	if err != outbox.ErrMessageNotClaimed {
		t.Fatalf("MarkSent on missing id must return ErrMessageNotClaimed, got %v", err)
	}

	cleanupOutboxPG(t, pool, []string{e1.EventID, e2.EventID, e3.EventID})
}

func outboxStatusPG(t *testing.T, pool *pgxpool.Pool, eventID string) (string, int) {
	t.Helper()
	ctx := context.Background()
	var status string
	var attempts int
	err := pool.QueryRow(ctx, `SELECT status, attempts FROM integration.outbox_messages WHERE event_id=$1`, eventID).Scan(&status, &attempts)
	if err != nil {
		t.Fatalf("outbox status query: %v", err)
	}
	return status, attempts
}

func outboxRowCountPG(t *testing.T, pool *pgxpool.Pool, eventID string) int {
	t.Helper()
	ctx := context.Background()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM integration.outbox_messages WHERE event_id=$1`, eventID).Scan(&n); err != nil {
		t.Fatalf("outbox count: %v", err)
	}
	return n
}

func cleanupOutboxPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM integration.outbox_messages WHERE event_id=$1`, id); err != nil {
			t.Logf("cleanup outbox %s: %v", id, err)
		}
	}
}
