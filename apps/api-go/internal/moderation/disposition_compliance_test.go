package moderation

import (
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-003：处置留痕。
//
// 086 的 reports 表把 state 钉死在 SUBMITTED，所以它能证明「平台收到过
// 举报」，但证明不了「平台处理过举报」。服务条款承诺了举报与申诉渠道、
// 并承诺 24 小时内处理违法信息 —— 收进来却没有处置记录，等于书面承认
// 收到、却拿不出任何处理痕迹。
//
// 刑法 327 条（介绍卖淫）的语境下更糟：MINOR_SAFETY / SOLICITATION 两类
// 举报进来后查不到处置记录，姿态就是「知情不办」。
//
// 这组用例钉住两件事：
//   1. 处置记录得下来（谁、什么时候、做了什么）；
//   2. 说不清的处置一律拒绝 —— 「处置了」不说处置了什么、「判定不成立」
//      不写理由、处置人不明、举报根本不存在，都不能写进去。

func dispositionEnvelope(reportID, action, outcome, note string, actorID string) command.Envelope {
	payload := map[string]any{"reportId": reportID, "action": action}
	if outcome != "" {
		payload["outcome"] = outcome
	}
	if note != "" {
		payload["note"] = note
	}
	return command.Envelope{
		CommandID:   "cmd_disp_1",
		CommandType: "RecordReportDisposition",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

// fileReport 先落一条真实举报，返回它的 id。处置必须挂在真实存在的举报上。
func fileReport(t *testing.T, svc *Service, reason string) string {
	t.Helper()
	result := svc.Handle(reportEnvelope(TargetMessage, "msg_1", reason, "user_reporter"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("setup: report rejected: %+v", result.Error)
	}
	reports := svc.repository.(*MemoryRepository).Reports()
	if len(reports) == 0 {
		t.Fatal("setup: no report persisted")
	}
	return reports[len(reports)-1].ID
}

// TestDispositionAcceptedAndAttributed 是核心用例：处置必须留下「谁、
// 什么时候、做了什么」，否则这条记录在举证上没有价值。
func TestDispositionAcceptedAndAttributed(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSolicitation)

	result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, OutcomeContentRemoved, "已下架并封号", "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("disposition rejected: %+v", result.Error)
	}

	rows := repo.Dispositions()
	if len(rows) != 1 {
		t.Fatalf("want 1 disposition, got %d", len(rows))
	}
	row := rows[0]
	if row.ReportID != reportID {
		t.Errorf("disposition points at the wrong report: got %q want %q", row.ReportID, reportID)
	}
	if row.ActorID != "operator_1" {
		t.Errorf("disposition has no actor: got %q", row.ActorID)
	}
	if row.Outcome != OutcomeContentRemoved {
		t.Errorf("disposition lost its outcome: got %q", row.Outcome)
	}
	if row.CreatedAt.IsZero() {
		t.Error("disposition has no timestamp — cannot show when it was handled")
	}
}

// TestReportStateFollowsDispositions：「现在到哪一步了」由处置链推导，
// reports 表保持 append-only。
func TestReportStateFollowsDispositions(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)

	if got := ReportState(repo.Dispositions()); got != ReportStateSubmitted {
		t.Fatalf("fresh report must be SUBMITTED, got %q", got)
	}

	for _, step := range []struct {
		action  string
		outcome string
		note    string
		state   string
	}{
		{ActionTriage, "", "", ReportStateTriaged},
		{ActionEscalate, "", "升级法务", ReportStateEscalated},
		{ActionTaken, OutcomeAccountSuspended, "已封号", ReportStateActioned},
		{ActionReopen, "", "申诉成立", ReportStateReopened},
		{ActionDismiss, "", "核实为误报，双方为同事", ReportStateDismissed},
	} {
		result := svc.Handle(dispositionEnvelope(reportID, step.action, step.outcome, step.note, "operator_1"))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("step %s rejected: %+v", step.action, result.Error)
		}
		if got := ReportState(repo.Dispositions()); got != step.state {
			t.Fatalf("after %s: state=%q want %q", step.action, got, step.state)
		}
	}

	// append-only：每一步都留一行，历史不被覆盖。
	if got := len(repo.Dispositions()); got != 5 {
		t.Fatalf("dispositions must be append-only, want 5 rows got %d", got)
	}
}

// TestDispositionRejectedWhenActionTakenWithoutOutcome：「已处置」不说
// 处置了什么 = 没有处置证据。
func TestDispositionRejectedWhenActionTakenWithoutOutcome(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSolicitation)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, "", "处理了", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("ACTION_TAKEN without outcome must be rejected, got %v", result.Outcome)
	}
	if len(repo.Dispositions()) != 0 {
		t.Fatal("nothing must be persisted when the outcome is missing")
	}
}

// TestDispositionRejectedWhenDismissedWithoutReason：无理由关掉一条
// 涉未成年人 / 招嫖的举报，看起来就是随手关掉。
func TestDispositionRejectedWhenDismissedWithoutReason(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionDismiss, "", "   ", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("DISMISS without a reason must be rejected, got %v", result.Outcome)
	}
	if len(repo.Dispositions()) != 0 {
		t.Fatal("nothing must be persisted when the reason is blank")
	}
}

// TestDispositionRejectedForUnknownActionOrOutcome：认不出的动作 / 结论
// 一律拒绝，不能悄悄当成「已处理」。
func TestDispositionRejectedForUnknownActionOrOutcome(t *testing.T) {
	svc, _ := newReportService()
	reportID := fileReport(t, svc, ReasonFraud)
	if result := svc.Handle(dispositionEnvelope(reportID, "DELETE_EVERYTHING", "", "", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatal("unknown action must be rejected")
	}
	if result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, "NUKED", "", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatal("unknown outcome must be rejected")
	}
}

// TestDispositionRejectedWhenActorMissing：一条没有署名的处置，日后说不清
// 是谁决定的。
func TestDispositionRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonHarassment)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionTriage, "", "", "")); result.Outcome != "REJECTED" {
		t.Fatalf("disposition without an actor must be rejected, got %v", result.Outcome)
	}
	if len(repo.Dispositions()) != 0 {
		t.Fatal("nothing must be persisted without an actor")
	}
}

// TestDispositionRejectedForUnknownReport：给一条不存在的举报写处置，
// 只能制造「看起来处理过」的假象。
func TestDispositionRejectedForUnknownReport(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(dispositionEnvelope("report_does_not_exist", ActionTaken, OutcomeNoAction, "x", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("disposition for an unknown report must be rejected, got %v", result.Outcome)
	}
	if len(repo.Dispositions()) != 0 {
		t.Fatal("nothing must be persisted for an unknown report")
	}
}

// TestDispositionFailedWhenRepositoryDown：写不进去必须报错，不能静默
// 当成已处置。
func TestDispositionFailedWhenRepositoryDown(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonUnsafe)
	repo.SetFail(true)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionTaken, OutcomeContentRemoved, "下架", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatal("a failed write must not be reported as handled")
	}
}

// TestDispositionServiceSupportsOnlyModerationCommands：命令面收窄，
// 别的服务不能借这个名字干别的事。
func TestDispositionServiceSupportsOnlyModerationCommands(t *testing.T) {
	svc, _ := newReportService()
	if !svc.Supports("ReportTarget") || !svc.Supports("RecordReportDisposition") {
		t.Fatal("moderation service must support both report intake and disposition")
	}
	if svc.Supports("DeleteReport") {
		t.Fatal("no command may delete a report — reports are evidence")
	}
}

// TestDispositionNoteTrimmed：前后空白不该混进举证材料。
func TestDispositionNoteTrimmed(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSpam)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionDismiss, "", "  核实为重复举报  ", "operator_1")); result.Outcome != "ACCEPTED" {
		t.Fatalf("dismiss with a reason must be accepted, got %v", result.Outcome)
	}
	if got := repo.Dispositions()[0].Note; strings.TrimSpace(got) != got {
		t.Fatalf("note must be trimmed, got %q", got)
	}
}

// 处置动作清单本身要钉住：少了 ESCALATE 就等于「升级给有权机关」这条路
// 在界面上消失，而那正是 327 条风险下最该保留的动作。
func TestDispositionActionsCoverEscalationAndReopen(t *testing.T) {
	for _, want := range []string{ActionTriage, ActionEscalate, ActionTaken, ActionDismiss, ActionReopen} {
		found := false
		for _, got := range DispositionActions() {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("disposition action %q is gone", want)
		}
	}
}

// 时间字段必须真的带上，否则「24 小时内处理」这条承诺无从核对。
func TestDispositionTimestampIsUTCAndRecent(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)
	before := time.Now().UTC().Add(-time.Second)
	if result := svc.Handle(dispositionEnvelope(reportID, ActionTriage, "", "", "operator_1")); result.Outcome != "ACCEPTED" {
		t.Fatalf("triage rejected: %+v", result.Error)
	}
	got := repo.Dispositions()[0].CreatedAt
	if got.Before(before) || got.After(time.Now().UTC().Add(time.Second)) {
		t.Fatalf("disposition timestamp looks wrong: %v (before=%v)", got, before)
	}
}
