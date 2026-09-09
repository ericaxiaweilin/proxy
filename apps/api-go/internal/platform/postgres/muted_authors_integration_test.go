package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/engagement"
)

// TestMutedAuthorsPostgresLifecycle pins the production write/read path of
// engagement.muted_authors (migration 078, MUTED-AUTHORS-001) through real
// PostgreSQL. The MuteAuthor command (R15.45) is a complete feature chain —
// service command handling + Repository interface (AddMutedAuthor/IsMuted)
// + EngagementRepository implementation (network.go) + main.go production
// wiring — but no migration had ever created the table. In PG mode every
// mute failed with 'relation "engagement.muted_authors" does not exist'
// (42P01) and the service layer surfaced it as MUTE_AUTHOR_FAILED, while
// the in-memory service tests stayed green — the same PG-only blind-spot
// class as dialog/voucher 42601 and friendship 42P10.
//
// Domain contract being pinned (internal/engagement/service.go):
//   - Composite idempotency key (ActorID, AuthorID): muting the same author
//     twice must return alreadyExisted=true and the ORIGINAL record, not
//     insert a second row. The service only emits AuthorMuted on the first.
//   - IsMuted(actor, author) must reflect the mute for feed filtering, and
//     stay false for unrelated pairs.
//
// Constraint audit (four checks before writing data):
//   - UNIQUE (actor_id, author_id) — both the domain idempotency key and
//     the ON CONFLICT arbiter, table-inline.
//   - CHECK (length(actor_id) > 0) / CHECK (length(author_id) > 0) —
//     empty ids must fail closed.
//   - No FK chain: muted_authors references actors/authors by plain text,
//     no parent rows need to be seeded.
//   - No enum columns.
func TestMutedAuthorsPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)

	run := time.Now().UnixNano()
	runID := itoa(run)
	actor := "mute_actor_" + runID
	author := "mute_author_" + runID
	other := "mute_other_" + runID
	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: shared-DB mode must clean rows it created —
		// exact pair delete, never a broad prefix.
		_, _ = repo.pool.Exec(cleanupCtx, `DELETE FROM engagement.muted_authors WHERE actor_id = $1`, actor)
	})

	// 1. First mute inserts and reports alreadyExisted=false.
	rec, existed, err := repo.AddMutedAuthor(ctx, engagement.MutedAuthor{
		ID:        "mute_" + runID,
		ActorID:   actor,
		AuthorID:  author,
		CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("AddMutedAuthor first insert: %v", err)
	}
	if existed {
		t.Fatalf("first mute reported alreadyExisted=true (want false)")
	}
	if rec.AuthorID != author || rec.ActorID != actor {
		t.Fatalf("round-trip mismatch: got actor=%s author=%s", rec.ActorID, rec.AuthorID)
	}

	// 2. Second mute of the SAME author is idempotent: no new row, the
	// original record comes back. This pins the ON CONFLICT arbiter —
	// before migration 078 the very first call died with 42P01 because
	// the table did not exist at all.
	again, existed2, err := repo.AddMutedAuthor(ctx, engagement.MutedAuthor{
		ID:        "mute_dup_" + runID,
		ActorID:   actor,
		AuthorID:  author,
		CreatedAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("AddMutedAuthor idempotent re-mute: %v", err)
	}
	if !existed2 {
		t.Fatalf("re-mute reported alreadyExisted=false (want true)")
	}
	if again.ID != rec.ID {
		t.Fatalf("re-mute returned different row: got id=%s want %s", again.ID, rec.ID)
	}

	// 3. IsMuted reflects the mute; unrelated pairs stay false.
	muted, err := repo.IsMuted(ctx, actor, author)
	if err != nil {
		t.Fatalf("IsMuted(positive): %v", err)
	}
	if !muted {
		t.Fatalf("IsMuted(actor, author) = false after mute")
	}
	muted, err = repo.IsMuted(ctx, actor, other)
	if err != nil {
		t.Fatalf("IsMuted(negative): %v", err)
	}
	if muted {
		t.Fatalf("IsMuted(actor, other) = true for never-muted pair")
	}
}
