package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/relationship"
)

// FRIEND-BLOCK-UNDO-001 PG 面：blocked_by 列的写入与读回（migration 116）。
// 内存单测钉语义，这里只钉"列真的存在且往返一致"——列名拼错/漏加到
// SELECT 里是内存测看不见的错（见 relationship_integration_test.go 头注释
// 的 42601 教训）。行 id 唯一，t.Cleanup 精确删 pair。
func TestRelationshipPostgresBlockedByRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewRelationshipRepository(pool)

	run := time.Now().UnixNano()
	a := "relblk_a_" + itoa(run)
	b := "relblk_b_" + itoa(run)
	now := time.Now().UTC().Truncate(time.Microsecond)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM relationship.friendships WHERE user_a = $1 AND user_b = $2`, a, b)
	})

	rec := relationship.FriendshipRecord{
		ID: "fr_relblk", UserA: a, UserB: b,
		State: relationship.FriendshipBlocked, RequesterID: b, BlockedBy: b,
		CreatedAt: now, UpdatedAt: now,
	}
	if _, err := repo.UpsertFriendship(ctx, rec); err != nil {
		t.Fatalf("upsert BLOCKED with blocked_by: %v", err)
	}
	got, err := repo.GetFriendship(ctx, a, b)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.BlockedBy != b {
		t.Fatalf("blocked_by round-trip: got %q want %q", got.BlockedBy, b)
	}
	// 清掉 blocker 再写回：非 BLOCKED 行必须能把列置空（transition 的 else 分支）。
	rec.State = relationship.FriendshipFriend
	rec.RequesterID = a
	rec.BlockedBy = ""
	rec.UpdatedAt = now.Add(time.Hour)
	if _, err := repo.UpsertFriendship(ctx, rec); err != nil {
		t.Fatalf("upsert clearing blocked_by: %v", err)
	}
	got, err = repo.GetFriendship(ctx, a, b)
	if err != nil {
		t.Fatalf("get after clear: %v", err)
	}
	if got.BlockedBy != "" {
		t.Fatalf("blocked_by must clear on non-BLOCKED states, got %q", got.BlockedBy)
	}
}
