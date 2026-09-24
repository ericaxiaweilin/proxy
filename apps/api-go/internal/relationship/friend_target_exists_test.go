package relationship

import (
	"context"
	"testing"
)

// FRIEND-TARGET-EXISTS-001 —— 目标账号不存在时不得写 PENDING。
//
// 首页「真人推荐」rail 曾经把本地 fixture id（u_vy）当 targetUserId 发出来，
// 于是 relationship.friendships 里落了一批 user_a/user_b 是 u_* 的行 ——
// 没有账号、没有真人能收到同意入口。用户点 + 看到「申请已发送」，
// 但那条申请永远不会被任何人同意（库里实测攒了 12 条，见 894f256 清掉的那批）。
//
// 客户端已经改成发送前解析账号 id，但客户端不是权限边界：旧客户端 / curl
// 仍能直调 SendFriendRequest，所以服务端必须自己 fail-closed。
//
// 注入式判定（identity.user_accounts 的精确存在性），relationship 不 import identity。

func TestFriendRequestToMissingAccountIsRejectedWithoutRow(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	// 只有 user_bob 是真实账号；u_vy 是客户端 fixture id，服务端没有这个账号。
	svc.SetTargetAccountExists(func(_ context.Context, targetUserID string) bool {
		return targetUserID == "user_bob"
	})

	result := svc.Handle(envelope("SendFriendRequest", "user_alice", "u_vy"))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "FRIEND_TARGET_NOT_FOUND" {
		t.Fatalf("missing-account friend request must be rejected explicitly: %s / %+v", result.Outcome, result.Error)
	}
	rows, err := repo.ListByUser(contextBackground(), "user_alice")
	if err != nil {
		t.Fatalf("ListByUser: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rejected request must not create a dead PENDING row: %+v", rows)
	}
}

func TestFriendRequestToExistingAccountStillWorks(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetTargetAccountExists(func(_ context.Context, targetUserID string) bool {
		return targetUserID == "user_bob"
	})

	result := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("request to an existing account must still work: %s / %+v", result.Outcome, result.Error)
	}
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipPending {
		t.Errorf("state = %s, want PENDING", row.State)
	}
}

// 两条拒绝必须是不同的错误码：AI 账号**存在**（只是不会 accept），
// 不存在的账号是另一回事。合并成一条，客户端就没法区分
// 「这个人不存在」和「这个人不收申请」——正是 SOUL 里那条
// 「没有数据 / 没有权限 / 没有这个记录不能长得一样」。
func TestMissingAccountAndAINonAcceptorHaveDistinctCodes(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	svc.SetCannotFriendTarget(func(targetUserID string) bool {
		return targetUserID == "ai_account_001"
	})
	svc.SetTargetAccountExists(func(_ context.Context, targetUserID string) bool {
		// ai_account_001 存在（平台 AI 是可寻址账号），u_ghost 不存在。
		return targetUserID == "ai_account_001" || targetUserID == "user_bob"
	})

	aiResult := svc.Handle(envelope("SendFriendRequest", "user_alice", "ai_account_001"))
	if aiResult.Error == nil || aiResult.Error.ErrorCode != "FRIEND_TARGET_DOES_NOT_ACCEPT_REQUESTS" {
		t.Fatalf("existing-but-AI target must keep its own code: %s / %+v", aiResult.Outcome, aiResult.Error)
	}

	missingResult := svc.Handle(envelope("SendFriendRequest", "user_alice", "u_ghost"))
	if missingResult.Error == nil || missingResult.Error.ErrorCode != "FRIEND_TARGET_NOT_FOUND" {
		t.Fatalf("missing target must report NOT_FOUND: %s / %+v", missingResult.Outcome, missingResult.Error)
	}

	if aiResult.Error.ErrorCode == missingResult.Error.ErrorCode {
		t.Fatal("missing account and non-accepting AI account must not share an error code")
	}
}

// 未接线时（nil）保持旧行为：这条钉住"注入是可选增强"，
// 同时 gate 反向钉住生产必须接线（否则等于没修）。
func TestUnwiredExistenceCheckKeepsLegacyBehaviour(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	result := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("unwired service must behave as before: %s / %+v", result.Outcome, result.Error)
	}
}
