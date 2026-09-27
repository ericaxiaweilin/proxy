package growth

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
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
