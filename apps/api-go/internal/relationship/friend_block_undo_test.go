package relationship

import "testing"

// FRIEND-BLOCK-UNDO-001 —— 拉黑必须记下"谁按的"，否则将来的显式 Unblock
// 命令无从判定只能两边都拒到底（含拉黑者本人想加回来）。
//
// 本文件只钉"记下来了"：放行/拒绝语义一个字不改（block_reentry_test 的三条
// pinned 测试必须原样全绿 —— 解除必须是显式命令，不能是重发，也不能是
// 本文件的任何断言偷偷放宽）。

func TestBlockRecordsBlocker(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("BlockFriend", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("block: %s / %+v", r.Outcome, r.Error)
	}
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipBlocked {
		t.Fatalf("state = %s, want BLOCKED", row.State)
	}
	if row.BlockedBy != "user_alice" {
		t.Fatalf("blocked_by = %q, want the blocker user_alice", row.BlockedBy)
	}
}

func TestBlockedRowSurvivesRejectedRetry(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("BlockFriend", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("block: %s / %+v", r.Outcome, r.Error)
	}
	// 拉黑者本人也不能重发（pinned 语义），但行里的 blocker 必须还在 ——
	// 未来的 Unblock 命令靠它认人。
	retry := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob"))
	if retry.Outcome != "REJECTED" {
		t.Fatalf("blocker re-request must still be rejected without an explicit Unblock command: %s", retry.Outcome)
	}
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipBlocked || row.BlockedBy != "user_alice" {
		t.Fatalf("rejected retry must not touch the row: %+v", row)
	}
}
