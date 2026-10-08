package matching

import (
	"fmt"
	"math"
	"sync/atomic"
)

// Tunables 是撮合排序的旋钮（OPS-MATCHING-TUNABLES-001）。
//
// 为什么要能调而不是永远写死：这一版引擎的行为全在 Score 那几个数里 —— 可靠占 40 分、
// 新人按「3 单里完成 2.4 单」起步、引力没算过的人给 0.3 中性响应分。运营看不见这些数，
// 也不可能在「撮合太偏袒便宜」「新人永远排不上」这类反馈之后调口径，只能改代码发版。
// 更要紧的是**界面上说的口径和代码里跑的口径必须是同一份账**：控制台以前摆的是写死的
// 18.6M，两份账对不上就是 OPS-REAL-001 要解决的问题。
//
// 默认值 = 接线之前 Score 里那几个字面量，一个都没动。这不是风格问题：接运行时配置的
// 前提是「库里什么都没有的时候，引擎逐位跟今天一样」，
// TestTunablesDefaultToTheHardcodedValues 钉的就是这条。
type Tunables struct {
	ReliabilityWeight  float64 // 可靠（完成率 × 准时率）满分
	SatisfactionWeight float64 // 满意（事后评价 + 回头找她）满分
	RatingShare        float64 // 满意分里「事后评价」那一项的系数
	ReuseShare         float64 // 满意分里「会不会再找她」那一项的系数
	ExperienceWeight   float64 // 经验（完成单量，log 递减）满分
	ExperienceSat      float64 // 经验饱和点：到这么多单算满分
	ResponseWeight     float64 // 响应（引力 P60）满分
	FitPoints          float64 // 报价在预算内的一次性加分
	OnTimePrior        float64 // 准时率的 Laplace 平滑强度
	PriorOrders        float64 // 完成率先验：当作已经接过这么多单
	PriorComplete      float64 // 完成率先验里假定的完成比例
	PriorRatings       float64 // 满意分的先验：当作已经有这么多条评价
	PriorSatisfaction  float64 // 先验评价给多少分
	NeutralResponse    float64 // 引力从没算过这个人时的中性响应分
	// DISPATCH-RANK-002
	DistanceWeight    float64 // 距离分满分（需求地点为圆心）
	RadiusKm          float64 // 距离分的半径：出了这个圈距离分为 0
	NewcomerBoost     float64 // 新人加权满分（0 单时拿满）
	NewcomerOrders    float64 // 新人加权覆盖前多少单
	LoadPenaltyPerJob float64 // 手上每一张未结束的邀约 / 订单扣多少分
	LoadPenaltyCap    float64 // 负载扣分封顶
}

// DefaultTunables 就是接线之前 Score 里写死的那批数：40 / 30 / 0.7-0.3 / 15 / log1p(50) /
// 10 / 5、准时率的 +1/+1 平滑，以及原来 matching.go 里那五个 const。
// 移动一个数 = 改引擎行为，必须说得出为什么。
func DefaultTunables() Tunables {
	return Tunables{
		ReliabilityWeight:  40,
		SatisfactionWeight: 30,
		// 两项系数都写成显式的 0.7 / 0.3，而不是 0.7 与 (1-0.7)：float64 里
		// 1-0.7 = 0.30000000000000004，乘上满意分再 round2 会让一部分候选的分差
		// 在小数第二位上翻一格（22.4999… vs 22.5），接近持平的两位就可能换先后。
		// 接线前后的对撞跑过 22 万组输入，抓出来的就是这个（2286 处不一致）。
		RatingShare:       0.7,
		ReuseShare:        0.3,
		ExperienceWeight:  15,
		ExperienceSat:     50,
		ResponseWeight:    10,
		FitPoints:         5,
		OnTimePrior:       1,
		PriorOrders:       3,
		PriorComplete:     0.8,
		PriorRatings:      2,
		PriorSatisfaction: 0.6,
		NeutralResponse:   0.3,
		// DISPATCH-RANK-002：《检索匹配与治理规则 v0.4》§二 距离权重 40%；半径 30km
		// （2026-10-04 用户：「30km 在越南有摩托车属于可接受的距离」）；前 10 单新手加权。
		DistanceWeight:    40,
		RadiusKm:          30,
		NewcomerBoost:     8,
		NewcomerOrders:    10,
		LoadPenaltyPerJob: 6,
		LoadPenaltyCap:    18,
	}
}

// TunableDef 是一个旋钮的边界 + 给人看的说明。校验和界面共用这一份，
// 免得界面上写的范围跟真校验的不一样（那种「说了不算」比没有说更糟）。
type TunableDef struct {
	Key         string  `json:"key"`
	Min         float64 `json:"min"`
	Max         float64 `json:"max"`
	Description string  `json:"description"`

	get func(Tunables) float64
	set func(*Tunables, float64)
}

// tunableDefs 的顺序就是界面的顺序（权重从大到小，然后是先验类）。
var tunableDefs = []TunableDef{
	{"reliabilityWeight", 0, 100, "可靠分满分：完成比例 × 准时比例，权重越高越看历史履约", func(t Tunables) float64 { return t.ReliabilityWeight }, func(t *Tunables, v float64) { t.ReliabilityWeight = v }},
	{"satisfactionWeight", 0, 100, "满意分满分：需求方事后评价 + 会不会再找她", func(t Tunables) float64 { return t.SatisfactionWeight }, func(t *Tunables, v float64) { t.SatisfactionWeight = v }},
	{"ratingShare", 0, 1, "满意分里「事后评价」那项的系数（默认 0.7，与下面那项之和应为 1）", func(t Tunables) float64 { return t.RatingShare }, func(t *Tunables, v float64) { t.RatingShare = v }},
	{"reuseShare", 0, 1, "满意分里「会不会再找她」那项的系数（默认 0.3）", func(t Tunables) float64 { return t.ReuseShare }, func(t *Tunables, v float64) { t.ReuseShare = v }},
	{"experienceWeight", 0, 100, "经验分满分：完成单量，log 递减（第 1 单和第 50 单边际不同）", func(t Tunables) float64 { return t.ExperienceWeight }, func(t *Tunables, v float64) { t.ExperienceWeight = v }},
	{"experienceSaturation", 2, 1000, "经验饱和点：完成这么多单算经验满分", func(t Tunables) float64 { return t.ExperienceSat }, func(t *Tunables, v float64) { t.ExperienceSat = v }},
	{"responseWeight", 0, 100, "响应分满分：引力引擎算的「接下来 60 分钟内会聊天」概率（GRAVITY-001）", func(t Tunables) float64 { return t.ResponseWeight }, func(t *Tunables, v float64) { t.ResponseWeight = v }},
	{"fitPoints", 0, 100, "报价在需求方预算内的一次性加分", func(t Tunables) float64 { return t.FitPoints }, func(t *Tunables, v float64) { t.FitPoints = v }},
	{"onTimePrior", 0, 10, "准时率的平滑强度：越大越不因单次的迟到/准时下重结论", func(t Tunables) float64 { return t.OnTimePrior }, func(t *Tunables, v float64) { t.OnTimePrior = v }},
	// 两个先验的**分母**：completeRate 除 (ended + priorOrders)，satisfaction 除
	// (rated + priorRatings)。下限不是 0 而是 0.1 —— 一个都没有的人遇上 0/0 会得到
	// NaN，NaN 参与排序比较时永远返回 false，sort.SliceStable 就静默按输入顺序排：
	// 界面照常出列表、一个错都不报。写死常量的时候不存在这个坑，可调之后就必须在
	// 边界上堵住，而不是指望调用方别乱填。
	{"priorOrders", 0.1, 50, "完成率的先验：新人当作已经接过这么多单", func(t Tunables) float64 { return t.PriorOrders }, func(t *Tunables, v float64) { t.PriorOrders = v }},
	{"priorCompleteRate", 0, 1, "完成率先验里假定的完成比例", func(t Tunables) float64 { return t.PriorComplete }, func(t *Tunables, v float64) { t.PriorComplete = v }},
	{"priorRatings", 0.1, 50, "满意分的先验：新人当作已经有这么多条中性评价", func(t Tunables) float64 { return t.PriorRatings }, func(t *Tunables, v float64) { t.PriorRatings = v }},
	{"priorSatisfaction", 0, 1, "先验评价给多少分（0.6 = 中性偏正）", func(t Tunables) float64 { return t.PriorSatisfaction }, func(t *Tunables, v float64) { t.PriorSatisfaction = v }},
	{"neutralResponse", 0, 1, "引力从没算过这个人时给的中性响应分（不惩罚没被建模的人）", func(t Tunables) float64 { return t.NeutralResponse }, func(t *Tunables, v float64) { t.NeutralResponse = v }},
	{"distanceWeight", 0, 100, "距离分满分：离需求地点越近越高（需求没给坐标时这一项人人为 0，不改变先后）", func(t Tunables) float64 { return t.DistanceWeight }, func(t *Tunables, v float64) { t.DistanceWeight = v }},
	{"radiusKm", 1, 200, "距离分的半径（公里）：出了这个圈距离分为 0", func(t Tunables) float64 { return t.RadiusKm }, func(t *Tunables, v float64) { t.RadiusKm = v }},
	{"newcomerBoost", 0, 50, "新人加权满分：0 单时拿满，按完成单量线性递减", func(t Tunables) float64 { return t.NewcomerBoost }, func(t *Tunables, v float64) { t.NewcomerBoost = v }},
	{"newcomerOrders", 0, 100, "新人加权覆盖前多少单（0 = 关掉新人加权）", func(t Tunables) float64 { return t.NewcomerOrders }, func(t *Tunables, v float64) { t.NewcomerOrders = v }},
	{"loadPenaltyPerJob", 0, 50, "负载扣分：手上每一张未结束的邀约 / 订单扣多少分", func(t Tunables) float64 { return t.LoadPenaltyPerJob }, func(t *Tunables, v float64) { t.LoadPenaltyPerJob = v }},
	{"loadPenaltyCap", 0, 100, "负载扣分封顶", func(t Tunables) float64 { return t.LoadPenaltyCap }, func(t *Tunables, v float64) { t.LoadPenaltyCap = v }},
}

// TunableDefs 是那张定义表（界面渲染与校验共用）。
func TunableDefs() []TunableDef { return tunableDefs }

// Default 是这个旋钮出厂时的那个数（界面上「当前 vs 默认」两列的另一列）。
func (d TunableDef) Default() float64 { return d.get(DefaultTunables()) }

func tunableDef(key string) (TunableDef, bool) {
	for _, d := range tunableDefs {
		if d.Key == key {
			return d, true
		}
	}
	return TunableDef{}, false
}

// Values 把当前旋钮摊成 key → 值。存储、界面、审计都走它，键只有一处定义。
func (t Tunables) Values() map[string]float64 {
	out := make(map[string]float64, len(tunableDefs))
	for _, d := range tunableDefs {
		out[d.Key] = d.get(t)
	}
	return out
}

// With 把 overrides 套到 t 上，返回新值。任何一个 key 不认识或越界就整体报错 ——
// 不接受「改了一半」：一半生效一半没生效，事后没人看得出来。
func (t Tunables) With(overrides map[string]float64) (Tunables, error) {
	next := t
	for _, d := range tunableDefs {
		v, ok := overrides[d.Key]
		if !ok {
			continue
		}
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return t, fmt.Errorf("tunable %q must be a finite number", d.Key)
		}
		if v < d.Min || v > d.Max {
			return t, fmt.Errorf("tunable %q out of range: got %g, want [%g, %g]", d.Key, v, d.Min, d.Max)
		}
		d.set(&next, v)
	}
	for key := range overrides {
		if _, ok := tunableDef(key); !ok {
			return t, fmt.Errorf("unknown tunable %q", key)
		}
	}
	return next, nil
}

// appliedTunables 是进程内生效的那一份。atomic.Pointer 而不是锁：读侧在每个批次
// 开头取一次快照（Rank 里所有候选必须按同一套数打分，不能中途换口径），
// 写侧只有运营改旋钮这一条低频路径。
var appliedTunables atomic.Pointer[Tunables]

func init() {
	SetTunables(DefaultTunables())
}

// InvariantWarnings 说出现在这套数**不再满足**哪些写进文档的排序不变量。
//
// 为什么要这个：旋钮可调 = 运营可以把「响应只用来打破接近的平局、压不过可靠度」
// （MATCH-RANK-001，internal/matching 的包注释与那条同名测试都在守它）调成反的。
// 那不该被禁止 —— 那是运营的判断；但也不能安静地发生：界面把话摆出来，
// 审计里留同一句话，事后复盘才知道当时是有人主动改的，不是引擎自己变的。
// 只报「和文档不一致」这一件事实，不报「我觉得好不好」。
func (t Tunables) InvariantWarnings() []string {
	var out []string
	ladder := []struct {
		name  string
		value float64
	}{
		{"可靠", t.ReliabilityWeight}, {"满意", t.SatisfactionWeight}, {"经验", t.ExperienceWeight},
		{"响应", t.ResponseWeight}, {"适配", t.FitPoints},
	}
	for i := 1; i < len(ladder); i++ {
		if ladder[i].value > ladder[i-1].value {
			out = append(out, fmt.Sprintf(
				"%s分满分（%g）高于%s分满分（%g）：文档里的权重阶梯是 可靠 ≥ 满意 ≥ 经验 ≥ 响应 ≥ 适配（默认 40/30/15/10/5）",
				ladder[i].name, ladder[i].value, ladder[i-1].name, ladder[i-1].value))
		}
	}
	if t.ResponseWeight > t.ReliabilityWeight {
		out = append(out, fmt.Sprintf(
			"响应权重（%g）压过可靠权重（%g）：MATCH-RANK-001 的「响应只打破接近的平局」不再成立，会不会聊天将比履约记录更决定谁排在前面",
			t.ResponseWeight, t.ReliabilityWeight))
	}
	if sum := t.RatingShare + t.ReuseShare; math.Abs(sum-1) > 1e-9 {
		out = append(out, fmt.Sprintf(
			"满意分两项系数之和是 %g（不是 1）：它不再是「评价 / 回头率」的加权平均，可能超过自己的满分 %g", round2(sum), t.SatisfactionWeight))
	}
	if t.PriorOrders >= 20 {
		out = append(out, fmt.Sprintf(
			"完成率先验按 %g 单起算：新人（0 单）与做过十几单的人差距被先验压平，真实履约记录对排序的影响变小", t.PriorOrders))
	}
	if t.PriorRatings >= 20 {
		out = append(out, fmt.Sprintf(
			"满意分先验按 %g 条评价起算：同上，评价样本的边际影响被先验摊薄", t.PriorRatings))
	}
	return out
}

// CurrentTunables 是引擎现在按的那套数。
func CurrentTunables() Tunables { return *appliedTunables.Load() }

// SetTunables 换掉生效的那一套（启动时从库里加载，运营改完再热更新一次）。
func SetTunables(t Tunables) { appliedTunables.Store(&t) }
