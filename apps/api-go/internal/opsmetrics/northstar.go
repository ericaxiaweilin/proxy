package opsmetrics

import (
	"context"
	"time"
)

// OPS-NORTH-STAR-001（2026-10-07）：North Star 落地页那四个格子。
//
// 那四个格子以前是 Overview.tsx 里一个写死的常量（有效意图 / 成功撮合 / 完成履约 /
// 负反馈率），永远显示「未接入」，跟库里有没有数没关系。用户：「不存在就建 不然怎么
// 后台运营」。这一版把它们接到真读模型上 —— 但只接**真有来源**的那一半，另一半仍然
// 明说缺什么，理由和 OPS-MERCHANT-001 一样：假的健康度比没有健康度更糟。
//
// 逐个说清楚「能算什么」和「不能算什么」，因为这四个格子名字很响，很容易被填成
// 看起来对的东西：
//
//  1. 有效意图（§17 的 intent_created）—— **能给**：澄清门的工作状态就落在
//     demand.task_drafts 上（lifecycle COMMITTED = 用户确认并发布）。但那张表
//     **没有 created_at**（只有 updated_at），所以这里只能给全量口径，不能给「近 30 天」；
//     给一个按 updated_at 切的窗口会被读成「近 30 天新增意图」，那是错的。
//     另外 demand.tasks 是 PublishTask 落的 canonical 行，两边应当对得上 —— 对不上
//     就说明有草案没走发布链路，这一点必须让运营看见（见 api 层的 note）。
//     **不能给**：spec §16 说的 intent-service 本身（澄清策略、澄清轮次）没有实现。
//
//  2. 成功撮合（§17 的 match_accept）—— **只能给一半**：撮合引擎跑过的候选批次
//     （supply.candidate_batches）是真表、有真写入方（platform/postgres/supply.go），
//     所以「跑了几批 / 几批找到了供给 / 几批供不应求」是真的。
//     **不能给**：「撮合成功」= 结果归因。outcome.* 五张表从建表起没有任何写入方
//     （实测 0 行），而且 candidate_batches.need_id 与 fulfillment.orders.need_id
//     不是同一套键（实测 5 批 vs 819 单，回连命中 0）—— 在这里算「转化率」得到的是
//     断链的 0，不是生意上的 0。所以结构上没有那个字段。
//
//  3. 完成履约（§17 的 fulfillment）—— **能给**：fulfillment.orders.lifecycle 是
//     真实状态机（OFFERED → CONFIRMED → EXECUTING → COMPLETED / CANCELLED，143 号迁移
//     有 CHECK）。单量和取消量都能算。
//     **不能给**：成交额。payment.* 四张表全是 0 行、没有支付通道，「金额」没有事实
//     来源 —— 显示 0 会被读成「没生意」，所以结构上没有金额字段。
//
//  4. 负反馈率（§10）—— **能给率**：举报 + 屏蔽作者是强负反馈，「减少推荐」是弱负反馈，
//     分母用曝光（跟 Behavior 同一口径、同一窗口、同一批人，可以相除）。
//     **不能给**：§10 的熔断本身（cooldown 24h/7d/30d、merchant 永久禁触达）没有实现，
//     所以这里没有「熔断状态」字段。§10 的 quick_skip 需要 watch_ms 的阈值定义，
//     仓里没有这个阈值，也不给。
//
// 一句话：这四个格子的 dataSource 会是 LIVE / PARTIAL，不再是「未接入」；但每个格子
// 旁边都带着「这个数是什么口径」和「哪一半没给、为什么」。
type IntentFunnel struct {
	// Drafts 是全量草案数，不是近 30 天 —— demand.task_drafts 没有 created_at。
	Drafts          int64 `json:"drafts"`
	DraftsOpen      int64 `json:"drafts_open"`
	DraftsCommitted int64 `json:"drafts_committed"`
	// CanonicalTasks 是 PublishTask 落的 demand.tasks 行数。与 DraftsCommitted
	// 应当一一对应；不等就是发布链路有缺口，不是「漏斗正常收窄」。
	CanonicalTasks int64 `json:"canonical_tasks"`
}

type MatchAttempts struct {
	Batches           int64 `json:"batches"`
	BatchesWithSupply int64 `json:"batches_with_supply"`
	ShortageBatches   int64 `json:"shortage_batches"`
}

type FulfillmentFunnel struct {
	Orders    int64 `json:"orders"`
	Offered   int64 `json:"offered"`
	Confirmed int64 `json:"confirmed"`
	Executing int64 `json:"executing"`
	Completed int64 `json:"completed"`
	Cancelled int64 `json:"cancelled"`
}

// NegativeFeedback 只有计数，没有率 —— 率的门槛（分母够不够大）由 api 层判，
// 因为「样本不足就不给率」是一句措辞，措辞跟着数据变（OPS-RETENTION-001 的做法）。
type NegativeFeedback struct {
	Exposures      int64 `json:"exposures"`
	StrongNegative int64 `json:"strong_negative"`
	WeakNegative   int64 `json:"weak_negative"`
}

type NorthStar struct {
	WindowDays  int64             `json:"windowDays"`
	Intent      IntentFunnel      `json:"intent"`
	Matching    MatchAttempts     `json:"matching"`
	Fulfillment FulfillmentFunnel `json:"fulfillment"`
	Negative    NegativeFeedback  `json:"negative"`
}

// NorthStar 一次把四个格子要的数读完。逐项都是相关子查询，不 join：四张表的口径
// 互不相干（草案 / 候选批次 / 订单 / 行为事件），并排 join 只会互相放大行数。
func (p *Postgres) NorthStar(ctx context.Context, now time.Time) (NorthStar, error) {
	since := now.Add(-Window)
	var out NorthStar
	out.WindowDays = int64(Window / (24 * time.Hour))

	err := p.pool.QueryRow(ctx, `
		SELECT
			-- ① 澄清门（全量口径，草案表没有 created_at）
			(SELECT COUNT(*) FROM demand.task_drafts),
			(SELECT COUNT(*) FROM demand.task_drafts WHERE lifecycle <> 'COMMITTED'),
			(SELECT COUNT(*) FROM demand.task_drafts WHERE lifecycle = 'COMMITTED'),
			(SELECT COUNT(*) FROM demand.tasks),
			-- ② 撮合尝试（近 30 天）
			(SELECT COUNT(*) FROM supply.candidate_batches WHERE created_at >= $1),
			(SELECT COUNT(*) FROM supply.candidate_batches
			  WHERE created_at >= $1
			    AND jsonb_typeof(candidates) = 'array'
			    AND jsonb_array_length(candidates) > 0),
			(SELECT COUNT(*) FROM supply.candidate_batches WHERE created_at >= $1 AND shortage),
			-- ③ 履约（近 30 天，按真实状态机分档）
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'OFFERED'),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'CONFIRMED'),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'EXECUTING'),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'COMPLETED'),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1 AND lifecycle = 'CANCELLED'),
			-- ④ 负反馈（近 30 天；强/弱口径与 Behavior 一致）
			(SELECT COUNT(*) FROM localnet.interaction_events
			  WHERE created_at >= $1 AND event_type IN ('POST_IMPRESSION', 'MEDIA_IMPRESSION')),
			(SELECT COUNT(*) FROM engagement.post_reports WHERE created_at >= $1)
			+ (SELECT COUNT(*) FROM engagement.muted_authors WHERE created_at >= $1),
			(SELECT COUNT(*) FROM engagement.feed_preferences WHERE created_at >= $1)`, since).
		Scan(
			&out.Intent.Drafts, &out.Intent.DraftsOpen, &out.Intent.DraftsCommitted, &out.Intent.CanonicalTasks,
			&out.Matching.Batches, &out.Matching.BatchesWithSupply, &out.Matching.ShortageBatches,
			&out.Fulfillment.Orders, &out.Fulfillment.Offered, &out.Fulfillment.Confirmed,
			&out.Fulfillment.Executing, &out.Fulfillment.Completed, &out.Fulfillment.Cancelled,
			&out.Negative.Exposures, &out.Negative.StrongNegative, &out.Negative.WeakNegative,
		)
	return out, err
}
