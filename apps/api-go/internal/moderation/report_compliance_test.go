package moderation

import (
	"context"
	"errors"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-001：法律文件 §38 承诺可举报的八类目标，必须真的都能报。
// 之前只有 engagement.ReportPost（POST）一类，其余七类既没有入口也没有
// 记录 —— 而最重的风险（刑法 327 条）恰恰发生在 MESSAGE / ACCOUNT /
// TRANSACTION 上。这组用例把「承诺过 = 接得上」钉死。

func reportEnvelope(targetType, targetID, reason string, actorID string) command.Envelope {
	payload := map[string]any{"targetType": targetType, "targetId": targetID, "reason": reason}
	if actorID == "" {
		payload["targetType"] = targetType
	}
	return command.Envelope{
		CommandID:   "cmd_report_1",
		CommandType: "ReportTarget",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

func newReportService() (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	return NewWithRepository(repo), repo
}

// TestReportableTargetTypesMatchTermsSection38 把八类目标本身钉住。
// 少了任何一类，法律文件就在说我们做不到的事。
func TestReportableTargetTypesMatchTermsSection38(t *testing.T) {
	got := ReportableTargetTypes()
	want := []string{"ACCOUNT", "ACTIVITY", "INVITE", "MERCHANT", "MESSAGE", "OPPORTUNITY", "POST", "TRANSACTION"}
	if len(got) != len(want) {
		t.Fatalf("reportable target types changed: got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("reportable target types changed at %d: got %q want %q", i, got[i], want[i])
		}
	}
}

func TestReportAcceptedForEveryTargetPromisedInTerms(t *testing.T) {
	// 故意把清单硬编码在这里，不用 ReportableTargetTypes()：遍历实现自己
	// 返回的清单，等于「少了一类」根本测不出来（循环里根本没有它）。
	// 清单来自法律文件 §38，改法律文件才改这里。
	for _, targetType := range []string{
		TargetPost, TargetMessage, TargetAccount, TargetActivity,
		TargetOpportunity, TargetMerchant, TargetInvite, TargetTransaction,
	} {
		svc, repo := newReportService()
		result := svc.HandleContext(context.Background(),
			reportEnvelope(targetType, "target_"+targetType, ReasonSpam, "user_reporter"))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("reporting %s must be accepted, got outcome=%s code=%s", targetType, result.Outcome, result.Error)
		}
		if len(repo.Reports()) != 1 {
			t.Fatalf("reporting %s did not persist exactly one row: %d", targetType, len(repo.Reports()))
		}
		if repo.Reports()[0].TargetType != targetType {
			t.Fatalf("reported %s but stored %q", targetType, repo.Reports()[0].TargetType)
		}
	}
}

func TestReportAcceptedForEveryReason(t *testing.T) {
	for _, reason := range ReportableReasons() {
		svc, repo := newReportService()
		result := svc.HandleContext(context.Background(), reportEnvelope(TargetPost, "post_1", reason, "user_reporter"))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("reason %s must be accepted, got outcome=%s code=%s", reason, result.Outcome, result.Error)
		}
		if repo.Reports()[0].Reason != reason {
			t.Fatalf("reason %s stored as %q", reason, repo.Reports()[0].Reason)
		}
	}
}

// TestReportRejectedForUnknownTargetType：不认识的目标一律拒绝，
// 不能兜底归到 OTHER —— 归到 OTHER 就永远看不出哪一类我们还没接。
func TestReportRejectedForUnknownTargetType(t *testing.T) {
	svc, repo := newReportService()
	result := svc.HandleContext(context.Background(), reportEnvelope("BANANA", "x_1", ReasonSpam, "user_reporter"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("unknown target type must be rejected, got %s", result.Outcome)
	}
	if len(repo.Reports()) != 0 {
		t.Fatalf("a rejected report must not be persisted: %d rows", len(repo.Reports()))
	}
}

func TestReportRejectedWhenTargetIDMissing(t *testing.T) {
	svc, repo := newReportService()
	result := svc.HandleContext(context.Background(), reportEnvelope(TargetMessage, "", ReasonHarassment, "user_reporter"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("missing target id must be rejected, got %s", result.Outcome)
	}
	if len(repo.Reports()) != 0 {
		t.Fatalf("a rejected report must not be persisted: %d rows", len(repo.Reports()))
	}
}

func TestReportRejectedForUnknownReason(t *testing.T) {
	svc, repo := newReportService()
	result := svc.HandleContext(context.Background(), reportEnvelope(TargetAccount, "acct_1", "DISLIKE", "user_reporter"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("unknown reason must be rejected, got %s", result.Outcome)
	}
	if len(repo.Reports()) != 0 {
		t.Fatalf("a rejected report must not be persisted: %d rows", len(repo.Reports()))
	}
}

// TestReportRejectedWhenActorMissing：举报人身份是举证链的一环，
// 匿名举报无法回访也无法核对，拿不到就拒绝。
func TestReportRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	result := svc.HandleContext(context.Background(), reportEnvelope(TargetTransaction, "order_1", ReasonFraud, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("report without an authenticated actor must be rejected, got %s", result.Outcome)
	}
	if len(repo.Reports()) != 0 {
		t.Fatalf("a rejected report must not be persisted: %d rows", len(repo.Reports()))
	}
}

// TestReportPersistsReporterTargetAndTimestamp：留痕要够用 ——
// 谁报的、报了什么、什么理由、什么时候，缺一样就无法复查也无法举证。
func TestReportPersistsReporterTargetAndTimestamp(t *testing.T) {
	svc, repo := newReportService()
	env := reportEnvelope(TargetMessage, "msg_42", ReasonSolicitation, "user_reporter")
	env.Payload["note"] = "对方在消息里提出线下付费见面"
	if result := svc.HandleContext(context.Background(), env); result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	row := repo.Reports()[0]
	if row.ReporterID != "user_reporter" {
		t.Fatalf("reporter not recorded: %q", row.ReporterID)
	}
	if row.TargetType != TargetMessage || row.TargetID != "msg_42" {
		t.Fatalf("target not recorded: type=%q id=%q", row.TargetType, row.TargetID)
	}
	if row.Reason != ReasonSolicitation {
		t.Fatalf("reason not recorded: %q", row.Reason)
	}
	if row.State != ReportStateSubmitted {
		t.Fatalf("state should be SUBMITTED, got %q", row.State)
	}
	if row.CreatedAt.IsZero() {
		t.Fatal("createdAt must be recorded")
	}
	if row.Note == "" {
		t.Fatal("note must be preserved")
	}
}

// TestReportFailedWhenRepositoryDown：写不进去必须报出来，
// 不能当成「已受理」—— 用户以为报上去了，实际上平台什么都没收到。
func TestReportFailedWhenRepositoryDown(t *testing.T) {
	repo := NewMemoryRepository()
	repo.SetFail(true)
	svc := NewWithRepository(repo)
	result := svc.HandleContext(context.Background(), reportEnvelope(TargetAccount, "acct_1", ReasonMinorSafety, "user_reporter"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("a failed write must be surfaced as REJECTED, got %s", result.Outcome)
	}
}

func TestReportRepositoryRejectsIncompleteRow(t *testing.T) {
	repo := NewMemoryRepository()
	if err := repo.AddReport(context.Background(), Report{TargetType: TargetPost}); !errors.Is(err, ErrReportTargetRequired) {
		t.Fatalf("expected ErrReportTargetRequired, got %v", err)
	}
	if err := repo.AddReport(context.Background(), Report{TargetType: TargetPost, TargetID: "p1"}); !errors.Is(err, ErrReportReasonRequired) {
		t.Fatalf("expected ErrReportReasonRequired, got %v", err)
	}
}

func TestReportServiceSupportsOnlyReportTarget(t *testing.T) {
	svc := New()
	if !svc.Supports("ReportTarget") {
		t.Fatal("ReportTarget must be supported")
	}
	if svc.Supports("DeleteReport") {
		t.Fatal("reports are append-only; DeleteReport must not be supported")
	}
}
