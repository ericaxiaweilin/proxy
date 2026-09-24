package relationship

import "testing"

// FRIEND-BLOCK-REENTRY-001 —— 「屏蔽」必须真的挡住重复骚扰。
//
// 逃逸路径（按钮级合规审计 2026-09-22）：
//   A 拉黑 B → row.State = BLOCKED → ListMyFriendships 隐藏这行；
//   B 再点一次加好友 → 旧 sendFriendRequest 无条件 Upsert(PENDING)；
//   A 的收件箱重新出现 B。
//
// 这不是一个普通状态机 bug：Terms 禁止骚扰，举报理由里也有 Harassment，
// 「屏蔽」就是用户自己能按下的核心防骚扰控件。按钮显示成功但服务端边界
// 能被同一个按钮绕过，等于控件没有实现。

// TestBlockedFriendCannotReopenRequestFromBlockedSide 钉审计报告里的原始逃逸：
// Alice 拉黑 Bob，Bob 不能再把行翻回 PENDING。
func TestBlockedFriendCannotReopenRequestFromBlockedSide(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob→alice request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("BlockFriend", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice blocks bob: %s / %+v", r.Outcome, r.Error)
	}

	retry := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice"))
	if retry.Outcome != "REJECTED" || retry.Error == nil || retry.Error.ErrorCode != "FRIEND_REQUEST_UNAVAILABLE" {
		t.Fatalf("blocked user must not reopen a request: %s / %+v", retry.Outcome, retry.Error)
	}

	// 核心后置条件：数据库里的边界仍是 BLOCKED，不只是 API 说了句拒绝。
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipBlocked {
		t.Fatalf("blocked row was overwritten: state=%s, want BLOCKED", row.State)
	}
	if row.RequesterID != "user_bob" {
		t.Fatalf("rejected retry must not rewrite requesterId: got %s", row.RequesterID)
	}
}

// TestBlockCannotBeSilentlyUndoneByBlocker 钉另一方向：当前 schema 没有 blocked_by，
// 历史 BLOCKED 行也不能可靠反推谁按了按钮。因此任一方向重发都不能把它
// 当成隐式 unblock。未来如果产品要「解除屏蔽」，必须是一个显式命令。
func TestBlockCannotBeSilentlyUndoneByBlocker(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("bob→alice request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("BlockFriend", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("alice blocks bob: %s / %+v", r.Outcome, r.Error)
	}

	// 连按屏蔽的人自己也不能用 SendFriendRequest 偷偷解除；否则一个 UI 误触
	// 就把防骚扰边界撤了，而且没有 Unblock 事件可审计。
	retry := svc.Handle(envelope("SendFriendRequest", "user_alice", "user_bob"))
	if retry.Outcome != "REJECTED" || retry.Error == nil || retry.Error.ErrorCode != "FRIEND_REQUEST_UNAVAILABLE" {
		t.Fatalf("blocker must use an explicit future Unblock command: %s / %+v", retry.Outcome, retry.Error)
	}
	row, err := repo.GetFriendship(contextBackground(), "user_alice", "user_bob")
	if err != nil {
		t.Fatalf("GetFriendship: %v", err)
	}
	if row.State != FriendshipBlocked {
		t.Fatalf("blocked row was overwritten: state=%s, want BLOCKED", row.State)
	}
}

// TestIgnoredRequestMayStillBeResent 证明修复没有把 Ignore 误改成 Block：
// Ignore 的产品语义本来就是「这次不要，但以后还可再发」（service.go 的注释）。
func TestIgnoredRequestMayStillBeResent(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("request: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("IgnoreFriendRequest", "user_alice", "user_bob")); r.Outcome != "ACCEPTED" {
		t.Fatalf("ignore: %s / %+v", r.Outcome, r.Error)
	}
	if r := svc.Handle(envelope("SendFriendRequest", "user_bob", "user_alice")); r.Outcome != "ACCEPTED" {
		t.Fatalf("ignore must not become a permanent block: %s / %+v", r.Outcome, r.Error)
	}
}
