package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/conversation"
)

// UNREAD-PIPELINE-001: 阅读位在 PG 里的回环。last_read_at 和 last_read_seq
// 必须一起存取 —— messages 表没有 seq 列，全零 Seq 的消息只能按时间判定，
// 丢一边 PG 上的未读数就算不对。run-scoped ID，用完即弃（同一表别的测试不碰）。
func TestDialogReadCursorPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewDialogRepository(pool)

	run := time.Now().UnixNano()
	userID := "user_cursor_pg_" + itoa(run)
	dialogID := "dlg_cursor_pg_" + itoa(run)

	// read_cursors.dialog_id 有外键：先建 run 级别的 dialog 行，用完一起删。
	now := time.Now().UTC()
	if err := repo.CreateDialog(ctx, conversation.Dialog{
		ID: dialogID, Type: "dm", Title: "cursor probe",
		MemberIDs: []string{userID}, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatalf("CreateDialog: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM conversation.read_cursors WHERE user_id=$1 AND dialog_id=$2`, userID, dialogID)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM conversation.dialogs WHERE id=$1`, dialogID)
	})

	// 没标过：零值 + nil error（调用方把缺席当“全量未读”，不慢慢查）。
	cur, err := repo.GetReadCursor(ctx, userID, dialogID)
	if err != nil {
		t.Fatalf("GetReadCursor missing: %v", err)
	}
	if cur.LastReadSeq != 0 || !cur.LastReadAt.IsZero() {
		t.Fatalf("missing cursor must be zero, got %+v", cur)
	}

	markAt := time.Now().UTC().Truncate(time.Microsecond)
	if err := repo.UpsertReadCursor(ctx, conversation.ReadCursor{
		UserID: userID, DialogID: dialogID, LastReadSeq: 7, LastReadAt: markAt,
	}); err != nil {
		t.Fatalf("UpsertReadCursor: %v", err)
	}
	cur, err = repo.GetReadCursor(ctx, userID, dialogID)
	if err != nil {
		t.Fatalf("GetReadCursor: %v", err)
	}
	if cur.LastReadSeq != 7 || !cur.LastReadAt.Equal(markAt) {
		t.Fatalf("round trip mismatch: got %+v want seq=7 at=%v", cur, markAt)
	}
}
