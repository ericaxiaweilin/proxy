package decisionengine

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeSource struct {
	level      string
	levelErr   error
	optedOut   bool
	used       int
	usedErr    error
	sinceSeen  time.Time
	gravity    map[string]*GravityState
	gravityErr error
}

func (f *fakeSource) RestrictionLevel(context.Context, string) (string, error) {
	return f.level, f.levelErr
}
func (f *fakeSource) NudgesOptedOut(context.Context, string) (bool, error) { return f.optedOut, nil }
func (f *fakeSource) InterventionsSince(_ context.Context, _ string, since time.Time) (int, error) {
	f.sinceSeen = since
	return f.used, f.usedErr
}
func (f *fakeSource) GravityState(_ context.Context, _ string, et string) (*GravityState, error) {
	if f.gravityErr != nil {
		return nil, f.gravityErr
	}
	return f.gravity[et], nil
}

type memLedger struct{ rows []Decision }

func (m *memLedger) Record(_ context.Context, d Decision) error {
	m.rows = append(m.rows, d)
	return nil
}

func eval(t *testing.T, src *fakeSource, req Request) (Decision, *memLedger) {
	t.Helper()
	led := &memLedger{}
	e := New(src, led)
	e.Now = func() time.Time { return time.Date(2026, 10, 11, 5, 0, 0, 0, time.UTC) }
	if req.Caller == "" {
		req.Caller = "test"
	}
	d, err := e.Evaluate(context.Background(), req)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	return d, led
}

func stepOf(d Decision, name string) Step {
	for _, s := range d.Steps {
		if s.Name == name {
			return s
		}
	}
	return Step{}
}

func TestDecisionEngine_LifecycleNudgeAllowedWithinBudget(t *testing.T) {
	d, led := eval(t, &fakeSource{}, Request{UserID: "u1", Action: ActionNudge, Subject: "FIRST_POST"})
	if !d.Allowed || d.State != StateSoftNudge {
		t.Fatalf("want allowed SOFT_NUDGE, got allowed=%v state=%s steps=%+v", d.Allowed, d.State, d.Steps)
	}
	if s := stepOf(d, StepEvidence); s.Verdict != VerdictSkip || s.Reason != "NOT_PREDICTION" {
		t.Fatalf("lifecycle nudge must SKIP the evidence gate, got %+v", s)
	}
	if s := stepOf(d, StepHumanValue); s.Verdict != VerdictSkip || s.Reason != "NOT_IMPLEMENTED" {
		t.Fatalf("human value must say NOT_IMPLEMENTED, got %+v", s)
	}
	if len(led.rows) != 1 || led.rows[0].ID != d.ID {
		t.Fatalf("every evaluation must be recorded once, got %d rows", len(led.rows))
	}
}

func TestDecisionEngine_RestrictedAccountIsBlocked(t *testing.T) {
	d, _ := eval(t, &fakeSource{level: "SUSPENDED"}, Request{UserID: "u1", Action: ActionNudge})
	if d.Allowed || d.State != StateBlocked || d.BlockedStep != StepSafety || d.Reason != "ACCOUNT_SUSPENDED" {
		t.Fatalf("got %+v", d)
	}
	// 后面的步骤仍然跑、仍然留痕。
	if len(d.Steps) != 5 {
		t.Fatalf("all five steps must be recorded even after a block, got %d", len(d.Steps))
	}
}

func TestDecisionEngine_OptOutBlocksNudgeButNotFeedCard(t *testing.T) {
	src := &fakeSource{optedOut: true, gravity: map[string]*GravityState{"BROWSE_ACTIVE": {ActionState: StateSoftNudge, P60: 0.6, Coverage: 0.6}}}
	n, _ := eval(t, src, Request{UserID: "u1", Action: ActionNudge})
	if n.Allowed || n.BlockedStep != StepNegative || n.Reason != "NUDGES_OPTED_OUT" || n.State != StateBlocked {
		t.Fatalf("nudge: got %+v", n)
	}
	f, _ := eval(t, src, Request{UserID: "u1", Action: ActionFeedCard, EventType: "BROWSE_ACTIVE"})
	if !f.Allowed {
		t.Fatalf("opting out of nudges must not hide the user from organic feed ranking, got %+v", f)
	}
}

// DECISION-BUDGET-001：每人每天（河内时间）最多主动打扰 1 次。
func TestDecisionEngine_BudgetExhaustedIsPassiveNotBlocked(t *testing.T) {
	src := &fakeSource{used: 1}
	d, _ := eval(t, src, Request{UserID: "u1", Action: ActionNudge})
	if d.Allowed || d.BlockedStep != StepBudget || d.Reason != "BUDGET_EXHAUSTED" || d.State != StatePassive {
		t.Fatalf("got %+v", d)
	}
	// 05:00 UTC = 12:00 河内 ⇒ 「今天」从河内 00:00 = 前一天 17:00 UTC 算起。
	if want := time.Date(2026, 10, 10, 17, 0, 0, 0, time.UTC); !src.sinceSeen.Equal(want) {
		t.Fatalf("budget day must start at 00:00 Hanoi (%s), got %s", want, src.sinceSeen.UTC())
	}
}

func TestDecisionEngine_EvidenceGateIsStricterForNudge(t *testing.T) {
	src := &fakeSource{gravity: map[string]*GravityState{"CHAT_ACTIVE": {ActionState: StateSoftNudge, P60: 0.7, Coverage: 0.8}}}
	f, _ := eval(t, src, Request{UserID: "u1", Action: ActionFeedCard, EventType: "CHAT_ACTIVE"})
	if !f.Allowed {
		t.Fatalf("feed card at coverage .8 / P60 .7 must pass, got %+v", f)
	}
	n, _ := eval(t, src, Request{UserID: "u1", Action: ActionNudge, EventType: "CHAT_ACTIVE"})
	if n.Allowed || n.BlockedStep != StepEvidence || n.Reason != "COVERAGE_BELOW_MIN" {
		t.Fatalf("a push needs stronger evidence than a feed card, got %+v", n)
	}
}

func TestDecisionEngine_NoGravityStateIsObserve(t *testing.T) {
	d, _ := eval(t, &fakeSource{}, Request{UserID: "u1", Action: ActionFeedCard, EventType: "SCENE_VISIT"})
	if d.Allowed || d.Reason != "NO_EVIDENCE" || d.State != StateObserve {
		t.Fatalf("got %+v", d)
	}
}

func TestDecisionEngine_UnreadableSourceFailsClosed(t *testing.T) {
	d, _ := eval(t, &fakeSource{levelErr: errors.New("db down")}, Request{UserID: "u1", Action: ActionNudge})
	if d.Allowed || d.Reason != ReasonUnavailable {
		t.Fatalf("an unreadable gate must block, got %+v", d)
	}
	d, _ = eval(t, &fakeSource{usedErr: errors.New("db down")}, Request{UserID: "u1", Action: ActionNudge})
	if d.Allowed || d.BlockedStep != StepBudget || d.Reason != ReasonUnavailable {
		t.Fatalf("an unreadable budget must block, got %+v", d)
	}
}

// 与 gravity.TestNeverAutoActiveOrchestrate 同一条约束：§12 没实现之前，引擎不给主动编排。
func TestDecisionEngine_NeverActiveOrchestrate(t *testing.T) {
	src := &fakeSource{gravity: map[string]*GravityState{"CHAT_ACTIVE": {ActionState: "ACTIVE_ORCHESTRATE", P60: 1, Coverage: 1}}}
	for _, a := range []string{ActionFeedCard, ActionNudge} {
		d, _ := eval(t, src, Request{UserID: "u1", Action: a, EventType: "CHAT_ACTIVE"})
		if d.State == "ACTIVE_ORCHESTRATE" {
			t.Fatalf("%s: engine returned ACTIVE_ORCHESTRATE", a)
		}
	}
}

func TestDecisionEngine_RejectsInvalidRequest(t *testing.T) {
	e := New(&fakeSource{}, nil)
	for _, r := range []Request{{Action: ActionNudge, Caller: "x"}, {UserID: "u", Action: "PUSH_EVERYONE", Caller: "x"}, {UserID: "u", Action: ActionNudge}} {
		if _, err := e.Evaluate(context.Background(), r); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%+v: want ErrInvalidRequest, got %v", r, err)
		}
	}
}
