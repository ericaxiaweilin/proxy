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
	// SideSpaceGap：R15.42 起 — 副空间缺口描述。
	//
	// 双轨架构：
	//   - 主空间 gap = GapSummary（"你需要发什么"）— UGC 维护
	//   - 副空间 gap = SideSpaceGap（"副空间还缺什么"）— 促成交
	//
	// 适用于 CREATOR_COLLAB 关系（合作方）；其他关系为空字符串
	// （非合作方不需要副空间）。
	SideSpaceGap string
	// SideSpaceKind：R15.42 起 — 副空间推荐内容类型
	//
	// 允许值同 RecommendedKind 集合（白名单复用）。
	// CREATOR_COLLAB 默认 "portfolio/capability"；非合作方为空字符串。
	SideSpaceKind string
	// SideSpaceFulfilled：R15.44 起 — 副空间缺口是否已被填上。
	//
	// true 意味着副空间已经有足够多与 SideSpaceKind 同类的内容，
	// AI 不再推 "还缺 X"。Mobile UI 可以展示绿色“已足够”状态。
	//
	// 只对 CREATOR_COLLAB 关系有意义，其他关系为 false。
	SideSpaceFulfilled bool
}

// SideSpaceStats 是 R15.44 新增的副空间实时统计，由 Service.List
// 在调 Reasoner 之前从 SideSpaceRepository.List() 算出来。
//
// 设计：Reasoner 是纯函数（signals + stats + relation → decision），
// 不直接访问 Repository，保持可测性。
type SideSpaceStats struct {
	// Total：副空间 post 总数
	Total int
	// KindCounts：按 kind 统计的 post 数量
	KindCounts map[string]int
}

// Reasoner 接口。
//
// Phase 1.5 实现：RuleReasoner（确定性规则）。
// Phase 2 计划：LLMReasoner，input 同 ObjectSignals + SideSpaceStats +
// Relation，output 同 ReasonedDecision。保持接口稳定，Service.List 不动。
//
// R15.44 起 Reason 签名加 SideSpaceStats 参数，让副空间缺口判定
// 实时反映副空间现状（不再仅靠 ShownAssetCount mock）。
// R15.51: 加 FacetConfig 参数 — 运营可调阈值 (sideSpace threshold / priority
// boundary / confidence floor) 从 config 读。
type Reasoner interface {
	Reason(signals ObjectSignals, relation string, sideSpace SideSpaceStats, config FacetConfig) ReasonedDecision
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
// 等）。signals 是 Object.Signals。sideSpace 是 R15.44 起的副空间
// 实时统计（Service.List 算好传入）。config 是 R15.51 运营阈值。
func (r *RuleReasoner) Reason(signals ObjectSignals, relation string, sideSpace SideSpaceStats, config FacetConfig) ReasonedDecision {
	switch relation {
	case "BUILDING_TRUST":
		return r.reasonBuildingTrust(signals, sideSpace, config)
	case "SHARED_INTEREST":
		return r.reasonSharedInterest(signals, sideSpace, config)
	case "CREATOR_COLLAB":
		return r.reasonCreatorCollab(signals, sideSpace, config)
	default:
		// 未知 relation：返回低置信度的通用决策，不静默失败。
		return ReasonedDecision{
			Goal:              "持续连接",
			CurrentState:      fmt.Sprintf("已展示 %d 条 · 本周新增 %d 个素材", signals.ShownAssetCount, signals.FreshAssetCount),
			GapSummary:        "保持节奏",
			NextShowAt:        r.now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind:   "personal/real-life",
			Confidence:        30,
			SideSpaceGap:      "",
			SideSpaceKind:     "",
			SideSpaceFulfilled: false,
		}
	}
}

// reasonBuildingTrust —— 重点关系。
//
// 核心目的：拉近距离 / 建立信任 → 真实日常、软肋、互动。
//   - 7 天没聊 + 未回复 → 对方在观望，给"真实软肋"破冰
//   - 高 ProfileViews + 久未互动 → 对方关注但沉默，给"近况"
//   - 其他 → 默认真实日常
//
// 重点关系无副空间概念（SideSpaceGap = ""）。
func (r *RuleReasoner) reasonBuildingTrust(s ObjectSignals, _ SideSpaceStats, _ FacetConfig) ReasonedDecision {
	if s.DaysSinceLastChat >= 7 && s.UnrepliedMessageCount > 0 {
		return ReasonedDecision{
			Goal:            "打破沉默，重建互动",
			CurrentState:    fmt.Sprintf("已 %d 天未聊 · 对方 %d 条未回 · 主页浏览 %d 次", s.DaysSinceLastChat, s.UnrepliedMessageCount, s.ProfileViewsLast7d),
			GapSummary:      "对方在观望，需要一条「真实软肋」破冰",
			NextShowAt:      r.now().Add(2 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "personal/honest",
			Confidence:      88,
			SideSpaceGap:    "",
			SideSpaceKind:   "",
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
			SideSpaceGap:    "",
			SideSpaceKind:   "",
		}
	}
	return ReasonedDecision{
		Goal:            "持续加深信任",
		CurrentState:    fmt.Sprintf("互动稳定 · 已展示 %d 条 · 关系 %d 天", s.ShownAssetCount, s.RelationshipDays),
		GapSummary:      "保持真实日常节奏",
		NextShowAt:      r.now().Add(12 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind: "personal/real-life",
		Confidence:      65,
		SideSpaceGap:    "",
		SideSpaceKind:   "",
	}
}

// reasonSharedInterest —— 朋友 / 共同兴趣。
//
// 核心目的：激活共同兴趣 → 城市 / 摄影 / 共同回忆。
//   - 有 fresh asset + 短期互动 → 推 city/travel 激活
//   - 有共同活动 → 推 shared-experience
//   - 默认 photo（摄影是常见 shared interest）
//
// 朋友无副空间概念（SideSpaceGap = ""）。
func (r *RuleReasoner) reasonSharedInterest(s ObjectSignals, _ SideSpaceStats, _ FacetConfig) ReasonedDecision {
	if s.FreshAssetCount > 0 && s.DaysSinceLastChat <= 3 {
		return ReasonedDecision{
			Goal:            "趁热打铁激活共同兴趣",
			CurrentState:    fmt.Sprintf("本周新增 %d 个素材 · 距上次聊天 %d 天", s.FreshAssetCount, s.DaysSinceLastChat),
			GapSummary:      "有新鲜城市 / 旅行内容未推",
			NextShowAt:      r.now().Add(3 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind: "city/travel",
			Confidence:      85,
			SideSpaceGap:    "",
			SideSpaceKind:   "",
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
			SideSpaceGap:    "",
			SideSpaceKind:   "",
		}
	}
	return ReasonedDecision{
		Goal:            "持续共同兴趣连接",
		CurrentState:    fmt.Sprintf("已展示 %d 条 · 距上次聊天 %d 天", s.ShownAssetCount, s.DaysSinceLastChat),
		GapSummary:      "需要新内容激活对话",
		NextShowAt:      r.now().Add(18 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind: "photo",
		Confidence:      60,
		SideSpaceGap:    "",
		SideSpaceKind:   "",
	}
}

// reasonCreatorCollab —— 合作方 / 商家。
//
// 核心目的：促成交 → 展示专业能力 / 作品 / 案例。
//   - 高合作意向（>=60）→ 推 portfolio / capability 推动合作成交
//   - 中等意向 → 推 intro / services 建立初步信任
//   - 低意向 → 推 personal/real-life 先建立关系
//
// R15.42 起，合作方额外输出 SideSpaceGap + SideSpaceKind（双轨）。
// R15.44 起，缺口判定用 SideSpaceStats 实时数据（不再仅看
// signals.ShownAssetCount）。阈值：
//   - 副空间 portfolio/capability >= 2 → 副空间已足够，gap 变为鼓励语
//   - 副空间 intro/services >= 2 → 副空间已足够
//   - 副空间 0 条 → 推 "还缺第一个"
//   - 1 条 → 推 "还差 1 个"
func (r *RuleReasoner) reasonCreatorCollab(s ObjectSignals, ss SideSpaceStats, config FacetConfig) ReasonedDecision {
	if s.CollaborationIntent >= config.PriorityHighBoundary {
		// 高意向：盯 portfolio/capability
		count := ss.KindCounts["portfolio/capability"]
		sideGap, fulfilled := sideSpaceGapForKind(ss, "portfolio/capability", config.SideSpaceHighThreshold)
		if fulfilled {
			sideGap = fmt.Sprintf("副空间已有 %d 个作品 / %d 个 portfolio/capability, 已足够, 下一个可以拓展合作案例对比图", ss.Total, count)
		}
		return ReasonedDecision{
			Goal:              "推动合作成交",
			CurrentState:      fmt.Sprintf("合作意向 %d%% · 主页浏览 %d 次 · 关系 %d 天 · 副空间 %d 条", s.CollaborationIntent, s.ProfileViewsLast7d, s.RelationshipDays, ss.Total),
			GapSummary:        "对方在评估能力，需要直接的作品 / 案例展示",
			NextShowAt:        r.now().Add(4 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind:   "portfolio/capability",
			Confidence:        90,
			SideSpaceGap:      sideGap,
			SideSpaceKind:     "portfolio/capability",
			SideSpaceFulfilled: fulfilled,
		}
	}
	if s.CollaborationIntent >= config.PriorityMidBoundary {
		// 中意向：盯 intro/services
		count := ss.KindCounts["intro/services"]
		sideGap, fulfilled := sideSpaceGapForKind(ss, "intro/services", config.SideSpaceMidThreshold)
		if fulfilled {
			sideGap = fmt.Sprintf("副空间已有 %d 个作品 / %d 个 intro/services, 已足够, 下一个可以拓展服务过程近景", ss.Total, count)
		}
		return ReasonedDecision{
			Goal:              "建立初步信任",
			CurrentState:      fmt.Sprintf("合作意向 %d%% · 距上次聊天 %d 天 · 副空间 %d 条", s.CollaborationIntent, s.DaysSinceLastChat, ss.Total),
			GapSummary:        "对方在观望，需要服务介绍 / 真实案例",
			NextShowAt:        r.now().Add(10 * time.Hour).UTC().Format(time.RFC3339),
			RecommendedKind:   "intro/services",
			Confidence:        72,
			SideSpaceGap:      sideGap,
			SideSpaceKind:     "intro/services",
			SideSpaceFulfilled: fulfilled,
		}
	}
	// 低意向：副空间还没起动，缺口为空（无需副空间运营）
	return ReasonedDecision{
		Goal:              "先建立关系",
		CurrentState:      fmt.Sprintf("合作意向 %d%% · 关系早期", s.CollaborationIntent),
		GapSummary:        "信任不足，先以真实日常建立连接",
		NextShowAt:        r.now().Add(20 * time.Hour).UTC().Format(time.RFC3339),
		RecommendedKind:   "personal/real-life",
		Confidence:        55,
		SideSpaceGap:      "",
		SideSpaceKind:     "",
		SideSpaceFulfilled: false,
	}
}

// sideSpaceGapForKind 算某个 kind 的副空间缺口 + 是否已足够。
//
// 规则：
//   - 0 条  → 缺口 = "副空间还没有, 需加第一个" + fulfilled = false
//   - 1 条  → 缺口 = "副空间有 1 个, 还差 1 个" + fulfilled = false
//   - >= threshold 条 → fulfilled = true（缺口文由 caller 写）
func sideSpaceGapForKind(ss SideSpaceStats, kind string, threshold int) (string, bool) {
	count := ss.KindCounts[kind]
	if count >= threshold {
		return "", true
	}
	if count == 0 {
		return "副空间还没有, 加第一个 " + kind + " 类型的作品", false
	}
	return fmt.Sprintf("副空间已有 %d 个, 还差 %d 个 %s 类型", count, threshold-count, kind), false
}
