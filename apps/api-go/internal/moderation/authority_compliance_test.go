package moderation

import (
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-AUTHORITY-001：有权机关请求的受理留痕与响应时限。
//
// 服务条款 §55 承诺了**带数字**的响应时限（24h / 3h / 24h / 6h）并要求
// 「所有请求应进行主体、权限、范围和合法性核验，并对处理过程进行记录」。
// 而代码里 REFERRED_TO_AUTHORITY 只是一个从未被任何写入路径使用的枚举值：
// 请求进来了没有受理记录、没有核验记录、没有截止时刻、没有响应记录。
//
// 这组用例钉住三件事：
//   1. 时限必须真的是 §55 写的那四个数字（认不出的种类绝不兜底成 24 小时）；
//   2. 四项核验缺一不得受理；
//   3. 响应留痕要能区分「踩线达标」与「超时」——超时也得照实记，但不能
//      让人误以为合规。

func authorityReqEnv(ref, authority, kind string, vs, va, vsc, vl bool, receivedAt, actorID string) command.Envelope {
	payload := map[string]any{
		"requestRef":        ref,
		"authority":         authority,
		"requestKind":       kind,
		"verifiedSubject":   vs,
		"verifiedAuthority": va,
		"verifiedScope":     vsc,
		"verifiedLegality":  vl,
	}
	if receivedAt != "" {
		payload["receivedAt"] = receivedAt
	}
	return command.Envelope{
		CommandID:   "cmd_authreq_1",
		CommandType: "RecordAuthorityRequest",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

// verifiedReq 四项核验齐全的受理请求。
func verifiedReq(kind, actorID string) command.Envelope {
	return authorityReqEnv("ref_1", "网络安全局", kind, true, true, true, true, "", actorID)
}

func authorityRespEnv(requestID, outcome, respondedAt, actorID string) command.Envelope {
	payload := map[string]any{"requestId": requestID, "outcome": outcome}
	if respondedAt != "" {
		payload["respondedAt"] = respondedAt
	}
	return command.Envelope{
		CommandID:   "cmd_authresp_1",
		CommandType: "RecordAuthorityResponse",
		Actor:       command.Actor{ID: actorID},
		Payload:     payload,
	}
}

// TestAuthorityRequestAcceptedAndAttributed：受理必须留下「哪个机关、什么
// 编号、什么种类、什么时候到期、谁受理的」。
func TestAuthorityRequestAcceptedAndAttributed(t *testing.T) {
	svc, repo := newReportService()

	result := svc.Handle(verifiedReq(KindUserInfo, "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("authority request rejected: %+v", result.Error)
	}

	rows := repo.AuthorityRequests()
	if len(rows) != 1 {
		t.Fatalf("want 1 authority request, got %d", len(rows))
	}
	row := rows[0]
	if row.Authority == "" || row.RequestRef == "" {
		t.Errorf("request lost its authority/ref: %+v", row)
	}
	if row.Kind != KindUserInfo {
		t.Errorf("request kind: got %q want %q", row.Kind, KindUserInfo)
	}
	if row.ActorID != "operator_1" {
		t.Errorf("request has no actor: got %q", row.ActorID)
	}
	if row.DeadlineAt.IsZero() || !row.DeadlineAt.After(row.ReceivedAt) {
		t.Errorf("request has no usable deadline: received=%v deadline=%v", row.ReceivedAt, row.DeadlineAt)
	}
}

// TestAuthoritySLAMatchesStatutoryDeadlines：§55 写的四个数字必须原样落地。
// 认不出的种类**不能**兜底成 24 小时 —— 那会把 3 小时的生命安全紧急请求
// 悄悄拖成 24 小时。
func TestAuthoritySLAMatchesStatutoryDeadlines(t *testing.T) {
	for _, step := range []struct {
		kind  string
		hours int
	}{
		{KindUserInfo, 24},
		{KindUserInfoEmergency, 3},
		{KindContentRemoval, 24},
		{KindContentRemovalEmergency, 6},
	} {
		got, ok := SLAHours(step.kind)
		if !ok {
			t.Fatalf("SLA missing for %q", step.kind)
		}
		if got != step.hours {
			t.Fatalf("%q SLA: got %dh want %dh (§55)", step.kind, got, step.hours)
		}
	}
	if _, ok := SLAHours("SOMETHING_ELSE"); ok {
		t.Fatal("an unknown request kind must not silently get a deadline")
	}
}

// TestAuthorityDeadlineDerivedFromReceivedAt：截止时刻 = 受理时刻 + 法定时限。
func TestAuthorityDeadlineDerivedFromReceivedAt(t *testing.T) {
	svc, repo := newReportService()
	received := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)

	result := svc.Handle(authorityReqEnv("ref_2", "网络安全局", KindContentRemovalEmergency,
		true, true, true, true, received.Format(time.RFC3339), "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("authority request rejected: %+v", result.Error)
	}
	row := repo.AuthorityRequests()[0]
	if !row.ReceivedAt.Equal(received) {
		t.Errorf("receivedAt: got %v want %v", row.ReceivedAt, received)
	}
	want := received.Add(6 * time.Hour)
	if !row.DeadlineAt.Equal(want) {
		t.Errorf("deadline: got %v want %v (6h for CONTENT_REMOVAL_EMERGENCY)", row.DeadlineAt, want)
	}
}

// TestAuthorityMetDeadlineDistinguishesOnTimeAndLate：「在 24 小时内响应了」
// 这条承诺唯一的直接判定。
func TestAuthorityMetDeadlineDistinguishesOnTimeAndLate(t *testing.T) {
	base := time.Now().UTC()
	deadline := base.Add(24 * time.Hour)
	if !MetDeadline(deadline, base.Add(time.Hour)) {
		t.Fatal("an on-time response must count as met")
	}
	if MetDeadline(deadline, base.Add(25*time.Hour)) {
		t.Fatal("a late response must not count as met")
	}
	// 正好踩线算达标（法律写的是「最迟 24 小时内」）。
	if !MetDeadline(deadline, deadline) {
		t.Fatal("responding exactly at the deadline must count as met")
	}
}

// TestAuthorityRequestRejectedWhenVerificationIncomplete：§55 要求主体 /
// 权限 / 范围 / 合法性四项核验，缺一不得受理。
func TestAuthorityRequestRejectedWhenVerificationIncomplete(t *testing.T) {
	cases := []struct {
		name            string
		vs, va, vsc, vl bool
	}{
		{"subject", false, true, true, true},
		{"authority", true, false, true, true},
		{"scope", true, true, false, true},
		{"legality", true, true, true, false},
	}
	for _, c := range cases {
		svc, repo := newReportService()
		result := svc.Handle(authorityReqEnv("ref_3", "网络安全局", KindUserInfo,
			c.vs, c.va, c.vsc, c.vl, "", "operator_1"))
		if result.Outcome != "REJECTED" {
			t.Fatalf("missing %s verification must be rejected, got %v", c.name, result.Outcome)
		}
		if len(repo.AuthorityRequests()) != 0 {
			t.Fatalf("nothing must be persisted when %s verification is missing", c.name)
		}
	}
}

// TestAuthorityRequestRejectedForUnknownKind：种类认不出就拿不到时限。
func TestAuthorityRequestRejectedForUnknownKind(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(verifiedReq("DELETE_THE_INTERNET", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("unknown request kind must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityRequests()) != 0 {
		t.Fatal("nothing must be persisted for an unknown kind")
	}
}

// TestAuthorityRequestRejectedWhenActorMissing：无署名的受理记录，日后说不清
// 是谁接的文。
func TestAuthorityRequestRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(verifiedReq(KindUserInfo, "")); result.Outcome != "REJECTED" {
		t.Fatalf("request without an actor must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityRequests()) != 0 {
		t.Fatal("nothing must be persisted without an actor")
	}
}

// TestAuthorityRequestRejectsFutureReceivedAt：客户端自报一个未来的受理时刻
// 会把截止时刻一起推后 —— 等于凭空多出响应时间。
func TestAuthorityRequestRejectsFutureReceivedAt(t *testing.T) {
	svc, repo := newReportService()
	future := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	result := svc.Handle(authorityReqEnv("ref_4", "网络安全局", KindUserInfo,
		true, true, true, true, future, "operator_1"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("a future receivedAt must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityRequests()) != 0 {
		t.Fatal("nothing must be persisted with a future receivedAt")
	}
}

// TestAuthorityResponseRejectedForUnknownRequest：给不存在的请求写响应，只能
// 制造「看起来响应过」的假象。
func TestAuthorityResponseRejectedForUnknownRequest(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(authorityRespEnv("authreq_nope", AuthorityOutcomeFulfilled, "", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("response for an unknown request must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityResponses()) != 0 {
		t.Fatal("nothing must be persisted for an unknown request")
	}
}

// TestAuthorityResponseRejectedForUnknownOutcome：认不出的结论一律拒绝。
func TestAuthorityResponseRejectedForUnknownOutcome(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(verifiedReq(KindUserInfo, "operator_1")); result.Outcome != "ACCEPTED" {
		t.Fatalf("setup: %+v", result.Error)
	}
	reqID := repo.AuthorityRequests()[0].ID
	if result := svc.Handle(authorityRespEnv(reqID, "IGNORED", "", "operator_1")); result.Outcome != "REJECTED" {
		t.Fatalf("unknown outcome must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityResponses()) != 0 {
		t.Fatal("nothing must be persisted for an unknown outcome")
	}
}

// TestAuthorityResponseRejectedWhenActorMissing：一条没有署名的响应，日后
// 说不清是谁答复的。
func TestAuthorityResponseRejectedWhenActorMissing(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(verifiedReq(KindUserInfo, "operator_1")); result.Outcome != "ACCEPTED" {
		t.Fatalf("setup: %+v", result.Error)
	}
	reqID := repo.AuthorityRequests()[0].ID
	if result := svc.Handle(authorityRespEnv(reqID, AuthorityOutcomeFulfilled, "", "")); result.Outcome != "REJECTED" {
		t.Fatalf("response without an actor must be rejected, got %v", result.Outcome)
	}
	if len(repo.AuthorityResponses()) != 0 {
		t.Fatal("nothing must be persisted without an actor")
	}
}

// TestAuthorityResponseMarkedLateWhenPastDeadline：超时也要照实留痕，但必须
// 被打上标记 —— 不能让人看到「已响应」就以为合规。
func TestAuthorityResponseMarkedLateWhenPastDeadline(t *testing.T) {
	svc, repo := newReportService()
	if result := svc.Handle(verifiedReq(KindUserInfoEmergency, "operator_1")); result.Outcome != "ACCEPTED" {
		t.Fatalf("setup: %+v", result.Error)
	}
	req := repo.AuthorityRequests()[0]

	// 紧急请求 3 小时时限，5 小时后才响应 = 超时。
	late := req.ReceivedAt.Add(5 * time.Hour)
	result := svc.Handle(authorityRespEnv(req.ID, AuthorityOutcomeFulfilled, late.Format(time.RFC3339), "operator_1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("late response must still be recorded: %+v", result.Error)
	}
	if !strings.HasSuffix(result.Aggregate.State, "|LATE") {
		t.Fatalf("late response must be marked, got state %q", result.Aggregate.State)
	}
	if len(repo.AuthorityResponses()) != 1 {
		t.Fatal("the late response must still leave a trail")
	}

	// 对照：按时响应不应带 LATE 标记。
	onTime := req.ReceivedAt.Add(1 * time.Hour)
	ok := svc.Handle(authorityRespEnv(req.ID, AuthorityOutcomeFulfilled, onTime.Format(time.RFC3339), "operator_1"))
	if ok.Outcome != "ACCEPTED" {
		t.Fatalf("on-time response rejected: %+v", ok.Error)
	}
	if strings.HasSuffix(ok.Aggregate.State, "|LATE") {
		t.Fatalf("on-time response must not be marked late, got %q", ok.Aggregate.State)
	}
}

// TestAuthorityFailedWhenRepositoryDown：写不进去必须报错，不能静默当成已受理。
func TestAuthorityFailedWhenRepositoryDown(t *testing.T) {
	svc, repo := newReportService()
	repo.SetFail(true)
	if result := svc.Handle(verifiedReq(KindUserInfo, "operator_1")); result.Outcome != "REJECTED" {
		t.Fatal("a failed write must not be reported as accepted")
	}
}

// TestAuthorityServiceSupportsOnlyModerationCommands：命令面收窄。
func TestAuthorityServiceSupportsOnlyModerationCommands(t *testing.T) {
	svc, _ := newReportService()
	for _, want := range []string{"RecordAuthorityRequest", "RecordAuthorityResponse"} {
		if !svc.Supports(want) {
			t.Fatalf("moderation service must support %q", want)
		}
	}
	if svc.Supports("DeleteAuthorityRequest") {
		t.Fatal("no command may delete an authority request — it is evidence")
	}
}

// 响应结论清单要钉住：少了 REFUSED 就等于「平台从不拒绝任何请求」这条路在
// 记录里消失，而超范围请求本就该拒绝。
func TestAuthorityOutcomesCoverRefusalAndNoData(t *testing.T) {
	for _, want := range []string{
		AuthorityOutcomeFulfilled, AuthorityOutcomePartiallyFulfilled,
		AuthorityOutcomeRefused, AuthorityOutcomeNoDataFound,
	} {
		found := false
		for _, got := range AuthorityOutcomes() {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("authority outcome %q is gone", want)
		}
	}
}
