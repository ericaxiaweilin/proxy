package postgres

import (
	"strconv"
	"testing"
	"time"
)

func TestInboxDedupeIsIdempotent(t *testing.T) {
	pool := testPool(t)
	repo := NewInboxRepository(pool)
	ctx := t.Context()
	// 固定 ID 在并发跑（两个 agent 同时跑测试）时会互踩：A 还没 cleanup，
	// B 的第一次 TryProcess 就返回 false。run 级唯一，各跑各的。
	eventID := "evt_test_dedupe_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	ok, err := repo.TryProcess(ctx, eventID, "TaskPublished", "Task", "task_001")
	if err != nil || !ok {
		t.Fatalf("first TryProcess must succeed, ok=%v err=%v", ok, err)
	}
	ok, err = repo.TryProcess(ctx, eventID, "TaskPublished", "Task", "task_001")
	if err != nil || ok {
		t.Fatalf("second TryProcess must be deduped, ok=%v err=%v", ok, err)
	}
	is, err := repo.IsProcessed(ctx, eventID)
	if err != nil || !is {
		t.Fatalf("IsProcessed must be true, is=%v err=%v", is, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM inbox.processed_events WHERE event_id=$1`, eventID)
	})
}
