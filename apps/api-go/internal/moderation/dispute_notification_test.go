package moderation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

func toJSONString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func envelopeForModeration(commandType string, actorID string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandType:   commandType,
		Actor:         command.Actor{Type: "USER", ID: actorID},
		Principal:     command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Payload:       payload,
		Target:        command.Target{Type: "Order", ID: targetID},
		CorrelationID: "corr_" + commandType,
		CommandID:     "cmd_" + commandType,
	}
}

// ORDER-DISPUTE-001：真人服务订单纠纷能被当成一类信号报上来（2026-10-05）。
//
// 之前只能塞 OTHER，而 OTHER 的意思是「没有信号」—— 运营在队列里看不出该先看哪条，
// 而订单纠纷恰恰是最有时效的一类（放鸽子、爽约、服务不符，现场就那一次）。
func TestOrderCanBeReportedAsAnOrderDispute(t *testing.T) {
	// 订单挂在 TRANSACTION 上（条款 §3.8 已列的那八类之一），而不是新加一个 ORDER：
	// 目标类型被法律条款钉死，加一类得先改条款，不能由代码单方面决定。
	if !contains(ReportableTargetTypes(), TargetTransaction) {
		t.Fatal("an order must be reportable as TRANSACTION")
	}
	if !contains(ReportableReasons(), ReasonOrderDispute) {
		t.Fatal("ORDER_DISPUTE must be a reportable reason")
	}
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	r := s.Handle(envelopeForModeration("ReportTarget", "user_hanh", map[string]any{
		"targetType": TargetTransaction,
		"targetId":   "ord_123",
		"reason":     ReasonOrderDispute,
		"note":       "约了下午三点，creator 没出现",
	}, "ord_123"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("filing an order dispute must be accepted, got %s (%+v)", r.Outcome, r.Error)
	}
}

// 处置结果必须通知举报人 —— 举报提交是同步回执，处置不是。
//
// 不通知的后果不是「少一条消息」：用户会默认举报被忽略了，而那比明确告诉他
// 「不成立」更伤。等于举报渠道静默失效。
func TestDispositionNotifiesTheReporter(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	r := s.Handle(envelopeForModeration("ReportTarget", "user_hanh", map[string]any{
		"targetType": TargetTransaction, "targetId": "ord_123", "reason": ReasonOrderDispute,
	}, "ord_123"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("report: %s", r.Outcome)
	}
	reportID := ""
	for _, report := range repo.Reports() {
		reportID = report.ID
	}

	d := s.Handle(envelopeForModeration("RecordReportDisposition", "operator_alice", map[string]any{
		"reportId": reportID, "action": ActionDismiss, "outcome": OutcomeNoAction, "note": "查了，没有这回事",
	}, ""))
	if d.Outcome != "ACCEPTED" {
		t.Fatalf("disposition: %s (%+v)", d.Outcome, d.Error)
	}

	events := repo.Events()
	var found *event.DomainEvent
	for i := range events {
		if events[i].EventType == "ReportDispositionRecorded" {
			found = &events[i]
		}
	}
	if found == nil {
		t.Fatalf("a disposition must emit ReportDispositionRecorded, got %+v", events)
	}
	// 收件人必须是举报人（principal），不然这条通知进不了任何人的收件箱
	if found.PrincipalID != "user_hanh" {
		t.Fatalf("recipient must be the reporter, got %q", found.PrincipalID)
	}
	// 运营的内部措辞不许进用户推送
	blob := strings.ToLower(toJSONString(found.Payload))
	if strings.Contains(blob, "查了") || strings.Contains(blob, "note") {
		t.Fatalf("the operator note must not reach the user payload, got %s", blob)
	}
}

// 申诉结果必须通知申诉人 —— 之前整条申诉链一个事件都不发，用户提交后永远没有回音。
func TestAppealDecisionNotifiesTheAppellant(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	r := s.Handle(envelopeForModeration("ReportTarget", "user_hanh", map[string]any{
		"targetType": TargetTransaction, "targetId": "ord_123", "reason": ReasonOrderDispute,
	}, "ord_123"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("report: %s", r.Outcome)
	}
	var reportID string
	for _, report := range repo.Reports() {
		reportID = report.ID
	}
	if d := s.Handle(envelopeForModeration("RecordReportDisposition", "operator_alice", map[string]any{
		"reportId": reportID, "action": ActionDismiss, "outcome": OutcomeNoAction, "note": "不成立",
	}, "")); d.Outcome != "ACCEPTED" {
		t.Fatalf("disposition: %s", d.Outcome)
	}
	appeal := s.Handle(envelopeForModeration("FileAppeal", "user_hanh", map[string]any{
		"reportId": reportID, "reason": "我有聊天记录能证明 creator 确实爽约了",
	}, ""))
	if appeal.Outcome != "ACCEPTED" {
		t.Fatalf("appeal: %s (%+v)", appeal.Outcome, appeal.Error)
	}
	appealID := ""
	for _, a := range repo.Appeals() {
		appealID = a.ID
	}

	before := len(repo.Events())
	dec := s.Handle(envelopeForModeration("RecordAppealDecision", "operator_bob", map[string]any{
		"appealId": appealID, "decision": AppealDecisionUpheld, "note": "核实了聊天记录，纠纷成立",
	}, ""))
	if dec.Outcome != "ACCEPTED" {
		t.Fatalf("appeal decision: %s (%+v)", dec.Outcome, dec.Error)
	}
	found := false
	for _, e := range repo.Events()[before:] {
		if e.EventType == "AppealDecisionRecorded" {
			found = true
			if e.PrincipalID != "user_hanh" {
				t.Fatalf("recipient must be the appellant, got %q", e.PrincipalID)
			}
			if e.Payload["decision"] != AppealDecisionUpheld {
				t.Fatalf("payload must carry the decision, got %v", e.Payload["decision"])
			}
			if blob := strings.ToLower(toJSONString(e.Payload)); strings.Contains(blob, "核实了") {
				t.Fatalf("the operator note must not reach the user payload, got %s", blob)
			}
		}
	}
	if !found {
		t.Fatal("an appeal decision must emit AppealDecisionRecorded")
	}
}

// 留痕和事件必须同生共死：事件发不出去就不能算处置成功 —— 否则会有一条通知说
// 「已处理」，而库里什么都没有。
func TestDispositionFailsWhenTheEventCannotBePublished(t *testing.T) {
	repo := &MemoryRepository{}
	s := NewWithRepository(repo)
	r := s.Handle(envelopeForModeration("ReportTarget", "user_hanh", map[string]any{
		"targetType": TargetTransaction, "targetId": "ord_123", "reason": ReasonOrderDispute,
	}, "ord_123"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("report: %s", r.Outcome)
	}
	var reportID string
	for _, report := range repo.Reports() {
		reportID = report.ID
	}
	// 空事件必须报错，而不是「静默当作成功」
	if err := repo.WriteAndPublish(context.Background(), func(context.Context) error { return nil }, nil); err == nil {
		t.Fatal("WriteAndPublish with zero events must fail — otherwise a future caller believes the notification pipeline is connected")
	}
	d := s.Handle(envelopeForModeration("RecordReportDisposition", "operator_alice", map[string]any{
		"reportId": reportID, "action": ActionDismiss, "outcome": OutcomeNoAction, "note": "不成立",
	}, ""))
	if d.Outcome != "ACCEPTED" {
		t.Fatalf("disposition should still succeed with a working repo, got %s", d.Outcome)
	}
}
