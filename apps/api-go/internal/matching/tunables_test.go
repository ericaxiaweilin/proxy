package matching

import (
	"math"
	"strings"
	"testing"
)

// OPS-MATCHING-TUNABLES-001。这组测试守的是**接线不改行为**：旋钮落库的前提是
// 「库里什么都没有时，引擎逐位跟接线的这一天一样」。

func TestTunablesDefaultToTheHardcodedValues(t *testing.T) {
	d := DefaultTunables()
	// 权重阶梯与先验，就是接线前 matching.go 里的那些字面量（包注释也写着同一份）。
	for _, c := range []struct {
		name string
		got  float64
		want float64
	}{
		{"可靠满分", d.ReliabilityWeight, 40},
		{"满意满分", d.SatisfactionWeight, 30},
		{"满意分里评价那项的系数", d.RatingShare, 0.7},
		{"满意分里回头率那项的系数", d.ReuseShare, 0.3},
		{"经验满分", d.ExperienceWeight, 15},
		{"经验饱和单量", d.ExperienceSat, 50},
		{"响应满分", d.ResponseWeight, 10},
		{"预算内加分", d.FitPoints, 5},
		{"准时率平滑", d.OnTimePrior, 1},
		{"完成率先验单量", d.PriorOrders, 3},
		{"完成率先验比例", d.PriorComplete, 0.8},
		{"满意分先验条数", d.PriorRatings, 2},
		{"满意分先验分值", d.PriorSatisfaction, 0.6},
		{"中性响应分", d.NeutralResponse, 0.3},
	} {
		if c.got != c.want {
			t.Fatalf("默认值变了：%s = %g，接线前是 %g —— 改默认值就是改引擎行为，得说清为什么", c.name, c.got, c.want)
		}
	}

	// 光核对字段还不够：整条 Score 路径按包注释那个口径重算一遍。
	// 可靠 = 40 × 完成率(10+3×0.8 比 12+3) × 准时率((9+1)/(10+1))
	// 满意 = 30 × (0.7 × 评价分(5.7/7) + 0.3 × 回头率(4.2/7))
	// 经验 = 15 × log1p(10)/log1p(50)，响应 = 10 × 0.3（引力没算过 ⇒ 中性，不惩罚）
	s := Signals{Completed: 10, Cancelled: 2, OnTime: 9, Rated: 5, SatisfactionSum: 4.5, WouldReuse: 3}
	got := Score(s, 500_000, 600_000)
	want := Breakdown{
		Reliability:  30.06,
		Satisfaction: 22.5,
		Experience:   9.15,
		Response:     3,
		Fit:          5,
		Total:        69.71,
		// 用户侧那三个是真数，不是先验掺出来的。
		FulfillmentRate:  0.83,
		SatisfactionRate: 0.9,
		HasTrackRecord:   true,
	}
	if got != want {
		t.Fatalf("Score 的整条路径跟接线前不一致：\n got %+v\nwant %+v", got, want)
	}
}

func TestTunablesWithRejectsUnknownAndOutOfRange(t *testing.T) {
	base := DefaultTunables()
	for _, c := range []struct {
		name  string
		give  map[string]float64
		cause string
	}{
		{"不认识的 key", map[string]float64{"exposureWeight": 50}, "unknown tunable"},
		{"超过上限", map[string]float64{"reliabilityWeight": 101}, "out of range"},
		{"低于下限", map[string]float64{"priorOrders": 0}, "out of range"},
		{"NaN", map[string]float64{"fitPoints": math.NaN()}, "finite"},
		{"+Inf", map[string]float64{"fitPoints": math.Inf(1)}, "finite"},
	} {
		next, err := base.With(c.give)
		if err == nil {
			t.Fatalf("%s 必须被拒（不然引擎会按一个没人核对过的数排序）", c.name)
		}
		if !contains(err.Error(), c.cause) {
			t.Fatalf("%s 的报错没有指向原因：want 含 %q, got %q", c.name, c.cause, err)
		}
		// 被拒的一整套必须原样退回，不能留下改了一半的值。
		if next != base {
			t.Fatalf("%s 失败却返回了改动过的旋钮：%+v", c.name, next)
		}
	}
	// 一次改多个是合法的（运营调口径本来就是一组一起动）。
	next, err := base.With(map[string]float64{"reliabilityWeight": 45, "fitPoints": 8})
	if err != nil || next.ReliabilityWeight != 45 || next.FitPoints != 8 {
		t.Fatalf("多个合法值应该一起生效: %+v err=%v", next, err)
	}
}

// 边界值不能把排序变成 NaN：0/0 在 sort 的比较里永远返回 false，
// 列表会静默按输入顺序出，一个错都不报 —— 这是把常量变成可调之后新引入的坑。
func TestTunablesBoundariesNeverProduceNanScores(t *testing.T) {
	low := edgeTunables(t, func(d TunableDef) float64 { return d.Min })
	high := edgeTunables(t, func(d TunableDef) float64 { return d.Max })
	for _, t0 := range []Tunables{low, high, DefaultTunables()} {
		for _, s := range []Signals{
			{}, // 什么都没做过的新人
			{Completed: 1, OnTime: 1, Rated: 1, SatisfactionSum: 1, WouldReuse: 1},
			{Cancelled: 20}, // 全是取消
			{ChatP60: ptr(-3), Completed: 4, OnTime: 4},   // 引力给了个越界的数
			{ChatP60: ptr(7), Completed: 900, Rated: 900}, // 极端大
		} {
			b := t0.Score(s, 10, 10)
			for name, v := range map[string]float64{
				"reliability": b.Reliability, "satisfaction": b.Satisfaction, "experience": b.Experience,
				"response": b.Response, "fit": b.Fit, "total": b.Total,
				"fulfillmentRate": b.FulfillmentRate, "satisfactionRate": b.SatisfactionRate,
			} {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					t.Fatalf("边界旋钮 + %+v 让 %s 变成 %v（NaN 参与排序 = 静默乱序）", s, name, v)
				}
			}
		}
	}
}

func TestSetTunablesTakesEffectAndRankUsesOneSnapshot(t *testing.T) {
	defer SetTunables(DefaultTunables())

	ids := []string{"agent_a", "agent_b"}
	prices := map[string]int64{"agent_a": 100, "agent_b": 100}
	// a 履约好，b 只是此刻在线：默认权重下 a 在前（MATCH-RANK-001 的口径）。
	signals := map[string]Signals{
		"agent_a": {Completed: 9, Cancelled: 1, OnTime: 9, Rated: 6, SatisfactionSum: 5.5, WouldReuse: 5},
		"agent_b": {ChatP60: ptr(0.95)},
	}
	SetTunables(DefaultTunables())
	got := Rank(ids, prices, signals, 0)
	if got[0].AgentID != "agent_a" {
		t.Fatalf("默认权重下可靠的人该在前: %+v", got)
	}

	// 把响应权重调到压过可靠：同一批人、同一份数据，顺序必须跟着翻过来 ——
	// 证明旋钮真的进了排序路径，不是只进了界面。
	SetTunables(mustWith(t, DefaultTunables(), map[string]float64{"responseWeight": 80, "reliabilityWeight": 5}))
	got = Rank(ids, prices, signals, 0)
	if got[0].AgentID != "agent_b" {
		t.Fatalf("响应权重压过可靠之后，在线的人该在前（旋钮没生效）: %+v", got)
	}
	if w := CurrentTunables().InvariantWarnings(); len(w) == 0 {
		t.Fatal("这种调法已经推翻了「响应只打破平局」，界面上却一句话都没有")
	}
}

func TestInvariantWarningsStayQuietOnTheDefaults(t *testing.T) {
	if w := DefaultTunables().InvariantWarnings(); len(w) != 0 {
		t.Fatalf("默认值就是文档里那套阶梯，不该报任何警告: %v", w)
	}
	// 阶梯反过来（适配 > 可靠）必须报，而且要报出是哪一项。
	noisy := mustWith(t, DefaultTunables(), map[string]float64{"fitPoints": 60})
	w := noisy.InvariantWarnings()
	if len(w) == 0 {
		t.Fatal("适配分 60 高于可靠分 40，权重阶梯已经断了却没报")
	}
	if !contains(w[0], "适配") {
		t.Fatalf("警告没点名是哪一项: %v", w)
	}
	// 只动加权平均的一项 = 系数之和不再归一，必须报。
	lopsided := mustWith(t, DefaultTunables(), map[string]float64{"ratingShare": 0.9})
	found := false
	for _, msg := range lopsided.InvariantWarnings() {
		if contains(msg, "之和") {
			found = true
		}
	}
	if !found {
		t.Fatalf("ratingShare 0.9 + reuseShare 0.3 = 1.2，满意分会超过它的满分，却没报: %v", lopsided.InvariantWarnings())
	}
}

func mustWith(t *testing.T, base Tunables, over map[string]float64) Tunables {
	t.Helper()
	next, err := base.With(over)
	if err != nil {
		t.Fatalf("With(%v): %v", over, err)
	}
	return next
}

// minTunables / maxTunables 按定义表取每个旋钮的边界，不另写一份数字 ——
// 边界改了它们自动跟着，测试不会变成第二份需要维护的常量表。
func edgeTunables(t *testing.T, pick func(TunableDef) float64) Tunables {
	t.Helper()
	over := map[string]float64{}
	for _, d := range tunableDefs {
		over[d.Key] = pick(d)
	}
	return mustWith(t, DefaultTunables(), over)
}

func contains(haystack, needle string) bool { return strings.Contains(haystack, needle) }

func ptr(f float64) *float64 { return &f }
