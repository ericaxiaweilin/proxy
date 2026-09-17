package postgres

import (
	"context"
	"testing"
	"time"
)

// BADGE-WALL-001: 打卡史回环 —— 过期的算，取消的不算（删行了），空返回 []。
// run-scoped actor，checkins 表无外键，用完删自己的行。
func TestCheckinHistoryPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewRealitySceneRepository(pool)

	run := time.Now().UnixNano()
	actor := "user_hist_pg_" + itoa(run)
	now := time.Now().UTC()
	old := now.Add(-3 * time.Hour)
	if err := repo.CheckInScene(ctx, actor, "hist_old_"+itoa(run), nil, old); err != nil {
		t.Fatalf("CheckInScene old: %v", err)
	}
	if err := repo.CheckInScene(ctx, actor, "hist_fresh_"+itoa(run), nil, now); err != nil {
		t.Fatalf("CheckInScene fresh: %v", err)
	}
	if err := repo.CheckInScene(ctx, actor, "hist_cancel_"+itoa(run), nil, now); err != nil {
		t.Fatalf("CheckInScene: %v", err)
	}
	if err := repo.CancelCheckIn(ctx, actor, "hist_cancel_"+itoa(run)); err != nil {
		t.Fatalf("CancelCheckIn: %v", err)
	}
	history, err := repo.ListMyCheckinHistory(ctx, actor)
	if err != nil {
		t.Fatalf("ListMyCheckinHistory: %v", err)
	}
	got := map[string]bool{}
	for _, id := range history {
		got[id] = true
	}
	if !got["hist_old_"+itoa(run)] || !got["hist_fresh_"+itoa(run)] {
		t.Fatalf("history must include expired-but-not-cancelled: %v", history)
	}
	if got["hist_cancel_"+itoa(run)] {
		t.Fatalf("cancelled must not count: %v", history)
	}
	t.Cleanup(func() {
		for _, id := range history {
			_, _ = pool.Exec(context.Background(),
				`DELETE FROM reality.scene_checkins WHERE scene_id=$1 AND actor_id=$2`, id, actor)
		}
	})
}
