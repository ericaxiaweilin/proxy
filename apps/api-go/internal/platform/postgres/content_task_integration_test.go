package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/supply"
)

// CONTENT-TASK-001：内容任务在 Postgres 上能存能取；稿件 / 审核 / 发布链接 JSONB 往返不丢，
// 同一邀约重复 Save 不覆盖（列表懒补任务时并发安全）。
func TestContentTaskRepositoryPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepository(pool)
	run := itoa(time.Now().UnixNano())
	merchant, agent := "m_ct_"+run, "agent_ct_"+run
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.content_tasks WHERE merchant_id=$1`, merchant)
	})
	now := time.Now().UTC().Truncate(time.Second)
	task := supply.ContentTask{
		ID: "ct_" + run, InvitationID: "ci_" + run, MerchantID: merchant, AgentID: agent,
		Title: "二层包厢", Brief: "拍光线", ContentType: "VIDEO", Platforms: []string{"tiktok", "instagram"},
		State: supply.ContentBriefed, Publications: []supply.ContentPublication{}, CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.SaveContentTask(ctx, task); err != nil {
		t.Fatalf("save: %v", err)
	}
	dup := task
	dup.ID, dup.Title = "ct_dup_"+run, "覆盖"
	if err := repo.SaveContentTask(ctx, dup); err != nil {
		t.Fatalf("duplicate invitation save should be a no-op, got %v", err)
	}
	list, err := repo.ListContentTasksByMerchant(ctx, merchant)
	if err != nil || len(list) != 1 || list[0].Title != "二层包厢" || len(list[0].Platforms) != 2 || list[0].Draft != nil {
		t.Fatalf("list after dup: %v %+v", err, list)
	}
	task.State = supply.ContentApproved
	task.Draft = &supply.ContentDraft{MediaAssetIDs: []string{"ma_1"}, Caption: "c", DurationSec: 42, SubmittedAt: now, Round: 2}
	task.Review = &supply.ContentReview{Decision: "APPROVE", Checks: supply.ContentChecks{StoreClear: true, MatchesReality: true, NoCompetitor: true, NoContact: true}, ReviewedAt: now}
	task.Publications = []supply.ContentPublication{{Platform: "tiktok", URL: "https://www.tiktok.com/@a/video/1", PublishedAt: now}}
	task.NudgedAt = now
	task.UpdatedAt = now.Add(time.Minute)
	if err := repo.UpdateContentTask(ctx, task); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := repo.GetContentTask(ctx, task.ID)
	if err != nil || got.State != supply.ContentApproved || got.Draft == nil || got.Draft.Round != 2 || got.Review == nil || !got.Review.Checks.NoContact ||
		len(got.Publications) != 1 || got.Publications[0].Platform != "tiktok" || !got.NudgedAt.Equal(now) {
		t.Fatalf("round trip: %v %+v", err, got)
	}
	byAgent, err := repo.ListContentTasksByAgent(ctx, agent)
	if err != nil || len(byAgent) != 1 {
		t.Fatalf("by agent: %v %d", err, len(byAgent))
	}
	if _, err := repo.GetContentTask(ctx, "ct_missing_"+run); !errors.Is(err, supply.ErrContentTaskNotFound) {
		t.Fatalf("missing should map to ErrContentTaskNotFound, got %v", err)
	}
	missing := task
	missing.ID = "ct_missing_" + run
	if err := repo.UpdateContentTask(ctx, missing); !errors.Is(err, supply.ErrContentTaskNotFound) {
		t.Fatalf("update missing: %v", err)
	}
}

// 催一下的事件和状态同一个事务进 outbox（worker 从这里投进 creator 收件箱）。
func TestContentTaskUpdateAndPublishWritesOutbox(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewSupplyRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	run := itoa(time.Now().UnixNano())
	now := time.Now().UTC().Truncate(time.Second)
	task := supply.ContentTask{ID: "ct_pub_" + run, InvitationID: "ci_pub_" + run, MerchantID: "m_pub_" + run, AgentID: "agent_pub_" + run,
		ContentType: "VIDEO", Platforms: []string{}, State: supply.ContentBriefed, Publications: []supply.ContentPublication{}, CreatedAt: now, UpdatedAt: now}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM supply.content_tasks WHERE id=$1`, task.ID)
		_, _ = pool.Exec(bg, `DELETE FROM integration.outbox_messages WHERE aggregate_id=$1`, task.ID)
	})
	if err := repo.SaveContentTask(ctx, task); err != nil {
		t.Fatalf("save: %v", err)
	}
	task.NudgedAt = now
	ev := event.New("ContentTaskNudged", "ContentTask", task.ID, 1, "principal", "corr_"+run, "cmd_"+run, now, map[string]any{"agentId": task.AgentID})
	if err := repo.UpdateContentTaskAndPublish(ctx, task, []event.DomainEvent{ev}); err != nil {
		t.Fatalf("update+publish: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1 AND event_type='ContentTaskNudged'`, task.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("outbox rows = %d (%v)", n, err)
	}
	got, err := repo.GetContentTask(ctx, task.ID)
	if err != nil || !got.NudgedAt.Equal(now) {
		t.Fatalf("state not saved with the event: %v %+v", err, got)
	}
}
