package api

import (
	"context"
	"net/http"
	"os"
	"time"

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
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/jurisdiction"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/location"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
	"github.com/proxy-app/proxy-api/internal/profile"
	"github.com/proxy-app/proxy-api/internal/realityscene"
	"github.com/proxy-app/proxy-api/internal/relationship"
	"github.com/proxy-app/proxy-api/internal/safety"
	"github.com/proxy-app/proxy-api/internal/scene"
	"github.com/proxy-app/proxy-api/internal/socialspace"
	"github.com/proxy-app/proxy-api/internal/supply"
	"github.com/proxy-app/proxy-api/internal/voucher"
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
	// Benefit owns the benefit routing network (R16.11 / Master PRD v1.4 §12 §3).
	Benefit *benefit.Service
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
	mux.HandleFunc("/v1/experience/surface", s.experienceSurface)
	mux.HandleFunc("/v1/experience/delta", s.experienceDelta)
	mux.HandleFunc("/v1/experience/metrics", s.experienceMetrics)
	mux.HandleFunc("/v1/operator/context-field", s.operatorContextField)
	mux.HandleFunc("/v1/operator/surface-plans", s.operatorSurfacePlans)
	mux.HandleFunc("/v1/operator/execution-runtime", s.operatorExecutionRuntime)
	mux.HandleFunc("/v1/operator/decision-engine", s.operatorDecisionEngine)
	mux.HandleFunc("/v1/operator/clarification-gate", s.operatorClarificationGate)
	mux.HandleFunc("/v1/operator/supply-health", s.operatorSupplyHealth)
	mux.HandleFunc("/v1/operator/fulfillment-attribution", s.operatorFulfillmentAttribution)
	mux.HandleFunc("/v1/operator/behavior", s.operatorBehavior)
	mux.HandleFunc("/v1/operator/research", s.operatorResearch)
	mux.HandleFunc("/v1/operator/population", s.operatorPopulation)
	mux.HandleFunc("/v1/operator/tags", s.operatorTags)
	mux.HandleFunc("/v1/operator/intent-orchestration", s.operatorIntentOrchestration)
	mux.HandleFunc("/v1/operator/engine-api", s.operatorEngineAPI)
	mux.HandleFunc("/v1/operator/merchant", s.operatorMerchant)
	mux.HandleFunc("/v1/operator/retention", s.operatorRetention)
	mux.HandleFunc("/v1/operator/trust", s.operatorTrust)
	mux.HandleFunc("/v1/operator/quality", s.operatorQuality)
	mux.HandleFunc("/v1/media/upload/", s.mediaUpload)
	mux.HandleFunc("/v1/media/play/", s.mediaFile)
	mux.HandleFunc("/v1/media/thumb/", s.mediaFile)
	mux.HandleFunc("/v1/media/variant/", s.mediaVariantFile)
	mux.HandleFunc("/v1/feed", s.publicFeed)
	mux.HandleFunc("/v1/reality-scenes", s.publicRealityScenes)
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
	// R16.7-P1-G: remote legal kill switch (LC-16). The public
	// /v1/legal/status route is read at mobile boot so the client
	// can show a "service paused" banner and disable regulated
	// subpages; the operator routes require an authenticated
	// operator and an OperatorGate allowlist.
	mux.HandleFunc("/v1/legal/status", s.legalStatus)
	mux.HandleFunc("/v1/operator/legal/kill-switch", s.operatorKillSwitchKill)
	mux.HandleFunc("/v1/operator/legal/kill-switch/", s.operatorKillSwitchRearm)
	mux.HandleFunc("/v1/operator/legal/kill-switches", s.operatorKillSwitchList)
	// R16.7-P1-K (LC-06) + R16.7-P1-I (LC-07): AI persona
	// catalog + likeness consent. The /v1/ai/personas prefix
	// is shared; sub-paths split between create/get/consent
	// lookups.
	mux.HandleFunc("/v1/ai/personas", s.routePersonaCollection)
	mux.HandleFunc("/v1/ai/personas/", s.routePersonaItem)
	mux.HandleFunc("/v1/ai/accounts", s.listPlatformAIAccounts)
	// R16.7-P1-E: Jurisdiction Policy Engine self-service.
	// GET reads the caller's current jurisdiction (default
	// VN-79 when no row exists); PATCH updates it. Operator
	// updates go through a separate operator-only endpoint
	// (TODO: when ops tooling lands).
	mux.HandleFunc("/v1/identity/jurisdiction", s.routeJurisdiction)
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
