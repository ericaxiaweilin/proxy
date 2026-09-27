// Package growth computes the "我的权益" tier/growth-value dashboard for
// the actor calling it: level, growth points, daily/weekly/long-term task
// progress, hidden milestones ("彩蛋"), and the tier comparison table.
//
// GROWTH-REAL-DATA-001: every per-user number here is derived, at read
// time, from fulfillment.Order records that already exist for real
// orders taken by this actor (AgentID == caller). There is no separate
// ledger/points table — growth points are always recomputed from the
// same source of truth, so there is nothing to backfill and nothing that
// can drift out of sync with the orders themselves. The static reference
// tables (tierBenefits/staticBenefits/tierCompare) are the same for every
// user — they describe the program, not a personal statistic — so they
// carry no fabrication risk either.
//
// Two mockup fields were dropped rather than faked:
//   - "好评率 4.9"（五星均分）: this app has no star-rating field anywhere.
//     The closest real signal is OutcomeRecord.Satisfaction.Resolved
//     (FULL/PARTIAL/NONE), so this package reports a FULL-satisfaction
//     rate instead of a fake star average, and says so explicitly when
//     an actor has zero satisfaction records yet (HasSatisfactionData).
//   - trend arrows (↑/—): would need a previous-period snapshot that
//     does not exist. Not returned.
//
// One egg was redefined: Order has no city field (only a transient
// marketId on the OrderCheckedIn event payload, never persisted onto the
// Order), so "服务过不同城市" became "服务过 N 位不同下单方" — decided
// with the user rather than guessed.
package growth

import (
	"context"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// ──────────────────────────────────────────────────────────────
// Reward constants — the single source of truth for point values.
// If these change, the matching copy in staticBenefits() must change
// with them so the "what you get" text and the real rule never drift.
// ──────────────────────────────────────────────────────────────

const (
	pointsPerCompletedOrder   = 50
	pointsPerFullSatisfaction = 30
	pointsPerRepeatCustomer   = 100

	rewardDailyOrder        = 50
	rewardDailySatisfaction = 30
	rewardDailySettlement   = 20

	rewardWeeklyOrders = 300
	rewardWeeklyRate   = 200
	rewardWeeklyRepeat = 150

	rewardMilestone50  = 800
	rewardMilestone15  = 500
	rewardMilestone100 = 1500

	// GROWTH-EGG-001: thresholds for the three hidden milestones, decided
	// with the user (city data does not exist — see package doc).
	eggDistinctClientsThreshold   = 10
	eggSameClientRepeatThreshold  = 3
	eggLifetimeMilestoneThreshold = 200
)

type TierLevel string

const (
	TierBronze   TierLevel = "BRONZE"
	TierSilver   TierLevel = "SILVER"
	TierGold     TierLevel = "GOLD"
	TierPlatinum TierLevel = "PLATINUM"
)

// GROWTH-TIER-001: point thresholds and perk-unlock levels below are
// first-pass, operator-tunable constants — not derived from anything,
// same as any other pricing/tier design decision.
var tierLadder = []struct {
	level TierLevel
	name  string
	min   int
	desc  string
	perks string
}{
	{TierPlatinum, "铂金会员", 2000, "专属客服", "免提现费 + 专属客服"},
	{TierGold, "黄金会员", 1000, "优先接单", "取消免责 1 次/月"},
	{TierSilver, "白银会员", 500, "优先展示", "优先展示"},
	{TierBronze, "青铜会员", 0, "基础接单", "基础曝光"},
}

func tierRank(level TierLevel) int {
	for i, t := range tierLadder {
		if t.level == level {
			return len(tierLadder) - i // BRONZE=1 ... PLATINUM=4
		}
	}
	return 0
}

type Tier struct {
	Level           TierLevel `json:"level"`
	Name            string    `json:"name"`
	CurrentPoints   int       `json:"currentPoints"`
	NextLevelPoints int       `json:"nextLevelPoints,omitempty"`
	NextLevelName   string    `json:"nextLevelName,omitempty"`
}

func resolveTier(points int) Tier {
	for i, t := range tierLadder {
		if points >= t.min {
			tier := Tier{Level: t.level, Name: t.name, CurrentPoints: points}
			if i > 0 {
				next := tierLadder[i-1]
				tier.NextLevelPoints = next.min
				tier.NextLevelName = next.name
			}
			return tier
		}
	}
	return Tier{Level: TierBronze, Name: "青铜会员", CurrentPoints: points}
}

type TodayProgress struct {
	Completed int         `json:"completed"`
	Target    int         `json:"target"`
	Tasks     []TodayTask `json:"tasks"`
}

type TodayTask struct {
	Name string `json:"name"`
	Done bool   `json:"done"`
}

type Stats struct {
	CompletedOrders             int  `json:"completedOrders"`
	RepeatCustomers             int  `json:"repeatCustomers"`
	HasSatisfactionData         bool `json:"hasSatisfactionData"`
	SatisfactionFullRatePercent int  `json:"satisfactionFullRatePercent"`
}

type TierBenefit struct {
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	Icon     string `json:"icon"`
	Unlocked bool   `json:"unlocked"`
}

// GROWTH-PERKS-DISPLAY-ONLY-001: this list is informational only. Nothing
// downstream (payment fee logic, cancellation-liability logic, support
// routing) reads Unlocked yet — showing "解锁" here does not make
// withdrawals free or cancellations no-fault. Wiring that up is separate,
// deliberately out-of-scope follow-up work; do not assume it exists.
func tierBenefits(level TierLevel) []TierBenefit {
	rank := tierRank(level)
	unlockedAt := func(min TierLevel) bool { return rank >= tierRank(min) }
	return []TierBenefit{
		{Name: "优先接单", Desc: "平台订单优先推送", Icon: "zap", Unlocked: unlockedAt(TierSilver)},
		{Name: "身份标识", Desc: "主页等级标识", Icon: "star", Unlocked: unlockedAt(TierSilver)},
		{Name: "取消免责", Desc: "每月 1 次无责取消", Icon: "shield", Unlocked: unlockedAt(TierGold)},
		{Name: "专属客服", Desc: "7x24 小时专线", Icon: "headset", Unlocked: unlockedAt(TierGold)},
		{Name: "提现免费", Desc: "0 手续费提现", Icon: "wallet", Unlocked: unlockedAt(TierPlatinum)},
		{Name: "生日礼包", Desc: "专属生日券", Icon: "gift", Unlocked: unlockedAt(TierPlatinum)},
	}
}

type BenefitRow struct {
	Name  string `json:"name"`
	Desc  string `json:"desc"`
	Value string `json:"value"`
	Icon  string `json:"icon"`
}

// staticBenefits describes the program itself (same text for everyone),
// not a personal statistic — the numbers here are kept in sync with the
// reward constants above by hand; if you change one, change the other.
func staticBenefits() (provider, client []BenefitRow) {
	provider = []BenefitRow{
		{Name: "订单成长值", Desc: "每完成 1 单，成长值 +" + itoa(pointsPerCompletedOrder), Value: "+" + itoa(pointsPerCompletedOrder), Icon: "zap"},
		{Name: "满意度奖励", Desc: "客户标记「完全满意」，成长值 +" + itoa(pointsPerFullSatisfaction), Value: "+" + itoa(pointsPerFullSatisfaction), Icon: "star"},
		{Name: "复购加成", Desc: "同一客户完成第 2 单起，成长值 +" + itoa(pointsPerRepeatCustomer), Value: "+" + itoa(pointsPerRepeatCustomer), Icon: "ticket"},
		{Name: "取消免责", Desc: "黄金及以上会员每月 1 次无责取消", Value: "1 次/月", Icon: "shield"},
	}
	client = []BenefitRow{
		{Name: "行程保障", Desc: "订单全程位置共享 + 紧急联系人", Value: "自动开启", Icon: "shield"},
		{Name: "专属客服", Desc: "7×24 小时客服通道", Value: "7×24", Icon: "headset"},
		{Name: "复购历史", Desc: "常约的接单方会记住你的偏好", Value: "自动记录", Icon: "ticket"},
	}
	return provider, client
}

type TierCompareRow struct {
	Name    string    `json:"name"`
	Level   TierLevel `json:"level"`
	Desc    string    `json:"desc"`
	Perks   string    `json:"perks"`
	Points  string    `json:"points"`
	Current bool      `json:"current"`
}

func tierCompare(current TierLevel) []TierCompareRow {
	rows := make([]TierCompareRow, 0, len(tierLadder))
	for i := len(tierLadder) - 1; i >= 0; i-- {
		t := tierLadder[i]
		points := itoa(t.min) + " – " + nextMinLabel(i)
		rows = append(rows, TierCompareRow{
			Name: t.name, Level: t.level, Desc: t.desc, Perks: t.perks,
			Points: points, Current: t.level == current,
		})
	}
	return rows
}

func nextMinLabel(i int) string {
	if i == 0 {
		return "+"
	}
	return itoa(tierLadder[i-1].min - 1)
}

type Egg struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Desc     string `json:"desc"`
	Unlocked bool   `json:"unlocked"`
}

func eggs(distinctClients, maxSingleClientRepeat, lifetimeCompleted int) []Egg {
	return []Egg{
		{
			Key: "egg_distinct_clients", Label: "广结善缘",
			Desc:     "服务过 " + itoa(eggDistinctClientsThreshold) + " 位不同下单方",
			Unlocked: distinctClients >= eggDistinctClientsThreshold,
		},
		{
			Key: "egg_repeat_client", Label: "熟客",
			Desc:     "熟悉的面孔会再次相逢：同一位客户下单 " + itoa(eggSameClientRepeatThreshold) + " 次以上",
			Unlocked: maxSingleClientRepeat >= eggSameClientRepeatThreshold,
		},
		{
			Key: "egg_milestone", Label: "行者",
			Desc:     "走得更远的人：累计完成 " + itoa(eggLifetimeMilestoneThreshold) + " 单",
			Unlocked: lifetimeCompleted >= eggLifetimeMilestoneThreshold,
		},
	}
}

type Task struct {
	Name     string `json:"name"`
	Reward   string `json:"reward"`
	Progress string `json:"progress"`
	Done     bool   `json:"done"`
	// ActionTarget is a client-side navigation key, e.g. "OPEN_MARKET".
	// Empty means the task is progress-only (no single next action to
	// take — the mobile surface must not render a fake button for it).
	ActionTarget string `json:"actionTarget,omitempty"`
}

type TaskGroup struct {
	Label string `json:"label"`
	Desc  string `json:"desc"`
	Tasks []Task `json:"tasks"`
}

type Summary struct {
	Tier           Tier             `json:"tier"`
	Stats          Stats            `json:"stats"`
	Today          TodayProgress    `json:"today"`
	TierBenefits   []TierBenefit    `json:"tierBenefits"`
	BenefitsMine   []BenefitRow     `json:"benefitsProvider"`
	BenefitsClient []BenefitRow     `json:"benefitsClient"`
	TaskGroups     []TaskGroup      `json:"taskGroups"`
	Eggs           []Egg            `json:"eggs"`
	TierCompare    []TierCompareRow `json:"tierCompare"`
}

// ──────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────

// orderReader is the narrow slice of fulfillment.Repository this package
// actually needs — the same read (Snapshot + in-process filter) that
// fulfillment.Service.listMyOrders already uses, so there is no new
// repository method to add or implement in Postgres.
type orderReader interface {
	Snapshot(ctx context.Context) ([]fulfillment.Order, error)
}

type Service struct {
	repo  orderReader
	clock clock.Clock
}

func New(repo orderReader) *Service {
	return &Service{repo: repo, clock: clock.System{}}
}

func NewWithClock(repo orderReader, c clock.Clock) *Service {
	return &Service{repo: repo, clock: c}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == "GetMyGrowthSummary"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	// OPENAPI-COMMAND-COVERAGE-001: dispatch via `case "X":`, not
	// `if e.CommandType == "X"` — see internal/realityscene/service.go.
	switch e.CommandType {
	case "GetMyGrowthSummary":
		orders, err := s.repo.Snapshot(ctx)
		if err != nil {
			return command.Rejected(e, "GROWTH_SUMMARY_FAILED", "INTERNAL", "SAFE_RETRY", "growth.summary_failed", nil)
		}
		summary := BuildSummary(orders, e.Actor.ID, s.clock.Now())
		result := command.Accepted(e, "GrowthSummary", e.Actor.ID, 1, "READY", nil)
		result.Body = map[string]any{"summary": summary}
		return result
	default:
		return command.Rejected(e, "GROWTH_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "growth.unsupported", nil)
	}
}

// BuildSummary is exported (unlike the rest of this file) purely so its
// table-driven tests can construct fixtures directly, without going
// through the command envelope.
func BuildSummary(all []fulfillment.Order, actorID string, now time.Time) Summary {
	mine := agentOrders(all, actorID)
	completed := completedOrders(mine)

	dayStart := startOfDay(now)
	weekStart := startOfWeek(now)

	completedToday := sinceCount(completed, dayStart)
	completedWeek := sinceCount(completed, weekStart)

	satTotal, satFull := satisfactionCounts(completed)
	satFullToday := satisfactionFullSince(completed, dayStart)

	repeatCustomers, maxSingleClientRepeat, distinctClients := repeatStats(completed)
	newRepeatThisWeek := newRepeatClientsSince(completed, weekStart)

	settlementConfirmedToday := settlementConfirmedSince(completed, dayStart)

	points := len(completed)*pointsPerCompletedOrder + satFull*pointsPerFullSatisfaction + repeatCustomers*pointsPerRepeatCustomer
	tier := resolveTier(points)

	stats := Stats{
		CompletedOrders:     len(completed),
		RepeatCustomers:     repeatCustomers,
		HasSatisfactionData: satTotal > 0,
	}
	if satTotal > 0 {
		stats.SatisfactionFullRatePercent = satFull * 100 / satTotal
	}

	todayTasks := []TodayTask{
		{Name: "接单 1 次", Done: completedToday >= 1},
		{Name: "好评 1 次", Done: satFullToday >= 1},
		{Name: "确认结算 1 次", Done: settlementConfirmedToday >= 1},
	}
	todayCompleted := 0
	for _, t := range todayTasks {
		if t.Done {
			todayCompleted++
		}
	}

	dailyOrderTask := Task{Name: "完成 1 次接单", Reward: "+" + itoa(rewardDailyOrder) + " 成长值", Progress: capProgress(completedToday, 1), Done: completedToday >= 1}
	if !dailyOrderTask.Done {
		dailyOrderTask.ActionTarget = "OPEN_MARKET"
	}

	provider, client := staticBenefits()

	return Summary{
		Tier:           tier,
		Stats:          stats,
		Today:          TodayProgress{Completed: todayCompleted, Target: len(todayTasks), Tasks: todayTasks},
		TierBenefits:   tierBenefits(tier.Level),
		BenefitsMine:   provider,
		BenefitsClient: client,
		TaskGroups: []TaskGroup{
			{
				Label: "日常任务", Desc: "每天刷新 · 稳定收益",
				Tasks: []Task{
					dailyOrderTask,
					{Name: "完成 1 次好评", Reward: "+" + itoa(rewardDailySatisfaction) + " 成长值", Progress: capProgress(satFullToday, 1), Done: satFullToday >= 1},
					{Name: "确认 1 次结算", Reward: "+" + itoa(rewardDailySettlement) + " 成长值", Progress: capProgress(settlementConfirmedToday, 1), Done: settlementConfirmedToday >= 1},
				},
			},
			{
				Label: "周度任务", Desc: "每周刷新 · 加速升级",
				Tasks: []Task{
					{Name: "本周完成 15 单", Reward: "+" + itoa(rewardWeeklyOrders) + " 成长值", Progress: itoa(completedWeek) + " / 15", Done: completedWeek >= 15},
					{Name: "本周新增复购 2 位", Reward: "+" + itoa(rewardWeeklyRepeat) + " 成长值", Progress: itoa(newRepeatThisWeek) + " / 2", Done: newRepeatThisWeek >= 2},
					weeklyRateTask(completed, weekStart),
				},
			},
			{
				Label: "长期任务", Desc: "一次性 · 里程碑奖励",
				Tasks: []Task{
					{Name: "累计接单 50 次", Reward: "+" + itoa(rewardMilestone50) + " 成长值", Progress: itoa(len(completed)) + " / 50", Done: len(completed) >= 50},
					{Name: "复购客户达到 15 位", Reward: "+" + itoa(rewardMilestone15) + " 成长值", Progress: itoa(repeatCustomers) + " / 15", Done: repeatCustomers >= 15},
					{Name: "累计接单 100 次", Reward: "+" + itoa(rewardMilestone100) + " 成长值 · 铂金晋级", Progress: itoa(len(completed)) + " / 100", Done: len(completed) >= 100},
				},
			},
		},
		Eggs:        eggs(distinctClients, maxSingleClientRepeat, len(completed)),
		TierCompare: tierCompare(tier.Level),
	}
}

func weeklyRateTask(completed []fulfillment.Order, weekStart time.Time) Task {
	total, full := satisfactionCounts(sinceOrders(completed, weekStart))
	progress := "暂无评价"
	done := false
	if total > 0 {
		rate := full * 100 / total
		progress = itoa(rate) + "% / 95%"
		done = rate >= 95
	}
	return Task{Name: "本周好评率 95%", Reward: "+" + itoa(rewardWeeklyRate) + " 成长值", Progress: progress, Done: done}
}

func capProgress(count, target int) string {
	shown := count
	if shown > target {
		shown = target
	}
	return itoa(shown) + " / " + itoa(target)
}

// ──────────────────────────────────────────────────────────────
// Pure helpers over []fulfillment.Order
// ──────────────────────────────────────────────────────────────

func agentOrders(all []fulfillment.Order, actorID string) []fulfillment.Order {
	out := make([]fulfillment.Order, 0, len(all))
	for _, o := range all {
		if o.AgentID == actorID {
			out = append(out, o)
		}
	}
	return out
}

func completedOrders(mine []fulfillment.Order) []fulfillment.Order {
	out := make([]fulfillment.Order, 0, len(mine))
	for _, o := range mine {
		if o.Lifecycle == "COMPLETED" {
			out = append(out, o)
		}
	}
	return out
}

func sinceOrders(completed []fulfillment.Order, since time.Time) []fulfillment.Order {
	out := make([]fulfillment.Order, 0, len(completed))
	for _, o := range completed {
		if !o.UpdatedAt.Before(since) {
			out = append(out, o)
		}
	}
	return out
}

func sinceCount(completed []fulfillment.Order, since time.Time) int {
	return len(sinceOrders(completed, since))
}

func satisfactionCounts(completed []fulfillment.Order) (total, full int) {
	for _, o := range completed {
		if o.Outcome == nil || o.Outcome.Satisfaction == nil || o.Outcome.Satisfaction.Resolved == "" {
			continue
		}
		total++
		if o.Outcome.Satisfaction.Resolved == "FULL" {
			full++
		}
	}
	return total, full
}

func satisfactionFullSince(completed []fulfillment.Order, since time.Time) int {
	_, full := satisfactionCounts(sinceOrders(completed, since))
	return full
}

func settlementConfirmedSince(completed []fulfillment.Order, since time.Time) int {
	n := 0
	for _, o := range sinceOrders(completed, since) {
		if o.Settlement != nil && o.Settlement.PayeeConfirmed {
			n++
		}
	}
	return n
}

// repeatStats groups completed orders by RequesterID.
//   - count: number of distinct clients with >=2 completed orders
//   - maxSingleClientRepeat: the highest completed-order count for any
//     single client (egg_repeat_client)
//   - distinctClients: number of distinct clients served at all
//     (egg_distinct_clients)
func repeatStats(completed []fulfillment.Order) (count, maxSingleClientRepeat, distinctClients int) {
	byClient := map[string]int{}
	for _, o := range completed {
		byClient[o.RequesterID]++
	}
	distinctClients = len(byClient)
	for _, n := range byClient {
		if n > maxSingleClientRepeat {
			maxSingleClientRepeat = n
		}
		if n >= 2 {
			count++
		}
	}
	return count, maxSingleClientRepeat, distinctClients
}

// newRepeatClientsSince counts clients whose order *this week* made them
// a repeat customer: either they already had a completed order before
// this week (a returning client), or they completed 2+ orders within
// this week itself.
func newRepeatClientsSince(completed []fulfillment.Order, weekStart time.Time) int {
	beforeWeek := map[string]bool{}
	thisWeekCount := map[string]int{}
	for _, o := range completed {
		if o.UpdatedAt.Before(weekStart) {
			beforeWeek[o.RequesterID] = true
		} else {
			thisWeekCount[o.RequesterID]++
		}
	}
	n := 0
	for client, c := range thisWeekCount {
		if beforeWeek[client] || c >= 2 {
			n++
		}
	}
	return n
}

func startOfDay(now time.Time) time.Time {
	u := now.UTC()
	y, m, d := u.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func startOfWeek(now time.Time) time.Time {
	day := startOfDay(now)
	// Monday=1 ... Sunday=0 in time.Weekday; days-since-Monday:
	offset := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -offset)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
