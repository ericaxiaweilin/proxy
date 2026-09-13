package moderation

import (
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-004：申诉机制。
//
// 001 + 003 让举报闭环到「收到 → 处理」。但没有申诉渠道，被处理方（被举报者、
// 或对处置不服的举报人）无法申辩。§37 第 693 行、§38 第 709 行承诺了「恢复或
// 申诉机制」，NĐ 147/2024 把社交网络的投诉 / 申诉渠道列为硬性要求。
//
// 这组用例钉住两件事：
//   1. 申诉能提交、复核能留下「谁、什么时候、决定了什么」；
//   2. 说不清的申诉 / 复核一律拒绝 —— 引用的举报 / 申诉不存在、空理由、
//      决策不认识、驳回不写理由、复核人不明，都不能写进去。

func appealEnvelope(reportID, reason, actorID string) command.Envelope {
	payload := map[string]any{"reportId": reportID}
	if reason != "" {
		payload["reason"] = reason
	}
	return command.Envelope{
		CommandID:   "cmd_appeal_1",
		CommandType: "FileAppeal",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

func appealDecisionEnvelope(appealID, decision, note, actorID string) command.Envelope {
	payload := map[string]any{"appealId": appealID, "decision": decision}
	if note != "" {
		payload["note"] = note
	}
	return command.Envelope{
		CommandID:   "cmd_appealdec_1",
		CommandType: "RecordAppealDecision",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

// fileAppeal 先落一条真实申诉，返回它的 id。复核必须挂在真实存在的申诉上。
func fileAppeal(t *testing.T, svc *Service, reportID, actorID string) string {
	t.Helper()
	result := svc.Handle(appealEnvelope(reportID, "我认为处置有误，需复核", actorID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("setup: appeal rejected: %+v", result.Error)
	}
	appeals := svc.repository.(*MemoryRepository).Appeals()
	if len(appeals) == 0 {
		t.Fatal("setup: no appeal persisted")
	}
	return appeals[len(appeals)-1].ID
}

// TestAppealAcceptedAndAttributed 是核心用例：申诉必须留下「谁、什么时候、
// 申诉了什么」，否则这条记录在举证上没有价值。
func TestAppealAcceptedAndAttributed(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSolicitation)

	result := svc.Handle(appealEnvelope(reportID, "账号被误封，请提供复核", "user_appellant"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("appeal rejected: %+v", result.Error)
	}

	rows := repo.Appeals()
	if len(rows) != 1 {
		t.Fatalf("want 1 appeal, got %d", len(rows))
	}
	row := rows[0]
	if row.ReportID != reportID {
		t.Errorf("appeal points at the wrong report: got %q want %q", row.ReportID, reportID)
	}
	if row.AppellantID != "user_appellant" {
		t.Errorf("appeal has no appellant: got %q", row.AppellantID)
	}
	if row.CreatedAt.IsZero() {
		t.Error("appeal has no timestamp — cannot show when it was filed")
	}
}

// TestAppealStateFollowsDecisions：「现在到哪一步了」由复核链推导，
// appeals 表保持 append-only。
func TestAppealStateFollowsDecisions(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)
	appealID := fileAppeal(t, svc, reportID, "user_appellant")

	if got := AppealState(repo.AppealDecisions()); got != AppealStateFiled {
		t.Fatalf("fresh appeal must be FILED, got %q", got)
	}

	for _, step := range []struct {
		decision string
		note     string
		state    string
	}{
		{AppealDecisionUpheld, "原处置证据不足，恢复账号", AppealStateUpheld},
		{AppealDecisionRejected, "复核后维持原处置", AppealStateRejected},
	} {
		result := svc.Handle(appealDecisionEnvelope(appealID, step.decision, step.note, "operator_1"))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("step %s rejected: %+v", step.decision, result.Error)
		}
		if got := AppealState(repo.AppealDecisions()); got != step.state {
			t.Fatalf("after %s: state=%q want %q", step.decision, got, step.state)
		}
	}

	// append-only：每一步复核都留一行，历史不被覆盖。
	if got := len(repo.AppealDecisions()); got != 2 {
		t.Fatalf("appeal decisions must be append-only, want 2 rows got %d", got)
	}
}

// TestAppealRejectedForUnknownReport：给一条不存在的举报写申诉，只能制造
// 「看起来申诉过」的假象。
func TestAppealRejectedForUnknownReport(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(appealEnvelope("report_does_not_exist", "请复核", "user_appellant")); result.Outcome != "REJECTED" {
		t.Fatalf("appeal for an unknown report must be rejected, got %v", result.Outcome)
	}
	if len(repo.Appeals()) != 0 {
		t.Fatal("nothing must be persisted for an unknown report")
	}
}

// TestAppealRejectedWhenReasonEmpty：空理由的申诉没有信息量，运营不知道在
// 申诉什么。
func TestAppealRejectedWhenReasonEmpty(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonFraud)
	if result := svc.Handle(appealEnvelope(reportID, "   ", "user_appellant")); result.Outcome != "REJECTED" {
		t.Fatalf("appeal with an empty reason must be rejected, got %v", result.Outcome)
	}
	if len(repo.Appeals()) != 0 {
		t.Fatal("nothing must be persisted with an empty reason")
	}
}

// TestAppealRejectedWhenActorMissing：一条没有署名（匿名）的申诉，无法回访、
// 无法核对。
func TestAppealRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonHarassment)
	if result := svc.Handle(appealEnvelope(reportID, "请复核", "")); result.Outcome != "REJECTED" {
		t.Fatalf("appeal without an actor must be rejected, got %v", result.Outcome)
	}
	if len(repo.Appeals()) != 0 {
		t.Fatal("nothing must be persisted without an actor")
	}
}

// TestAppealDecisionRejectedForUnknownAppeal：给一条不存在的申诉写复核，只能
// 制造「看起来复核过」的假象。
func TestAppealDecisionRejectedForUnknownAppeal(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(appealDecisionEnvelope("appeal_does_not_exist", AppealDecisionUpheld, "x", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("appeal decision for an unknown appeal must be rejected, got %v", result.Outcome)
	}
	if len(repo.AppealDecisions()) != 0 {
		t.Fatal("nothing must be persisted for an unknown appeal")
	}
}

// TestAppealDecisionRejectedForUnknownDecision：认不出的决策一律拒绝，不能
// 悄悄当成「已复核」。
func TestAppealDecisionRejectedForUnknownDecision(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSolicitation)
	appealID := fileAppeal(t, svc, reportID, "user_appellant")
	if result := svc.Handle(appealDecisionEnvelope(appealID, "DISAPPEAR", "", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("unknown decision must be rejected, got %v", result.Outcome)
	}
	if len(repo.AppealDecisions()) != 0 {
		t.Fatal("nothing must be persisted for an unknown decision")
	}
}

// TestAppealDecisionRejectedWhenRejectedWithoutNote：驳回不写理由，看起来就是
// 随手关掉。
func TestAppealDecisionRejectedWhenRejectedWithoutNote(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)
	appealID := fileAppeal(t, svc, reportID, "user_appellant")
	if result := svc.Handle(appealDecisionEnvelope(appealID, AppealDecisionRejected, "   ", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("REJECTED without a note must be rejected, got %v", result.Outcome)
	}
	if len(repo.AppealDecisions()) != 0 {
		t.Fatal("nothing must be persisted when the note is blank")
	}
}

// TestAppealDecisionRejectedWhenActorMissing：一条没有署名的复核，日后说不清
// 是谁决定的。
func TestAppealDecisionRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonUnsafe)
	appealID := fileAppeal(t, svc, reportID, "user_appellant")
	if result := svc.Handle(appealDecisionEnvelope(appealID, AppealDecisionUpheld, "恢复", "")); result.Outcome != "REJECTED" {
		t.Fatalf("appeal decision without an actor must be rejected, got %v", result.Outcome)
	}
	if len(repo.AppealDecisions()) != 0 {
		t.Fatal("nothing must be persisted without an actor")
	}
}

// TestAppealFailedWhenRepositoryDown：写不进去必须报错，不能静默当成已复核。
func TestAppealFailedWhenRepositoryDown(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSpam)
	repo.SetFail(true)
	if result := svc.Handle(appealEnvelope(reportID, "请复核", "user_appellant")); result.Outcome != "REJECTED" {
		t.Fatal("a failed write must not be reported as filed")
	}
}

// TestAppealServiceSupportsOnlyModerationCommands：命令面收窄，别的服务不能
// 借这个名字干别的事。
func TestAppealServiceSupportsOnlyModerationCommands(t *testing.T) {
	svc, _ := newReportService()
	for _, want := range []string{"ReportTarget", "RecordReportDisposition", "FileAppeal", "RecordAppealDecision"} {
		if !svc.Supports(want) {
			t.Fatalf("moderation service must support %q", want)
		}
	}
	if svc.Supports("DeleteAppeal") {
		t.Fatal("no command may delete an appeal — appeals are evidence")
	}
}

// TestAppealReasonTrimmed：前后空白不该混进举证材料。
func TestAppealReasonTrimmed(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonSpam)
	if result := svc.Handle(appealEnvelope(reportID, "  账号被误封，需复核  ", "user_appellant")); result.Outcome != "ACCEPTED" {
		t.Fatalf("appeal with a reason must be accepted, got %v", result.Outcome)
	}
	if got := repo.Appeals()[0].Reason; strings.TrimSpace(got) != got {
		t.Fatalf("reason must be trimmed, got %q", got)
	}
}

// 复核决策清单本身要钉住：少了 REJECTED 就等于「申诉永远成立 / 永远驳回」，
// 制衡的两种结果缺一个就成了单边。
func TestAppealDecisionsCoverUpheldAndRejected(t *testing.T) {
	for _, want := range []string{AppealDecisionUpheld, AppealDecisionRejected} {
		found := false
		for _, got := range AppealDecisions() {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("appeal decision %q is gone", want)
		}
	}
}

// 时间字段必须真的带上，否则「申诉何时提交 / 复核」无从核对。
func TestAppealTimestampIsUTCAndRecent(t *testing.T) {
	svc, repo := newReportService()
	reportID := fileReport(t, svc, ReasonMinorSafety)
	before := time.Now().UTC().Add(-time.Second)
	if result := svc.Handle(appealEnvelope(reportID, "请复核", "user_appellant")); result.Outcome != "ACCEPTED" {
		t.Fatalf("appeal rejected: %+v", result.Error)
	}
	got := repo.Appeals()[0].CreatedAt
	if got.Before(before) || got.After(time.Now().UTC().Add(time.Second)) {
		t.Fatalf("appeal timestamp looks wrong: %v (before=%v)", got, before)
	}
}
