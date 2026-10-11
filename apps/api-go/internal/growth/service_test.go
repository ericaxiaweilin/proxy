package growth

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identitytier"
)

var fixedNow = time.Date(2026, 9, 24, 15, 0, 0, 0, time.UTC) // Thursday

func completedOrder(agentID, requesterID string, updatedAt time.Time) fulfillment.Order {
	return fulfillment.Order{
		ID: "order_" + updatedAt.String() + "_" + requesterID, AgentID: agentID, RequesterID: requesterID,
		Lifecycle: "COMPLETED", UpdatedAt: updatedAt,
	}
}

func withSatisfaction(o fulfillment.Order, resolved string) fulfillment.Order {
	o.Outcome = &fulfillment.OutcomeRecord{Satisfaction: &fulfillment.SatisfactionRecord{Resolved: resolved}}
	return o
}

func withSettlementConfirmed(o fulfillment.Order) fulfillment.Order {
	o.Settlement = &fulfillment.SettlementRecord{PayeeConfirmed: true}
	return o
}

func TestBuildSummaryZeroOrdersIsBronzeNotAnError(t *testing.T) {
	s := BuildSummary(nil, "agent_1", fixedNow)
	if s.Tier.Level != TierBronze || s.Tier.CurrentPoints != 0 {
		t.Fatalf("expected BRONZE/0 for a brand-new actor, got %+v", s.Tier)
	}
	if s.Stats.CompletedOrders != 0 || s.Stats.RepeatCustomers != 0 {
		t.Fatalf("expected zero stats, got %+v", s.Stats)
	}
	if s.Stats.HasSatisfactionData {
		t.Fatal("must not claim satisfaction data exists when there are zero orders")
	}
	for _, e := range s.Eggs {
		if e.Unlocked {
			t.Fatalf("no egg should be unlocked with zero orders: %+v", e)
		}
	}
}

func TestBuildSummaryOnlyCountsTheActorsOwnAgentOrders(t *testing.T) {
	orders := []fulfillment.Order{
		completedOrder("agent_1", "client_a", fixedNow),
		completedOrder("agent_2", "client_b", fixedNow), // someone else's order
	}
	s := BuildSummary(orders, "agent_1", fixedNow)
	if s.Stats.CompletedOrders != 1 {
		t.Fatalf("expected 1 (only agent_1's own), got %d", s.Stats.CompletedOrders)
	}
}

func TestGrowthPointsFormulaAndTierThresholds(t *testing.T) {
	cases := []struct {
		name           string
		completed      int
		satFull        int
		repeatCustomer int
		wantPoints     int
		wantTier       TierLevel
	}{
		{"zero", 0, 0, 0, 0, TierBronze},
		{"just under silver", 9, 0, 0, 450, TierBronze},               // 9*50=450 < 500
		{"crosses silver", 10, 0, 0, 500, TierSilver},                 // 10*50=500
		{"crosses gold via satisfaction", 10, 17, 0, 1010, TierGold},  // 500+17*30=1010
		{"crosses platinum via repeat", 0, 0, 20, 2000, TierPlatinum}, // 20*100=2000
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			points := c.completed*pointsPerCompletedOrder + c.satFull*pointsPerFullSatisfaction + c.repeatCustomer*pointsPerRepeatCustomer
			if points != c.wantPoints {
				t.Fatalf("points = %d, want %d", points, c.wantPoints)
			}
			tier := resolveTier(points)
			if tier.Level != c.wantTier {
				t.Fatalf("tier = %s, want %s (points=%d)", tier.Level, c.wantTier, points)
			}
		})
	}
}

func TestTodayAndWeekWindowsRespectBoundaries(t *testing.T) {
	today := completedOrder("agent_1", "client_a", fixedNow)
	yesterday := completedOrder("agent_1", "client_b", fixedNow.AddDate(0, 0, -1))
	lastWeek := completedOrder("agent_1", "client_c", fixedNow.AddDate(0, 0, -8))

	s := BuildSummary([]fulfillment.Order{today, yesterday, lastWeek}, "agent_1", fixedNow)
	if s.Stats.CompletedOrders != 3 {
		t.Fatalf("lifetime completed should be 3, got %d", s.Stats.CompletedOrders)
	}
	if s.Today.Completed < 1 {
		t.Fatal("today's order should count toward today's progress")
	}
	weekly := findTask(t, s, "本周完成 15 单")
	if weekly.Progress != "2 / 15" {
		// today + yesterday fall in the same ISO week (fixedNow is a Thursday); lastWeek does not.
		t.Fatalf("weekly progress = %q, want %q", weekly.Progress, "2 / 15")
	}
}

func TestSatisfactionRateOnlyCountsOrdersWithARecordedOutcome(t *testing.T) {
	full := withSatisfaction(completedOrder("agent_1", "client_a", fixedNow), "FULL")
	partial := withSatisfaction(completedOrder("agent_1", "client_b", fixedNow), "PARTIAL")
	noRecord := completedOrder("agent_1", "client_c", fixedNow)

	s := BuildSummary([]fulfillment.Order{full, partial, noRecord}, "agent_1", fixedNow)
	if !s.Stats.HasSatisfactionData {
		t.Fatal("expected HasSatisfactionData once at least one order has a Satisfaction record")
	}
	if s.Stats.SatisfactionFullRatePercent != 50 {
		t.Fatalf("rate = %d, want 50 (1 of 2 recorded orders is FULL; noRecord must not count)", s.Stats.SatisfactionFullRatePercent)
	}
}

func TestRepeatCustomerStatsAndEggThresholds(t *testing.T) {
	var orders []fulfillment.Order
	// client_a orders 3 times (crosses the repeat-client egg threshold).
	for i := 0; i < 3; i++ {
		orders = append(orders, completedOrder("agent_1", "client_a", fixedNow))
	}
	// 9 more distinct one-time clients -> 10 distinct clients total (crosses the distinct-clients egg).
	for i := 0; i < 9; i++ {
		orders = append(orders, completedOrder("agent_1", "client_"+string(rune('b'+i)), fixedNow))
	}

	s := BuildSummary(orders, "agent_1", fixedNow)
	if s.Stats.RepeatCustomers != 1 {
		t.Fatalf("expected exactly 1 repeat customer (client_a), got %d", s.Stats.RepeatCustomers)
	}
	if !findEgg(t, s, "egg_repeat_client").Unlocked {
		t.Fatal("egg_repeat_client should unlock: client_a ordered 3 times")
	}
	if !findEgg(t, s, "egg_distinct_clients").Unlocked {
		t.Fatal("egg_distinct_clients should unlock: 10 distinct clients served")
	}
	if findEgg(t, s, "egg_milestone").Unlocked {
		t.Fatal("egg_milestone (200 lifetime orders) must stay locked with only 12 orders")
	}
}

func TestDailyOrderTaskHasAnActionTargetOnlyWhenNotDone(t *testing.T) {
	notDone := BuildSummary(nil, "agent_1", fixedNow)
	task := findTask(t, notDone, "完成 1 次接单")
	if task.Done {
		t.Fatal("should not be done with zero orders")
	}
	if task.ActionTarget != "OPEN_MARKET" {
		t.Fatalf("expected an action target while not done, got %q", task.ActionTarget)
	}

	done := BuildSummary([]fulfillment.Order{completedOrder("agent_1", "client_a", fixedNow)}, "agent_1", fixedNow)
	doneTask := findTask(t, done, "完成 1 次接单")
	if !doneTask.Done || doneTask.ActionTarget != "" {
		t.Fatalf("a completed task must not carry an action target, got %+v", doneTask)
	}
}

func TestTasksWithNoSingleActionNeverCarryAnActionTarget(t *testing.T) {
	s := BuildSummary([]fulfillment.Order{completedOrder("agent_1", "client_a", fixedNow)}, "agent_1", fixedNow)
	for _, group := range s.TaskGroups {
		for _, task := range group.Tasks {
			if task.Name == "完成 1 次接单" {
				continue // the one task that legitimately has a single action
			}
			if task.ActionTarget != "" {
				t.Fatalf("task %q must not have a fake action button, got %q", task.Name, task.ActionTarget)
			}
		}
	}
}

func TestSettlementConfirmedDailyTask(t *testing.T) {
	confirmed := withSettlementConfirmed(completedOrder("agent_1", "client_a", fixedNow))
	s := BuildSummary([]fulfillment.Order{confirmed}, "agent_1", fixedNow)
	task := findTask(t, s, "确认 1 次结算")
	if !task.Done {
		t.Fatal("expected the settlement-confirmation daily task to be done")
	}
}

func TestServiceHandleContextRejectsUnknownCommand(t *testing.T) {
	svc := NewWithClock(memRepo{}, clock.NewFixed(fixedNow))
	result := svc.HandleContext(context.Background(), command.Envelope{CommandType: "SomethingElse"})
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for an unsupported command, got %s", result.Outcome)
	}
}

func TestServiceHandleContextReturnsSummaryInBody(t *testing.T) {
	repo := memRepo{orders: []fulfillment.Order{completedOrder("agent_1", "client_a", fixedNow)}}
	svc := NewWithClock(repo, clock.NewFixed(fixedNow))
	result := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "GetMyGrowthSummary",
		Actor:       command.Actor{Type: "INDIVIDUAL", ID: "agent_1"},
	})
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s: %+v", result.Outcome, result.Error)
	}
	summary, ok := result.Body["summary"].(Summary)
	if !ok {
		t.Fatalf("expected a Summary in result.Body, got %T", result.Body["summary"])
	}
	if summary.Stats.CompletedOrders != 1 {
		t.Fatalf("expected the fixture order to be counted, got %+v", summary.Stats)
	}
}

// ── test helpers ────────────────────────────────────────────────

type memRepo struct {
	orders []fulfillment.Order
}

func (r memRepo) Snapshot(_ context.Context) ([]fulfillment.Order, error) {
	return r.orders, nil
}

func findTask(t *testing.T, s Summary, name string) Task {
	t.Helper()
	for _, group := range s.TaskGroups {
		for _, task := range group.Tasks {
			if task.Name == name {
				return task
			}
		}
	}
	t.Fatalf("no task named %q in %+v", name, s.TaskGroups)
	return Task{}
}

func findEgg(t *testing.T, s Summary, key string) Egg {
	t.Helper()
	for _, e := range s.Eggs {
		if e.Key == key {
			return e
		}
	}
	t.Fatalf("no egg with key %q in %+v", key, s.Eggs)
	return Egg{}
}

// 「我的权益」的成长值 = 订单积分 + 账本积分；等级和星级由合计算。
func TestSummaryAddsLedgerPointsAndShowsStars(t *testing.T) {
	s := BuildSummaryWithBonus(nil, "agent_1", fixedNow, 175)
	if s.Tier.Level != TierBronze || s.Tier.Stars != 2 || s.Tier.CurrentPoints != 175 {
		t.Fatalf("175 points = bronze 2 stars: %+v", s.Tier)
	}
	if s.Tier.NextLevelPoints != 300 || s.Tier.NextLevelName != "青铜会员★★★" {
		t.Fatalf("next step is the third star: %+v", s.Tier)
	}
	top := BuildSummaryWithBonus(nil, "agent_1", fixedNow, 600)
	if top.Tier.Level != TierSilver || top.Tier.Stars != 1 {
		t.Fatalf("600 = silver 1 star: %+v", top.Tier)
	}
	if got := BuildSummary(nil, "agent_1", fixedNow); got.Tier.CurrentPoints != 0 || got.Tier.Stars != 1 {
		t.Fatalf("no points is bronze 1 star, honestly zero: %+v", got.Tier)
	}
}

// 成长值取账本：订单积分已经在账本里，不再重复叠加订单实时算的那一份。
func TestSummaryFromLedgerDoesNotDoubleCountOrderPoints(t *testing.T) {
	orders := []fulfillment.Order{completedOrder("agent_1", "client_a", fixedNow)}
	fromOrders := BuildSummary(orders, "agent_1", fixedNow)
	if fromOrders.Tier.CurrentPoints != pointsPerCompletedOrder {
		t.Fatalf("one order = %d points when computed live: %d", pointsPerCompletedOrder, fromOrders.Tier.CurrentPoints)
	}
	fromLedger := BuildSummaryWithPoints(orders, "agent_1", fixedNow, 120)
	if fromLedger.Tier.CurrentPoints != 120 {
		t.Fatalf("the ledger is the source of the points: %d", fromLedger.Tier.CurrentPoints)
	}
	if fromLedger.Stats.CompletedOrders != 1 {
		t.Fatalf("order stats still come from the orders: %+v", fromLedger.Stats)
	}
}

// ---- DAILY-LOGIN-001（用户：「每日登录都默认加积分 比如 5 积分」）----

type dailyLedger struct {
	seen map[string]bool // userID|ref
	fail error
}

func (d *dailyLedger) Points(context.Context, identitytier.Kind, string) (int, error) { return 0, nil }

func (d *dailyLedger) CreditDailyLogin(_ context.Context, userID string, now time.Time) (bool, error) {
	if d.fail != nil {
		return false, d.fail
	}
	key := userID + "|" + identitytier.DailyLoginRef(now)
	if d.seen[key] {
		return false, nil
	}
	d.seen[key] = true
	return true, nil
}

type emptyOrders struct{}

func (emptyOrders) Snapshot(context.Context) ([]fulfillment.Order, error) { return nil, nil }

func dailyEnvelope(actorType, actorID string) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_daily", CommandType: "RecordDailyLogin", CommandVersion: 1,
		Actor:     command.Actor{Type: actorType, ID: actorID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:    command.Target{Type: "DailyLogin", ID: "me"},
		Purpose:   "daily_login", CorrelationID: "corr_daily", IdempotencyKey: "idem_daily",
	}
}

func TestRecordDailyLoginGrantsOncePerDayAndIsIdempotent(t *testing.T) {
	ledger := &dailyLedger{seen: map[string]bool{}}
	// 2026-09-24 15:00 UTC = 22:00 越南时区（同一个越南日）；+5h = 次日 03:00 越南。
	clk := &mutableClock{now: fixedNow}
	svc := NewWithClock(emptyOrders{}, clk)
	svc.SetLedger(ledger)

	body := func() map[string]any {
		res := svc.Handle(dailyEnvelope("USER", "user_1"))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("rejected: %+v", res.Error)
		}
		return res.Body
	}
	first := body()
	if first["granted"] != true || first["points"] != 5 || first["date"] != "2026-09-24" {
		t.Fatalf("first open of the day grants 5: %+v", first)
	}
	if again := body(); again["granted"] != false {
		t.Fatalf("a second open the same day must not grant again: %+v", again)
	}
	// 跨过越南时区午夜（15:00 UTC + 10h = 次日 01:00 UTC+7... 取 +6h = 21:00 UTC = 04:00 越南次日）
	clk.now = fixedNow.Add(6 * time.Hour)
	if next := body(); next["granted"] != true || next["date"] != "2026-09-25" {
		t.Fatalf("a new Hanoi day grants again: %+v", next)
	}
}

// 「每天」按越南时区算，不按 UTC：UTC 的 17:30 已经是越南次日 00:30。
func TestDailyLoginDayBoundaryIsHanoiNotUTC(t *testing.T) {
	before := time.Date(2026, 9, 24, 16, 59, 0, 0, time.UTC) // 越南 23:59
	after := time.Date(2026, 9, 24, 17, 0, 0, 0, time.UTC)   // 越南 00:00 次日
	if identitytier.DailyLoginRef(before) != "2026-09-24" || identitytier.DailyLoginRef(after) != "2026-09-25" {
		t.Fatalf("Hanoi day boundary: %s / %s", identitytier.DailyLoginRef(before), identitytier.DailyLoginRef(after))
	}
}

func TestRecordDailyLoginRefusesAnonymousAndUnavailableLedger(t *testing.T) {
	svc := NewWithClock(emptyOrders{}, clock.System{})
	svc.SetLedger(&dailyLedger{seen: map[string]bool{}})
	if res := svc.Handle(dailyEnvelope("PUBLIC", "anonymous_reader")); res.Error == nil || res.Error.ErrorCode != "DAILY_LOGIN_REQUIRES_ACTOR" {
		t.Fatalf("a public reader never earns points: %+v", res)
	}
	if res := svc.Handle(dailyEnvelope("USER", "")); res.Error == nil {
		t.Fatalf("no actor id is refused")
	}
	// 没接账本：老实说没记，不假装成功。
	if res := NewWithClock(emptyOrders{}, clock.System{}).Handle(dailyEnvelope("USER", "user_1")); res.Error == nil || res.Error.ErrorCode != "DAILY_LOGIN_UNAVAILABLE" {
		t.Fatalf("no ledger => unavailable: %+v", res)
	}
	// 账本写失败：报错，让 App 下次再试，不是「今天已经记过」。
	boom := &dailyLedger{seen: map[string]bool{}, fail: context.DeadlineExceeded}
	s2 := NewWithClock(emptyOrders{}, clock.System{})
	s2.SetLedger(boom)
	if res := s2.Handle(dailyEnvelope("USER", "user_1")); res.Error == nil || res.Error.ErrorCode != "DAILY_LOGIN_FAILED" {
		t.Fatalf("ledger failure must surface: %+v", res)
	}
}

func TestDailyLoginIsAnEarnRuleWithFivePoints(t *testing.T) {
	for _, r := range identitytier.EarnRules(identitytier.User) {
		if r.Reason == identitytier.DailyLoginReason {
			if r.Points != 5 || r.Label != "每日登录" {
				t.Fatalf("daily login rule: %+v", r)
			}
			return
		}
	}
	t.Fatal("DAILY_LOGIN must be in the user earn rules (the rules table and the credit share one constant)")
}

type mutableClock struct{ now time.Time }

func (c *mutableClock) Now() time.Time { return c.now }
