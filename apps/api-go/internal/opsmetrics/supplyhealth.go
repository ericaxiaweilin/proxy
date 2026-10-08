package opsmetrics

import (
	"context"
	"time"
)

// OPS-SUPPLY-HEALTH-001（2026-10-05）：供给健康度的真读模型。
//
// 这一页守的是「别拿错口径的数当结论」。三个具体的坑，都是这次实测踩到的：
//
//  1. **实名核验按 agent_id 数，不按 user_account_id。** supply.seller_real_name_verifications
//     那 13 行里 user_account_id **全是 NULL**（身份记在 agent_id 上）。用 user_account_id 去数
//     会得到 0 —— 一个看起来像「供给方都没核验」的结论，其实是列名猜错。
//     核验通过 7、过期 6，过期也算事实，所以两个数都出。
//  2. **不给供需比。** 需求侧今天只有 54 张草稿、0 个正式任务（demand.tasks 是空的），
//     拿 107 个供给去除以一个 0，得到的任何数字都是噪声。这一页把需求侧的真实体量摆出来，
//     然后说明为什么不比。
//  3. **不拿 fulfillment.orders.agent_id 直接跟 agent_profiles 对齐。** 那个字段历史上是混写的
//     （一部分行里装的其实是 user_account id），所以「有单的服务者」只数**能对回
//     agent_profiles 的那些**，并把这个限制写在字段名和界面上。

// SupplyHealth 是供给侧这一页的全部真数。
type SupplyHealth struct {
	WindowDays int64 `json:"windowDays"`

	Agents        int64 `json:"agents"`
	AgentsActive  int64 `json:"agentsActive"`
	AgentsDraft   int64 `json:"agentsDraft"`
	AgentsNew     int64 `json:"agentsNewInWindow"`
	AgentsWithBio int64 `json:"agentsWithBio"`
	// AgentsWithLanguages 用 jsonb_array_length 数，languages 是 JSONB 数组不是数组列。
	AgentsWithLanguages int64 `json:"agentsWithLanguages"`
	// AgentsWithAvailability / ...Future 的区别是「配过时间窗」和「现在还有可用的窗」。
	// 两者差得远（本机 106 配过、只有 65 个窗还没过期），合成一个数就会骗人。
	AgentsWithAvailability int64 `json:"agentsWithAvailability"`
	AgentsWithOpenWindow   int64 `json:"agentsWithOpenWindow"`

	RealNameVerified   int64 `json:"realNameVerified"`
	RealNameExpired    int64 `json:"realNameExpired"`
	CapabilityVerified int64 `json:"capabilityVerified"`

	// AgentsWithOrders 只对得上 agent_profiles 里真有的 agent（见包注释第 3 条）。
	AgentsWithOrders int64 `json:"agentsWithOrders"`
	OrdersWindow     int64 `json:"ordersInWindow"`

	// 需求侧的真实体量 —— 摆出来是为了说明为什么没有供需比。
	DemandTaskDrafts   int64 `json:"demandTaskDrafts"`
	DemandTasks        int64 `json:"demandTasks"`
	CityCompanionNeeds int64 `json:"cityCompanionNeeds"`
}

// 核验口径抽成常量，因为**两个页面**都要它：供给健康度页和信任与风险页
// （OPS-TRUST-EVIDENCE-001）。两份 SQL 各写一遍一定会漂 —— 一边改了过期判定、
// 另一边没改，运营就会在两页看到互相矛盾的「已核验 / 已过期」。
// $2 = now：$1 是窗口起点，核验是状态不是事件，所以只跟 now 比。
const (
	realNameVerifiedCount = `(SELECT COUNT(DISTINCT agent_id) FROM supply.seller_real_name_verifications
			 WHERE status = 'VERIFIED' AND (expires_at IS NULL OR expires_at > $2))`
	realNameExpiredCount = `(SELECT COUNT(DISTINCT agent_id) FROM supply.seller_real_name_verifications
			 WHERE status = 'EXPIRED' OR (status = 'VERIFIED' AND expires_at IS NOT NULL AND expires_at <= $2))`
	capabilityVerifiedCount = `(SELECT COUNT(DISTINCT agent_id) FROM supply.capability_verifications)`
)

func (p *Postgres) SupplyHealth(ctx context.Context, now time.Time) (SupplyHealth, error) {
	since := now.Add(-Window)
	var out SupplyHealth
	out.WindowDays = int64(Window / (24 * time.Hour))
	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM supply.agent_profiles),
			(SELECT COUNT(*) FROM supply.agent_profiles WHERE status = 'ACTIVE'),
			(SELECT COUNT(*) FROM supply.agent_profiles WHERE status = 'DRAFT'),
			(SELECT COUNT(*) FROM supply.agent_profiles WHERE created_at >= $1),
			(SELECT COUNT(*) FROM supply.agent_profiles WHERE COALESCE(bio, '') <> ''),
			(SELECT COUNT(*) FROM supply.agent_profiles
			 WHERE jsonb_typeof(languages) = 'array' AND jsonb_array_length(languages) > 0),
			(SELECT COUNT(DISTINCT agent_id) FROM supply.availability_windows),
			(SELECT COUNT(DISTINCT agent_id) FROM supply.availability_windows WHERE end_at > $2),
			(`+realNameVerifiedCount+`),
			(`+realNameExpiredCount+`),
			(`+capabilityVerifiedCount+`),
			(SELECT COUNT(DISTINCT o.agent_id) FROM fulfillment.orders o
				JOIN supply.agent_profiles a ON a.agent_id = o.agent_id
			 WHERE o.created_at >= $1),
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1),
			(SELECT COUNT(*) FROM demand.task_drafts),
			(SELECT COUNT(*) FROM demand.tasks),
			(SELECT COUNT(*) FROM citycompanion.needs)`, since, now).
		Scan(&out.Agents, &out.AgentsActive, &out.AgentsDraft, &out.AgentsNew,
			&out.AgentsWithBio, &out.AgentsWithLanguages,
			&out.AgentsWithAvailability, &out.AgentsWithOpenWindow,
			&out.RealNameVerified, &out.RealNameExpired, &out.CapabilityVerified,
			&out.AgentsWithOrders, &out.OrdersWindow,
			&out.DemandTaskDrafts, &out.DemandTasks, &out.CityCompanionNeeds)
	return out, err
}
