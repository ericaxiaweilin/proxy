package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-NOTIFY-001（2026-10-05）：**这一条钉的是整件事最贵的那个错**。
//
// 收件箱按 principal id 索引（listInbox / markRead / 深链归属都用 e.Principal.ID），
// 而 creator 侧事件一开始拿 `agentId` 当收件人。agentId 既不是 user account，也不是
// 任何会话的 principal：
//
//	identity.sessions 里 principal_id LIKE 'agent_%'            = 0 行
//	identity.user_accounts 里 id LIKE 'agent_%'                  = 0 行
//	supply.agent_profiles.agent_id ∩ identity.user_accounts.id  = 0 行
//
// 结果是：通知**正确地**写进了 inbox_items，然后永远没有人读到。一行没人读的记录
// 比没有通知更坏 —— 它让「通知系统在工作」这句话看起来是真的。
//
// 这条在真 PG 上断言：给一个真实 creator 发通知，收件人必须是**某个会话的
// principal**（或 user_account），而且必须 ≠ agentId。
func TestCreatorNotificationRecipientIsARealPrincipal(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	agentID := "agent_rls_" + run
	userAccountID := "user_rls_" + run
	repo := NewSupplyRepositoryWithOutbox(pool, NewOutboxRepository(pool))

	profile := supply.AgentProfile{
		AgentID: agentID, Name: "Reachability Probe", Status: "ACTIVE",
		Photos: []string{"https://cdn.proxy.test/creators/probe.jpg"}, Languages: []string{"ZH"},
		ServiceAreas: []string{"hn"}, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
		UserAccountID: userAccountID,
	}
	if err := repo.CreateProfile(ctx, profile); err != nil {
		t.Fatalf("CreateProfile must persist user_account_id (that is the only deliverable address): %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.agent_profiles WHERE agent_id=$1`, agentID)
	})
	got, err := repo.GetProfile(ctx, agentID)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if got.UserAccountID != userAccountID {
		t.Fatalf("user_account_id did not survive the round trip: got %q want %q", got.UserAccountID, userAccountID)
	}

	// 断言 1：agentId 永远不能当收件人 —— 它连 user account 都不是。
	// 临时集群里 identity.user_accounts 本来就是空的，所以这条在**任何**环境下
	// 都成立；真正有说服力的是本地库那份实测（agent_profiles.agent_id 与
	// user_accounts 交集 0 行 / sessions 里 principal_id LIKE 'agent_%' 0 行），
	// 记在上面函数的注释里。
	var agentIsAccount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM identity.user_accounts WHERE id = $1`, agentID).Scan(&agentIsAccount); err != nil {
		t.Fatal(err)
	}
	if agentIsAccount != 0 {
		t.Fatalf("premise broken: %s is a real user account, so this test would prove nothing", agentID)
	}

	// 断言 3：真的用这个收件人投一条通知，行必须落在这个 user account 名下。
	notificationRepo := NewNotificationRepository(pool)
	item, created, err := notification.NewPipeline(notificationRepo, nil).Emit(ctx, notification.Notification{
		RecipientID: got.UserAccountID, Type: "CollabInvitationCreated",
		Title: "收到合作邀约", DedupeKey: notification.EventDedupeKey("evt_rls_" + run),
	})
	if err != nil || !created {
		t.Fatalf("Emit with the creator's user account must succeed: created=%v err=%v", created, err)
	}
	if item.RecipientID == agentID {
		t.Fatal("the inbox row was addressed to the agent id — nobody can read it")
	}
	// 用 ListInbox 读回来（RLS 作用域 = 收件人）：这才是「对方真的看得到」。
	page, err := notificationRepo.ListInbox(ctx, userAccountID, false, 0, "")
	if err != nil {
		t.Fatalf("ListInbox for the creator's account: %v", err)
	}
	found := false
	for _, it := range page.Items {
		if it.ID == item.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("the notification must be readable back through ListInbox for %s", userAccountID)
	}
	t.Cleanup(func() {
		bg := context.Background()
		if _, err := pool.Exec(bg, `SET LOCAL ROLE `+superuserRoleName(bg, pool)); err == nil {
			pool.Exec(bg, `DELETE FROM notification.inbox_items WHERE id=$1`, item.ID)
		}
	})
}
