// Package aisystem 是平台的 **AI 系统登记册**：把平台上在跑的每一个 AI 系统
// 登记在代码里，写明它的风险等级、分级依据、能力面、以及按法律要求必须有的
// 保护措施 —— 以及**今天实际有哪些**。
//
// 为什么需要它（法律依据，逐条可核）：
//
//	Luật Trí tuệ nhân tạo 134/2025/QH15（2026-03-01 生效）
//	  Điều 9.1  按风险分三级：cao（高）/ trung bình（中）/ thấp（低）
//	  Điều 9.2  分级标准：对人权·安全·安防的影响程度；使用领域（尤其
//	            必要领域或直接关系公共利益）；用户范围与影响规模
//	  Điều 10.1 **提供方在投入使用前自行分级**，且必须附分级档案
//	  Điều 10.3 分级为**中或高**的系统，投入使**用前**必须通过「一站式
//	            门户」把分级结果**报送**科技部；低风险只是「鼓励」公开
//	  Điều 10.5 按等级决定检查/监督方式
//	  Điều 11.1 直接与人交互的 AI，须让用户**认得出**对面是 AI
//	  Điều 11.2 系统生成的内容须带**机器可读标记**
//	  Điều 11.3 部署方须明示内容由 AI 生成（可能引起混淆时）
//	  Điều 11.4 模拟真人外形/声音/言语的内容须**加标注**
//	  Điều 12   事故的发现、处置与严重事故报告
//
//	Nghị định 330/2026/NĐ-CP（2026-08-19 发布即生效）
//	  Điều 67.2(d) 必须按风险等级对 AI 系统分级并据此设保护措施
//	               （5,000–7,000 万 VND）
//	  Điều 67.2(đ) 用 AI 推理结果识别或帮助识别特定个人时，须施加保护
//	  Điều 67.3(b) 会做出影响权利的自动决定的系统，须允许要求**人工复核**
//	               （7,000 万–1 亿 VND）
//
// 这个包要解决的具体问题：**在此之前，「AI 系统」在这个仓里根本不是一个
// 实体。** 有 5 个平台 AI 人格、有 AI 代回复、有 AI 生成媒体、有分身、
// 有从照片读面部特征、有模型底座 —— 但没有任何一处能回答「我们一共跑了
// 几个 AI 系统、各自什么等级、按法律该有哪些措施、现在缺哪些」。
// Điều 10.1 的第一句就是「提供方**自行分级**」—— 分级这个动作本身没有产物，
// 就等于没做。
//
// 三条设计上的硬约束（与本仓其他合规件一致）：
//
//  1. **分级由依据推导，不允许独立声明。** System 声明的是 Basis
//     （Điều 9.1 的哪一点），Tier() 从 Basis 推导。这样「声明成低风险、
//     依据却是 9.1(a)」这种自相矛盾在类型层面就写不出来。
//
//  2. **未知即 UNCLASSIFIED，绝不回落成 LOW。** TierUnclassified 不是法定
//     等级（IsLegalTier() 为 false），它是「没有记录」这个事实。法律上
//     「没分级」和「分成了低风险」是两回事，UI/接口上必须长得不一样。
//
//  3. **Implemented 只写今天真有证据的。** 每条已实现的措施都要在
//     Evidence 里点名它的落点（表 / 命令 / 测试）。缺的那些进 Missing，
//     由 Required() 推导，不靠人记得去更新。
//
// 这个包**不做运行时拦截**。它不是 kill switch —— 把在跑的 AI 系统停掉是
// 经营决定（Điều 67.4(b) 的停运是**处罚**，不是自助动作），而现有的
// compliance kill switch 已经能在需要时闸住 AI_MEDIA。
// 它的作用是**如实登记 + 可查询**：让「哪些系统不该带着这些缺口继续跑」
// 从「没人知道」变成「运维和审计随时能查到一个带法律条文的清单」。
package aisystem

import (
	"fmt"
	"sort"
	"strings"
)

// Tier 是 AI 系统的风险等级。取值对齐 Luật AI 134/2025 Điều 9.1 的三级，
// 外加一个**不是法定等级**的 UNCLASSIFIED。
type Tier string

const (
	// TierHigh — Điều 9.1(a) rủi ro cao：可能对生命、健康、组织/个人的
	// 权利与合法利益、国家利益、公共利益、国家安全造成**显著损害**。
	TierHigh Tier = "HIGH"
	// TierMedium — Điều 9.1(b) rủi ro trung bình：因为无法识别交互对象是
	// AI 系统、或内容由该系统生成，而可能引起混淆、影响或操纵使用者。
	TierMedium Tier = "MEDIUM"
	// TierLow — Điều 9.1(c) rủi ro thấp：不属于 a、b 两点的。
	TierLow Tier = "LOW"
	// TierUnclassified 是**「没有记录」**，不是法律上的第三个等级。
	// Điều 10.1 要求提供方在投入使用前自行分级；没分级 = 违法状态，
	// 而不是「默认低风险」。任何把未知回落成 TierLow 的写法都是 bug。
	TierUnclassified Tier = "UNCLASSIFIED"
)

// LegalTiers 是法律承认的等级，不含 UNCLASSIFIED。用于「是否存在一个
// 有效的分级记录」这类判断。
var LegalTiers = []Tier{TierHigh, TierMedium, TierLow}

// IsLegalTier 报告这个取值是不是 Điều 9.1 承认的等级。
func (t Tier) IsLegalTier() bool {
	for _, legal := range LegalTiers {
		if t == legal {
			return true
		}
	}
	return false
}

// Rank 给出等级的轻重次序，UNCLASSIFIED 最小。用于「至少要到某一级」的
// 比较；不要用它替代 IsLegalTier。
func (t Tier) Rank() int {
	switch t {
	case TierHigh:
		return 3
	case TierMedium:
		return 2
	case TierLow:
		return 1
	default:
		return 0
	}
}

// Criterion 是 Điều 9.1 的三个分级依据点。System 声明的是它，不是 Tier。
type Criterion string

const (
	// CriterionSignificantHarm — Điều 9.1(a)。
	CriterionSignificantHarm Criterion = "SIGNIFICANT_HARM"
	// CriterionConfusionOrManipulation — Điều 9.1(b)。注意这一点的构成要件
	// 是「因为认不出交互对象是 AI / 内容由 AI 生成，而可能引起混淆、
	// 影响或操纵」—— 它是**系统性质**，不是「披露做没做」。披露（Điều 11.1）
	// 是这一级的**保护措施**，不是把等级降下来的理由。
	CriterionConfusionOrManipulation Criterion = "CONFUSION_OR_MANIPULATION"
	// CriterionResidualLow — Điều 9.1(c)。
	CriterionResidualLow Criterion = "RESIDUAL_LOW"
)

// Tier 从依据推导等级。这是唯一产生 Tier 的入口 —— 想让某个系统变成
// 低风险，只能改它的 Basis，改不动「结论」。
func (c Criterion) Tier() Tier {
	switch c {
	case CriterionSignificantHarm:
		return TierHigh
	case CriterionConfusionOrManipulation:
		return TierMedium
	case CriterionResidualLow:
		return TierLow
	default:
		return TierUnclassified
	}
}

// Law 给出该依据点在法律里的准确出处，用于报错与运维界面。
func (c Criterion) Law() string {
	switch c {
	case CriterionSignificantHarm:
		return "Luật AI 134/2025 Điều 9.1(a)"
	case CriterionConfusionOrManipulation:
		return "Luật AI 134/2025 Điều 9.1(b)"
	case CriterionResidualLow:
		return "Luật AI 134/2025 Điều 9.1(c)"
	default:
		return "Luật AI 134/2025 Điều 9.1"
	}
}

// Factor 是 Điều 9.2 的分级考量因素。它不改变等级，但必须写下来 ——
// Điều 9.2 要求分级「基于」这些因素，一个只有结论没有因素的档案
// 在 Điều 10.6「申报不实」上是站不住的。
type Factor string

const (
	FactorImpactOnRightsSafetySecurity    Factor = "IMPACT_ON_RIGHTS_SAFETY_SECURITY"
	FactorEssentialOrPublicInterestSector Factor = "ESSENTIAL_OR_PUBLIC_INTEREST_SECTOR"
	FactorUserScopeAndScale               Factor = "USER_SCOPE_AND_SCALE"
)

var AllFactors = []Factor{
	FactorImpactOnRightsSafetySecurity,
	FactorEssentialOrPublicInterestSector,
	FactorUserScopeAndScale,
}

// Capability 是系统**能做什么**。保护措施由「等级 × 能力」共同决定 ——
// Điều 11 的透明义务看的是能力（是否直接交互、是否生成内容、是否模拟真人），
// Điều 10.3 / 10.5 看的是等级。把两轴分开，才不会出现「低风险所以不用
// 标注 AI 生成」这种错误推论。
type Capability string

const (
	// CapabilityDirectInteraction — Điều 11.1：直接与人交互。
	CapabilityDirectInteraction Capability = "DIRECT_INTERACTION"
	// CapabilityGeneratesContent — Điều 11.2 / 11.3：生成内容。
	CapabilityGeneratesContent Capability = "GENERATES_CONTENT"
	// CapabilitySimulatesRealPerson — Điều 11.4：模拟真人的外形/声音/言语。
	CapabilitySimulatesRealPerson Capability = "SIMULATES_REAL_PERSON"
	// CapabilityIdentifiesPerson — NĐ 330/2026 Điều 67.2(đ)：用 AI 推理
	// 结果识别或帮助识别特定个人（生物特征类）。
	CapabilityIdentifiesPerson Capability = "IDENTIFIES_PERSON"
	// CapabilityAutomatedRightsAffectingDecision — Điều 67.3(b)：做出影响
	// 组织/个人权利与合法利益的自动决定。
	CapabilityAutomatedRightsAffectingDecision Capability = "AUTOMATED_RIGHTS_AFFECTING_DECISION"
)

var AllCapabilities = []Capability{
	CapabilityDirectInteraction,
	CapabilityGeneratesContent,
	CapabilitySimulatesRealPerson,
	CapabilityIdentifiesPerson,
	CapabilityAutomatedRightsAffectingDecision,
}

// Protection 是一条具体的保护措施。每条都对应法律里的一句话，Law() 给出出处。
type Protection string

const (
	// ProtectionClassificationDossier — Điều 10.1：投入使用前自行分级，
	// 且**附分级档案**。
	ProtectionClassificationDossier Protection = "CLASSIFICATION_DOSSIER"
	// ProtectionPreUseNotification — Điều 10.3：中/高风险须在投入使用前
	// 把分级结果报送科技部（一站式门户）。
	ProtectionPreUseNotification Protection = "PRE_USE_NOTIFICATION"
	// ProtectionPeriodicInspection — Điều 10.5(a)：高风险须定期检查。
	ProtectionPeriodicInspection Protection = "PERIODIC_INSPECTION"
	// ProtectionSampleAudit — Điều 10.5(b)：中风险须以报告/抽检/独立评估
	// 方式监督。
	ProtectionSampleAudit Protection = "SAMPLE_AUDIT"
	// ProtectionIncidentDrivenReview — Điều 10.5(c)：低风险只在出事故、
	// 被反映或需要时才检查 —— 法律明确说不要给它加不必要的义务。
	ProtectionIncidentDrivenReview Protection = "INCIDENT_DRIVEN_REVIEW"
	// ProtectionInteractionDisclosure — Điều 11.1。
	ProtectionInteractionDisclosure Protection = "INTERACTION_DISCLOSURE"
	// ProtectionMachineReadableMarking — Điều 11.2。
	ProtectionMachineReadableMarking Protection = "MACHINE_READABLE_MARKING"
	// ProtectionAIContentNotice — Điều 11.3。
	ProtectionAIContentNotice Protection = "AI_CONTENT_NOTICE"
	// ProtectionRealPersonSimulationLabel — Điều 11.4。
	ProtectionRealPersonSimulationLabel Protection = "REAL_PERSON_SIMULATION_LABEL"
	// ProtectionOngoingTransparency — Điều 11.5：透明信息须在整个提供
	// 期间维持。
	ProtectionOngoingTransparency Protection = "ONGOING_TRANSPARENCY"
	// ProtectionIncidentDetectionAndRemedy — Điều 12.1。
	ProtectionIncidentDetectionAndRemedy Protection = "INCIDENT_DETECTION_AND_REMEDY"
	// ProtectionSeriousIncidentReport — Điều 12.2。
	ProtectionSeriousIncidentReport Protection = "SERIOUS_INCIDENT_REPORT"
	// ProtectionHumanControlAndIntervention — Điều 4：保证人对 AI 系统的
	// 每一个决定与行为保有控制与干预能力。
	ProtectionHumanControlAndIntervention Protection = "HUMAN_CONTROL_AND_INTERVENTION"
	// ProtectionIdentificationInferenceProtection — NĐ 330/2026 Điều 67.2(đ)。
	ProtectionIdentificationInferenceProtection Protection = "IDENTIFICATION_INFERENCE_PROTECTION"
	// ProtectionHumanReviewRequest — NĐ 330/2026 Điều 67.3(b)：必须允许
	// 要求人工复核。
	ProtectionHumanReviewRequest Protection = "HUMAN_REVIEW_REQUEST"
)

var AllProtections = []Protection{
	ProtectionClassificationDossier,
	ProtectionPreUseNotification,
	ProtectionPeriodicInspection,
	ProtectionSampleAudit,
	ProtectionIncidentDrivenReview,
	ProtectionInteractionDisclosure,
	ProtectionMachineReadableMarking,
	ProtectionAIContentNotice,
	ProtectionRealPersonSimulationLabel,
	ProtectionOngoingTransparency,
	ProtectionIncidentDetectionAndRemedy,
	ProtectionSeriousIncidentReport,
	ProtectionHumanControlAndIntervention,
	ProtectionIdentificationInferenceProtection,
	ProtectionHumanReviewRequest,
}

// Law 给出该措施的法律出处。运维界面直接显示这句，避免「要求」和
// 「条文」在传递中脱钩。
func (p Protection) Law() string {
	switch p {
	case ProtectionClassificationDossier:
		return "Luật AI 134/2025 Điều 10.1"
	case ProtectionPreUseNotification:
		return "Luật AI 134/2025 Điều 10.3"
	case ProtectionPeriodicInspection:
		return "Luật AI 134/2025 Điều 10.5(a)"
	case ProtectionSampleAudit:
		return "Luật AI 134/2025 Điều 10.5(b)"
	case ProtectionIncidentDrivenReview:
		return "Luật AI 134/2025 Điều 10.5(c)"
	case ProtectionInteractionDisclosure:
		return "Luật AI 134/2025 Điều 11.1"
	case ProtectionMachineReadableMarking:
		return "Luật AI 134/2025 Điều 11.2"
	case ProtectionAIContentNotice:
		return "Luật AI 134/2025 Điều 11.3"
	case ProtectionRealPersonSimulationLabel:
		return "Luật AI 134/2025 Điều 11.4"
	case ProtectionOngoingTransparency:
		return "Luật AI 134/2025 Điều 11.5"
	case ProtectionIncidentDetectionAndRemedy:
		return "Luật AI 134/2025 Điều 12.1"
	case ProtectionSeriousIncidentReport:
		return "Luật AI 134/2025 Điều 12.2"
	case ProtectionHumanControlAndIntervention:
		return "Luật AI 134/2025 Điều 4"
	case ProtectionIdentificationInferenceProtection:
		return "Nghị định 330/2026/NĐ-CP Điều 67.2(đ)"
	case ProtectionHumanReviewRequest:
		return "Nghị định 330/2026/NĐ-CP Điều 67.3(b)"
	default:
		return "Luật AI 134/2025"
	}
}

// NotificationStatus 是 Điều 10.3 的报送状态。它是**与等级并列的独立轴**：
// 等级决定「要不要报」，状态记录「报了没有」。两者混成一个字段，
// 就会出现「中风险 = 已合规」这种把义务当结果的误读。
type NotificationStatus string

const (
	// NotificationNotRequired — 低风险。Điều 10.3 对低风险只是「鼓励公开」，
	// 不是报送义务。
	NotificationNotRequired NotificationStatus = "NOT_REQUIRED"
	// NotificationNotFiled — 该报但**还没报**。Điều 10.3 的措辞是
	// 「trước khi đưa vào sử dụng」（投入使用**前**），所以这个状态意味着
	// 系统本不该带着它继续跑。
	NotificationNotFiled NotificationStatus = "NOT_FILED"
	// NotificationFiled — 已报送，需带 reference 与日期。
	NotificationFiled NotificationStatus = "FILED"
)

// NotificationAuthority 是 Điều 10.3 指定的受理机关。
const NotificationAuthority = "Bộ Khoa học và Công nghệ (MoST)"

// Notification 记录报送事实。低风险时 Status 为 NOT_REQUIRED，其余字段留空。
type Notification struct {
	Status    NotificationStatus
	Authority string
	Portal    string
	FiledAt   string
	Reference string
}

// SystemID 是系统的稳定标识。
type SystemID string

const (
	// SystemAIPersona — AI 人格：平台陪伴人格（晴晴/安安/米娅/林夏/七喜）
	// 与用户自建创作人格（CREATIVE）。两者在 Điều 9.1(b) 下是同一类系统，
	// 只差归属，因此登记为一条。
	// 落点：apps/mobile/src/ai-companion-catalog.ts（personaType
	// "PLATFORM_AI"、aiStatus "AI"）、internal/aipersona
	// （PersonaTypePlatformAI / PersonaTypeCreative，POST /v1/ai/personas）。
	SystemAIPersona SystemID = "AI_PERSONA"
	// SystemAIStandInReply — AI 替真人回复。落点：migrations/120
	// （authored_by IN ('ai_stand_in')）、internal/conversation/service.go。
	SystemAIStandInReply SystemID = "AI_STAND_IN_REPLY"
	// SystemAIMediaGeneration — AI 生成媒体（图像/视频）。落点：
	// migrations/108（media.media_assets.ai_generation_source 等 5 列）、
	// internal/media。
	SystemAIMediaGeneration SystemID = "AI_MEDIA_GENERATION"
	// SystemUserTwinLikeness — 用户 AI 分身（likeness 代理）。落点：
	// internal/aipersona（PersonaTypeUserTwin + twin_consents，LC-07）。
	SystemUserTwinLikeness SystemID = "USER_TWIN_LIKENESS"
	// SystemAIFaceFeatureInference — AI 从本人照片推理面部特征。
	// 落点：migrations/123（ai.user_models.face_features）。
	SystemAIFaceFeatureInference SystemID = "AI_FACE_FEATURE_INFERENCE"
	// SystemAIContentDrafting — 模型底座支撑的文本起草/摘要。落点：
	// internal/modelstack（Port/Service，未配置时 fail-closed）、
	// internal/twininsight 的 summary:refresh、storeonboarding 的
	// SuggestStoreRecommendation。
	SystemAIContentDrafting SystemID = "AI_CONTENT_DRAFTING"
)

// AllSystemIDs 是登记册的闭集。加系统 = 加一条 Register 记录，
// 并且必须在 register_test.go 里给出覆盖它的用例。
var AllSystemIDs = []SystemID{
	SystemAIPersona,
	SystemAIStandInReply,
	SystemAIMediaGeneration,
	SystemUserTwinLikeness,
	SystemAIFaceFeatureInference,
	SystemAIContentDrafting,
}

// System 是登记册里的一条记录。
type System struct {
	ID   SystemID
	Name string
	// Basis 是 Điều 9.1 的分级依据。Tier() 由它推导 —— 见 Criterion.Tier。
	Basis Criterion
	// BasisNote 写清这次判断的事实与边界。它不是注释，是 Điều 10.1
	// 「分级档案」的正文；分级结论有争议时，能拿出来的就是这段话。
	BasisNote string
	// Factors 是 Điều 9.2 的考量因素。
	Factors []Factor
	// Capabilities 决定 Điều 11 / 67.2(đ) / 67.3(b) 那一轴的要求。
	Capabilities []Capability
	// Implemented 是**今天真的有落点**的保护措施。它刻意不由推导得出：
	// 推导能算出「该有什么」，算不出「实际有什么」。
	Implemented []Protection
	// Evidence 为每条 Implemented 点名落点。没有落点的措施不许写进
	// Implemented —— register_test.go 会逐条检查。
	Evidence map[Protection]string
	// Notification 是 Điều 10.3 的报送事实。
	Notification Notification
}

// Tier 从 Basis 推导。见包注释约束 1。
func (s System) Tier() Tier { return s.Basis.Tier() }

// Required 是「按法律必须有的保护措施」，由等级与能力共同决定。
//
// 注意它**不包含** Implemented 的任何信息 —— 这正是它能用来做差距分析的
// 原因。想少要一条措施，只能去改等级或能力（即改法律事实），
// 不能靠「这条我们没做」把它从要求里拿掉。
func (s System) Required() []Protection {
	set := map[Protection]bool{
		// Điều 10.1 对**所有**等级都要求「投入使用前自行分级并附档案」。
		ProtectionClassificationDossier: true,
		// Điều 12.1 / 12.2 不分等级。
		ProtectionIncidentDetectionAndRemedy: true,
		ProtectionSeriousIncidentReport:      true,
		// Điều 4 的原则对**每一个** AI 系统成立。
		ProtectionHumanControlAndIntervention: true,
	}

	switch s.Tier() {
	case TierHigh:
		// Điều 10.3：中/高须投入使用前报送。Điều 10.5(a)：高风险定期检查。
		set[ProtectionPreUseNotification] = true
		set[ProtectionPeriodicInspection] = true
	case TierMedium:
		set[ProtectionPreUseNotification] = true
		set[ProtectionSampleAudit] = true
	case TierLow:
		// Điều 10.3 对低风险是「khuyến khích」（鼓励）公开，不是义务；
		// Điều 10.5(c) 明确不要给低风险加不必要的义务。
		set[ProtectionIncidentDrivenReview] = true
	default:
		// UNCLASSIFIED：没有分级就没有依据决定该有哪些措施。
		// 这里**不猜**。Assess 会把「未分级」本身作为 blocker 报出去，
		// 而不是伪造一套要求。除了上面四条对全体成立的要求之外，
		// 未知等级的系统不额外要求任何东西 —— 因为无从要求。
	}

	transparency := false
	for _, c := range s.Capabilities {
		switch c {
		case CapabilityDirectInteraction:
			set[ProtectionInteractionDisclosure] = true
			transparency = true
		case CapabilityGeneratesContent:
			set[ProtectionMachineReadableMarking] = true
			set[ProtectionAIContentNotice] = true
			transparency = true
		case CapabilitySimulatesRealPerson:
			set[ProtectionRealPersonSimulationLabel] = true
			transparency = true
		case CapabilityIdentifiesPerson:
			set[ProtectionIdentificationInferenceProtection] = true
		case CapabilityAutomatedRightsAffectingDecision:
			set[ProtectionHumanReviewRequest] = true
		}
	}
	if transparency {
		set[ProtectionOngoingTransparency] = true
	}

	out := make([]Protection, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// Missing 是 Required 里今天没有落点的那些。返回值已排序。
func (s System) Missing() []Protection {
	have := make(map[Protection]bool, len(s.Implemented))
	for _, p := range s.Implemented {
		have[p] = true
	}
	out := make([]Protection, 0)
	for _, p := range s.Required() {
		if !have[p] {
			out = append(out, p)
		}
	}
	return out
}

// BlockerCode 是 blocker 的稳定标识，供运维/审计做条件判断，
// 不要去匹配 Detail 的文案。
type BlockerCode string

const (
	// BlockerNotRegistered — 这个 ID 根本不在登记册里。
	BlockerNotRegistered BlockerCode = "NOT_REGISTERED"
	// BlockerUnclassified — 在登记册里，但没有有效的分级依据。
	BlockerUnclassified BlockerCode = "UNCLASSIFIED"
	// BlockerDossierMissing — Điều 10.1 的分级档案缺失。
	BlockerDossierMissing BlockerCode = "CLASSIFICATION_DOSSIER_MISSING"
	// BlockerNotificationMissing — Điều 10.3 的报送未完成。
	BlockerNotificationMissing BlockerCode = "PRE_USE_NOTIFICATION_MISSING"
	// BlockerProtectionMissing — 其余按等级/能力要求的措施缺失。
	BlockerProtectionMissing BlockerCode = "PROTECTION_MISSING"
)

// Blocker 是一条「为什么这个系统现在不该带着现状继续跑」的说明。
// 每一条都带法律出处，避免运维只看到一个代号。
type Blocker struct {
	Code    BlockerCode
	Law     string
	Detail  string
	Missing []Protection
}

// Assessment 是一个系统的完整体检结果。Found 用来区分「查不到这个系统」
// 和「系统存在但有问题」—— 这两种在界面上必须长得不一样。
type Assessment struct {
	ID           SystemID
	Name         string
	Found        bool
	Tier         Tier
	Basis        Criterion
	BasisNote    string
	Factors      []Factor
	Capabilities []Capability
	Required     []Protection
	Implemented  []Protection
	Missing      []Protection
	Notification Notification
	// ReadyForUse 为 true 当且仅当 Blockers 为空。
	ReadyForUse bool
	Blockers    []Blocker
}

// register 是登记册本体。顺序即展示顺序。
var register = []System{
	{
		ID:    SystemAIPersona,
		Name:  "AI 人格（平台陪伴人格 + 用户创作人格）",
		Basis: CriterionConfusionOrManipulation,
		BasisNote: "人格以真人化的名字、头像与口吻直接和用户聊天，" +
			"构成 Điều 9.1(b) 的典型情形：使用者可能认不出交互对象是 AI。" +
			"注意等级不因「welcomeMessage 已自报 AI」而下降 —— 自报是 " +
			"Điều 11.1 的保护措施，不是分级依据。" +
			"平台人格与用户自建的 CREATIVE 人格归为同一条：归属不同，" +
			"对使用者的混淆风险相同。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityDirectInteraction,
			CapabilityGeneratesContent,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionInteractionDisclosure,
			ProtectionAIContentNotice,
			ProtectionOngoingTransparency,
			ProtectionIncidentDetectionAndRemedy,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionInteractionDisclosure:       "apps/mobile/src/ai-companion-catalog.ts：5 个人格的 welcomeMessage 均自报「AI 虚拟女孩」",
			ProtectionAIContentNotice:             "apps/mobile/src/feed.tsx AUTHOR_TYPE_META.AI_NATIVE（label「AI生成 · 小美」、aiBadge）",
			ProtectionOngoingTransparency:         "同上，随目录下发（apps/api-go/internal/api/ai_catalog_handlers.go）",
			ProtectionIncidentDetectionAndRemedy:  "internal/compliance kill switch（AI_MEDIA 可即时闸停）",
			ProtectionHumanControlAndIntervention: "internal/aiboundary：AI 主体不得执行接单/报名/金钱/发布动作",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
	{
		ID:    SystemAIStandInReply,
		Name:  "AI 代真人回复（ai_stand_in）",
		Basis: CriterionConfusionOrManipulation,
		BasisNote: "AI 以**某个真人的身份**给对方写消息。Điều 9.1(b) 的构成要件" +
			"（认不出交互对象是 AI）在这里比陪伴人格更重，因为第三人看到的" +
			"是一个真人 ID 而不是一个 AI 账号；同时触发 Điều 11.4（模拟真人言语）。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityDirectInteraction,
			CapabilityGeneratesContent,
			CapabilitySimulatesRealPerson,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionInteractionDisclosure,
			ProtectionAIContentNotice,
			ProtectionRealPersonSimulationLabel,
			ProtectionOngoingTransparency,
			ProtectionIncidentDetectionAndRemedy,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionInteractionDisclosure:       "apps/mobile/src/surfaces/conversation.tsx：对方看到「AI 代回」、本人看到「AI 替你回的」，带 accessibilityLabel",
			ProtectionAIContentNotice:             "同上（aiStandIn 标记 + 无障碍文案）",
			ProtectionRealPersonSimulationLabel:   "apps/api-go/migrations/120_message_authored_by.sql（authored_by='ai_stand_in' 落库，UI 据此标注）",
			ProtectionOngoingTransparency:         "同上，标注随每条消息下发",
			ProtectionIncidentDetectionAndRemedy:  "internal/compliance kill switch",
			ProtectionHumanControlAndIntervention: "internal/aiboundary（AI 不得以主体身份接单/报名/付款）",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
	{
		ID:    SystemAIMediaGeneration,
		Name:  "AI 生成媒体（图像 / 视频）",
		Basis: CriterionConfusionOrManipulation,
		BasisNote: "生成的是**看起来像真实拍摄**的图片与视频，正是 Điều 9.1(b) " +
			"「nội dung do hệ thống tạo ra」所指的内容。触发 Điều 11.2（机器可读" +
			"标记）与 11.4（真人模拟标注）。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityGeneratesContent,
			CapabilitySimulatesRealPerson,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionAIContentNotice,
			ProtectionRealPersonSimulationLabel,
			ProtectionIncidentDetectionAndRemedy,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionAIContentNotice:             "apps/api-go/migrations/108_media_ai_provenance.sql（ai_generation_source / ai_generated 落库）+ internal/media 的 AI_LABEL_MISSING fail-closed",
			ProtectionRealPersonSimulationLabel:   "internal/media：AI_PERSONA 且无活体同意 → AI_LIKENESS_CONSENT_MISSING（LC-07）",
			ProtectionIncidentDetectionAndRemedy:  "internal/compliance kill switch（AI_MEDIA → PublishAIPost / GenerateAIContent）",
			ProtectionHumanControlAndIntervention: "internal/aiboundary（AI 不得直接发布）",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
	{
		ID:    SystemUserTwinLikeness,
		Name:  "用户 AI 分身（likeness 代理）",
		Basis: CriterionConfusionOrManipulation,
		BasisNote: "分身以**用户本人的形象**生成内容。对看到内容的第三人来说，" +
			"这与真人发布的区别只能靠标注 —— Điều 9.1(b) 与 Điều 11.4 同时成立。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityGeneratesContent,
			CapabilitySimulatesRealPerson,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionRealPersonSimulationLabel,
			ProtectionIncidentDetectionAndRemedy,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionRealPersonSimulationLabel:   "internal/aipersona（twin_consents / HasLiveConsent，LC-07；无活体同意则媒体不得置 READY）",
			ProtectionIncidentDetectionAndRemedy:  "internal/compliance kill switch",
			ProtectionHumanControlAndIntervention: "internal/aipersona 的 likeness consent gate：本人可撤回授权",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
	{
		ID:    SystemAIFaceFeatureInference,
		Name:  "AI 面部特征推理（本人照片 → face_features）",
		Basis: CriterionSignificantHarm,
		BasisNote: "从本人照片用 AI 读出面部特征并落库（ai.user_models.face_features）。" +
			"这是**生物特征识别类**的个人数据处理：Điều 9.1(a) 的「显著损害到" +
			"权利与合法利益」在此成立，且 NĐ 330/2026 Điều 67.2(đ) 专门把" +
			"「用 AI 推理结果识别或帮助识别特定个人」单列出来。生物特征属于" +
			"356/2025 下的敏感个人数据，一旦泄露不可撤销，因此定为**高风险**。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityIdentifiesPerson,
			CapabilityGeneratesContent,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionHumanControlAndIntervention: "internal/aipersona likeness consent（AI-MANAGE-015/016：需会话 + 本人形象授权才可建模）",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
	{
		ID:    SystemAIContentDrafting,
		Name:  "模型底座文本起草 / 摘要（含用户 AI 助理）",
		Basis: CriterionConfusionOrManipulation,
		BasisNote: "经 internal/modelstack 调用的文本生成：动态摘要（post_summary）、" +
			"分身好友洞察摘要（summary:refresh）、小美推荐草稿" +
			"（SuggestStoreRecommendation），以及 aiboundary 里 " +
			"USER_ASSISTANT 这类「起草但不得提交」的工具型助手。" +
			"生成的是供人阅读的自然语言，属于 Điều 9.1(b) 的「nội dung do " +
			"hệ thống tạo ra」。底座未配置时 fail-closed" +
			"（modelstack.ErrUnconfigured），不退化成本地假结果。",
		Factors: []Factor{
			FactorImpactOnRightsSafetySecurity,
			FactorUserScopeAndScale,
		},
		Capabilities: []Capability{
			CapabilityGeneratesContent,
		},
		Implemented: []Protection{
			ProtectionClassificationDossier,
			ProtectionHumanControlAndIntervention,
		},
		Evidence: map[Protection]string{
			ProtectionClassificationDossier:       "本文件（internal/aisystem/register.go）",
			ProtectionHumanControlAndIntervention: "internal/modelstack/port.go：底座未配置时拒绝调用（fail-closed），不伪造模型结果",
		},
		Notification: Notification{
			Status:    NotificationNotFiled,
			Authority: NotificationAuthority,
			Portal:    "Cổng thông tin điện tử một cửa về trí tuệ nhân tạo",
		},
	},
}

// index 是 ID → 记录。未知 ID 不在表里 —— 由 TierOf 负责回落成
// UNCLASSIFIED，而不是在这里塞一条默认记录。
var index = func() map[SystemID]System {
	m := make(map[SystemID]System, len(register))
	for _, s := range register {
		m[s.ID] = s
	}
	return m
}()

// All 返回登记册全部记录（副本），按 AllSystemIDs 的顺序。
func All() []System {
	out := make([]System, 0, len(AllSystemIDs))
	for _, id := range AllSystemIDs {
		if s, ok := index[id]; ok {
			out = append(out, s)
		}
	}
	return out
}

// Lookup 按 ID 取记录。第二个返回值区分「查到了」与「没有这条记录」。
func Lookup(id SystemID) (System, bool) {
	s, ok := index[id]
	return s, ok
}

// TierOf 返回系统的等级。**未知系统回落成 UNCLASSIFIED，不是 LOW** ——
// 这是本包最重要的一条：把「没登记」当成「低风险」，正是 Điều 10.1 要防的事。
func TierOf(id SystemID) Tier {
	s, ok := index[id]
	if !ok {
		return TierUnclassified
	}
	return s.Tier()
}

// Assess 产出单个系统的完整体检结果。id 不在登记册里时返回一个
// Found=false 的结果，Blockers 里带 NOT_REGISTERED —— 调用方据此
// 渲染「查不到这个系统」，而不是一个空的正常结果。
func Assess(id SystemID) Assessment {
	s, found := index[id]
	if !found {
		return Assessment{
			ID:    id,
			Found: false,
			Tier:  TierUnclassified,
			Blockers: []Blocker{{
				Code:   BlockerNotRegistered,
				Law:    "Luật AI 134/2025 Điều 10.1",
				Detail: fmt.Sprintf("AI 系统 %q 不在登记册中：提供方在投入使用前必须自行分级并留存分级档案", id),
			}},
		}
	}

	a := Assessment{
		ID:           s.ID,
		Name:         s.Name,
		Found:        true,
		Tier:         s.Tier(),
		Basis:        s.Basis,
		BasisNote:    s.BasisNote,
		Factors:      append([]Factor(nil), s.Factors...),
		Capabilities: append([]Capability(nil), s.Capabilities...),
		Required:     s.Required(),
		Implemented:  append([]Protection(nil), s.Implemented...),
		Missing:      s.Missing(),
		Notification: s.Notification,
	}

	blockers := make([]Blocker, 0, 3)

	if !a.Tier.IsLegalTier() {
		blockers = append(blockers, Blocker{
			Code:   BlockerUnclassified,
			Law:    "Luật AI 134/2025 Điều 9.1",
			Detail: fmt.Sprintf("系统 %q 没有有效的风险分级依据（当前 %q）", s.ID, s.Basis),
		})
	}

	// Điều 10.1：投入使用前自行分级，且**附分级档案**。
	if !s.has(ProtectionClassificationDossier) {
		blockers = append(blockers, Blocker{
			Code:   BlockerDossierMissing,
			Law:    ProtectionClassificationDossier.Law(),
			Detail: fmt.Sprintf("系统 %q 缺分级档案：Điều 10.1 要求投入使用前分级并留存档案", s.ID),
		})
	}

	// Điều 10.3：中/高风险须在投入使用前报送。低风险不报送 —— 也不产生
	// 这条 blocker（Điều 10.5(c) 明确不给低风险加不必要义务）。
	needsNotification := a.Tier == TierHigh || a.Tier == TierMedium
	if needsNotification && s.Notification.Status != NotificationFiled {
		blockers = append(blockers, Blocker{
			Code: BlockerNotificationMissing,
			Law:  ProtectionPreUseNotification.Law(),
			Detail: fmt.Sprintf("系统 %q 为 %s 风险，但分级结果尚未报送 %s：Điều 10.3 要求**投入使用前**完成报送",
				s.ID, a.Tier, NotificationAuthority),
		})
	}

	// 其余按等级/能力推导出的措施缺失。10.1 / 10.3 已单列，避免重复。
	rest := make([]Protection, 0)
	for _, p := range a.Missing {
		if p == ProtectionClassificationDossier || p == ProtectionPreUseNotification {
			continue
		}
		rest = append(rest, p)
	}
	if len(rest) > 0 {
		blockers = append(blockers, Blocker{
			Code:    BlockerProtectionMissing,
			Law:     "Luật AI 134/2025 Điều 10 / 11 / 12",
			Detail:  fmt.Sprintf("系统 %q（%s 风险）缺 %d 项按等级与能力要求的保护措施", s.ID, a.Tier, len(rest)),
			Missing: rest,
		})
	}

	a.Blockers = blockers
	a.ReadyForUse = len(blockers) == 0
	return a
}

// AssessAll 体检全部已登记系统，顺序同 AllSystemIDs。
func AssessAll() []Assessment {
	out := make([]Assessment, 0, len(AllSystemIDs))
	for _, id := range AllSystemIDs {
		out = append(out, Assess(id))
	}
	return out
}

// Summary 是登记册的汇总口径，供运维首屏与启动日志使用。
type Summary struct {
	Total        int
	ReadyForUse  int
	Blocked      int
	Unclassified int
	// NotifiedToMoST 是已完成 Điều 10.3 报送的系统数。
	NotifiedToMoST int
	// RequiredProtectionGaps 是全部系统缺失措施的去重计数。
	RequiredProtectionGaps int
}

// Summarize 汇总 AssessAll 的结果。
func Summarize(assessments []Assessment) Summary {
	gaps := map[Protection]bool{}
	sum := Summary{Total: len(assessments)}
	for _, a := range assessments {
		if a.ReadyForUse {
			sum.ReadyForUse++
		} else {
			sum.Blocked++
		}
		if !a.Tier.IsLegalTier() {
			sum.Unclassified++
		}
		if a.Notification.Status == NotificationFiled {
			sum.NotifiedToMoST++
		}
		for _, p := range a.Missing {
			gaps[p] = true
		}
	}
	sum.RequiredProtectionGaps = len(gaps)
	return sum
}

// has 报告系统是否把某条措施写进了 Implemented。
func (s System) has(p Protection) bool {
	for _, impl := range s.Implemented {
		if impl == p {
			return true
		}
	}
	return false
}

// NormalizeTier 容忍大小写/空白，供接口层解析外部输入。
// 未知取值回落成 TierUnclassified（fail-closed），不返回错误 ——
// 「查不到这个等级」与「这个系统没分级」在语义上是同一件事。
func NormalizeTier(s string) Tier {
	upper := Tier(strings.ToUpper(strings.TrimSpace(s)))
	if upper.IsLegalTier() {
		return upper
	}
	return TierUnclassified
}
