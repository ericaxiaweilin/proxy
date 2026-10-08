// Package matching 是撮合排序（MATCH-RANK-001，2026-09-23）——
// 《Personalization & Orchestration Engineering Spec v1》§16.2 Ranking 的第一版，只用真实信号。
//
// 以前：供给候选批次只按价格从低到高排；城市同行的候选履约率 / 满意率是写死的 0.97 / 0.95、完成单量恒为 0，
// 而且候选根本不排序。现在按下面几项打分，每项都能在 Breakdown 里看到（排序可解释、可审计）：
//
//	可靠（0-40）  已结束的订单里完成的比例 × 准时率（贝叶斯先验：新人按「3 单里完成 2.4 单」起步，不是 0 也不是满分）
//	满意（0-30）  需求方事后评价：FULL=1 / PARTIAL=0.5 / NONE=0，外加「还会再找她」的比例（先验 2 条中性评价）
//	经验（0-15）  完成单量，log 递减（第 1 单和第 50 单的边际不一样）
//	响应（0-10）  引力引擎算的「接下来 60 分钟内会聊天」的概率（GRAVITY-001）；没算过就给中性分，不惩罚
//	适配（0-5）   报价在需求方预算内
//
// DISPATCH-RANK-002（2026-10-06，对齐《检索匹配与治理规则 v0.4》§二）在上面五项之外再加三项，都可在控制台调：
//
//	距离（0-40）  她离需求地点多近：半径内线性递减，出了半径 0。需求没给坐标、或她没有位置 ⇒ 0（不猜，也就不改变今天的先后）
//	新人（0-8）   完成单不足 10 单的人按差几单线性加权（规则：「前 10 单给予新手加权」，免得没评价就永远排不上）
//	负载（-0…-18）手上还没结束的邀约 / 订单每张扣 6 分，封顶 18：单子不该全压在头部几个人身上
//
// PRD R15.2 冻结：Popularity ≠ Qualification。浏览、点赞、粉丝**不进**撮合排序 —— 漂亮、会修图可以让内容
// 被更多人看到，但不能让她在真实任务撮合、报价排序、履约资格里更靠前。这里一个曝光信号都不读。
package matching

import (
	"context"
	"math"
	"sort"
)

// Signals 是一个服务者的真实履约记录与当下状态。
type Signals struct {
	Completed       int      `json:"completed"`
	Cancelled       int      `json:"cancelled"`
	OnTime          int      `json:"onTime"`
	Rated           int      `json:"rated"`
	SatisfactionSum float64  `json:"satisfactionSum"` // FULL=1, PARTIAL=0.5, NONE=0 的和
	WouldReuse      int      `json:"wouldReuse"`
	ChatP60         *float64 `json:"chatP60,omitempty"` // nil = 引力还没算过这个人
	// DISPATCH-RANK-002
	ActiveLoad int      `json:"activeLoad"`          // 还没结束的邀约（未过期）+ 订单
	DistanceM  *float64 `json:"distanceM,omitempty"` // 到这一单需求地点的距离；nil = 算不出来
	Lat        *float64 `json:"-"`                   // 她的位置（只用来算距离，不出现在任何返回里）
	Lng        *float64 `json:"-"`
	// TAG-SYSTEM-001：她和发单方的共同兴趣（标签重合度，0..1）。nil = 没算（没有标签 / 标签层没接）→ 0 分，
	// 不是「完全不合」。tagFitWeight 出厂为 0：标签层上线不改任何人的排名，运营在控制台打开才生效。
	TagFit *float64 `json:"-"`
}

// Breakdown 是一个候选的得分明细。
type Breakdown struct {
	Reliability  float64 `json:"reliability"`
	Satisfaction float64 `json:"satisfaction"`
	Experience   float64 `json:"experience"`
	Response     float64 `json:"response"`
	Fit          float64 `json:"fit"`
	// DISPATCH-RANK-002
	Distance      float64  `json:"distance"`
	NewcomerBoost float64  `json:"newcomerBoost"`
	LoadPenalty   float64  `json:"loadPenalty"`          // 正数，总分里减掉它
	TagFit        float64  `json:"tagFit"`               // TAG-SYSTEM-001：共同兴趣加分（出厂权重 0）
	DistanceKm    *float64 `json:"distanceKm,omitempty"` // 给人看的距离（只出公里数，不出坐标）
	Total         float64  `json:"total"`
	// 用户侧能说的人话（不含任何曝光数据）。
	FulfillmentRate  float64 `json:"fulfillmentRate"`
	SatisfactionRate float64 `json:"satisfactionRate"`
	HasTrackRecord   bool    `json:"hasTrackRecord"`
}

// 这些数现在住在 Tunables 里（OPS-MATCHING-TUNABLES-001）：默认值就是下面这些字面量，
// 运营可以在控制台改，改了立刻生效并且留审计。Score 不再直接读常量，
// 而是在每个批次开头取一份旋钮快照。

// Score 用当前生效的旋钮算一个候选的得分。price / budget 为 0 表示不知道，适配分给 0（不猜）。
func Score(s Signals, price, budget int64) Breakdown {
	return CurrentTunables().Score(s, price, budget)
}

// Score 用指定的一套旋钮算分。Rank 用它（一个批次必须按同一套数打分），
// 单独的调用方用上面那个包级 Score。
func (t Tunables) Score(s Signals, price, budget int64) Breakdown {
	ended := float64(s.Completed + s.Cancelled)
	completeRate := (float64(s.Completed) + t.PriorOrders*t.PriorComplete) / (ended + t.PriorOrders)
	onTimeRate := 1.0
	if s.Completed > 0 {
		onTimeRate = (float64(s.OnTime) + t.OnTimePrior) / (float64(s.Completed) + t.OnTimePrior)
	}
	satisfaction := (s.SatisfactionSum + t.PriorRatings*t.PriorSatisfaction) / (float64(s.Rated) + t.PriorRatings)
	reuse := (float64(s.WouldReuse) + t.PriorRatings*t.PriorSatisfaction) / (float64(s.Rated) + t.PriorRatings)
	response := t.NeutralResponse
	if s.ChatP60 != nil {
		response = math.Max(0, math.Min(1, *s.ChatP60))
	}
	b := Breakdown{
		Reliability:  round2(t.ReliabilityWeight * completeRate * onTimeRate),
		Satisfaction: round2(t.SatisfactionWeight * (t.RatingShare*satisfaction + t.ReuseShare*reuse)),
		Experience:   round2(t.ExperienceWeight * math.Min(1, math.Log1p(float64(s.Completed))/math.Log1p(t.ExperienceSat))),
		Response:     round2(t.ResponseWeight * response),
	}
	if budget > 0 && price > 0 && price <= budget {
		b.Fit = round2(t.FitPoints)
	}
	if s.DistanceM != nil && *s.DistanceM >= 0 {
		km := *s.DistanceM / 1000
		shown := round2(km)
		b.DistanceKm = &shown
		if t.RadiusKm > 0 && km < t.RadiusKm {
			b.Distance = round2(t.DistanceWeight * (1 - km/t.RadiusKm))
		}
	}
	if t.NewcomerOrders > 0 && float64(s.Completed) < t.NewcomerOrders {
		b.NewcomerBoost = round2(t.NewcomerBoost * (1 - float64(s.Completed)/t.NewcomerOrders))
	}
	if s.TagFit != nil && t.TagFitWeight > 0 {
		b.TagFit = round2(t.TagFitWeight * math.Max(0, math.Min(1, *s.TagFit)))
	}
	if s.ActiveLoad > 0 {
		b.LoadPenalty = round2(math.Min(t.LoadPenaltyCap, t.LoadPenaltyPerJob*float64(s.ActiveLoad)))
	}
	b.Total = round2(b.Reliability + b.Satisfaction + b.Experience + b.Response + b.Fit +
		b.Distance + b.NewcomerBoost + b.TagFit - b.LoadPenalty)
	if ended > 0 {
		b.FulfillmentRate = round2(float64(s.Completed) / ended)
	}
	if s.Rated > 0 {
		b.SatisfactionRate = round2(s.SatisfactionSum / float64(s.Rated))
	}
	b.HasTrackRecord = s.Completed > 0
	return b
}

// Ranked 是排好序的一个候选。
type Ranked struct {
	AgentID   string    `json:"agentId"`
	Price     int64     `json:"price"`
	Breakdown Breakdown `json:"breakdown"`
}

// Rank 按总分从高到低；同分按价格低的在前，再按 id（稳定、可复现）。
func Rank(agentIDs []string, prices map[string]int64, signals map[string]Signals, budget int64) []Ranked {
	return CurrentTunables().Rank(agentIDs, prices, signals, budget)
}

// Rank 用指定的一套旋钮排序。快照只在批次开头取一次：中途运营改了旋钮，
// 不能让同一批候选一半按新数、一半按旧数。
func (t Tunables) Rank(agentIDs []string, prices map[string]int64, signals map[string]Signals, budget int64) []Ranked {
	out := make([]Ranked, 0, len(agentIDs))
	for _, id := range agentIDs {
		out = append(out, Ranked{AgentID: id, Price: prices[id], Breakdown: t.Score(signals[id], prices[id], budget)})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Breakdown.Total != out[j].Breakdown.Total {
			return out[i].Breakdown.Total > out[j].Breakdown.Total
		}
		if out[i].Price != out[j].Price {
			return out[i].Price < out[j].Price
		}
		return out[i].AgentID < out[j].AgentID
	})
	return out
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// DistanceMeters 是两点的大圆距离（haversine）。
func DistanceMeters(aLat, aLng, bLat, bLng float64) float64 {
	const earth = 6_371_000.0
	rad := math.Pi / 180
	dLat := (bLat - aLat) * rad
	dLng := (bLng - aLng) * rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(aLat*rad)*math.Cos(bLat*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earth * math.Asin(math.Sqrt(h))
}

// WithDistances 给每个有位置的人填上到 (lat, lng) 的距离。需求没坐标就原样返回。
func WithDistances(signals map[string]Signals, ids []string, lat, lng *float64) map[string]Signals {
	if lat == nil || lng == nil {
		return signals
	}
	out := make(map[string]Signals, len(signals))
	for k, v := range signals {
		out[k] = v
	}
	for _, id := range ids {
		s := out[id]
		if s.Lat != nil && s.Lng != nil {
			d := DistanceMeters(*lat, *lng, *s.Lat, *s.Lng)
			s.DistanceM = &d
			out[id] = s
		}
	}
	return out
}

type requesterKey struct{}

// WithRequester 把「这次排名是替谁排的」（发单方）带进排序器——标签契合需要知道另一端是谁。
func WithRequester(ctx context.Context, requesterID string) context.Context {
	return context.WithValue(ctx, requesterKey{}, requesterID)
}

// RequesterFrom 取出发单方；没有就是空串（排序器不算标签契合）。
func RequesterFrom(ctx context.Context) string {
	id, _ := ctx.Value(requesterKey{}).(string)
	return id
}
