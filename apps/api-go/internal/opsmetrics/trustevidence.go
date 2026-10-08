package opsmetrics

import (
	"context"
	"time"
)

// OPS-TRUST-EVIDENCE-001（2026-10-07）：信任与风险页（/v1/operator/trust）。
//
// 这一页原来是 `notConnected("信任与风险评分（evidence-gate、negative-breaker）")`，
// 而 Trust.tsx 直接读 d.safety / d.risk_scores —— 桩不发这两个字段，**页面一打开就崩**。
//
// 更要注意的是它**原来想显示什么**：`risk_scores: [{segment, score}]`，即逐人群的
// 0–1 风险分。那个数字今天算不出来，也**不该被编出来** —— 一个凭空的风险分比没有风险分坏
// 得多：它会让人以为系统在评估风险，而事实是没有任何一个风险模型在跑。所以结构上
// 没有 score / risk 字段。给的是能被数的**证据与处置事实**：
//
//	供给侧证据（spec §9 的 evidence 那一半，全量口径 —— 核验是状态不是事件）：
//	  多少人核验通过 / 过期 / 一条核验记录都没有、多少人验过能力。
//	风险信号（举报 / 屏蔽 / 安全事件）：
//	  窗口内 + 全量两个口径，跟商家页 orders30d / orders30dAll 同一个道理 ——
//	  只报窗口会把「一直挂着没处置」藏起来，而那正是运营要看见的东西。
//	处置事实：
//	  dispositions / appeals —— 用来回答「举报有没有人处理」。
//
// 本机实测最有信息量的一条：moderation.reports 有 1 条 SUBMITTED，而
// moderation.dispositions 是 **0 行**。不是「举报都处理完了」，是处置链路没接。
// 这条必须作为话讲出来（见 handler 的 note），否则「0 处置」会被读成「0 风险」。
//
// 没有的东西：§10 的熔断（negative-breaker）没有实现；安全事件表存在但是空的，
// 那是「没有记录」还是「没有事故」分不清 —— 所以只给数，不下结论。
type TrustEvidence struct {
	WindowDays int64 `json:"windowDays"`

	// 供给侧证据（全量）
	Agents             int64 `json:"agents"`
	RealNameVerified   int64 `json:"real_name_verified"`
	RealNameExpired    int64 `json:"real_name_expired"`
	RealNameMissing    int64 `json:"real_name_missing"`
	CapabilityVerified int64 `json:"capability_verified"`

	// 风险信号：窗口内 vs 全量，两个都要（理由见包注释）
	Reports30d      int64 `json:"reports_30d"`
	ReportsAll      int64 `json:"reports_all"`
	MutedAuthors30d int64 `json:"muted_authors_30d"`
	MutedAuthorsAll int64 `json:"muted_authors_all"`
	PostReportsAll  int64 `json:"post_reports_all"`

	// 处置事实
	Dispositions30d    int64 `json:"dispositions_30d"`
	DispositionsAll    int64 `json:"dispositions_all"`
	AppealsAll         int64 `json:"appeals_all"`
	SafetyIncidentsAll int64 `json:"safety_incidents_all"`
	SafetyBlocksAll    int64 `json:"safety_blocks_all"`
}

func (p *Postgres) TrustEvidence(ctx context.Context, now time.Time) (TrustEvidence, error) {
	since := now.Add(-Window)
	var out TrustEvidence
	out.WindowDays = int64(Window / (24 * time.Hour))

	err := p.pool.QueryRow(ctx, `
		SELECT
			-- 供给侧证据（全量）
			(SELECT COUNT(*) FROM supply.agent_profiles),
			(`+realNameVerifiedCount+`),
			(`+realNameExpiredCount+`),
			(SELECT COUNT(*) FROM supply.agent_profiles a
			  WHERE NOT EXISTS (SELECT 1 FROM supply.seller_real_name_verifications v WHERE v.agent_id = a.agent_id)),
			(`+capabilityVerifiedCount+`),
			-- 风险信号：窗口内 / 全量
			(SELECT COUNT(*) FROM moderation.reports WHERE created_at >= $1),
			(SELECT COUNT(*) FROM moderation.reports),
			(SELECT COUNT(*) FROM engagement.muted_authors WHERE created_at >= $1),
			(SELECT COUNT(*) FROM engagement.muted_authors),
			(SELECT COUNT(*) FROM engagement.post_reports),
			-- 处置事实
			(SELECT COUNT(*) FROM moderation.dispositions WHERE created_at >= $1),
			(SELECT COUNT(*) FROM moderation.dispositions),
			(SELECT COUNT(*) FROM moderation.appeals),
			(SELECT COUNT(*) FROM safety.incidents),
			(SELECT COUNT(*) FROM safety.blocks)`, since, now).
		Scan(
			&out.Agents, &out.RealNameVerified, &out.RealNameExpired, &out.RealNameMissing, &out.CapabilityVerified,
			&out.Reports30d, &out.ReportsAll,
			&out.MutedAuthors30d, &out.MutedAuthorsAll, &out.PostReportsAll,
			&out.Dispositions30d, &out.DispositionsAll, &out.AppealsAll,
			&out.SafetyIncidentsAll, &out.SafetyBlocksAll,
		)
	return out, err
}
