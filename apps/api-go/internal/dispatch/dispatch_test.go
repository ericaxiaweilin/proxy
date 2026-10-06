package dispatch

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// fakeOffers 是一个可控的履约端：记下发给谁，状态由测试设定。
type fakeOffers struct {
	sent    []string          // agentId，按发出顺序
	status  map[string]string // offerId → 状态
	refuse  map[string]string // agentId → 拒绝码
	failFor map[string]bool   // agentId → 基础设施错误
	n       int
}

func (f *fakeOffers) Send(_ context.Context, _ Run, c Candidate, ttl time.Duration) (string, time.Time, string, error) {
	if f.failFor[c.AgentID] {
		return "", time.Time{}, "", errors.New("db down")
	}
	if code := f.refuse[c.AgentID]; code != "" {
		return "", time.Time{}, code, nil
	}
	f.n++
	id := fmt.Sprintf("off_%d", f.n)
	f.sent = append(f.sent, c.AgentID)
	f.status[id] = "OFFERED"
	return id, clockNow.Add(ttl), "", nil
}

func (f *fakeOffers) Status(_ context.Context, _ Run, offerID string) (string, error) {
	return f.status[offerID], nil
}

var clockNow = time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)

func newEngine() (*Engine, *fakeOffers, *time.Time) {
	now := clockNow
	offers := &fakeOffers{status: map[string]string{}, refuse: map[string]string{}, failFor: map[string]bool{}}
	n := 0
	return &Engine{
		Repo: NewMemory(), Offers: offers,
		Now:   func() time.Time { return now },
		NewID: func() string { n++; return fmt.Sprintf("run_%d", n) },
	}, offers, &now
}

func task(c ...Candidate) Task {
	return Task{TaskID: "task_1", RequesterID: "req_1", SlotIDs: []string{"slot_1"}, MatchingMode: "FAST",
		AutoDispatch: true, BudgetVND: 1_000_000, BatchID: "cb_1", Candidates: c}
}

func run(t *testing.T, e *Engine) Run {
	t.Helper()
	if _, err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	r, _, err := e.Repo.Get(context.Background(), "run_1")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestOnlyFastTasksTheRequesterAuthorizedWithABudgetAreDispatched(t *testing.T) {
	for _, c := range []struct {
		name   string
		mutate func(*Task)
		reason string
	}{
		{"curated", func(t *Task) { t.MatchingMode = "CURATED" }, "matching_mode_not_fast"},
		{"no consent", func(t *Task) { t.AutoDispatch = false }, "requester_did_not_authorize_auto_dispatch"},
		{"no budget", func(t *Task) { t.BudgetVND = 0 }, "no_fixed_vnd_budget"},
	} {
		tk := task(Candidate{AgentID: "a", Price: 1})
		c.mutate(&tk)
		if ok, why := tk.Eligible(); ok || why != c.reason {
			t.Fatalf("%s: eligible=%v why=%q", c.name, ok, why)
		}
		e, _, _ := newEngine()
		runs, _ := e.Start(context.Background(), tk)
		if len(runs) != 0 {
			t.Fatalf("%s must not create a run", c.name)
		}
	}
}

func TestOneAtATimeInRankOrderAndAdvanceOnExpiry(t *testing.T) {
	e, offers, now := newEngine()
	if _, err := e.Start(context.Background(), task(Candidate{AgentID: "a", Price: 900_000}, Candidate{AgentID: "b", Price: 800_000})); err != nil {
		t.Fatal(err)
	}
	r := run(t, e)
	if len(offers.sent) != 1 || offers.sent[0] != "a" || r.CurrentAgentID != "a" {
		t.Fatalf("first tick offers the top-ranked one only: sent=%v run=%+v", offers.sent, r)
	}
	// 还没过期：什么都不做（不能同时发给第二个人）。
	*now = now.Add(4 * time.Minute)
	r = run(t, e)
	if len(offers.sent) != 1 {
		t.Fatalf("while a's offer is live nobody else is offered: %v", offers.sent)
	}
	*now = now.Add(2 * time.Minute)
	r = run(t, e)
	if len(offers.sent) != 2 || offers.sent[1] != "b" || r.CurrentAgentID != "b" {
		t.Fatalf("after 5 minutes it moves on to b: sent=%v run=%+v", offers.sent, r)
	}
}

func TestAcceptedOfferAssignsTheSlot(t *testing.T) {
	e, offers, _ := newEngine()
	_, _ = e.Start(context.Background(), task(Candidate{AgentID: "a", Price: 900_000}, Candidate{AgentID: "b", Price: 800_000}))
	r := run(t, e)
	offers.status[r.CurrentOfferID] = "ACCEPTED"
	r = run(t, e)
	if r.Status != StatusAssigned || r.AssignedAgentID != "a" {
		t.Fatalf("accepted ⇒ assigned to a: %+v", r)
	}
	if len(offers.sent) != 1 {
		t.Fatalf("an assigned run sends nothing more: %v", offers.sent)
	}
}

func TestOverBudgetAndRefusedCandidatesAreSkippedWithAReason(t *testing.T) {
	e, offers, _ := newEngine()
	offers.refuse["b"] = "CASH_ELIGIBILITY_BLOCKED"
	_, _ = e.Start(context.Background(), task(
		Candidate{AgentID: "pricey", Price: 1_500_000},
		Candidate{AgentID: "b", Price: 700_000},
		Candidate{AgentID: "c", Price: 600_000},
	))
	r := run(t, e)
	if r.CurrentAgentID != "c" || len(offers.sent) != 1 {
		t.Fatalf("over-budget and refused are skipped, c is offered: %+v sent=%v", r, offers.sent)
	}
	_, steps, _ := e.Repo.Get(context.Background(), "run_1")
	kinds := []string{}
	for _, s := range steps {
		kinds = append(kinds, s.Kind)
	}
	want := []string{StepStarted, StepSkippedBudget, StepOfferRefused, StepOfferSent}
	if fmt.Sprint(kinds) != fmt.Sprint(want) {
		t.Fatalf("every skip leaves a step: got %v want %v", kinds, want)
	}
}

func TestExhaustedWhenEveryoneIsTriedAndNoRadiusIsWidened(t *testing.T) {
	e, offers, now := newEngine()
	_, _ = e.Start(context.Background(), task(Candidate{AgentID: "a", Price: 900_000}))
	run(t, e)
	*now = now.Add(6 * time.Minute)
	r := run(t, e)
	if r.Status != StatusExhausted {
		t.Fatalf("after the last candidate expires the run is exhausted (goes to the ops queue): %+v", r)
	}
	if len(offers.sent) != 1 {
		t.Fatalf("exhausted means stop, not re-search wider: %v", offers.sent)
	}
}

func TestEmptyBatchIsVisibleAsExhaustedFromTheStart(t *testing.T) {
	e, _, _ := newEngine()
	runs, err := e.Start(context.Background(), task())
	if err != nil || len(runs) != 1 || runs[0].Status != StatusExhausted {
		t.Fatalf("no candidates still creates a run so ops can see the shortage: %+v %v", runs, err)
	}
}

func TestInfrastructureFailureRetriesTheSamePersonNextTick(t *testing.T) {
	e, offers, _ := newEngine()
	offers.failFor["a"] = true
	_, _ = e.Start(context.Background(), task(Candidate{AgentID: "a", Price: 900_000}, Candidate{AgentID: "b", Price: 800_000}))
	r := run(t, e)
	if r.Cursor != 0 || r.CurrentOfferID != "" {
		t.Fatalf("a failed send must not skip a: %+v", r)
	}
	offers.failFor["a"] = false
	r = run(t, e)
	if r.CurrentAgentID != "a" {
		t.Fatalf("next tick offers a again: %+v", r)
	}
}

func TestTwoSlotsOfOneTaskNeverOfferTheSamePerson(t *testing.T) {
	e, offers, _ := newEngine()
	tk := task(Candidate{AgentID: "a", Price: 900_000}, Candidate{AgentID: "b", Price: 800_000})
	tk.SlotIDs = []string{"slot_1", "slot_2"}
	_, _ = e.Start(context.Background(), tk)
	if _, err := e.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(offers.sent) != "[a b]" {
		t.Fatalf("slot 2 skips a (slot 1 is waiting on her) and offers b: %v", offers.sent)
	}
}

func TestOperatorRetryAssignAndCancel(t *testing.T) {
	ctx := context.Background()
	e, offers, now := newEngine()
	_, _ = e.Start(ctx, task(Candidate{AgentID: "a", Price: 900_000}))
	run(t, e)
	*now = now.Add(6 * time.Minute)
	run(t, e) // exhausted

	if _, err := e.Retry(ctx, "run_1", "op_1", "a 说现在有空了"); err != nil {
		t.Fatal(err)
	}
	r := run(t, e)
	if r.CurrentAgentID != "a" || len(offers.sent) != 2 {
		t.Fatalf("retry starts over from the top: %+v sent=%v", r, offers.sent)
	}

	if _, _, err := e.Assign(ctx, "run_1", Candidate{AgentID: "z", Price: 500_000}, "op_1", "电话确认过"); err == nil {
		t.Fatal("cannot assign while an offer is still waiting")
	}
	*now = now.Add(6 * time.Minute)
	run(t, e) // a expired again → exhausted
	if _, _, err := e.Assign(ctx, "run_1", Candidate{AgentID: "z", Price: 2_000_000}, "op_1", "x"); err == nil {
		t.Fatal("an operator pick above the budget is refused, same rule as the engine")
	}
	r, _, err := e.Assign(ctx, "run_1", Candidate{AgentID: "z", Price: 500_000}, "op_1", "电话确认过")
	if err != nil || r.CurrentAgentID != "z" || offers.sent[len(offers.sent)-1] != "z" {
		t.Fatalf("assign offers the chosen person right away: %+v %v sent=%v", r, err, offers.sent)
	}
	if _, err := e.Cancel(ctx, "run_1", "op_1", "需求方取消"); err != nil {
		t.Fatal(err)
	}
	before := len(offers.sent)
	*now = now.Add(10 * time.Minute)
	if r = run(t, e); r.Status != StatusCancelled || len(offers.sent) != before {
		t.Fatalf("a cancelled run sends nothing more: %+v", r)
	}
}
