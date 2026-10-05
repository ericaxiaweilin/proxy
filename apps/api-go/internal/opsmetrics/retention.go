package opsmetrics

import (
	"context"
	"time"
)

// OPS-RETENTION-001（2026-10-05）：留存与复购的真读模型。
//
// 这一页原来是 NOT_CONNECTED 桩，而库里其实有真事实：30 天 415 张单、196 个下单的人、
// 其中 117 个下过 ≥2 次。控制台首页的「30D 复购/复用」那颗 KPI 因此一直只能显示「未接入」。
//
// 口径全部钉在这里，界面照抄，不各算一遍：
//   · **复购 = 同一个需求方在窗口内下过 ≥2 张单**。不是金额复购 —— 支付没接，
//     金额没有事实来源，报一个客单价就是编。
//   · **回头找她 = 同一个（需求方 × 服务者）在窗口内 ≥2 张单**。跟上面那条是两个数，
//     分开摆：如果重复全都发生在同一个人身上，两个数会几乎相等，这个形状本身就是信息。
//   · **回访只给人数，不给百分比**（结构体里就没有 returnedRate 这个字段）：
//     实测前一个 14 天窗口只有 1 个活跃的人，任何百分比都是噪声，而一旦算出来
//     就会被当成结论念出去。
//   · **同期群留存这里没有**，而且不是漏了：库里 196 个下单人的**首单全部**落在最近
//     30 天内 —— 没有「窗口之前就有的人」可以对照，硬算出来的 100% 是假的。
//     这条写成 note 带上界面，免得有人以为这一页坏了。

// Retention 是留存与复购这一页的全部真数。
type Retention struct {
	WindowDays int64 `json:"windowDays"`

	Orders         int64 `json:"orders"`
	Requesters     int64 `json:"requesters"`
	RepeatRequests int64 `json:"repeatRequesters"`
	// RepeatRequesterRate 的分母是「窗口内下过单的人数」，不是全体用户 —— 口径要写在名字里。
	RepeatRequesterRate  float64 `json:"repeatRequesterRate"`
	SamePairRepeatGroups int64   `json:"samePairRepeatGroups"`
	AgentsWithOrders     int64   `json:"agentsWithOrders"`

	Completed int64 `json:"completed"`
	Cancelled int64 `json:"cancelled"`
	// Lifecycle 是状态机的真实分布（OFFERED / CONFIRMED / EXECUTING / COMPLETED / CANCELLED）。
	// 单独摆出来是因为「有 415 张单」很容易被读成「有 415 单生意」，而其中真正
	// 走完履约的只有 completed 那个数。
	Lifecycle map[string]int64 `json:"lifecycle"`

	// 回访：只给三个数，不给比率（理由见包注释）。
	ActiveLast14d int64 `json:"activeLast14d"`
	ActivePrev14d int64 `json:"activePrev14d"`
	ReturnedUsers int64 `json:"returnedUsers"`

	// PriorWindowRequesters 是「窗口内下过单、且在窗口**之前**也下过单」的需求方数。
	// 它是同期群留存能不能算的那个开关：为 0 就没有前后两期可比，硬算出来的
	// 「100% 留存」是假的，所以这一页宁可不给这个指标，也要说明为什么不给。
	PriorWindowRequesters int64 `json:"priorWindowRequesters"`
}

// Retention 一条 QueryRow 出全部标量，生命周期分布另走一条 GROUP BY。
// 计数一律用**独立子查询**，不并排 LEFT JOIN —— 订单×事件并排 join 会把两边都放大。
func (p *Postgres) Retention(ctx context.Context, now time.Time) (Retention, error) {
	since := now.Add(-Window)
	mid := now.Add(-Window / 2)
	var out Retention
	out.WindowDays = int64(Window / (24 * time.Hour))
	out.Lifecycle = map[string]int64{}

	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1),
			(SELECT COUNT(*) FROM (SELECT requester_id FROM fulfillment.orders WHERE created_at >= $1 GROUP BY requester_id) r),
			(SELECT COUNT(*) FROM (SELECT requester_id FROM fulfillment.orders WHERE created_at >= $1 GROUP BY requester_id HAVING COUNT(*) >= 2) r),
			(SELECT COUNT(*) FROM (SELECT requester_id, agent_id FROM fulfillment.orders WHERE created_at >= $1 GROUP BY requester_id, agent_id HAVING COUNT(*) >= 2) p),
			(SELECT COUNT(DISTINCT agent_id) FROM fulfillment.orders WHERE created_at >= $1),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'COMPLETED'),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'CANCELLED'),
			(SELECT COUNT(DISTINCT actor_id) FROM localnet.interaction_events WHERE created_at >= $2),
			(SELECT COUNT(DISTINCT actor_id) FROM localnet.interaction_events WHERE created_at >= $1 AND created_at < $2),
			(SELECT COUNT(*) FROM (
				SELECT DISTINCT actor_id FROM localnet.interaction_events WHERE created_at >= $2
			) recent WHERE recent.actor_id IN (
				SELECT DISTINCT actor_id FROM localnet.interaction_events WHERE created_at >= $1 AND created_at < $2
			)),
			(SELECT COUNT(*) FROM (
				SELECT DISTINCT o1.requester_id FROM fulfillment.orders o1 WHERE o1.created_at >= $1
			) w WHERE EXISTS (
				SELECT 1 FROM fulfillment.orders o2
				WHERE o2.requester_id = w.requester_id AND o2.created_at < $1
			))`, since, mid).
		Scan(&out.Orders, &out.Requesters, &out.RepeatRequests, &out.SamePairRepeatGroups,
			&out.AgentsWithOrders, &out.Completed, &out.Cancelled,
			&out.ActiveLast14d, &out.ActivePrev14d, &out.ReturnedUsers, &out.PriorWindowRequesters)
	if err != nil {
		return Retention{}, err
	}
	// 分母是 0 时不算比例：0.0 会被读成「复购率 0%」，而事实是「窗口内没人下单，
	// 这个指标此刻无从谈起」。界面按 requesters==0 显示「—」。
	if out.Requesters > 0 {
		out.RepeatRequesterRate = round1(float64(out.RepeatRequests) / float64(out.Requesters) * 100)
	}

	rows, err := p.pool.Query(ctx, `
		SELECT lifecycle, COUNT(*) FROM fulfillment.orders
		WHERE created_at >= $1 GROUP BY lifecycle ORDER BY lifecycle`, since)
	if err != nil {
		return Retention{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var n int64
		if err := rows.Scan(&state, &n); err != nil {
			return Retention{}, err
		}
		out.Lifecycle[state] = n
	}
	return out, rows.Err()
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }
