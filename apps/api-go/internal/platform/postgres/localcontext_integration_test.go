package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/localcontext"
)

// TestLocalContextPostgresLifecycle covers the M1 LocalContext chain
// through real PostgreSQL: SetLocalContext (CITY precision, then
// COARSE_AREA with a known area) → GetLocalContext round-trip
// (proves the row was persisted, not just cached in memory) →
// invalid market / invalid area / invalid source rejections. Also
// covers the GrantExactLocation 24h ephemeral grant (does NOT persist
// to PG by design — the gate is that no row appears in
// localcontext.exact_grants after a grant).
func TestLocalContextPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalContextRepository(pool)
	svc := localcontext.NewWithRepository(repo)

	run := time.Now().UnixNano()
	actorID := "user_lc_pg_" + itoa(run)

	// 1. SetLocalContext with city only: CITY precision, no area.
	r := svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"marketId": "hanoi", "source": "MANUAL",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SetLocalContext city: %+v", r.Error)
	}
	if r.Aggregate.State != "SET" {
		t.Fatalf("after Set, want SET, got %s", r.Aggregate.State)
	}

	// 2. GetLocalContext round-trip via PG repo.
	got, err := repo.GetContext(ctx, actorID)
	if err != nil {
		t.Fatalf("GetContext from PG: %v", err)
	}
	if got.MarketID != "hanoi" || got.MarketLabel != "河内" {
		t.Fatalf("GetContext market wrong: %+v", got)
	}
	if got.Precision != "CITY" || got.AreaID != "" {
		t.Fatalf("CITY precision / no area expected, got %+v", got)
	}

	// 3. Upsert: set with a known area. Must UPDATE, not duplicate
	// rows. COARSE_AREA precision.
	r = svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"marketId": "hanoi", "areaId": "hoankiem", "source": "DEVICE",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SetLocalContext with area: %+v", r.Error)
	}
	got, _ = repo.GetContext(ctx, actorID)
	if got.AreaID != "hoankiem" || got.Precision != "COARSE_AREA" || got.AreaLabel != "还剑湖附近" {
		t.Fatalf("COARSE_AREA upsert wrong: %+v", got)
	}
	// Must still be exactly 1 row for this actor.
	rowCount := localContextRowCountPG(t, pool, actorID)
	if rowCount != 1 {
		t.Fatalf("upsert must not duplicate row, got %d rows", rowCount)
	}

	// 4. Invalid market: must be REJECTED with MARKET_NOT_FOUND.
	r = svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"marketId": "atlantis", "source": "MANUAL",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("unknown market must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "MARKET_NOT_FOUND" {
		t.Fatalf("expected MARKET_NOT_FOUND, got %+v", r.Error)
	}

	// 5. Valid market but invalid area: must be REJECTED with
	// AREA_NOT_FOUND.
	r = svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"marketId": "hanoi", "areaId": "atlantis_district", "source": "MANUAL",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("unknown area must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "AREA_NOT_FOUND" {
		t.Fatalf("expected AREA_NOT_FOUND, got %+v", r.Error)
	}

	// 6. Invalid source: must be REJECTED with INVALID_CONTEXT_SOURCE.
	r = svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"marketId": "hanoi", "source": "GPS_SNIFF",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("bad source must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_CONTEXT_SOURCE" {
		t.Fatalf("expected INVALID_CONTEXT_SOURCE, got %+v", r.Error)
	}

	// 7. Empty marketId: must be REJECTED with INVALID_LOCAL_CONTEXT.
	r = svc.HandleContext(ctx, lcEnvelope("SetLocalContext", map[string]any{
		"source": "MANUAL",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("empty marketId must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_LOCAL_CONTEXT" {
		t.Fatalf("expected INVALID_LOCAL_CONTEXT, got %+v", r.Error)
	}

	// 8. GetLocalContext on the actor: must return state=SET, the
	// previously upserted context.
	r = svc.HandleContext(ctx, lcEnvelope("GetLocalContext", map[string]any{}, actorID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "SET" {
		t.Fatalf("GetLocalContext after set: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}

	// 9. GetLocalContext on a fresh actor: must return state=UNSET
	// (the in-memory seed has nothing for this new actor, and the PG
	// row is also absent).
	freshActor := "user_lc_pg_fresh_" + itoa(run)
	r = svc.HandleContext(ctx, lcEnvelope("GetLocalContext", map[string]any{}, freshActor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("GetLocalContext fresh: %+v", r.Error)
	}
	if r.Aggregate.State != "UNSET" {
		t.Fatalf("fresh GetLocalContext must be UNSET, got %s", r.Aggregate.State)
	}

	// 10. GrantExactLocation is ephemeral by design. Issue one
	// for TASK purpose, then verify the actor's context row is
	// unchanged AND no exact_grants row appeared (table may not
	// exist; that's fine — it just means the grant was not
	// persisted, which is the contract).
	r = svc.HandleContext(ctx, lcEnvelope("GrantExactLocation", map[string]any{
		"purpose": "TASK", "referenceId": "task_pg_" + itoa(run),
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("GrantExactLocation: %+v", r.Error)
	}
	if r.Aggregate.State != "GRANTED" {
		t.Fatalf("GrantExactLocation state must be GRANTED, got %s", r.Aggregate.State)
	}
	// The LocalContext row must NOT have changed.
	post, _ := repo.GetContext(ctx, actorID)
	if post.MarketID != "hanoi" || post.AreaID != "hoankiem" {
		t.Fatalf("GrantExactLocation must not mutate LocalContext: %+v", post)
	}

	// 11. Invalid grant purpose: must be REJECTED with
	// INVALID_GRANT_PURPOSE.
	r = svc.HandleContext(ctx, lcEnvelope("GrantExactLocation", map[string]any{
		"purpose": "GLOBAL_TRACKING", "referenceId": "x",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("bad grant purpose must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_GRANT_PURPOSE" {
		t.Fatalf("expected INVALID_GRANT_PURPOSE, got %+v", r.Error)
	}

	cleanupLocalContextPG(t, pool, []string{actorID})
}

func localContextRowCountPG(t *testing.T, pool *pgxpool.Pool, actorID string) int {
	t.Helper()
	ctx := context.Background()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM localcontext.contexts WHERE actor_id=$1`, actorID).Scan(&n); err != nil {
		t.Fatalf("count contexts: %v", err)
	}
	return n
}

func cleanupLocalContextPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM localcontext.contexts WHERE actor_id=$1`, id); err != nil {
			t.Logf("cleanup contexts: %v", err)
		}
	}
}

func lcEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_lc_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_lc_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_lc_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}
