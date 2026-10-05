package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/relationship"
)

// MERCHANT-CREATOR-NOTIFY-001：好友请求这一条链路的「事务性」成不成立。
//
// 单测跑的是内存仓（没有事务）。这里在真 PG 上钉：关系行和事件必须同生共死 ——
// 只写一半的那种「成功」正是这次要找的东西（请求显示已发出，对方永远收不到）。
func TestFriendshipUpsertAndPublishIsTransactional(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	a, b := "fr_a_"+run, "fr_b_"+run
	rec := relationship.FriendshipRecord{
		ID: "fr_notify_" + run, UserA: a, UserB: b, State: relationship.FriendshipPending,
		RequesterID: a, CreatedAt: time.Now().UTC().Truncate(time.Second), UpdatedAt: time.Now().UTC().Truncate(time.Second),
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM relationship.friendships WHERE id=$1`, rec.ID)
		_, _ = pool.Exec(bg, `DELETE FROM integration.outbox_messages WHERE aggregate_id=$1`, rec.ID)
	})

	ev := event.New("FriendRequestSent", "Friendship", rec.ID, 1, a, "corr_"+run, "cmd_"+run, time.Now().UTC(), map[string]any{
		"requesterId": a, "targetId": b, "notifyPrincipalId": b,
	})
	repo := NewRelationshipRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	saved, err := repo.UpsertFriendshipAndPublish(ctx, rec, []event.DomainEvent{ev})
	if err != nil {
		t.Fatalf("UpsertFriendshipAndPublish: %v", err)
	}
	if saved.ID != rec.ID || saved.State != relationship.FriendshipPending {
		t.Fatalf("saved record = %+v", saved)
	}
	var outboxRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1 AND event_type='FriendRequestSent'`, rec.ID).Scan(&outboxRows); err != nil {
		t.Fatal(err)
	}
	if outboxRows != 1 {
		t.Fatalf("the event must reach the outbox, rows=%d", outboxRows)
	}

	// 没配 outbox 的仓储必须**拒绝**，而不是安静地只写关系行 —— 那正是本次修的洞。
	bare := NewRelationshipRepository(pool)
	other := rec
	other.ID = "fr_notify_bare_" + run
	other.UserA, other.UserB = "fr_ba_"+run, "fr_bb_"+run
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM relationship.friendships WHERE id=$1`, other.ID)
	})
	if _, err := bare.UpsertFriendshipAndPublish(ctx, other, []event.DomainEvent{event.New("FriendRequestSent", "Friendship", other.ID, 1, other.UserA, "c", "d", time.Now().UTC(), map[string]any{"notifyPrincipalId": other.UserB})}); err == nil {
		t.Fatal("without an outbox the write must fail loudly, not store half the fact")
	}
	var bareRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM relationship.friendships WHERE id=$1`, other.ID).Scan(&bareRows); err != nil {
		t.Fatal(err)
	}
	if bareRows != 0 {
		t.Fatalf("a rejected write must leave no friendship row, got %d", bareRows)
	}
}
