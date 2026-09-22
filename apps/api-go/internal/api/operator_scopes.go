package api

// OPS-SCOPE-001: operator 最小权限的第一步 —— 把"是不是 operator"（二值）
// 拆成"这个 operator 有哪几个域的 scope"。
//
// 背景（PRD Ch.18 §11/§12 + AC-OPS-05/AC-OPS-06）：今天 StaticOperatorGate 是
// 全有全无 —— 进了 PROXY_OPERATOR_PRINCIPALS 白名单的人能调 36 条特权命令里
// 的每一条（放款、封号、法务保全、看全量推荐理由……）。§12 要求权限可拆分
// （Marketplace / Safety / Payments / Identity / Graph + CASE/TASK/MATCH…），
// AC-OPS-05 要求每个 Team 只看到职责所需的数据。
//
// 本 slice 只做不改变任何现行放行的地基（零行为变更），让下一步"按人配 scope"
// 是一个纯配置改动，而不是又一次授权模型重写：
//  1. scope 词汇（§12 分组 + 命令现实补的 AUTHORITY/MODERATION/PLATFORM/ANALYTICS）；
//  2. 36 条门命令 → 唯一 required scope（编译期可数、测试钉住不漏）；
//  3. ScopesForPrincipal：白名单内 = 全 scope（= 今天的行为），之外 = 空；
//  4. dispatch 在 IsOperator 通过后再过一道 AuthorizeOperatorCommand —— 今天恒
//     通过，但从此"加新门命令却忘配 scope"会在测试里炸，而不是在线上敞开。
//
// Per-principal scope 配置（env 格式 + main.go 接线 + bootenv 文案）是明确的
// 下一步，不在本 slice —— 见 ScopesForPrincipal 注释。

// OperatorScope 是 §12 权限词汇的域级 scope。命令只认 scope，不认人。
type OperatorScope string

const (
	// CASE: 运营工单（创建/查看/指派/解决）。
	ScopeCase OperatorScope = "CASE"
	// MARKETPLACE: 市场运营（推荐评估、活动/配额管理）。AC-OPS-06 点名可拆分。
	ScopeMarketplace OperatorScope = "MARKETPLACE"
	// SAFETY: 安全处置（事件/封禁/法务保全/临时授权）。AC-OPS-06 点名可拆分。
	ScopeSafety OperatorScope = "SAFETY"
	// PAYMENTS: 资金动作（支付确认/退款/保全/券发行结算）。AC-OPS-06 点名可拆分。
	ScopePayments OperatorScope = "PAYMENTS"
	// IDENTITY: §12 预留（IDENTITY_VIEW/IDENTITY_DECIDE 的域）。今天门命令里
	// 还没有纯 IDENTITY 域的条目 —— 按"无引用不进词汇"原则暂不声明，等第一条
	// IDENTITY 门命令落地时再加（加了就必须进 requiredOperatorScope，被测试数住）。
	// AUTHORITY: 有权机关请求的受理与响应（COMP-AUTHORITY-001，§55 SLA，
	// fail-closed）。§12 没单列，但这类命令碰的是司法调证，不能跟普通
	// MODERATION 共用一个 scope。
	ScopeAuthority OperatorScope = "AUTHORITY"
	// MODERATION: 内容与社区治理（媒体评审/举报处置/申诉复核）。
	ScopeModeration OperatorScope = "MODERATION"
	// CAPABILITY: 能力核验。
	ScopeCapability OperatorScope = "CAPABILITY"
	// CONTRIBUTION: 贡献评审与激励。
	ScopeContribution OperatorScope = "CONTRIBUTION"
	// MEDIA: 媒体就绪裁决。
	ScopeMedia OperatorScope = "MEDIA"
	// PLATFORM: 平台级共享词表与系统通知渠道（模板/收件箱代写）。
	ScopePlatform OperatorScope = "PLATFORM"
	// ANALYTICS: 行为轨迹回放（归因/事件流）。看的是"谁看了谁"，只能给
	// 需要归因回放的角色，不能搭在普通运营权限上。
	ScopeAnalytics OperatorScope = "ANALYTICS"
)

// allOperatorScopes 是词汇全集 —— ScopesForPrincipal(白名单内) = 全集，
// 即今天的行为。增减 scope 必须同步改 requiredOperatorScope（completeness
// 测试双向钉住：门命令无 scope 会炸，未被引用的 scope 也会炸，避免词汇烂尾）。
var allOperatorScopes = []OperatorScope{
	ScopeCase,
	ScopeMarketplace,
	ScopeSafety,
	ScopePayments,
	ScopeAuthority,
	ScopeModeration,
	ScopeCapability,
	ScopeContribution,
	ScopeMedia,
	ScopePlatform,
	ScopeAnalytics,
}

// requiredOperatorScope: 36 条门命令各自唯一的 required scope。
// 与 security.go 的 operatorCommandTypes 严格 1:1 —— 一边加一边必须加。
var requiredOperatorScope = map[string]OperatorScope{
	// CAPABILITY
	"VerifyCapability": ScopeCapability,
	// CONTRIBUTION
	"ReviewContributionAccess": ScopeContribution,
	"ReviewContributionDomain": ScopeContribution,
	"ReviewRewardGate":         ScopeContribution,
	"ActivateContribution":     ScopeContribution,
	"RecordContributionValue":  ScopeContribution,
	"GrantContributionReward":  ScopeContribution,
	// MEDIA
	"MarkMediaReady": ScopeMedia,
	// MODERATION
	"ReviewMediaAsset":        ScopeModeration,
	"ListMediaReviewDecisions": ScopeModeration,
	"AmendMediaReviewDecision": ScopeModeration,
	"RecordReportDisposition": ScopeModeration,
	"RecordAppealDecision":    ScopeModeration,
	// PAYMENTS
	"ConfirmPaymentIntent": ScopePayments,
	"RefundPaymentIntent":  ScopePayments,
	"CreatePayoutHold":     ScopePayments,
	"ReleasePayout":        ScopePayments,
	"CreateVoucher":        ScopePayments,
	"SettleVoucher":        ScopePayments,
	// AUTHORITY
	"RecordAuthorityRequest":  ScopeAuthority,
	"RecordAuthorityResponse": ScopeAuthority,
	// MARKETPLACE
	"ListStoreRecommendations":  ScopeMarketplace,
	"DecideStoreRecommendation": ScopeMarketplace,
	"CreateCampaign":            ScopeMarketplace,
	"ActivateCampaign":          ScopeMarketplace,
	"PauseCampaign":             ScopeMarketplace,
	"AllocateBenefit":           ScopeMarketplace,
	// SAFETY
	"GrantJITAccess":    ScopeSafety,
	"CreateIncident":    ScopeSafety,
	"CreateSafetyBlock": ScopeSafety,
	"CreateLegalHold":   ScopeSafety,
	"ReleaseLegalHold":  ScopeSafety,
	// CASE
	"CreateOperatorCase": ScopeCase,
	// PLATFORM
	"CreateObservationTemplate": ScopePlatform,
	"SendInboxNotification":     ScopePlatform,
	// ANALYTICS
	"ListInteractionEvents": ScopeAnalytics,
}

// RequiredOperatorScope 返回某命令的 required scope。第二个返回值 false =
// 非门命令（调用方自己的 actor 鉴权负责，本表不插手）。
func RequiredOperatorScope(commandType string) (OperatorScope, bool) {
	scope, ok := requiredOperatorScope[commandType]
	return scope, ok
}

// ScopesForPrincipal 返回某 principal 持有的 scope 集合。
//
// 今天：allowlisted（= IsOperator 通过，含白名单与 role=OPERATOR 会话）= 全
// scope —— 与现行放行完全一致，零行为变更。allowlisted=false = 空集。
//
// 下一步（不在本 slice）：env 按人配 scope（例如
// PROXY_OPERATOR_SCOPES="alice:PAYMENTS,MARKETPLACE"），到时只改这个函数，
// dispatch 与各 service 零改动。
func ScopesForPrincipal(allowlisted bool) map[OperatorScope]bool {
	scopes := make(map[OperatorScope]bool, len(allOperatorScopes))
	if !allowlisted {
		return scopes
	}
	for _, scope := range allOperatorScopes {
		scopes[scope] = true
	}
	return scopes
}

// AuthorizeOperatorCommand 在 IsOperator 通过之后再验一道 scope。
// 非门命令恒 true（不插手各域自己的 actor 鉴权）；门命令要求持有其 required
// scope —— 今天白名单内恒全 scope，所以与现行放行逐条一致（parity 测试钉住）。
func AuthorizeOperatorCommand(commandType string, scopes map[OperatorScope]bool) bool {
	required, gated := RequiredOperatorScope(commandType)
	if !gated {
		return true
	}
	return scopes[required]
}
