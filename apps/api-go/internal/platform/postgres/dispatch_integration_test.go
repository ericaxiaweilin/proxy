package postgres

// DISPATCH-LOOP-001：派单的 run / step 存储对**真库**跑（migration 181）。
// 内存实现证明的是规则；这里证明的是列名、JSONB 快照读得回来、FOR UPDATE SKIP LOCKED
// 那条推进路径真的落库、乐观版本号真的拦得住并发的运营动作，以及 (task, slot) 不会建出两条。

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
)

type pgFakeOffers struct {
	n      int
	status map[string]string
	sent   []string
}

func (f *pgFakeOffers) Send(_ context.Context, _ dispatch.Run, c dispatch.Candidate, ttl time.Duration) (string, time.Time, string, error) {
	f.n++
	id := fmt.Sprintf("off_dispatch_probe_%d", f.n)
	f.status[id] = "OFFERED"
	f.sent = append(f.sent, c.AgentID)
	return id, time.Now().Add(ttl), "", nil
}

func (f *pgFakeOffers) Status(_ context.Context, _ dispatch.Run, id string) (string, error) {
	return f.status[id], nil
}

func TestDispatchRunsRoundTripThroughPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	taskID := "task_dispatch_probe_" + time.Now().Format("150405.000000")
	cleanup := func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM dispatch.runs WHERE task_id = $1`, taskID)
	}
	cleanup()
	t.Cleanup(cleanup)

	offers := &pgFakeOffers{status: map[string]string{}}
	n := 0
	engine := &dispatch.Engine{
		Repo: dispatch.NewPostgres(pool), Offers: offers,
		NewID: func() string { n++; return fmt.Sprintf("%s_run_%d", taskID, n) },
	}
	tk := dispatch.Task{TaskID: taskID, RequesterID: "req_probe", SlotIDs: []string{"s1", "s2"}, MatchingMode: "FAST",
		AutoDispatch: true, BudgetVND: 1_000_000, BatchID: "cb_probe",
		Candidates: []dispatch.Candidate{{AgentID: "a", Price: 900_000, Currency: "VND"}, {AgentID: "b", Price: 800_000}}}
	if _, err := engine.Start(ctx, tk); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// 同一张需求再发布一次（重试 / 重复事件）：(task, slot) 唯一，不会多出第二条在跑的派单。
	if _, err := engine.Start(ctx, tk); err != nil {
		t.Fatalf("second Start must be a no-op, got %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM dispatch.runs WHERE task_id = $1`, taskID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("two slots ⇒ exactly two runs, got %d (%v)", count, err)
	}

	if _, err := engine.Tick(ctx); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if len(offers.sent) != 2 || offers.sent[0] == offers.sent[1] {
		t.Fatalf("each slot offers a different person: %v", offers.sent)
	}
	runs, err := engine.Repo.TaskRuns(ctx, taskID)
	if err != nil || len(runs) != 2 {
		t.Fatalf("TaskRuns: %v %v", runs, err)
	}
	r, steps, err := engine.Repo.Get(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if r.CurrentOfferID == "" || r.CurrentExpiresAt == nil || len(r.Candidates) != 2 || r.Candidates[0].Currency != "VND" {
		t.Fatalf("run state and candidate snapshot read back intact: %+v", r)
	}
	if len(steps) != 2 || steps[0].Kind != dispatch.StepStarted || steps[1].Kind != dispatch.StepOfferSent || steps[1].Detail["price"] == nil {
		t.Fatalf("steps are appended in order with their detail: %+v", steps)
	}

	// 两个运营同时对同一条做动作：后到的那个按旧版本写，必须被拦下。
	if err := engine.Repo.Save(ctx, r, r.Version-1, nil); !errors.Is(err, dispatch.ErrVersionConflict) {
		t.Fatalf("a stale version must be rejected, got %v", err)
	}

	offers.status[r.CurrentOfferID] = "ACCEPTED"
	if _, err := engine.Tick(ctx); err != nil {
		t.Fatalf("Tick 2: %v", err)
	}
	r, _, _ = engine.Repo.Get(ctx, r.ID)
	if r.Status != dispatch.StatusAssigned || r.AssignedAgentID == "" {
		t.Fatalf("accepted ⇒ assigned, persisted: %+v", r)
	}
	stats, err := dispatch.NewPostgres(pool).Stats(ctx, time.Now().Add(-time.Hour))
	if err != nil || stats.Assigned < 1 || stats.MedianMinutesToAssign == nil {
		t.Fatalf("stats read the real tables: %+v %v", stats, err)
	}
}

type pgNoApplicants struct{}

func (pgNoApplicants) Candidates(context.Context, dispatch.Run, map[string]bool) ([]dispatch.Candidate, string, error) {
	return nil, "", nil
}

type pgInviter struct{}

func (pgInviter) Invite(_ context.Context, _ dispatch.Run, exclude map[string]bool, limit int) ([]string, string, error) {
	out := []string{}
	for _, id := range []string{"inv_a", "inv_b"} {
		if !exclude[id] {
			out = append(out, id)
		}
	}
	return out, "", nil
}

// MARKET-INVITE-001：邀请的流水、run 上的「邀过谁」、以及给每位被邀者的 outbox 事件，同一个事务落库。
func TestMarketInvitationsPersistWithTheirOutboxEvents(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	opp := "opp_invite_probe_" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM integration.outbox_messages WHERE aggregate_id = $1`, opp)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch.runs WHERE task_id = $1`, opp)
	})
	now := time.Now().UTC()
	engine := &dispatch.Engine{Repo: dispatch.NewPostgres(pool), Offers: &pgFakeOffers{status: map[string]string{}},
		Sources: map[string]dispatch.CandidateSource{dispatch.KindMarket: pgNoApplicants{}}, Inviter: pgInviter{},
		Now: func() time.Time { return now }, NewID: func() string { return opp + "_run" }}
	if _, err := engine.StartMarket(ctx, opp, "owner_probe"); err != nil {
		t.Fatalf("StartMarket: %v", err)
	}
	if _, err := engine.Tick(ctx); err != nil { // WAITING
		t.Fatal(err)
	}
	now = now.Add(11 * time.Minute)
	if _, err := engine.Tick(ctx); err != nil { // INVITED
		t.Fatal(err)
	}
	r, steps, err := engine.Repo.Get(ctx, opp+"_run")
	if err != nil {
		t.Fatal(err)
	}
	if r.Kind != dispatch.KindMarket || r.InviteRounds != 1 || len(r.Invited) != 2 || r.InvitedAt == nil || !r.Waiting {
		t.Fatalf("invite state persisted on the run: %+v", r)
	}
	if steps[len(steps)-1].Kind != dispatch.StepInvited {
		t.Fatalf("the invitation is on the trail: %+v", steps)
	}
	var events int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM integration.outbox_messages
		WHERE aggregate_id = $1 AND event_type = 'MarketOpportunityInvited' AND payload->>'notifyPrincipalId' IN ('inv_a', 'inv_b')`, opp).Scan(&events); err != nil || events != 2 {
		t.Fatalf("one outbox event per invitee, written with the step: %d (%v)", events, err)
	}
}
