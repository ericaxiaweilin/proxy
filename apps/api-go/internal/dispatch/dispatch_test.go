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

// ---- MARKET-FAST-001：市场发单的快速模式 ----

type fakeSource struct {
	applicants []Candidate
	stop       string
}

func (f *fakeSource) Candidates(_ context.Context, _ Run, tried map[string]bool) ([]Candidate, string, error) {
	if f.stop != "" {
		return nil, f.stop, nil
	}
	out := []Candidate{}
	for _, c := range f.applicants {
		if !tried[c.AgentID] {
			out = append(out, c)
		}
	}
	return out, "", nil
}

type withdrawingOffers struct {
	*fakeOffers
	withdrawn []string
}

func (w *withdrawingOffers) Withdraw(_ context.Context, _ Run, offerID string) error {
	w.withdrawn = append(w.withdrawn, offerID)
	w.status[offerID] = "CANCELLED"
	return nil
}

func marketEngine() (*Engine, *withdrawingOffers, *fakeSource, *time.Time) {
	e, offers, now := newEngine()
	w := &withdrawingOffers{fakeOffers: offers}
	src := &fakeSource{}
	e.Offers = w
	e.Sources = map[string]CandidateSource{KindMarket: src}
	return e, w, src, now
}

func stepKinds(t *testing.T, e *Engine) []string {
	t.Helper()
	_, steps, _ := e.Repo.Get(context.Background(), "run_1")
	out := []string{}
	for _, s := range steps {
		out = append(out, s.Kind)
	}
	return out
}

func TestMarketRunWaitsQuietlyThenSelectsTheBestApplicant(t *testing.T) {
	ctx := context.Background()
	e, w, src, now := marketEngine()
	if _, err := e.StartMarket(ctx, "opp_1", "owner_1"); err != nil {
		t.Fatal(err)
	}
	run(t, e)
	run(t, e)
	if got := stepKinds(t, e); fmt.Sprint(got) != fmt.Sprint([]string{StepStarted, StepWaiting}) {
		t.Fatalf("no applicants yet: one WAITING step, no spam: %v", got)
	}
	// 两人报名（来源已按撮合排好序）。市场单的价格是发单价：0 也照样选，不比预算。
	src.applicants = []Candidate{{AgentID: "best", Ref: "app_best"}, {AgentID: "second", Ref: "app_second"}}
	r := run(t, e)
	if r.CurrentAgentID != "best" || r.Status != StatusRunning || r.Waiting {
		t.Fatalf("the top-ranked applicant is selected: %+v", r)
	}
	*now = now.Add(6 * time.Minute)
	r = run(t, e)
	if len(w.withdrawn) != 1 || r.CurrentAgentID != "second" {
		t.Fatalf("after 5 minutes the selection is withdrawn before the next one is selected: withdrawn=%v run=%+v", w.withdrawn, r)
	}
	w.status[r.CurrentOfferID] = "ACCEPTED"
	if r = run(t, e); r.Status != StatusAssigned || r.AssignedAgentID != "second" {
		t.Fatalf("she confirmed ⇒ assigned: %+v", r)
	}
}

func TestMarketRunStopsWhenTheOwnerPicksSomeoneHimself(t *testing.T) {
	ctx := context.Background()
	e, _, src, _ := marketEngine()
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	src.stop = "owner_selected_manually"
	if r := run(t, e); r.Status != StatusCancelled {
		t.Fatalf("the owner's own choice wins; the platform stops: %+v", r)
	}
	if got := stepKinds(t, e); got[len(got)-1] != StepOwnerTookOver {
		t.Fatalf("the reason is on the trail: %v", got)
	}
}

func TestMarketRunExhaustsAndReopensOnANewApplicant(t *testing.T) {
	ctx := context.Background()
	e, w, src, now := marketEngine()
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	src.applicants = []Candidate{{AgentID: "only", Ref: "app_only"}}
	run(t, e)
	*now = now.Add(6 * time.Minute)
	if r := run(t, e); r.Status != StatusExhausted {
		t.Fatalf("everyone who applied was tried ⇒ exhausted (ops queue): %+v", r)
	}
	src.applicants = append(src.applicants, Candidate{AgentID: "late", Ref: "app_late"})
	if err := e.Reopen(ctx, "opp_1", "late"); err != nil {
		t.Fatal(err)
	}
	r := run(t, e)
	if r.Status != StatusRunning || r.CurrentAgentID != "late" || len(w.sent) != 2 {
		t.Fatalf("a new applicant reopens the run and is selected next: %+v sent=%v", r, w.sent)
	}
}

// 撤回那一刻她确认了：不能再选下一位（否则两个人同时被选中）。
type racingOffers struct{ *withdrawingOffers }

func (r *racingOffers) Withdraw(_ context.Context, _ Run, offerID string) error {
	r.status[offerID] = "ACCEPTED" // 她在撤回落库前一瞬间确认了，撤回成了空操作
	return nil
}

func TestMarketWithdrawRaceWithAConfirmationCountsAsAssigned(t *testing.T) {
	ctx := context.Background()
	e, w, src, now := marketEngine()
	race := &racingOffers{w}
	e.Offers = race
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	src.applicants = []Candidate{{AgentID: "a", Ref: "app_a"}, {AgentID: "b", Ref: "app_b"}}
	run(t, e)
	*now = now.Add(6 * time.Minute)
	r := run(t, e)
	if r.Status != StatusAssigned || r.AssignedAgentID != "a" || len(w.sent) != 1 {
		t.Fatalf("a confirmation that beat the withdrawal wins; b is never selected: %+v sent=%v", r, w.sent)
	}
}

// ---- MARKET-INVITE-001：没人报名就主动邀请附近合适的人 ----

type fakeInviter struct {
	pool     []string
	skip     string
	calls    int
	excluded []map[string]bool
}

func (f *fakeInviter) Invite(_ context.Context, _ Run, exclude map[string]bool, limit int) ([]string, string, error) {
	f.calls++
	f.excluded = append(f.excluded, exclude)
	if f.skip != "" {
		return nil, f.skip, nil
	}
	out := []string{}
	for _, id := range f.pool {
		if !exclude[id] && len(out) < limit {
			out = append(out, id)
		}
	}
	return out, "", nil
}

func eventsOf(e *Engine, kind string) []string {
	out := []string{}
	for _, ev := range e.Repo.(*Memory).Events() {
		if ev.EventType == kind {
			who, _ := ev.Payload["notifyPrincipalId"].(string)
			out = append(out, who)
		}
	}
	return out
}

func TestNoApplicantsMeansTwoRoundsOfInvitationsThenSilence(t *testing.T) {
	ctx := context.Background()
	e, _, _, now := marketEngine()
	inv := &fakeInviter{pool: []string{"p1", "p2", "p3", "p4", "p5", "p6", "p7", "owner_1"}}
	e.Inviter = inv
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	run(t, e) // WAITING
	*now = now.Add(9 * time.Minute)
	run(t, e)
	if inv.calls != 0 {
		t.Fatal("nobody is bothered before 10 minutes")
	}
	*now = now.Add(2 * time.Minute)
	r := run(t, e)
	if inv.calls != 1 || len(r.Invited) != 5 || r.InviteRounds != 1 {
		t.Fatalf("round 1 invites 5 people: %+v", r)
	}
	if !inv.excluded[0]["owner_1"] {
		t.Fatal("the poster never invites himself")
	}
	*now = now.Add(20 * time.Minute)
	run(t, e)
	if inv.calls != 1 {
		t.Fatal("round 2 waits a full 30 minutes")
	}
	*now = now.Add(11 * time.Minute)
	r = run(t, e)
	if inv.calls != 2 || fmt.Sprint(r.Invited[5:]) != "[p6 p7]" {
		t.Fatalf("round 2 invites only people not invited before: %+v", r.Invited)
	}
	*now = now.Add(5 * time.Hour)
	run(t, e)
	if inv.calls != 2 {
		t.Fatal("after two rounds the platform stops inviting")
	}
	if got := eventsOf(e, "MarketOpportunityInvited"); len(got) != 7 {
		t.Fatalf("every invitee gets one notification event: %v", got)
	}
}

func TestInvitingImpossibleIsRecordedOnceAndNotRetried(t *testing.T) {
	ctx := context.Background()
	e, _, _, now := marketEngine()
	inv := &fakeInviter{skip: "opportunity_has_no_location"}
	e.Inviter = inv
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	run(t, e)
	*now = now.Add(11 * time.Minute)
	run(t, e)
	*now = now.Add(2 * time.Hour)
	run(t, e)
	if inv.calls != 1 {
		t.Fatalf("a skip is final, not retried every tick: %d calls", inv.calls)
	}
	if got := stepKinds(t, e); got[len(got)-1] != StepInviteSkipped {
		t.Fatalf("the reason is on the trail: %v", got)
	}
}

func TestTheSelectedApplicantIsToldShehasFiveMinutes(t *testing.T) {
	ctx := context.Background()
	e, _, src, _ := marketEngine()
	_, _ = e.StartMarket(ctx, "opp_1", "owner_1")
	src.applicants = []Candidate{{AgentID: "amy", Ref: "app_amy"}}
	run(t, e)
	if got := eventsOf(e, "MarketApplicationSelected"); fmt.Sprint(got) != "[amy]" {
		t.Fatalf("the platform's pick is notified, otherwise she never confirms in time: %v", got)
	}
}
