package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/moderation"
)

// COMP-REPORT-005 — 举报队列的 SQL 往返。
//
// 单测跑的是内存仓储，证明不了 SQL。这一段恰恰是最容易出错的地方：
//   - 两个 LEFT JOIN LATERAL（最后一条处置 / 处置条数）；
//   - 「没有任何处置」时 last_disposition_at 是 NULL —— 扫进 time.Time 会直接
//     报错，或者被兜成 epoch，让「从没人碰过」看起来像「1970 年处置过」；
//   - ORDER BY 必须与 moderation.buildReportQueue 的排序一致，否则内存实现
//     与生产实现给出两个顺序。
//
// 这里把生产者（AddReport 写 due_at）与读者（ListReportQueue 读 due_at）
// 串起来验一遍 —— 一个值只有能被读回来才算真的写进去了。
//
// 卫生：只删自己建的行（按 id 前缀），不动别人的记录。
// 附注：moderation.reports 的 append-only 目前只是 086 注释里的约定 ——
// 那张迁移没有 REVOKE、没有触发器，DB 层并不拦 DELETE / UPDATE。这是另一笔
// 待办（与 112 / 114 把 media 审计表做成 DB 级 append-only 同构），不在本次范围。
func TestModerationReportQueueRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewModerationRepository(pool)

	tag := "rpt_q_" + itoa(time.Now().UnixNano())
	reportID := tag + "_solicit"
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM moderation.dispositions WHERE report_id LIKE $1`, tag+"%"); err != nil {
			t.Logf("cleanup dispositions: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM moderation.reports WHERE id LIKE $1`, tag+"%"); err != nil {
			t.Logf("cleanup reports: %v", err)
		}
	})

	// 7 天前受理的 SOLICITATION —— 复刻实测库里的形状（6h 时限，早已超时）。
	created := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(time.Second)
	dueAt, ok := moderation.ReportDueAt(moderation.ReasonSolicitation, created)
	if !ok {
		t.Fatal("SOLICITATION has no SLA")
	}
	if err := repo.AddReport(ctx, moderation.Report{
		ID: reportID, ReporterID: tag + "_reporter",
		TargetType: moderation.TargetMessage, TargetID: tag + "_msg",
		Reason: moderation.ReasonSolicitation, State: moderation.ReportStateSubmitted,
		CreatedAt: created, DueAt: dueAt,
	}); err != nil {
		t.Fatalf("AddReport: %v", err)
	}

	// 1. due_at 写得进、读得回。
	found, ok := repo.FindReport(ctx, reportID)
	if !ok {
		t.Fatalf("FindReport(%s): not found", reportID)
	}
	if !found.DueAt.Equal(dueAt) {
		t.Errorf("due_at round-trip: got %v want %v", found.DueAt, dueAt)
	}
	if got := found.DueAt.Sub(found.CreatedAt); got != 6*time.Hour {
		t.Errorf("stored SLA = %v, want 6h for SOLICITATION", got)
	}

	// 2. 队列读得到它，且「没有任何处置」不被兜成 epoch。
	entries, err := repo.ListReportQueue(ctx)
	if err != nil {
		t.Fatalf("ListReportQueue: %v", err)
	}
	if !dueAtAscending(entries) {
		t.Error("ListReportQueue must return rows ordered by due_at ascending (SQL ORDER BY drifted from buildReportQueue)")
	}
	mine := entryFor(entries, reportID)
	if mine == nil {
		t.Fatalf("report %s missing from the queue — 举报写进去了却列不出来", reportID)
	}
	if mine.DispositionCount != 0 {
		t.Errorf("dispositionCount = %d, want 0", mine.DispositionCount)
	}
	if mine.LastAction != "" {
		t.Errorf("lastAction = %q, want empty (no disposition was written)", mine.LastAction)
	}
	if !mine.LastDispositionAt.IsZero() {
		t.Errorf("lastDispositionAt = %v, want zero — NULL 被兜成了 epoch 会把「从没人碰过」显示成「1970 年处置过」", mine.LastDispositionAt)
	}

	// 3. 五种处置动作在生产路径上都要写得进去。
	//    这一段是「内存绿、生产红」的守卫：内存仓储不校验 outcome，所以
	//    「outcome 为空串撞 DB CHECK」这类故障只有真库能暴露 —— 修之前，
	//    五种动作里只有 ACTION_TAKEN 写得进去，其余四种全部报
	//    dispositions_outcome_check (SQLSTATE 23514)，而单测全绿。
	svc := moderation.NewWithRepository(repo)
	actions := moderation.DispositionActions()
	for i, action := range actions {
		payload := map[string]any{"reportId": reportID, "action": action}
		switch action {
		case moderation.ActionTaken:
			// 「处置了」必须说清处置了什么。
			payload["outcome"] = moderation.OutcomeNoAction
		case moderation.ActionDismiss:
			// 「判定不成立」必须写理由。
			payload["note"] = "证据不足，不予处理"
		}
		result := svc.HandleContext(ctx, command.Envelope{
			CommandID:   "cmd_pg_disp_" + itoa(int64(i)),
			CommandType: "RecordReportDisposition",
			Actor:       command.Actor{ID: tag + "_operator"},
			Payload:     payload,
		})
		if result.Outcome != "ACCEPTED" {
			t.Errorf("action %s must be recordable on the production path: %+v", action, result.Error)
		}
	}

	// 4. 处置链要能被读回来（队列反映「现在到哪一步」）。
	entries, err = repo.ListReportQueue(ctx)
	if err != nil {
		t.Fatalf("ListReportQueue after dispositions: %v", err)
	}
	mine = entryFor(entries, reportID)
	if mine == nil {
		t.Fatal("report fell out of the queue after its dispositions")
	}
	if mine.DispositionCount != len(actions) {
		t.Errorf("dispositionCount = %d, want %d", mine.DispositionCount, len(actions))
	}
	if want := actions[len(actions)-1]; mine.LastAction != want {
		t.Errorf("lastAction = %q, want %q (最后一条处置决定「现在到哪一步」)", mine.LastAction, want)
	}
	if mine.LastDispositionAt.IsZero() {
		t.Error("lastDispositionAt must be populated once dispositions exist")
	}

	// 5. DB 层的 due_at NOT NULL：绕过应用直接写一条没有时限的举报必须被拒。
	//    这条是「举报必须有截止时刻」在数据库侧的最终保证 —— 应用层校验可以
	//    被绕过（直接调仓储、手工 SQL），NOT NULL 不能。
	if _, err := pool.Exec(ctx, `
INSERT INTO moderation.reports (id, reporter_id, target_type, target_id, reason, state, created_at)
VALUES ($1, $2, 'MESSAGE', $3, 'SPAM', 'SUBMITTED', $4)`,
		tag+"_nodue", tag+"_reporter", tag+"_msg2", created); err == nil {
		t.Fatal("moderation.reports.due_at must be NOT NULL — 一条没有截止时刻的举报正是本次修复要消灭的状态")
	}
}

func entryFor(entries []moderation.ReportQueueEntry, reportID string) *moderation.ReportQueueEntry {
	for i := range entries {
		if entries[i].Report.ID == reportID {
			return &entries[i]
		}
	}
	return nil
}

func dueAtAscending(entries []moderation.ReportQueueEntry) bool {
	for i := 1; i < len(entries); i++ {
		if entries[i].Report.DueAt.Before(entries[i-1].Report.DueAt) {
			return false
		}
	}
	return true
}
