package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// MERCHANT-CREATOR-NOTIFY-001：邀约这一条链路的「事务性」到底成不成立。
//
// 这次漏通知的两层原因分别是：
//
//	① 域里没接 outbox（事件只回给调用方客户端）—— 这里钉住**接上了**，
//	   而且是「业务行和事件同生共死」，不是两个各自成功的写入；
//	② worker 没映射（即使进了 outbox 也只是躺在那儿）—— 那边由
//	   cmd/worker 的映射与反向门禁负责，这里只管到 outbox。
//
// 另外钉住 created_by_principal_id 的**回读**：它在写侧是「谁该被通知」的
// 唯一来源，读不回来整条商家侧通知链就断在半路（而且断得很安静）。
func TestCollabInvitationAndPublishIsTransactional(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	outbox := NewOutboxRepository(pool)
	repo := NewSupplyRepositoryWithOutbox(pool, outbox)
	run := itoa(time.Now().UnixNano())
	now := time.Now().UTC().Truncate(time.Second)

	inv := supply.CollabInvitation{
		ID: "ci_notify_" + run, MerchantID: "m_notify_" + run, AgentID: "agent_notify_" + run,
		ServiceType: "CITY_COMPANION", Status: supply.InvitationPending, TermsVersion: 1,
		Currency: "VND", CreatedAt: now, ExpiresAt: now.Add(48 * time.Hour),
		CreatedByPrincipalID: "user_merchant_" + run,
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.collab_invitations WHERE id=$1`, inv.ID)
		_, _ = pool.Exec(bg, `DELETE FROM integration.outbox_messages WHERE aggregate_id=$1`, inv.ID)
	})

	ev := event.New("CollabInvitationCreated", "CollabInvitation", inv.ID, 1, "user_merchant_"+run, "corr_"+run, "cmd_"+run, now, map[string]any{
		"merchantId": inv.MerchantID, "agentId": inv.AgentID, "serviceType": inv.ServiceType,
		"notifyPrincipalId": inv.AgentID,
	})
	if err := repo.SaveInvitationAndPublish(ctx, inv, []event.DomainEvent{ev}); err != nil {
		t.Fatalf("SaveInvitationAndPublish: %v", err)
	}

	var outboxRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1 AND event_type='CollabInvitationCreated'`, inv.ID).Scan(&outboxRows); err != nil || outboxRows != 1 {
		t.Fatalf("the event must reach the outbox, rows=%d err=%v", outboxRows, err)
	}
	got, err := repo.GetInvitation(ctx, inv.ID)
	if err != nil {
		t.Fatalf("GetInvitation: %v", err)
	}
	if got.CreatedByPrincipalID != inv.CreatedByPrincipalID {
		t.Fatalf("created_by_principal_id did not survive the round trip: got %q want %q",
			got.CreatedByPrincipalID, inv.CreatedByPrincipalID)
	}

	// 事务性：业务行失败 ⇒ 事件也不该留下。构造一个必失败的更新（主键不存在），
	// 看 outbox 里会不会多出一行。
	ghost := inv
	ghost.ID = "ci_notify_ghost_" + run
	ghostEvent := event.New("CollabInvitationResponded", "CollabInvitation", ghost.ID, 2, "x", "corr_g_"+run, "cmd_g_"+run, now, map[string]any{"notifyPrincipalId": "nobody"})
	if err := repo.UpdateInvitationAndPublish(ctx, ghost, []event.DomainEvent{ghostEvent}); err == nil {
		t.Fatal("updating a missing invitation must fail")
	}
	var ghostEvents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1`, ghost.ID).Scan(&ghostEvents); err != nil {
		t.Fatal(err)
	}
	if ghostEvents != 0 {
		t.Fatalf("a failed write must not leave its event behind (%d rows) — 业务和事件必须同生共死", ghostEvents)
	}

	// 没配 outbox 的仓储必须**拒绝**这类写，而不是静默只写一半。
	bare := NewSupplyRepository(pool)
	other := inv
	other.ID = "ci_notify_bare_" + run
	otherEvent := event.New("CollabInvitationCreated", "CollabInvitation", other.ID, 1, "p", "corr_b_"+run, "cmd_b_"+run, now, map[string]any{"notifyPrincipalId": other.AgentID})
	if err := bare.SaveInvitationAndPublish(ctx, other, []event.DomainEvent{otherEvent}); err == nil {
		t.Fatal("without an outbox the write must fail loudly, not store half the fact")
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.collab_invitations WHERE id=$1`, other.ID)
	})
	var bareRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM supply.collab_invitations WHERE id=$1`, other.ID).Scan(&bareRows); err != nil {
		t.Fatal(err)
	}
	if bareRows != 0 {
		t.Fatalf("a rejected write must leave no business row, got %d", bareRows)
	}
}
