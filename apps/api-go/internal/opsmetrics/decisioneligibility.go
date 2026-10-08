package opsmetrics

import (
	"context"
	"time"
)

// OPS-DECISION-ELIGIBILITY-001（2026-10-07）：决策引擎页（/v1/operator/decision-engine）。
//
// 这一页原来是 `notConnected("决策引擎（/v1/decisions/evaluate 未实现…）")`，而页面 JSX
// 直接读 `data.engine.evaluate_calls_30d` —— 桩根本不发这个字段，所以**页面一打开就崩**。
// 同崩的还有 trust / clarification / intent-orchestration：四个桩页在运营后台里是打不开的。
//
// 但「/v1/decisions/evaluate 没实现」不等于「决策资格没有数据」。spec §11 要的是
// **不要只有 active / inactive**，那台状态机**是有的**：decision.user_event_states 里
// 逐个 (人 × 事件类型) 存着 action_state（OBSERVE / LEARN_ONLY / PASSIVE / ACTIVE_ORCHESTRATE）、
// confidence、evidence_coverage、sample_events、model_version —— 由 gravity 的 worker 算。
// 本机实测 38 行：OBSERVE 24 / LEARN_ONLY 11 / PASSIVE 3，**没有一个 ACTIVE_ORCHESTRATE**
// （§12/§13 不会自动给，gravity 包里有 TestNeverAutoActiveOrchestrate 钉着）。
//
// 所以这一页给的是「引擎今天把人判成什么状态、证据够不够」，不是「引擎每秒处理多少请求」——
// 后者确实不存在（evaluate 端点没注册路由），继续在页面说明里写明，不给数。
//
// 结构上没有「转化率 / 通过率」：这些格子的人数不是同一批人，相除没有意义。
type EligibilityStateRow struct {
	State           string  `json:"state"`
	People          int64   `json:"people"`
	AvgConfidence   float64 `json:"avg_confidence"`
	AvgEvidence     float64 `json:"avg_evidence_coverage"`
	AvgSampleEvents float64 `json:"avg_sample_events"`
}

type EligibilityEventRow struct {
	EventType string `json:"event_type"`
	People    int64  `json:"people"`
}

type DecisionEligibility struct {
	// States 是按 action_state 分组的人数。spec §11：不要只有 active/inactive。
	States []EligibilityStateRow `json:"states"`
	// EventTypes 是按引力事件类型分组的人数（同一个人在不同事件类型上是不同行）。
	EventTypes []EligibilityEventRow `json:"event_types"`
	// ActiveOrchestrate 单独给：它**应该永远是 0**（§12/§13 不自动进入主动编排），
	// 所以它不是「一个数」而是「一条断言」—— 哪天不是 0 了，是引擎越权了。
	ActiveOrchestrate int64 `json:"active_orchestrate"`
	// ModelVersions / LastComputedAt 回答「这套状态是谁、什么时候算出来的」。
	// 状态不是事实，是引擎在某一刻的判断 —— 没这个时间戳，运营会把陈旧判断当成当前判断。
	ModelVersions   []string   `json:"model_versions"`
	LastComputedAt  *time.Time `json:"last_computed_at"`
	FirstComputedAt *time.Time `json:"first_computed_at"`
	TotalPeople     int64      `json:"total_people"`
}

func (p *Postgres) DecisionEligibility(ctx context.Context, now time.Time) (DecisionEligibility, error) {
	var out DecisionEligibility

	rows, err := p.pool.Query(ctx, `
		SELECT action_state, COUNT(*),
			COALESCE(AVG(confidence), 0), COALESCE(AVG(evidence_coverage), 0),
			COALESCE(AVG(sample_events), 0)
		FROM decision.user_event_states
		GROUP BY action_state
		ORDER BY COUNT(*) DESC, action_state`)
	if err != nil {
		return DecisionEligibility{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var r EligibilityStateRow
		if err := rows.Scan(&r.State, &r.People, &r.AvgConfidence, &r.AvgEvidence, &r.AvgSampleEvents); err != nil {
			return DecisionEligibility{}, err
		}
		if r.State == "ACTIVE_ORCHESTRATE" {
			out.ActiveOrchestrate += r.People
		}
		out.States = append(out.States, r)
		out.TotalPeople += r.People
	}
	if err := rows.Err(); err != nil {
		return DecisionEligibility{}, err
	}

	rows2, err := p.pool.Query(ctx, `
		SELECT event_type, COUNT(*) FROM decision.user_event_states
		GROUP BY event_type ORDER BY COUNT(*) DESC, event_type`)
	if err != nil {
		return DecisionEligibility{}, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var r EligibilityEventRow
		if err := rows2.Scan(&r.EventType, &r.People); err != nil {
			return DecisionEligibility{}, err
		}
		out.EventTypes = append(out.EventTypes, r)
	}
	if err := rows2.Err(); err != nil {
		return DecisionEligibility{}, err
	}

	// 一张表里理论上只该有一个 model_version（一次重算写一个版本）。
	// 出现多个 = 有人改了版本但老行没清，运营看到的状态就不是一个口径 —— 所以列出来，不合并。
	var versions []string
	var last, first *time.Time
	err = p.pool.QueryRow(ctx, `
		SELECT COALESCE(array_agg(DISTINCT model_version ORDER BY model_version), '{}'),
			MAX(computed_at), MIN(computed_at)
		FROM decision.user_event_states`).Scan(&versions, &last, &first)
	if err != nil {
		return DecisionEligibility{}, err
	}
	out.ModelVersions = versions
	out.LastComputedAt = last
	out.FirstComputedAt = first
	return out, nil
}
