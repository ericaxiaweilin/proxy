package api

import (
	"context"
	"github.com/proxy-app/proxy-api/internal/weather"
	"net/http"
	"os"
	"time"

	"github.com/proxy-app/proxy-api/internal/accountstatus"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/compliance"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/emergency"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/growth"
	"github.com/proxy-app/proxy-api/internal/guidance"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/incentive"
	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/jurisdiction"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/location"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/moderation"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/numberlookup"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/opsmetrics"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
	"github.com/proxy-app/proxy-api/internal/profile"
	"github.com/proxy-app/proxy-api/internal/providerapp"
	"github.com/proxy-app/proxy-api/internal/rating"
	"github.com/proxy-app/proxy-api/internal/realityscene"
	"github.com/proxy-app/proxy-api/internal/relationship"
	"github.com/proxy-app/proxy-api/internal/research"
	"github.com/proxy-app/proxy-api/internal/safety"
	"github.com/proxy-app/proxy-api/internal/scene"
	"github.com/proxy-app/proxy-api/internal/scenereview"
	"github.com/proxy-app/proxy-api/internal/socialspace"
	"github.com/proxy-app/proxy-api/internal/storeboard"
	"github.com/proxy-app/proxy-api/internal/storeonboarding"
	"github.com/proxy-app/proxy-api/internal/supply"
	"github.com/proxy-app/proxy-api/internal/tagging"
	"github.com/proxy-app/proxy-api/internal/twininsight"
	"github.com/proxy-app/proxy-api/internal/usermodel"
	"github.com/proxy-app/proxy-api/internal/voucher"
	"github.com/proxy-app/proxy-api/internal/wallet"
)

type Server struct {
	Identity      *identity.Service
	Demand        *demand.Service
	CityCompanion *citycompanion.Service
	LocalNet      *localnet.Service
	LocalContext  *localcontext.Service
	Conversation  *conversation.Service
	Engagement    *engagement.Service
	Fulfillment   *fulfillment.Service
	Supply        *supply.Service
	Media         *media.Service
	Activity      *activity.Service
	Contribution  *contribution.Service
	Experience    *experience.Service
	Voucher       *voucher.Service
	Marketplace   *marketplace.Service
	SocialSpace   *socialspace.Service
	Payment       *payment.Service
	Wallet        *wallet.Service
	Outcome       *outcome.Service
	Notification  *notification.Service
	Safety        *safety.Service
	Business      *business.Service
	Relationship  *relationship.Service
	Scene         *scene.Service
	RealityScene  *realityscene.Service
	Facet         *facet.Service
	// Location owns the precise-location consent ledger (R16.7-P1-J).
	// It is a separate service so the consent reads / writes do not
	// pay the load cost of the full identity service.
	Location *location.Service
	// Emergency owns the caller's own safety net: emergency contacts and
	// the append-only emergency-event log (SAFETY-NET-001). Deliberately
	// a separate domain from Safety, which is operator/moderation
	// (incidents, legal holds) and is pinned operator-only by
	// SAFETY-GATE-001.
	Emergency *emergency.Service
	// Benefit owns the benefit routing network (R16.11 / Master PRD v1.4 §12 §3).
	Benefit *benefit.Service
	// Growth computes the "我的权益" tier/growth-value dashboard, read-only
	// over Fulfillment's own orders (no separate ledger to keep in sync).
	Growth *growth.Service
	// Rating owns CLIENT-RATING-001: provider-rates-client public stars
	// shown on market listings (see internal/rating package doc).
	Rating *rating.Service
	// SceneReview owns SCENE-REVIEW-001: checkin-gated public stars shown
	// on reality scene (venue) cards (see internal/scenereview package doc).
	SceneReview *scenereview.Service
	// LocationRepo is the storage handle the history endpoint reads
	// from. Kept separate from the Service so tests can inject an
	// in-memory repository without standing up a service.
	LocationRepo location.Repository
	// Compliance owns the remote legal kill switch (R16.7-P1-G).
	// The HTTP layer uses Compliance.IsEnabled to gate regulated
	// endpoints; the public /v1/legal/status route reads
	// Compliance.GlobalStatus to expose the active switches to
	// the mobile client at boot.
	Compliance *compliance.Service
	// Moderation owns the user report intake (COMP-REPORT-001). The terms
	// of service §38 promise users can report eight kinds of targets; this
	// is the single intake that actually accepts all of them.
	Moderation *moderation.Service
	// StoreOnboarding owns the store-recommendation intake (STORE-REC-001).
	// Original design: stores enter the ecosystem when users / AI Xiaomei
	// recommend them; this is the append-only intake for that flow.
	StoreOnboarding *storeonboarding.Service
	// NumberLookup：客服 / 运营按全数字公共编号反查（PUBLIC-NO-LOOKUP-001）。operator 门 +
	// CASE scope，每次查询留痕。nil = 命令按未实现处理。
	NumberLookup *numberlookup.Service
	// Tagging：标签层的写命令（RecordCoarseLocation）与运营读取（TAG-SYSTEM-001）。
	Tagging *tagging.Commands
	// Guidance：下一步引导（GetNextSteps）。
	Guidance *guidance.Commands
	// Incentive：激励规则与用户读自己的奖励（INCENTIVE-001）。
	IncentiveStore    incentive.Store
	IncentiveCommands *incentive.Commands
	// Insight：需求缺口与标签分群读模型（OPS-INSIGHT-001）。
	Insight insight.Source
	// MatchPreview：撮合预览（OPS-MATCH-PREVIEW-001），组合根接线。
	MatchPreview MatchPreviewFunc
	// MATCH-ENGINE-001：撮合决策账查询（matching.decisions）。
	MatchExplain MatchExplainFunc
	// WEATHER-001：天气与见面时间建议；nil = 503。
	Weather *weather.Service
	// MatchEval：撮合离线回放评估（OPS-MATCH-EVAL-001），组合根接线。
	MatchEval MatchEvalSource
	// ProviderList / ProviderProfile：小美画像（OPS-PROVIDER-PROFILE-001），组合根接线。
	ProviderList    ProviderListFunc
	ProviderProfile ProviderProfileFunc
	// AccountStatus：账号受限 / 封禁（OPS-RESTRICT-001）。nil = 不执行任何限制。
	AccountStatus *accountstatus.Service
	// AccountInFlight：一个人手上没结束的订单数（封禁不自动取消，运营页提醒人工善后）。
	AccountInFlight func(ctx context.Context, userID string) (int, error)
	TagStore        tagging.Store
	// PolicyDecisions is the LC-28 audit-log writer. The
	// fulfillment service uses it to gate the OFFERED →
	// CONFIRMED transition for PLATFORM_PAY orders. Wired
	// from cmd/api/main.go so the dependency flows one way.
	PolicyDecisions *policydecisions.Service
	// AIPersona is the LC-07 likeness-consent reader. The
	// media service uses it to fail closed when an AI
	// persona asset lacks a live consent. Wired from
	// cmd/api/main.go.
	AIPersona *aipersona.Service
	// UserModel：AI 分身的用户建模（AI-MANAGE-015）。nil = 端点返回 503。
	UserModel *usermodel.Service
	// OpsMetrics：运营控制台的真实读模型（OPS-REAL-001）。nil = 没配库，相关页返回 NOT_CONNECTED。
	OpsMetrics opsmetrics.Source
	// Research：实验注册 + 影子评估（OPS-RESEARCH-001）。nil = Research 页返回 NOT_CONNECTED。
	Research *research.Service
	// Gravity：引力状态存储（GRAVITY-001）。nil = 没配库，相关页返回 NOT_CONNECTED。
	Gravity gravity.Store
	// Matching：撮合排序的旋钮存储与决策留痕读模型（OPS-MATCHING-TUNABLES-001）。
	// nil = 没配库，/v1/operator/matching 返回 NOT_CONNECTED，引擎按出厂默认跑。
	Matching matching.ConsoleStore
	// StoreBoard：门店预约与承载读模型（STORE-ATTRIBUTION-P1）。算不出来的数是 null，
	// 页面显示「—」。nil = 没配库，工作台返回 NOT_CONNECTED，一个数都不给。
	StoreBoard storeboard.Source
	// Dispatch：FAST 需求的自动派单（DISPATCH-LOOP-001）。nil = 没配库，工作台返回 NOT_CONNECTED。
	Dispatch      *dispatch.Engine
	DispatchStats DispatchStatsSource
	// ProviderApps：接单权限申请 + 运营审核（ORDER-PERMISSION-001）。nil = 端点返回 503。
	ProviderApps *providerapp.Service
	// Audit：运营动作审计（OPS-AUDIT-001）。nil = 没配库，运营写口照样执行，
	// 但 /v1/operator/access 会报 audit.connected=false —— 缺口可见，不是静默。
	Audit *operatoraudit.Recorder
	// OrderPermission：有没有接单权限。AI 分身（建分身、模型读本人照片）只对有权限的人开
	// （ORDER-PERMISSION-TWIN-001）。nil = 没接（测试 / 无库），生产 main.go 必须接。
	OrderPermission func(ctx context.Context, userAccountID string) (bool, error)
	// TwinInsight 是 AI 分身「好友洞察」的读模型（TWIN-INSIGHT-002）。
	// 它是一个独立的读模型包而不是挂在 localnet / relationship 上：
	// 这条洞察跨四个域（好友关系 / 行为事件 / 对话 / 点赞），没有任何
	// 一个域拥有"这个好友值不值得运营"这个问题。见 internal/twininsight。
	TwinInsight *twininsight.Service
	// Jurisdiction is the R16.7-P1-E lookup. The
	// fulfillment service consumes it through a bridge to
	// pick the right policy decision (LC-28 / LC-30). The
	// HTTP API surface for self-service jurisdiction
	// changes is mounted separately in handlers.
	Jurisdiction *jurisdiction.Service
	// Profile owns the server-side user profile card (P1, audit 2026-09-04):
	// UpsertUserProfile / GetUserProfile. Kept separate from identity so the
	// profile write path does not touch the login/device ledger.
	Profile       *profile.Service
	Idempotency   command.IdempotencyStore
	Authenticator Authenticator
	ReadyCheck    func(context.Context) error
	ReadyMode     string
	Transactions  TransactionRunner
	// R15.32.1.3: HTTP client used by /v1/geocode/reverse to talk to
	// Nominatim. Tests inject a stub via NewServerWithHTTPClient;
	// production wires a 4s-timeout client in main.go.
	HTTPClient *http.Client
	Operator   OperatorGate
	RateLimit  *RateLimiter
	// TrustCloudflareIP must only be enabled when the origin is reachable
	// exclusively through Cloudflare. Otherwise CF-Connecting-IP is client
	// controlled and must be ignored.
	TrustCloudflareIP bool
	ReadTimeout       time.Duration
}

type Authenticator interface {
	Authenticate(ctx context.Context, rawAccessToken string) (identity.AuthenticatedSession, error)
}

// TransactionRunner binds the API command boundary to the persistence unit of
// work. PostgreSQL uses it to commit idempotency, aggregate state and outbox
// events together.
type TransactionRunner interface {
	WithinTransaction(ctx context.Context, operation func(context.Context) error) error
}

func NewServer(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service) *Server {
	return NewServerWithDependencies(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, command.NewMemoryIdempotencyStore(), nil)
}

func NewServerWithDependencies(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error) *Server {
	return NewServerWithDependenciesAndAuthenticator(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, nil)
}

func NewServerWithDependenciesAndAuthenticator(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator) *Server {
	return NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, authenticator, nil)
}

func NewServerWithRuntime(identityService *identity.Service, demandService *demand.Service, cityCompanionService *citycompanion.Service, localNetService *localnet.Service, localContextService *localcontext.Service, conversationService *conversation.Service, engagementService *engagement.Service, fulfillmentService *fulfillment.Service, supplyService *supply.Service, mediaService *media.Service, contributionService *contribution.Service, idempotencyStore command.IdempotencyStore, readyCheck func(context.Context) error, authenticator Authenticator, transactions TransactionRunner) *Server {
	if idempotencyStore == nil {
		idempotencyStore = command.NewMemoryIdempotencyStore()
	}
	// SEARCH-CORPUS-003: feed 搜索要能命中评论，而评论只存在 engagement 里
	// （Post 上一条都没有）。接在这里而不是 main.go：所有 NewServer* 变体和
	// 全部测试都从这一个函数过，不存在「某条构造路径忘了接线、于是搜索悄悄
	// 不搜评论」的分支 —— 那正是这类可选端口最容易烂掉的方式。
	if localNetService != nil && engagementService != nil {
		localNetService.SetReplySearch(engagementService)
	}
	readyMode := "local_memory"
	if readyCheck != nil {
		readyMode = "configured"
	}
	return &Server{Identity: identityService, Demand: demandService, CityCompanion: cityCompanionService, LocalNet: localNetService, LocalContext: localContextService, Conversation: conversationService, Engagement: engagementService, Fulfillment: fulfillmentService, Supply: supplyService, Media: mediaService, Contribution: contributionService, Experience: experience.NewWithRepository(experience.NewMemoryRepository()), Voucher: voucher.New(), SocialSpace: socialspace.New(), Payment: payment.New(), Outcome: outcome.New(), Notification: notification.New(), Safety: safety.New(), Business: business.New(), Relationship: relationship.New(), Scene: scene.New(), RealityScene: realityscene.New(), Facet: facet.New(), Profile: profile.New(), Idempotency: idempotencyStore, Authenticator: authenticator, ReadyCheck: readyCheck, ReadyMode: readyMode, Transactions: transactions, RateLimit: NewRateLimiter(time.Minute, 120), TrustCloudflareIP: envBool("PROXY_TRUST_CLOUDFLARE_IP"), ReadTimeout: 4 * time.Second}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health/live", s.live)
	mux.HandleFunc("/health/ready", s.ready)
	mux.HandleFunc("/v1/commands/", s.command)
	mux.HandleFunc("/v1/decisions/evaluate", s.evaluateDecision)
	mux.HandleFunc("/v1/experience/surface", s.experienceSurface)
	mux.HandleFunc("/v1/experience/delta", s.experienceDelta)
	mux.HandleFunc("/v1/experience/metrics", s.experienceMetrics)
	mux.HandleFunc("/v1/operator/providers", s.operatorConsoleGated(http.MethodGet, ScopeMarketplace, s.operatorProviders))
	mux.HandleFunc("/v1/operator/providers/profile", s.operatorConsoleGated(http.MethodGet, ScopeMarketplace, s.operatorProviderProfile))
	mux.HandleFunc("/v1/operator/matching-eval", s.operatorConsole(s.operatorMatchingEval))
	mux.HandleFunc("/v1/operator/match-preview", s.operatorConsoleGated(http.MethodGet, ScopeMarketplace, s.operatorMatchPreview))
	mux.HandleFunc("/v1/operator/tag-pipeline", s.operatorConsole(s.operatorTagPipeline))
	mux.HandleFunc("/v1/operator/demand-gap", s.operatorConsole(s.operatorDemandGap))
	mux.HandleFunc("/v1/operator/insights", s.operatorConsole(s.operatorInsights))
	mux.HandleFunc("/v1/operator/context-field", s.operatorConsole(s.operatorContextField))
	mux.HandleFunc("/v1/operator/surface-plans", s.operatorConsole(s.operatorSurfacePlans))
	mux.HandleFunc("/v1/operator/execution-runtime", s.operatorConsole(s.operatorExecutionRuntime))
	mux.HandleFunc("/v1/operator/decision-engine", s.operatorConsole(s.operatorDecisionEngine))
	mux.HandleFunc("/v1/operator/clarification-gate", s.operatorConsole(s.operatorClarificationGate))
	mux.HandleFunc("/v1/operator/supply-health", s.operatorConsole(s.operatorSupplyHealth))
	mux.HandleFunc("/v1/operator/north-star", s.operatorConsole(s.operatorNorthStar))
	mux.HandleFunc("/v1/operator/fulfillment-attribution", s.operatorConsole(s.operatorAttributionAudit))
	mux.HandleFunc("/v1/operator/behavior", s.operatorConsole(s.operatorBehavior))
	mux.HandleFunc("/v1/operator/research", s.operatorConsole(operatorResearch))
	mux.HandleFunc("/v1/operator/population", s.operatorConsole(s.operatorPopulation))
	mux.HandleFunc("/v1/operator/tags", s.operatorConsole(s.operatorTags))
	mux.HandleFunc("/v1/operator/intent-orchestration", s.operatorConsole(s.operatorIntentOrchestration))
	mux.HandleFunc("/v1/operator/engine-api", s.operatorConsole(s.operatorEngineAPI))
	mux.HandleFunc("/v1/operator/merchant", s.operatorConsole(s.operatorMerchant))
	mux.HandleFunc("/v1/operator/retention", s.operatorConsole(s.operatorRetention))
	mux.HandleFunc("/v1/operator/trust", s.operatorConsole(s.operatorTrust))
	mux.HandleFunc("/v1/operator/quality", s.operatorConsole(s.operatorDataQuality))
	// GRAVITY-001: 引力状态（真实派生数据，spec §6-§7 / §21）。
	mux.HandleFunc("/v1/operator/gravity", s.operatorConsole(s.operatorGravity))
	mux.HandleFunc("/v1/operator/gravity/recompute", s.operatorConsoleMethod(http.MethodPost, s.operatorGravityRecompute))
	// OPS-MATCHING-TUNABLES-001：撮合引擎管理。读口跟其他控制台页一样要 ANALYTICS；
	// 改旋钮是**动全平台撮合口径**，所以门是 MARKETPLACE（撮合域的授权），
	// 而且必填理由 + 落 operator.action_log（OPS-AUDIT-001）。
	mux.HandleFunc("/v1/operator/matching", s.operatorConsole(s.operatorMatching))
	mux.HandleFunc("/v1/operator/matching/trace", s.operatorConsole(s.operatorMatchingTrace))
	mux.HandleFunc("/v1/operator/matching/explain", s.operatorConsole(s.operatorMatchingExplain))
	mux.HandleFunc("/v1/operator/matching/tunables", s.operatorConsoleGated(http.MethodPost, ScopeMarketplace, s.operatorMatchingTunables))
	mux.HandleFunc("/v1/operator/dispatch", s.operatorConsole(s.operatorDispatch))
	mux.HandleFunc("/v1/operator/dispatch/run", s.operatorConsole(s.operatorDispatchRun))
	// OPS-MODERATION-001: 举报处置队列 + 处置（走 Moderation 命令边界，不绕过校验）。
	mux.HandleFunc("/v1/operator/moderation", s.operatorConsoleGated(http.MethodGet, ScopeModeration, s.operatorModerationQueue))
	mux.HandleFunc("/v1/operator/authority-requests", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.operatorConsoleGated(http.MethodGet, ScopeAuthority, s.operatorAuthorityQueue)(w, r)
		default:
			s.operatorConsoleGated(http.MethodPost, ScopeAuthority, s.operatorAuthorityCommand("RecordAuthorityRequest", "AUTHORITY_REQUEST_RECORD", "requestRef"))(w, r)
		}
	})
	mux.HandleFunc("/v1/operator/authority-requests/response", s.operatorConsoleGated(http.MethodPost, ScopeAuthority, s.operatorAuthorityCommand("RecordAuthorityResponse", "AUTHORITY_RESPONSE_RECORD", "requestId")))
	mux.HandleFunc("/v1/operator/incentives", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			s.operatorConsoleGated(http.MethodGet, ScopePayments, s.operatorIncentives)(w, r)
			return
		}
		s.operatorConsoleGated(http.MethodPost, ScopePayments, s.operatorIncentiveUpsert)(w, r)
	})
	mux.HandleFunc("/v1/operator/incentives/active", s.operatorConsoleGated(http.MethodPost, ScopePayments, s.operatorIncentiveActive))
	mux.HandleFunc("/v1/operator/restrictions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			s.operatorConsoleGated(http.MethodGet, ScopeModeration, s.operatorRestrictions)(w, r)
			return
		}
		s.operatorConsoleGated(http.MethodPost, ScopeModeration, s.operatorRestrictionSet)(w, r)
	})
	mux.HandleFunc("/v1/operator/restrictions/lift", s.operatorConsoleGated(http.MethodPost, ScopeModeration, s.operatorRestrictionLift))
	mux.HandleFunc("/v1/operator/appeals", s.operatorConsoleGated(http.MethodGet, ScopeModeration, s.operatorAppealQueue))
	mux.HandleFunc("/v1/operator/appeals/decision", s.operatorConsoleGated(http.MethodPost, ScopeModeration, s.operatorAppealDecision))
	mux.HandleFunc("/v1/operator/moderation/disposition", s.operatorConsoleGated(http.MethodPost, ScopeModeration, s.operatorModerationDisposition))
	mux.HandleFunc("/v1/operator/dispatch/actions", s.operatorConsoleGated(http.MethodPost, ScopeMarketplace, s.operatorDispatchAction))
	// MARKET-FAST-001：市场发单看板 —— 快速发单一段时间内的表现（只读，同一道 ANALYTICS 门）。
	mux.HandleFunc("/v1/operator/market-dispatch", s.operatorConsole(s.operatorMarketBoard))
	// STORE-ATTRIBUTION-P1：门店预约与承载 —— 哪一家店拿到了多少承载预约、它自己报的
	// 承载快照有多新（只读，同一道 ANALYTICS 门）。
	mux.HandleFunc("/v1/operator/store-board", s.operatorConsole(s.operatorStoreBoard))
	mux.HandleFunc("/v1/operator/provider-applications", s.operatorConsole(s.operatorProviderApplications))
	mux.HandleFunc("/v1/operator/provider-applications/review", s.operatorConsoleMethod(http.MethodPost, s.operatorProviderApplicationReview))
	// OPS-ACCESS-001: 运营权限自己的可观测面 —— 词汇表 / 当前配置 / 我生效的 scope /
	// 审计计数与最近动作。只读，授权仍然只在 env 里改。走 anyScope 门（是运营就能看
	// 自己有什么权限），理由见 operatorConsoleAnyScope。
	mux.HandleFunc("/v1/operator/access", s.operatorConsoleAnyScope(s.operatorAccess))
	mux.HandleFunc("/v1/media/upload/", s.mediaUpload)
	mux.HandleFunc("/v1/media/play/", s.mediaFile)
	mux.HandleFunc("/v1/media/thumb/", s.mediaFile)
	mux.HandleFunc("/v1/media/variant/", s.mediaVariantFile)
	mux.HandleFunc("/v1/feed", s.publicFeed)
	mux.HandleFunc("/v1/reality-scenes", s.publicRealityScenes)
	mux.HandleFunc("/v1/weather", s.publicWeather)
	mux.HandleFunc("/v1/scene-assets", s.publicSceneAssets)
	mux.HandleFunc("/v1/reality-scenes/nearby", s.nearbyRealityScenes)
	mux.HandleFunc("/v1/scenes/", s.dynamicSceneRead)
	// R16.9: public legal docs (Terms / Privacy) used by the signup
	// consent gate. The handler serves the v1.1 Vietnam 2026-08-31
	// drafts embedded in the binary (see legal.go).
	mux.HandleFunc("/v1/legal/", s.legalDoc)
	// R16.10-P1-F: privacy request center (Vietnam PDP 91/2025/QH15
	// Art. 31/32 + PRD v1.4 LC-15). GET /v1/privacy/me assembles a
	// user data export on demand; POST /v1/privacy/export and POST
	// /v1/privacy/delete submit new requests; POST /v1/privacy/cancel
	// withdraws a delete request inside the 30-day grace window; GET
	// /v1/privacy/status?requestId=... polls for status; GET
	// /v1/privacy/requests returns the full history.
	mux.HandleFunc("/v1/privacy/me", s.privacyMe)
	mux.HandleFunc("/v1/privacy/export", s.privacyExportRequest)
	mux.HandleFunc("/v1/privacy/delete", s.privacyDeleteRequest)
	mux.HandleFunc("/v1/privacy/cancel", s.privacyCancelRequest)
	mux.HandleFunc("/v1/privacy/status", s.privacyStatus)
	mux.HandleFunc("/v1/privacy/requests", s.privacyList)
	// R16.7-P1-J: precise location opt-in + time limit (LC-08).
	// GET /v1/location/consent returns the current consent status
	// (NONE / GRANTED / EXPIRED). POST /v1/location/consent/grant
	// opts the user in with a duration choice. POST
	// /v1/location/consent/revoke opts out. GET
	// /v1/location/consent/history returns the full history.
	mux.HandleFunc("/v1/location/consent", s.locationConsentGet)
	mux.HandleFunc("/v1/location/consent/grant", s.locationConsentGrant)
	mux.HandleFunc("/v1/location/consent/revoke", s.locationConsentRevoke)
	mux.HandleFunc("/v1/location/consent/history", s.locationConsentHistory)
	// SAFETY-NET-001: the caller's own safety net. Two paths carry the
	// five commands (contacts: GET/POST/DELETE, events: GET/POST); every
	// one of them is authenticated (requiresAuthentication is
	// deny-by-default and none of these is on the public allowlist) and
	// none is operator-gated, because all of them read or write only
	// the caller's own rows.
	mux.HandleFunc("/v1/emergency/contacts", s.emergencyContacts)
	mux.HandleFunc("/v1/emergency/events", s.emergencyEvents)
	// R16.7-P1-G: remote legal kill switch (LC-16). The public
	// /v1/legal/status route is read at mobile boot so the client
	// can show a "service paused" banner and disable regulated
	// subpages; the operator routes require an authenticated
	// operator and an OperatorGate allowlist.
	mux.HandleFunc("/v1/legal/status", s.legalStatus)
	mux.HandleFunc("/v1/operator/legal/kill-switch", s.operatorKillSwitchKill)
	mux.HandleFunc("/v1/operator/legal/kill-switch/", s.operatorKillSwitchRearm)
	mux.HandleFunc("/v1/operator/legal/kill-switches", s.operatorKillSwitchList)
	// AI-SYSTEM-REGISTER-001: AI 系统登记册（internal/aisystem）的运维读口。
	// Luật AI 134/2025 Điều 10.1 要求提供方在投入使用前自行分级并留存档案，
	// Điều 10.3 要求中/高风险的分级结果在投入使用前报送科技部。这两个口把
	// 「哪个 AI 系统带着哪条缺口在跑」变成一个可查状态，而不是只在文档里。
	// 运维专用：缺口清单属内部合规信息。
	mux.HandleFunc("/v1/operator/ai/systems", s.operatorAISystemRegister)
	mux.HandleFunc("/v1/operator/ai/systems/", s.operatorAISystemItem)
	// R16.7-P1-K (LC-06) + R16.7-P1-I (LC-07): AI persona
	// catalog + likeness consent. The /v1/ai/personas prefix
	// is shared; sub-paths split between create/get/consent
	// lookups.
	mux.HandleFunc("/v1/ai/personas", s.routePersonaCollection)
	mux.HandleFunc("/v1/ai/personas/", s.routePersonaItem)
	// TWIN-INSIGHT-002: AI 分身「好友洞察」。四端点全在 /v1/ai/twins/ 下，
	// 走**会话 + 分身归属**校验（不是 PRD 写的匿名读 —— 理由见
	// twin_insight_handlers.go 顶部那段偏离说明）。
	mux.HandleFunc("/v1/ai/twins/", s.routeTwinInsight)
	mux.HandleFunc("/v1/ai/accounts", s.listPlatformAIAccounts)
	// AI-ASSIST-001: 平台 AI 助手公开目录（首页推荐），匿名可读。
	mux.HandleFunc("/v1/ai/assistants", s.listAIAssistants)
	// AI-MANAGE-007: AI 目录（价格 / logo / 免费额度），来自 config/ai-catalog 文件，匿名可读。
	mux.HandleFunc("/v1/ai/catalog", s.getAICatalog)
	// AI-MANAGE-015: AI 分身「用户建模」（需会话 + 本人形象授权）。
	mux.HandleFunc("/v1/ai/user-model", s.routeUserModel)
	mux.HandleFunc("/v1/provider-application", s.routeProviderApplication)
	mux.HandleFunc("/v1/provider-application/", s.routeProviderApplication)
	mux.HandleFunc("/v1/ai/user-model/", s.routeUserModel)
	// 小美头像原文件（GPT 交付 SVG）：更长 prefix，优先于 personas/ 通配。
	mux.HandleFunc("/v1/ai/personas/photo/", s.personaPhoto)
	// R16.7-P1-E: Jurisdiction Policy Engine self-service.
	// GET reads the caller's current jurisdiction (default
	// VN-79 when no row exists); PATCH updates it. Operator
	// updates go through a separate operator-only endpoint
	// (TODO: when ops tooling lands).
	mux.HandleFunc("/v1/identity/jurisdiction", s.routeJurisdiction)
	// AGE-BACKFILL-001: 老账号补年龄断言（SELF_DECLARED_BACKFILL），给
	// COMP-AGE-001 之前注册、零年龄证据的账号一条出路。本人只能给自己补。
	mux.HandleFunc("/v1/identity/age-assertion", s.recordAgeAssertion)
	// R15.25 FACET — object-oriented content operation (Phase 1 = list only).
	// 匿名 GET endpoint, 返回 mock 3 个对象 (Ken / Linh / ABC Spa) 跟 prototype
	// 一致. Phase 1 没有持久化, 也不需要 auth — 跟 prototype HTML demo 同形.
	mux.HandleFunc("/v1/facet/objects", s.facetObjects)
	mux.HandleFunc("/v1/facet/objects/", s.facetSideSpace)
	mux.HandleFunc("/v1/facet/side-space/catalog", s.facetSideSpaceCatalog)
	mux.HandleFunc("/v1/facet/side-space/suggestions", s.facetSideSpaceSuggestions)
	mux.HandleFunc("/v1/facet/config", s.facetConfig)
	// R15.33: /v1/map/items 撤了 — LocationPickerSheet 直接用
	// /v1/geocode/reverse (Photon proxy) 拿真实地址，不需要 server
	// 拿 bbox 查 post/agent/order pin。Post pin overlay 如果要
	// 重做，起新端点 /v1/feed/local (Phase 2, not yet)。
	// R15.32.1.3: reverse geocode proxy. Mobile LocationPickerSheet
	// calls this with (lat, lng) after GPS snap and the server relays
	// the request to Nominatim. Server-side proxy gives us
	// observability (one log line per call) and lets us add caching
	// later without touching the mobile code path.
	mux.HandleFunc("/v1/geocode/reverse", s.reverseGeocode)
	// NEARBY-SPOTS-001: 3km 热门地点。nearbyPlaces 早就实现了（Overpass 景点/
	// 公园/市集，按距离排序），但一直没挂路由 —— 客户端只能用硬编码
	// 的 4 个城市预设。与 reverse 同口径：公开 GET，失败 fail-closed 给空列表。
	mux.HandleFunc("/v1/places/nearby", s.nearbyPlaces)
	return s.recoverMiddleware(s.versionMiddleware(mux))
}

func (s *Server) live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "proxy-api"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if s.ReadyCheck != nil {
		if err := s.ReadyCheck(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "service": "proxy-api", "error": "dependency_unavailable"})
			return
		}
	}
	checks := map[string]string{"database": "not_configured_local_mode", "redis": "not_configured_local_mode"}
	if s.ReadyMode == "configured" {
		checks["database"] = "ok"
		checks["redis"] = "not_configured_optional"
	}
	// R16.6: surface login provider status in /health/ready so operators can
	// see "fail-closed" SMTP at probe time (before users notice OTP never
	// arrives). Boot-time log.Fatal already prevents this state in main.go,
	// but a non-strict operator who comments the log.Fatal out won't get a
	// silent outage any more.
	checks["login_provider"] = loginProviderStatus()
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "service": "proxy-api", "checks": checks})
}

func loginProviderStatus() string {
	mode := os.Getenv("PROXY_LOGIN_PROVIDER")
	switch mode {
	case "":
		return "unset"
	case "simulated":
		return "simulated"
	case "smtp":
		if os.Getenv("PROXY_SMTP_HOST") == "" {
			return "fail_closed_no_smtp_env"
		}
		return "smtp_configured"
	case "sms":
		if os.Getenv("PROXY_SMS_URL") == "" {
			return "fail_closed_no_sms_env"
		}
		return "sms_configured"
	default:
		return "unknown_mode_" + mode
	}
}
