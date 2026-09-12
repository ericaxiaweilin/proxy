package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/relationship"
)

// TestRelationshipPostgresLifecycle pins the production write path of
// relationship.friendships (migration 040, R18.x FRIEND-001) through real
// PostgreSQL. The service layer has 8 in-memory tests (TestListMyFriendships-
// SplitsActiveAndPending etc.) but none of them exercise the pgx INSERT —
// the dialog/voucher 42601 class lesson: a placeholder/column mismatch or a
// wire-format bug in the SQL is invisible to memory tests and only fires in
// PG mode. This lifecycle test makes every repo method falsifiable before
// the next commander wire-up.
//
// Constraint audit (four checks before writing data):
//   - CHECK (user_a < user_b) — the pair MUST be lexically canonical;
//     feeding a non-canonical pair must fail-closed, mirroring the domain
//     layer's orderPair().
//   - CHECK (state IN ('PENDING','FRIEND','BLOCKED','IGNORED_TOMBSTONE')).
//   - CHECK (length(requester_id) > 0).
//   - ON CONFLICT (user_a,user_b) DO UPDATE — upsert semantics: the second
//     request after a pending row must update state/requester, not insert.
func TestRelationshipPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewRelationshipRepository(pool)

	run := time.Now().UnixNano()
	runID := itoa(run)
	// Canonical pair: rel_a_* < rel_b_* lexically by construction.
	userA := "rel_a_" + runID
	userB := "rel_b_" + runID
	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: shared-DB mode must clean rows it created —
		// exact pair delete, never a broad prefix.
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM relationship.friendships WHERE user_a = $1 AND user_b = $2`, userA, userB)
	})

	// 1. UpsertFriendship inserts a canonical PENDING row.
	rec := relationship.FriendshipRecord{
		ID:          "fr_rel_" + runID,
		UserA:        userA,
		UserB:        userB,
		State:        relationship.FriendshipPending,
		RequesterID:  userA,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	out, err := repo.UpsertFriendship(ctx, rec)
	if err != nil {
		t.Fatalf("UpsertFriendship insert: %v", err)
	}
	if out.UserA != userA || out.UserB != userB || out.State != relationship.FriendshipPending {
		t.Fatalf("insert returned wrong pair/state: %+v", out)
	}
	if !out.CreatedAt.Equal(now) {
		t.Fatalf("CreatedAt wire round-trip mismatch: sent %v got %v", now, out.CreatedAt)
	}

	// 2. GetFriendship returns the same row.
	got, err := repo.GetFriendship(ctx, userA, userB)
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if got.ID != out.ID || got.State != relationship.FriendshipPending || got.RequesterID != userA {
		t.Fatalf("GetFriendship mismatch: %+v", got)
	}

	// 3. UpsertFriendship updates in place: PENDING -> FRIEND with a new
	// requester (the accept flow). Must NOT create a second row.
	rec.State = relationship.FriendshipFriend
	rec.RequesterID = userB
	rec.UpdatedAt = now.Add(2 * time.Hour)
	// Wire-format tripwire (dialog $11,$11 class): created and updated are
	// distinct inputs; after the update round-trip they must stay distinct.
	out2, err := repo.UpsertFriendship(ctx, rec)
	if err != nil {
		t.Fatalf("UpsertFriendship update: %v", err)
	}
	if out2.State != relationship.FriendshipFriend || out2.RequesterID != userB {
		t.Fatalf("upsert did not apply update: %+v", out2)
	}
	if !out2.UpdatedAt.Equal(rec.UpdatedAt) {
		t.Fatalf("UpdatedAt not persisted: sent %v got %v", rec.UpdatedAt, out2.UpdatedAt)
	}
	if !out2.CreatedAt.Equal(now) {
		t.Fatalf("CreatedAt must survive update unchanged: want %v got %v", now, out2.CreatedAt)
	}
	if rows, err := countFriendships(ctx, pool, userA, userB); err != nil || rows != 1 {
		t.Fatalf("upsert must keep a single row, got %d (err=%v)", rows, err)
	}

	// 4. ListByUser returns the friendship from both sides.
	for _, uid := range []string{userA, userB} {
		list, err := repo.ListByUser(ctx, uid)
		if err != nil {
			t.Fatalf("ListByUser(%s): %v", uid, err)
		}
		if len(list) != 1 || list[0].State != relationship.FriendshipFriend {
			t.Fatalf("ListByUser(%s) expected 1 FRIEND row, got %+v", uid, list)
		}
	}

	// 5. Non-canonical pair must fail-closed (CHECK user_a < user_b):
	// the SQL constraint and the domain orderPair() must agree.
	bad := relationship.FriendshipRecord{
		ID:          "fr_rel_bad_" + runID,
		UserA:        userB, // deliberately reversed: user_b < user_a
		UserB:        userA,
		State:        relationship.FriendshipPending,
		RequesterID:  userB,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if _, err := repo.UpsertFriendship(ctx, bad); err == nil {
		t.Fatalf("non-canonical pair (user_a > user_b) must violate CHECK (user_a < user_b), got nil error")
	}

	// 6. Missing row maps to the domain not-found error, not a raw pgx error.
	if _, err := repo.GetFriendship(ctx, "rel_missing_a_"+runID, "rel_missing_b_"+runID); err != relationship.ErrFriendshipNotFound {
		t.Fatalf("GetFriendship missing must be ErrFriendshipNotFound, got %v", err)
	}
}

func countFriendships(ctx context.Context, pool *pgxpool.Pool, userA, userB string) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM relationship.friendships WHERE user_a = $1 AND user_b = $2`, userA, userB).Scan(&n)
	return n, err
}
