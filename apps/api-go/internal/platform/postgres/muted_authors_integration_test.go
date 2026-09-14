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

// TestMutedAuthorsPostgresUnmuteAndList pins the MUTE-REVERSIBLE-001 read/write
// path (RemoveMutedAuthor + ListMutedAuthors) through real PostgreSQL.
//
// Why this test exists: MuteAuthor used to be one-way. The write path was
// complete, but there was no UnmuteAuthor command and no way to enumerate your
// own mutes — so a muted author's posts were filtered out of the feed forever
// with no route back. Two things must hold in PG, not just in memory:
//   - RemoveMutedAuthor reports whether a row actually went away (rowsAffected),
//     so a repeat call for an already-removed pair returns false, not an error.
//   - ListMutedAuthors is actor-scoped and ordered created_at DESC, id DESC —
//     the SAME order as MemoryRepository.ListMutedAuthors. If the two diverge,
//     the same assertion passes in memory and fails in production.
func TestMutedAuthorsPostgresUnmuteAndList(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)

	runID := itoa(time.Now().UnixNano())
	actor := "unmute_actor_" + runID
	otherActor := "unmute_actor_other_" + runID
	base := time.Now().UTC().Truncate(time.Microsecond)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: shared-DB mode must clean rows it created —
		// exact-pair deletes, never a broad prefix.
		_, _ = repo.pool.Exec(cleanupCtx, `DELETE FROM engagement.muted_authors WHERE actor_id = $1`, actor)
		_, _ = repo.pool.Exec(cleanupCtx, `DELETE FROM engagement.muted_authors WHERE actor_id = $1`, otherActor)
	})

	// Three mutes for `actor` with explicit, strictly increasing created_at
	// (inserted out of order), plus one belonging to a different actor.
	seed := []struct {
		id     string
		actor  string
		author string
		at     time.Time
	}{
		{actor + "_oldest", actor, actor + "_author_a", base},
		{actor + "_newest", actor, actor + "_author_c", base.Add(2 * time.Second)},
		{actor + "_middle", actor, actor + "_author_b", base.Add(time.Second)},
		{otherActor + "_x", otherActor, otherActor + "_author_z", base.Add(3 * time.Second)},
	}
	for _, spec := range seed {
		if _, _, err := repo.AddMutedAuthor(ctx, engagement.MutedAuthor{
			ID: spec.id, ActorID: spec.actor, AuthorID: spec.author, CreatedAt: spec.at,
		}); err != nil {
			t.Fatalf("seed %s: %v", spec.id, err)
		}
	}

	// 1. Actor-scoped, newest first.
	list, err := repo.ListMutedAuthors(ctx, actor)
	if err != nil {
		t.Fatalf("ListMutedAuthors: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 mutes for actor, got %d (%+v)", len(list), list)
	}
	want := []string{actor + "_author_c", actor + "_author_b", actor + "_author_a"}
	for i := range want {
		if list[i].AuthorID != want[i] {
			t.Fatalf("newest-first order: want %v, got %+v", want, list)
		}
		if list[i].ActorID != actor {
			t.Fatalf("list leaked another actor's mute: %+v", list[i])
		}
	}

	// 2. RemoveMutedAuthor reports whether a row actually went away.
	removed, err := repo.RemoveMutedAuthor(ctx, actor, actor+"_author_b")
	if err != nil {
		t.Fatalf("RemoveMutedAuthor: %v", err)
	}
	if !removed {
		t.Fatal("RemoveMutedAuthor reported false for a pair that was muted")
	}
	removed, err = repo.RemoveMutedAuthor(ctx, actor, actor+"_author_b")
	if err != nil {
		t.Fatalf("RemoveMutedAuthor (second call): %v", err)
	}
	if removed {
		t.Fatal("RemoveMutedAuthor is not idempotent: second call claimed a row was removed")
	}

	// 3. IsMuted and the list both reflect the removal.
	muted, err := repo.IsMuted(ctx, actor, actor+"_author_b")
	if err != nil {
		t.Fatalf("IsMuted after unmute: %v", err)
	}
	if muted {
		t.Fatal("IsMuted still true after RemoveMutedAuthor")
	}
	list, err = repo.ListMutedAuthors(ctx, actor)
	if err != nil {
		t.Fatalf("ListMutedAuthors after unmute: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 mutes after unmute, got %d", len(list))
	}
	for _, mute := range list {
		if mute.AuthorID == actor+"_author_b" {
			t.Fatal("unmuted author is still listed")
		}
	}

	// 4. Removal is pair-scoped: another actor's mute must survive.
	otherList, err := repo.ListMutedAuthors(ctx, otherActor)
	if err != nil {
		t.Fatalf("ListMutedAuthors(other): %v", err)
	}
	if len(otherList) != 1 || otherList[0].AuthorID != otherActor+"_author_z" {
		t.Fatalf("other actor's mute was disturbed: %+v", otherList)
	}

	// 5. An actor with no mutes gets an empty (non-nil) slice, never null.
	empty, err := repo.ListMutedAuthors(ctx, "unmute_nobody_"+runID)
	if err != nil {
		t.Fatalf("ListMutedAuthors(empty): %v", err)
	}
	if empty == nil {
		t.Fatal("ListMutedAuthors returned nil; the read model must marshal as [] not null")
	}
	if len(empty) != 0 {
		t.Fatalf("expected 0 mutes, got %+v", empty)
	}
}
