package moderation

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-005：举报的处置时限与运营队列。
//
// 这组用例钉住两件此前**完全不存在**的事：
//
//  1. 举报有处置截止时刻（紧急 6h / 一般 24h，服务条款 §58 + Decree 328/2026
//     §4），且受理时就固定写入；
//  2. 举报有读出口（ListReportQueue）。在此之前 Repository 只有 AddReport /
//     FindReport，而 FindReport 只被写入口当作「对象是否存在」的校验用 ——
//     举报收得下，却没有任何路径把它交到人手上。087 甚至替「运营队列」建好
//     了索引，那条查询从来没被写出来。
//
// 实测背景（不是推测）：本库唯一一条举报 reason='SOLICITATION'，
// 2026-09-15 18:59 受理，到 2026-09-22 已 7 天、处置记录 0 条 —— 不是没人
// 处理，是没人能发现它存在。下面 TestReportQueueSurfacesTheStaleSolicitation
// 就是这个形状的回归用例。

func newQueueService(now time.Time) (*Service, *MemoryRepository, *clock.Fixed) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	fake := clock.NewFixed(now)
	svc.clock = fake
	return svc, repo, fake
}

func mustReportQueue(t *testing.T, svc *Service, includeClosed bool, limit int) ReportQueue {
	t.Helper()
	payload := map[string]any{}
	if includeClosed {
		payload["includeClosed"] = true
	}
	if limit > 0 {
		payload["limit"] = limit
	}
	result := svc.Handle(command.Envelope{
		CommandID:   "cmd_queue_1",
		CommandType: "ListReportQueue",
		Actor:       command.Actor{ID: "operator_1"},
		Payload:     payload,
	})
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ListReportQueue rejected: %+v", result.Error)
	}
	queue, ok := result.Body["reportQueue"].(ReportQueue)
	if !ok {
		t.Fatalf("ListReportQueue accepted but carried no reportQueue body: %+v", result.Body)
	}
	return queue
}

// ---------- 时限 ----------

// TestEverySupportedReasonHasAnSLA 是 completeness 守卫：理由清单加了第 10 类
// 却忘了给时限，这条立刻红。少了它，「新理由静默没有时限」会一路绿到线上 ——
// 而 ReportSLAHours 的 false 分支在受理路径上是 fail-closed 拒收，等于
// 举报功能对新理由整体关闭。
func TestEverySupportedReasonHasAnSLA(t *testing.T) {
	for _, reason := range ReportableReasons() {
		hours, ok := ReportSLAHours(reason)
		if !ok {
			t.Errorf("reason %q has no disposition SLA — 受理路径会因此 fail-closed 拒收", reason)
			continue
		}
		if hours != reportSLAUrgentHours && hours != reportSLADefaultHours {
			t.Errorf("reason %q got %dh, want either %dh (紧急) or %dh (一般)",
				reason, hours, reportSLAUrgentHours, reportSLADefaultHours)
		}
	}
}

// TestReportSLAUrgentClassCoversMinorAndSolicitation 钉住最重的那三类。
// 刑法 327 条（介绍卖淫）落在 SOLICITATION 上，MINOR_SAFETY 是涉未成年人，
// 把它们降级成 24 小时就是把「紧急 6 小时」的承诺悄悄放宽一倍。
func TestReportSLAUrgentClassCoversMinorAndSolicitation(t *testing.T) {
	for _, reason := range []string{ReasonMinorSafety, ReasonSolicitation, ReasonUnsafe} {
		hours, ok := ReportSLAHours(reason)
		if !ok {
			t.Fatalf("reason %q has no SLA", reason)
		}
		if hours != reportSLAUrgentHours {
			t.Errorf("reason %q got %dh, want the urgent %dh (Decree 328/2026 §4)", reason, hours, reportSLAUrgentHours)
		}
	}
	// 反向：普通的理由不该被误升级成 6 小时 —— 那会把「紧急」这个词用滥，
	// 反而看不出该先处理哪条。
	for _, reason := range []string{ReasonSpam, ReasonOther, ReasonIP} {
		hours, ok := ReportSLAHours(reason)
		if !ok {
			t.Fatalf("reason %q has no SLA", reason)
		}
		if hours != reportSLADefaultHours {
			t.Errorf("reason %q got %dh, want the default %dh", reason, hours, reportSLADefaultHours)
		}
	}
}

// TestReportSLARejectsUnsupportedReason：认不出的理由不给兜底时限。
// 与 authority.SLAHours 同口径 —— 「认不出来就按 24 小时算」会把 6 小时的
// 涉未成年人举报悄悄拖成 24 小时。
func TestReportSLARejectsUnsupportedReason(t *testing.T) {
	if _, ok := ReportSLAHours("NOT_A_REASON"); ok {
		t.Fatal("unsupported reason must not resolve to a deadline")
	}
	if _, ok := ReportDueAt("", time.Now()); ok {
		t.Fatal("empty reason must not resolve to a deadline")
	}
}

func TestReportDueAtIsDerivedFromReasonAndCreatedAt(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 59, 22, 0, time.UTC)
	urgent, _ := ReportDueAt(ReasonSolicitation, created)
	if want := created.Add(6 * time.Hour); !urgent.Equal(want) {
		t.Errorf("urgent dueAt = %v, want %v", urgent, want)
	}
	ordinary, _ := ReportDueAt(ReasonSpam, created)
	if want := created.Add(24 * time.Hour); !ordinary.Equal(want) {
		t.Errorf("ordinary dueAt = %v, want %v", ordinary, want)
	}
}

// TestReportOverdueBoundaryIsExclusiveAtTheDeadline：正好到截止时刻不算超时
// （「最迟 24 小时内处理」包含第 24 小时那一刻）。差一纳秒才算超时。
func TestReportOverdueBoundaryIsExclusiveAtTheDeadline(t *testing.T) {
	due := time.Date(2026, 9, 15, 17, 59, 22, 0, time.UTC)
	if ReportOverdue(due, due) {
		t.Error("exactly at the deadline must not count as overdue")
	}
	if !ReportOverdue(due, due.Add(time.Nanosecond)) {
		t.Error("one nanosecond past the deadline must count as overdue")
	}
	if ReportOverdue(due, due.Add(-time.Hour)) {
		t.Error("before the deadline must not count as overdue")
	}
}

// TestAcceptedReportCarriesAFixedDueAt：截止时刻在**受理时**就算好并写入，
// 不在读时重算 —— 法定时限改了也不能把过去的按时处理追溯成超时。
func TestAcceptedReportCarriesAFixedDueAt(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 59, 22, 0, time.UTC)
	svc, repo, _ := newQueueService(created)
	fileReport(t, svc, ReasonMinorSafety)

	rows := repo.Reports()
	if len(rows) != 1 {
		t.Fatalf("want 1 report, got %d", len(rows))
	}
	if rows[0].DueAt.IsZero() {
		t.Fatal("accepted report has no dueAt — 平台因此证明不了自己按时处理过")
	}
	if want := created.Add(6 * time.Hour); !rows[0].DueAt.Equal(want) {
		t.Errorf("dueAt = %v, want %v", rows[0].DueAt, want)
	}
}

// ---------- 队列 ----------

// TestReportQueueSurfacesTheStaleSolicitation 复刻实测库里的形状：一条
// SOLICITATION 举报躺了 7 天、零处置。这正是本次修复前「不可见」的那条。
func TestReportQueueSurfacesTheStaleSolicitation(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 59, 22, 0, time.UTC)
	svc, _, fake := newQueueService(created)
	fileReport(t, svc, ReasonSolicitation)

	// 7 天后仍然没有任何处置 —— 与实测库一致。
	fake.Advance(7 * 24 * time.Hour)
	queue := mustReportQueue(t, svc, false, 0)

	if queue.Total != 1 || len(queue.Items) != 1 {
		t.Fatalf("want exactly the one report in the queue, got total=%d returned=%d", queue.Total, len(queue.Items))
	}
	item := queue.Items[0]
	if item.Reason != ReasonSolicitation {
		t.Errorf("reason = %q, want %q", item.Reason, ReasonSolicitation)
	}
	if !item.Overdue {
		t.Error("a solicitation report 7 days past its 6h deadline must be flagged overdue")
	}
	if item.DispositionCount != 0 {
		t.Errorf("dispositionCount = %d, want 0 (nobody has touched it)", item.DispositionCount)
	}
	if item.State != ReportStateSubmitted {
		t.Errorf("state = %q, want %q", item.State, ReportStateSubmitted)
	}
	if item.LastAction != "" || item.LastDispositionAt != nil {
		t.Errorf("no disposition was written, but the item claims one: action=%q at=%v", item.LastAction, item.LastDispositionAt)
	}
	// 168h 已躺、超时 162h（168 - 6）。
	if item.AgeHours < 167.9 || item.AgeHours > 168.1 {
		t.Errorf("ageHours = %v, want ~168", item.AgeHours)
	}
	if item.OverdueHours < 161.9 || item.OverdueHours > 162.1 {
		t.Errorf("overdueHours = %v, want ~162", item.OverdueHours)
	}
	if queue.OverdueCount != 1 {
		t.Errorf("overdueCount = %d, want 1", queue.OverdueCount)
	}
	if queue.OpenCount != 1 {
		t.Errorf("openCount = %d, want 1", queue.OpenCount)
	}
	if queue.GeneratedAt.IsZero() {
		t.Error("queue has no generatedAt — 调用方无从判断这份快照有多旧")
	}
}

// TestReportQueueOrdersByDueTimeSoUrgentFloatsUp：排序按截止时刻，而不是
// 受理时刻 —— 后报的涉未成年人举报要排在先报的垃圾举报前面。
func TestReportQueueOrdersByDueTimeSoUrgentFloatsUp(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, _ := newQueueService(created)
	fileReport(t, svc, ReasonSpam) // 24h
	fileReport(t, svc, ReasonMinorSafety) // 6h —— 后报的，但更急

	queue := mustReportQueue(t, svc, false, 0)
	if len(queue.Items) != 2 {
		t.Fatalf("want 2 items, got %d", len(queue.Items))
	}
	if queue.Items[0].Reason != ReasonMinorSafety {
		t.Errorf("first item reason = %q, want the urgent %q to be first", queue.Items[0].Reason, ReasonMinorSafety)
	}
	if !queue.Items[0].DueAt.Before(queue.Items[1].DueAt) {
		t.Error("items are not ordered by dueAt ascending")
	}
}

// TestReportQueueStateFollowsTheLastDisposition：队列必须回答「这条现在到
// 哪一步」。没有处置 = SUBMITTED（收进来了没人碰过），TRIAGE 之后 = TRIAGED。
func TestReportQueueStateFollowsTheLastDisposition(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, _ := newQueueService(created)
	reportID := fileReport(t, svc, ReasonSolicitation)

	before := mustReportQueue(t, svc, false, 0)
	if before.Items[0].State != ReportStateSubmitted || before.Items[0].DispositionCount != 0 {
		t.Fatalf("before triage: state=%q count=%d, want SUBMITTED/0",
			before.Items[0].State, before.Items[0].DispositionCount)
	}

	result := svc.Handle(dispositionEnvelope(reportID, ActionTriage, "", "", "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("triage rejected: %+v", result.Error)
	}

	after := mustReportQueue(t, svc, false, 0)
	if len(after.Items) != 1 {
		t.Fatalf("triaged report must stay in the open queue, got %d items", len(after.Items))
	}
	item := after.Items[0]
	if item.State != ReportStateTriaged {
		t.Errorf("state = %q, want %q", item.State, ReportStateTriaged)
	}
	if item.DispositionCount != 1 || item.LastAction != ActionTriage {
		t.Errorf("dispositionCount=%d lastAction=%q, want 1/%q", item.DispositionCount, item.LastAction, ActionTriage)
	}
	if item.LastDispositionAt == nil {
		t.Error("lastDispositionAt must be set once a disposition exists")
	}
}

// TestReportQueueHidesClosedReportsByDefault：终结的举报（已处置 / 判定不
// 成立）默认离开队列 —— 队列是「待办」，不是流水账。但必须能按需取回：
// 举证时要能看到完整历史，所以 includeClosed 不能是「拿不到」。
func TestReportQueueHidesClosedReportsByDefault(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, _ := newQueueService(created)
	reportID := fileReport(t, svc, ReasonSpam)

	result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, OutcomeNoAction, "", "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("disposition rejected: %+v", result.Error)
	}

	openOnly := mustReportQueue(t, svc, false, 0)
	if len(openOnly.Items) != 0 {
		t.Errorf("closed report must leave the open queue, got %d items", len(openOnly.Items))
	}
	if openOnly.OpenCount != 0 {
		t.Errorf("openCount = %d, want 0", openOnly.OpenCount)
	}

	withClosed := mustReportQueue(t, svc, true, 0)
	if len(withClosed.Items) != 1 {
		t.Fatalf("includeClosed must bring the report back for audit, got %d items", len(withClosed.Items))
	}
	if withClosed.Items[0].State != ReportStateActioned {
		t.Errorf("state = %q, want %q", withClosed.Items[0].State, ReportStateActioned)
	}
}

// TestReportQueueTruncationIsVisible：结果被 limit 截断时必须看得出来。
// 「队列看起来只有 100 条」会把第 101 条举报藏起来 —— 那正是本次修复
// 要消灭的「举报不可见」，只不过换了个原因。
func TestReportQueueTruncationIsVisible(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, _ := newQueueService(created)
	for i := 0; i < 3; i++ {
		fileReport(t, svc, ReasonSpam)
	}

	queue := mustReportQueue(t, svc, false, 2)
	if queue.Total != 3 {
		t.Errorf("total = %d, want 3 (总数不受 limit 影响)", queue.Total)
	}
	if queue.Returned != 2 || len(queue.Items) != 2 {
		t.Errorf("returned = %d / items = %d, want 2", queue.Returned, len(queue.Items))
	}
	if queue.Limit != 2 {
		t.Errorf("limit = %d, want 2", queue.Limit)
	}
}

// TestReportQueueRequiresAnActor：队列含举报人 id 与被举报目标 id，属个人信息。
// 命令边界已按 operator 白名单拦一道，这里再兜一道 —— 拿不到「谁在看」就不给看。
func TestReportQueueRequiresAnActor(t *testing.T) {
	svc, _, _ := newQueueService(time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC))
	result := svc.Handle(command.Envelope{
		CommandID:   "cmd_queue_no_actor",
		CommandType: "ListReportQueue",
		Payload:     map[string]any{},
	})
	if result.Outcome == "ACCEPTED" {
		t.Fatal("queue must not be readable without an identified actor")
	}
	if result.Error == nil || result.Error.ErrorCode != "REPORT_QUEUE_REQUIRES_ACTOR" {
		t.Fatalf("unexpected rejection: %+v", result.Error)
	}
}

// TestReportQueueFailsClosedWhenRepositoryIsDown：仓储挂了要报错，不能返回
// 空队列 —— 空队列会被读成「没有待办举报」，而事实是「读不出来」。
// 「没数据」与「没权限 / 读不到」绝不能长得一样。
func TestReportQueueFailsClosedWhenRepositoryIsDown(t *testing.T) {
	svc, repo, _ := newQueueService(time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC))
	fileReport(t, svc, ReasonSpam)
	repo.SetFail(true)

	result := svc.Handle(command.Envelope{
		CommandID:   "cmd_queue_down",
		CommandType: "ListReportQueue",
		Actor:       command.Actor{ID: "operator_1"},
		Payload:     map[string]any{},
	})
	if result.Outcome == "ACCEPTED" {
		t.Fatal("a failing repository must not produce an accepted (and therefore empty-looking) queue")
	}
	if result.Error == nil || result.Error.ErrorCode != "REPORT_QUEUE_FAILED" {
		t.Fatalf("unexpected rejection: %+v", result.Error)
	}
}

// TestHoursBetweenNeverGoesNegative：「还没超时」与「超时了 -3 小时」在举证上
// 完全不同，后者会被读成提前完成。
func TestHoursBetweenNeverGoesNegative(t *testing.T) {
	now := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	if got := hoursBetween(now.Add(time.Hour), now); got != 0 {
		t.Errorf("hoursBetween(future, now) = %v, want 0", got)
	}
	if got := hoursBetween(now, now.Add(90*time.Minute)); got != 1.5 {
		t.Errorf("hoursBetween(now, now+90m) = %v, want 1.5", got)
	}
}

// TestReportQueueDoesNotCallAPromptResolutionOverdue 钉住超时判定的对象：
// 是「这条举报有没有在时限内被处理完」，而不是「现在是否晚于截止时刻」。
//
// 拿 now 去比会把一条 1 小时就处置完（时限 6 小时）的举报在 7 天后显示成
// 「超时 162 小时」—— 假警报。假警报比没有警报更糟：一旦运营发现这个字段
// 总在误报，就会整体忽略它，真超时的那条也跟着被忽略。
func TestReportQueueDoesNotCallAPromptResolutionOverdue(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, fake := newQueueService(created)
	reportID := fileReport(t, svc, ReasonSolicitation) // 6h 时限

	// 第 1 小时就处置完 —— 完全在时限内。
	fake.Advance(time.Hour)
	result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, OutcomeContentRemoved, "已下架并封号", "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("disposition rejected: %+v", result.Error)
	}

	// 又过了 7 天。举报早就处理完了。
	fake.Advance(7 * 24 * time.Hour)
	queue := mustReportQueue(t, svc, true, 0)
	if len(queue.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(queue.Items))
	}
	item := queue.Items[0]
	if item.Overdue {
		t.Errorf("按时处置完的举报不能在 7 天后被标成超时（overdueHours=%v）", item.OverdueHours)
	}
	if item.OverdueHours != 0 {
		t.Errorf("overdueHours = %v, want 0", item.OverdueHours)
	}
	// AgeHours 对已处理完的举报是「实际花了多久」，不是「受理至今」。
	if item.AgeHours < 0.9 || item.AgeHours > 1.1 {
		t.Errorf("ageHours = %v, want ~1 (受理 → 处置完成)", item.AgeHours)
	}
	if queue.OverdueCount != 0 {
		t.Errorf("overdueCount = %d, want 0", queue.OverdueCount)
	}
}

// TestReportQueueFlagsALateResolution 是上一条的反面：真的处理晚了必须照实
// 标出来 —— 超时要能被证明，否则「我们在 24 小时内处理了」这句话就没有反例，
// 也就没有意义。
func TestReportQueueFlagsALateResolution(t *testing.T) {
	created := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	svc, _, fake := newQueueService(created)
	reportID := fileReport(t, svc, ReasonSolicitation) // 6h 时限

	// 拖到第 10 小时才处置 —— 比时限晚 4 小时。
	fake.Advance(10 * time.Hour)
	result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, OutcomeContentRemoved, "已下架并封号", "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("disposition rejected: %+v", result.Error)
	}

	queue := mustReportQueue(t, svc, true, 0)
	if len(queue.Items) != 1 {
		t.Fatalf("want 1 item, got %d", len(queue.Items))
	}
	item := queue.Items[0]
	if !item.Overdue {
		t.Error("第 10 小时才处置完（时限 6 小时）必须被标成处理晚了")
	}
	if item.OverdueHours < 3.9 || item.OverdueHours > 4.1 {
		t.Errorf("overdueHours = %v, want ~4", item.OverdueHours)
	}
	if item.AgeHours < 9.9 || item.AgeHours > 10.1 {
		t.Errorf("ageHours = %v, want ~10", item.AgeHours)
	}
	if queue.OverdueCount != 1 {
		t.Errorf("overdueCount = %d, want 1", queue.OverdueCount)
	}
}

// ---------- 迁移与 Go 规则的一致性 ----------

// TestMigrationBackfillMatchesGoMapping 是 117 迁移与 ReportSLAHours 之间的
// 漂移守卫。迁移里的一次性补齐用的是 SQL CASE，而受理路径用的是 Go —— 两边
// 各写一遍时限，改一边不改另一边就会把历史举报的时限算错。
// 逐条双向比对，任一侧多了 / 少了 / 数字不同都红。
func TestMigrationBackfillMatchesGoMapping(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/117_moderation_reports_due_at.sql")
	if err != nil {
		t.Fatalf("read 117 migration: %v", err)
	}
	whenRe := regexp.MustCompile(`WHEN\s+'([A-Z_]+)'\s+THEN\s+(\d+)`)
	elseRe := regexp.MustCompile(`ELSE\s+(\d+)`)
	listed := map[string]int{}
	fallback := -1
	for _, line := range strings.Split(string(raw), "\n") {
		if m := whenRe.FindStringSubmatch(line); m != nil {
			hours, convErr := strconv.Atoi(m[2])
			if convErr != nil {
				t.Fatalf("migration WHEN %q has an unparsable hour count %q", m[1], m[2])
			}
			listed[m[1]] = hours
			continue
		}
		if m := elseRe.FindStringSubmatch(line); m != nil {
			fallback, _ = strconv.Atoi(m[1])
		}
	}
	if fallback < 0 {
		t.Fatal("117 migration has no ELSE fallback — 新增理由会没有时限")
	}
	if fallback != reportSLADefaultHours {
		t.Errorf("migration ELSE = %dh, Go default = %dh", fallback, reportSLADefaultHours)
	}

	for _, reason := range ReportableReasons() {
		hours, ok := ReportSLAHours(reason)
		if !ok {
			t.Fatalf("reason %q has no Go SLA", reason)
		}
		got, inMigration := listed[reason]
		wantInMigration := hours != reportSLADefaultHours
		if wantInMigration != inMigration {
			t.Errorf("reason %q: Go says %dh (紧急=%v) but the migration CASE lists it=%v",
				reason, hours, wantInMigration, inMigration)
			continue
		}
		if inMigration && got != hours {
			t.Errorf("reason %q: migration says %dh, Go says %dh", reason, got, hours)
		}
	}
	// 反向：迁移列了 Go 不认的理由（例如理由已从 ReportableReasons 移除）。
	for reason, hours := range listed {
		goHours, ok := ReportSLAHours(reason)
		if !ok {
			t.Errorf("migration CASE lists %q, which is not a supported reason", reason)
			continue
		}
		if goHours != hours {
			t.Errorf("migration CASE lists %q as %dh, Go says %dh", reason, hours, goHours)
		}
	}
}
