package opsmetrics

import (
	"context"
	"time"
)

// OPS-ATTRIBUTION-AUDIT-001（2026-10-07）：归因链页（/v1/operator/fulfillment-attribution）。
//
// 这一页原来读 `data.attribution`（逐单的 decision_id / surface_plan_id / delta_id 明细表）
// —— notConnected 桩不发这个字段，**一打开就崩**。更重要的是：就算补上字段，那张明细表
// 今天也造不出来 —— decision→曝光→撮合→成交的链在**键**这一层就没接上。
//
// 所以这一页不给明细表，给**归因键审计**：链的三段，每一段各有一个数，
// 谁把键接上了，对应的数就会动 —— 改措辞它们不会动：
//
//	段一 决策 → 曝光：interaction_events.recommendation_request_id 的非空数
//	     （这是把一条曝光追回「哪次推荐请求把它排出来」的唯一键；0 = 没有任何曝光可归因）
//	段二 撮合 ↔ 成交：supply.candidate_batches.need_id 与 fulfillment.orders.need_id
//	     的**交集**（0 = 两边的键不是同一套，撮合批次永远连不上订单）
//	段三 结果落库：outcome.* 五张表的总行数（0 = 建表起没有任何写入方）
//
// 本机实测：三段全是 0 —— 这不是「没有生意」，是**链没接**。做成数而不是散文，
// 是因为接键的那天这页要自己亮起来。
type AttributionAudit struct {
	WindowDays int64 `json:"windowDays"`

	EventsAll          int64 `json:"events_all"`
	EventsAttributable int64 `json:"events_attributable"` // 段一：带 recommendation_request_id 的曝光

	BatchesAll        int64 `json:"batches_all"`
	BatchesWithNeedId int64 `json:"batches_with_need_id"`
	OrdersAll         int64 `json:"orders_all"`
	OrdersWithNeedId  int64 `json:"orders_with_need_id"`
	KeysJoined        int64 `json:"keys_joined"` // 段二：两边 need_id 的交集

	OutcomeRows int64 `json:"outcome_rows"` // 段三：outcome.* 五张表总行数
}

func (p *Postgres) AttributionAudit(ctx context.Context, _ time.Time) (AttributionAudit, error) {
	var out AttributionAudit
	out.WindowDays = int64(Window / (24 * time.Hour))

	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM localnet.interaction_events),
			(SELECT COUNT(*) FROM localnet.interaction_events
			  WHERE COALESCE(recommendation_request_id,'') <> ''),
			(SELECT COUNT(*) FROM supply.candidate_batches),
			(SELECT COUNT(*) FROM supply.candidate_batches
			  WHERE COALESCE(need_id,'') <> ''),
			(SELECT COUNT(*) FROM fulfillment.orders),
			(SELECT COUNT(*) FROM fulfillment.orders
			  WHERE COALESCE(need_id,'') <> ''),
			(SELECT COUNT(*) FROM fulfillment.orders o
			  WHERE COALESCE(o.need_id,'') <> ''
			    AND o.need_id IN (
			      SELECT need_id FROM supply.candidate_batches
			      WHERE COALESCE(need_id,'') <> '')),
			(SELECT COUNT(*) FROM outcome.observations)
			+ (SELECT COUNT(*) FROM outcome.observation_sets)
			+ (SELECT COUNT(*) FROM outcome.deltas)
			+ (SELECT COUNT(*) FROM outcome.learnings)
			+ (SELECT COUNT(*) FROM outcome.observation_templates)`).
		Scan(&out.EventsAll, &out.EventsAttributable,
			&out.BatchesAll, &out.BatchesWithNeedId,
			&out.OrdersAll, &out.OrdersWithNeedId,
			&out.KeysJoined, &out.OutcomeRows)
	return out, err
}
