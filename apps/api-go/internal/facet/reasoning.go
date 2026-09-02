package facet

import (
	"fmt"
	"time"
)

// ReasonedDecision 是 ReasoningEngine 的输出。
//
// 字段全部是 Mobile 友好的"自然语言短句"或结构化 token（recommendedKind）。
// Phase 1.5 范围：纯规则 + 模板；Phase 2 替换为 LLM call 时接口不变。
type ReasonedDecision struct {
	// Goal：关系目标（"拉近距离" / "激活共同兴趣" / "推动合作成交"）
	Goal string
	// CurrentState：当前运营状态描述（"已展示 X 条 / 缺口 Y"）
	CurrentState string
	// GapSummary：当前缺口 1 句话（"对方在关注 / 缺真实日常"）
	GapSummary string
	// NextShowAt：下次展示时间（RFC3339）
	NextShowAt string
	// RecommendedKind：推荐展示的内容类型
	//
	// 允许值：
	//   personal/real-life   — 真实日常（侧重拉近）
	//   personal/honest      — 真实 / 翻车 / 软肋（侧重信任）
	//   city/travel          — 城市 / 旅行
	//   photo                — 摄影 / 视觉
	//   shared-experience    — 共同回忆
	//   portfolio/capability — 作品 / 能力
	//   intro/services       — 服务介绍 / 信任建设
	RecommendedKind string
	// Confidence：推理置信度 0-100
	Confidence int
}

// Reasoner 接口。
//
// Phase 1.5 实现：RuleReasoner（确定性规则）。
// Phase 2 计划：LLMReasoner，input 同 ObjectSignals + Relation，
// output 同 ReasonedDecision。保持接口稳定，Service.List 不动。
type Reasoner interface {
	Reason(signals ObjectSignals, relation string) ReasonedDecision
}

// NewRuleReasoner 返回基于规则的 Reasoner。now 用于计算 nextShowAt。
// 接受 now func 注入便于单测。
func NewRuleReasoner(now func() time.Time) *RuleReasoner {
	return &RuleReasoner{now: now}
}

// RuleReasoner 实现了 Phase 1.5 推理逻辑。
//
// 设计：5 条规则 × 3 种关系 = 最多 15 种决策路径。
// 每条规则的"输入特征"是 ObjectSignals 的一组指标，输出是
// ReasonedDecision 的所有字段。
//
// 关键不变量：
//   - Determinism：相同 inputs 必产 same outputs（便于单测 / 缓存）
//   - RecommendedKind 必须从允许值集合里（前端 switch case 匹配）
//   - NextShowAt 用 now() 算，恒为 future time
type RuleReasoner struct {
	now func() time.Time
}

// Reason 是入口。relation 是 Object.Relation 字段（"BUILDING_TRUST"
// 等）。signals 是 Object.Signals。
func (r *RuleReasoner) Reason(signals ObjectSignals, relation string) ReasonedDecision {
	switch relation {
	case "BUILDING_TRUST":
		return r.reasonBuildingTrust(signals)
	case "SHARED_INTEREST":
		return r.reasonSharedInterest(signals)
	case "CREATOR_COLLAB":
		return r.reasonCreatorCollab(signals)
	default:
		// 未知 relation：返回低置信度的通用决策，不静默失败。
		return ReasonedDecision{
			Goal:            "持续连接",
			CurrentState:    fmt.Sprintf("已展示 %d 条 · 本周新增 %d 个素材", signals.ShownAssetCount, signals.FreshAssetCount),
			GapSummary:      "保持节奏",
			NextShowAt:      r.now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "personal/real-life",
			Confidence:      30,
		}
	}
}

// reasonBuildingTrust —— 重点关系。
//
// 核心目的：拉近距离 / 建立信任 → 真实日常、软肋、互动。
//   - 7 天没聊 + 未回复 → 对方在观望，给"真实软肋"破冰
//   - 高 ProfileViews + 久未互动 → 对方关注但沉默，给"近况"
//   - 其他 → 默认真实日常
func (r *RuleReasoner) reasonBuildingTrust(s ObjectSignals) ReasonedDecision {
	if s.DaysSinceLastChat >= 7 && s.UnrepliedMessageCount > 0 {
		return ReasonedDecision{
			Goal:            "打破沉默，重建互动",
			CurrentState:    fmt.Sprintf("已 %d 天未聊 · 对方 %d 条未回 · 主页浏览 %d 次", s.DaysSinceLastChat, s.UnrepliedMessageCount, s.ProfileViewsLast7d),
			GapSummary:      "对方在观望，需要一条「真实软肋」破冰",
			NextShowAt:      r.now().Add(2 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "personal/honest",
			Confidence:      88,
		}
	}
	if s.ProfileViewsLast7d >= 3 {
		return ReasonedDecision{
			Goal:            "回应对方的关注，强化亲近感",
			CurrentState:    fmt.Sprintf("对方 7 天内浏览主页 %d 次 · 距上次聊天 %d 天", s.ProfileViewsLast7d, s.DaysSinceLastChat),
			GapSummary:      "对方沉默但持续关注，缺一条「今天的我」",
			NextShowAt:      r.now().Add(6 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "personal/real-life",
			Confidence:      82,
		}
	}
	return ReasonedDecision{
		Goal:            "持续加深信任",
		CurrentState:    fmt.Sprintf("互动稳定 · 已展示 %d 条 · 关系 %d 天", s.ShownAssetCount, s.RelationshipDays),
		GapSummary:      "保持真实日常节奏",
		NextShowAt:      r.now().Add(12 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind: "personal/real-life",
		Confidence:      65,
	}
}

// reasonSharedInterest —— 朋友 / 共同兴趣。
//
// 核心目的：激活共同兴趣 → 城市 / 摄影 / 共同回忆。
//   - 有 fresh asset + 短期互动 → 推 city/travel 激活
//   - 有共同活动 → 推 shared-experience
//   - 默认 photo（摄影是常见 shared interest）
func (r *RuleReasoner) reasonSharedInterest(s ObjectSignals) ReasonedDecision {
	if s.FreshAssetCount > 0 && s.DaysSinceLastChat <= 3 {
		return ReasonedDecision{
			Goal:            "趁热打铁激活共同兴趣",
			CurrentState:    fmt.Sprintf("本周新增 %d 个素材 · 距上次聊天 %d 天", s.FreshAssetCount, s.DaysSinceLastChat),
			GapSummary:      "有新鲜城市 / 旅行内容未推",
			NextShowAt:      r.now().Add(3 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "city/travel",
			Confidence:      85,
		}
	}
	if s.MutualEventsCount > 0 {
		return ReasonedDecision{
			Goal:            "激活共同回忆，建立新连接",
			CurrentState:    fmt.Sprintf("共同活动 %d 次 · 关系 %d 天", s.MutualEventsCount, s.RelationshipDays),
			GapSummary:      "可推送一段共同经历相关的新内容",
			NextShowAt:      r.now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "shared-experience",
			Confidence:      80,
		}
	}
	return ReasonedDecision{
		Goal:            "持续共同兴趣连接",
		CurrentState:    fmt.Sprintf("已展示 %d 条 · 距上次聊天 %d 天", s.ShownAssetCount, s.DaysSinceLastChat),
		GapSummary:      "需要新内容激活对话",
		NextShowAt:      r.now().Add(18 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind: "photo",
		Confidence:      60,
	}
}

// reasonCreatorCollab —— 合作方 / 商家。
//
// 核心目的：促成交 → 展示专业能力 / 作品 / 案例。
//   - 高合作意向（>=60）→ 推 portfolio / capability 推动合作成交
//   - 中等意向 → 推 intro / services 建立初步信任
//   - 低意向 → 推 personal/real-life 先建立关系
func (r *RuleReasoner) reasonCreatorCollab(s ObjectSignals) ReasonedDecision {
	if s.CollaborationIntent >= 60 {
		return ReasonedDecision{
			Goal:            "推动合作成交",
			CurrentState:    fmt.Sprintf("合作意向 %d%% · 主页浏览 %d 次 · 关系 %d 天", s.CollaborationIntent, s.ProfileViewsLast7d, s.RelationshipDays),
			GapSummary:      "对方在评估能力，需要直接的作品 / 案例展示",
			NextShowAt:      r.now().Add(4 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "portfolio/capability",
			Confidence:      90,
		}
	}
	if s.CollaborationIntent >= 30 {
		return ReasonedDecision{
			Goal:            "建立初步信任",
			CurrentState:    fmt.Sprintf("合作意向 %d%% · 距上次聊天 %d 天", s.CollaborationIntent, s.DaysSinceLastChat),
			GapSummary:      "对方在观望，需要服务介绍 / 真实案例",
			NextShowAt:      r.now().Add(10 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "intro/services",
			Confidence:      72,
		}
	}
	return ReasonedDecision{
		Goal:            "先建立关系",
		CurrentState:    fmt.Sprintf("合作意向 %d%% · 关系早期", s.CollaborationIntent),
		GapSummary:      "信任不足，先以真实日常建立连接",
		NextShowAt:      r.now().Add(20 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind: "personal/real-life",
		Confidence:      55,
	}
}
