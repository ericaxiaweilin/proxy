package opsmetrics

import (
	"context"
	"time"
)

// OPS-CLARIFICATION-001（2026-10-07）：澄清门页（/v1/operator/clarification-gate）。
//
// 这一页原来是 `notConnected("澄清门（intent-service）")`，而 Clarification.tsx 直接
// `data.gates.map(...)` —— 桩不发 gates，**页面一打开就崩**。
//
// 澄清门**本身**（追问策略、PASS / CLARIFY / BLOCK 的判定）确实没实现，那部分继续不给数。
// 但它的**产出**是有的：demand.task_drafts 就是澄清过程中那份逐步补齐的草案
// （lifecycle COMMITTED = 用户确认并发布），demand.tasks 是 PublishTask 落的 canonical 行。
// 所以这一页给的是澄清门的**漏斗**，不是它的策略。
//
// 关键发现（本机实测，三条回连全部为 0）：
//
//	54 条草案、45 条 COMMITTED、0 条 canonical task；
//	草案 id 在 supply.candidate_batches.need_id 里出现 **0 次**；
//	草案 id 在 fulfillment.orders.need_id 里出现 **0 次**。
//
// 也就是说「澄清 → 撮合 → 成交」这条链在**键这一层就没接上**，不是转化差。
// 所以把这两个回连数也读出来 —— 让断链作为一个**数**出现在页面上，而不是靠一句
// 散文声明。谁把键接上了，这两个数会动；谁只是改了措辞，它们不动。
type ClarificationFunnel struct {
	WindowDays int64 `json:"windowDays"`

	// 全量口径：demand.task_drafts 没有 created_at（只有 updated_at），
	// 按 updated_at 切窗口会被读成「近 30 天新增意图」，那是另一个指标。
	Drafts          int64 `json:"drafts"`
	DraftsOpen      int64 `json:"drafts_open"`
	DraftsCommitted int64 `json:"drafts_committed"`
	CanonicalTasks  int64 `json:"canonical_tasks"`

	// 下游回连：澄清的产出有没有真的往下走。
	DraftsWithBatch int64 `json:"drafts_with_batch"`
	DraftsWithOrder int64 `json:"drafts_with_order"`

	// citycompanion.needs 是另一条需求入口（同城需求的正式表），摆出来是为了
	// 说明「需求不止从澄清门进来」，不要拿草案数当需求总数。
	Needs int64 `json:"needs"`
}

func (p *Postgres) ClarificationFunnel(ctx context.Context, now time.Time) (ClarificationFunnel, error) {
	var out ClarificationFunnel
	out.WindowDays = int64(Window / (24 * time.Hour))

	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM demand.task_drafts),
			(SELECT COUNT(*) FROM demand.task_drafts WHERE lifecycle <> 'COMMITTED'),
			(SELECT COUNT(*) FROM demand.task_drafts WHERE lifecycle = 'COMMITTED'),
			(SELECT COUNT(*) FROM demand.tasks),
			-- 回连：草案 id 有没有成为撮合批次的 need_id
			(SELECT COUNT(*) FROM demand.task_drafts d
			  WHERE EXISTS (SELECT 1 FROM supply.candidate_batches b WHERE b.need_id = d.id)),
			-- 回连：草案 id 有没有成为订单的 need_id
			(SELECT COUNT(*) FROM demand.task_drafts d
			  WHERE EXISTS (SELECT 1 FROM fulfillment.orders o WHERE o.need_id = d.id)),
			(SELECT COUNT(*) FROM citycompanion.needs)`).
		Scan(&out.Drafts, &out.DraftsOpen, &out.DraftsCommitted, &out.CanonicalTasks,
			&out.DraftsWithBatch, &out.DraftsWithOrder, &out.Needs)
	return out, err
}
