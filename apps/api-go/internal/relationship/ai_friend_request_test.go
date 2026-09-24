package relationship

import "testing"

// AI-FRIEND-REQUEST-001 —— 平台 AI 不接受好友申请。
//
// 按钮级审计发现：首页 AI 卡右下 + 与真人共用 SendFriendRequest，AI 主页也
// 走同一条链。平台 AI 不会主动 Accept，于是每次点击都会创建一条永远
// PENDING 的死记录，用户看到「好友申请已发送」，对方永远不回。
//
// 移动端已把 + 改成发消息，但服务端仍必须拒绝旧客户端 / curl ——
// 客户端按钮不是权限边界。

func TestPlatformAIFriendRequestIsRejectedWithoutCreatingPendingRow(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetCannotFriendTarget(func(targetID string) bool {
		return targetID == "ai_account_001"
	})

	result := svc.Handle(envelope("SendFriendRequest", "user_alice", "ai_account_001"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "FRIEND_TARGET_DOES_NOT_ACCEPT_REQUESTS" {
		t.Fatalf("platform AI friend request must be rejected explicitly: %s / %+v", result.Outcome, result.Error)
	}
	rows, err := repo.ListByUser(contextBackground(), "user_alice")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rejected AI request must not create a dead PENDING row: %+v", rows)
	}
}

func TestHumanFriendRequestStillWorksWithAIDirectoryWired(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetCannotFriendTarget(func(targetID string) bool {
		return targetID == "ai_account_001"
	})

	result := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("human friend request must still work: %s / %+v", result.Outcome, result.Error)
	}
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipPending {
		t.Errorf("human request state = %s, want PENDING", row.State)
	}
}
