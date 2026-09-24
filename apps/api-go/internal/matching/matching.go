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
// PRD R15.2 冻结：Popularity ≠ Qualification。浏览、点赞、粉丝**不进**撮合排序 —— 漂亮、会修图可以让内容
// 被更多人看到，但不能让她在真实任务撮合、报价排序、履约资格里更靠前。这里一个曝光信号都不读。
package matching

import (
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
}

// Breakdown 是一个候选的得分明细。
type Breakdown struct {
	Reliability  float64 `json:"reliability"`
	Satisfaction float64 `json:"satisfaction"`
	Experience   float64 `json:"experience"`
	Response     float64 `json:"response"`
	Fit          float64 `json:"fit"`
	Total        float64 `json:"total"`
	// 用户侧能说的人话（不含任何曝光数据）。
	FulfillmentRate  float64 `json:"fulfillmentRate"`
	SatisfactionRate float64 `json:"satisfactionRate"`
	HasTrackRecord   bool    `json:"hasTrackRecord"`
}

const (
	priorOrders       = 3.0
	priorCompleteRate = 0.8
	priorRatings      = 2.0
	priorSatisfaction = 0.6
	neutralResponse   = 0.3
)

// Score 算一个候选的得分。price / budget 为 0 表示不知道，适配分给 0（不猜）。
func Score(s Signals, price, budget int64) Breakdown {
	ended := float64(s.Completed + s.Cancelled)
	completeRate := (float64(s.Completed) + priorOrders*priorCompleteRate) / (ended + priorOrders)
	onTimeRate := 1.0
	if s.Completed > 0 {
		onTimeRate = (float64(s.OnTime) + 1) / (float64(s.Completed) + 1)
	}
	satisfaction := (s.SatisfactionSum + priorRatings*priorSatisfaction) / (float64(s.Rated) + priorRatings)
	reuse := (float64(s.WouldReuse) + priorRatings*priorSatisfaction) / (float64(s.Rated) + priorRatings)
	response := neutralResponse
	if s.ChatP60 != nil {
		response = math.Max(0, math.Min(1, *s.ChatP60))
	}
	b := Breakdown{
		Reliability:  round2(40 * completeRate * onTimeRate),
		Satisfaction: round2(30 * (0.7*satisfaction + 0.3*reuse)),
		Experience:   round2(15 * math.Min(1, math.Log1p(float64(s.Completed))/math.Log1p(50))),
		Response:     round2(10 * response),
	}
	if budget > 0 && price > 0 && price <= budget {
		b.Fit = 5
	}
	b.Total = round2(b.Reliability + b.Satisfaction + b.Experience + b.Response + b.Fit)
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
	out := make([]Ranked, 0, len(agentIDs))
	for _, id := range agentIDs {
		out = append(out, Ranked{AgentID: id, Price: prices[id], Breakdown: Score(signals[id], prices[id], budget)})
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
