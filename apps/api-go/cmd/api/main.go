package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/bootenv"
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
	"github.com/proxy-app/proxy-api/internal/mockidentity"
	"github.com/proxy-app/proxy-api/internal/modelstack"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
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

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "4100"
	}
	mediaStoreDir, err := media.ResolveLocalStoreDir(os.Getenv("PROXY_MEDIA_STORE_DIR"))
	if err != nil {
		log.Fatalf("configure media store: %v", err)
	}

	if warnings := bootenv.Warnings(); len(warnings) > 0 {
		for _, w := range warnings {
			log.Printf("BOOT WARNING: %s", w)
		}
	}

	var idempotencyStore command.IdempotencyStore = command.NewMemoryIdempotencyStore()
	var readyCheck func(context.Context) error
	var authenticator api.Authenticator
	loginProvider, simulatedLogin := configuredLoginChallengeProvider()
	identityService := localIdentityService(loginProvider, simulatedLogin)
	admissionGate, fundingGate := configuredDemandGates()
	demandService := demand.New(admissionGate, fundingGate)
	cityCompanionService := citycompanion.New()
	localContextService := localcontext.New()
	modelStack := configuredModelStack()
	localNetService := localnet.NewWithModelStack(nil, modelStack)
	// R15.15 P2: in-memory 访客空流修补 — 同步跱演示帖 (Linh /
	// Mai / Huyen / Bonsaidon), 幂等:重启不会重复。不会走 PG 路径
	// (PG 路径在 migration 后会调用 seedPostgresPosts, 本 commit
	// 不动 — PG 有 25 帖, 不需要补)。
	if seedErr := localNetService.SeedDemoPosts(context.Background()); seedErr != nil {
		log.Printf("seed demo posts: %v (continuing without seed)", seedErr)
	}
	if modelStack.Available() {
		log.Printf("proxy api go model stack adapter configured (business side sends task ids only)")
	} else {
		log.Printf("proxy api go model stack adapter unconfigured (fail-closed)")
	}
	conversationService := conversation.NewWithModelStack(nil, modelStack)
	conversationService.SetMediaStoreDir(mediaStoreDir)
	engagementService := engagement.New()
	fulfillmentService := fulfillment.New()
	supplyService := supply.New()
	mediaService := media.New()
	mediaService.SetStoreDir(mediaStoreDir)
	contributionService := contribution.New()
	// Profile 域（P1，audit 2026-09-04）：默认内存仓；DATABASE_URL 存在时
	// 在 DB 分支换成 postgres.NewProfileRepository（服务端持久化名片）。
	profileService := profile.New()
	socialSpaceService := socialspace.New()
	businessService := business.New()
	relationshipService := relationship.New()
	paymentService := payment.New()
	notificationService := notification.NewWithPushProvider(nil, configuredNotificationPush())
	safetyService := safety.New()
	outcomeService := outcome.New()
	sceneService := scene.New()
	realitySceneService := realityscene.New()
	marketplaceService := marketplace.New()
	// OPP-SUGGEST-001: 发布搜索"生成"走语义层（modelstack），与
	// conversation 同一适配器；未配置时 SuggestOpportunityTemplate
	// fail-closed 明确拒绝（AI_NOT_CONFIGURED），前端隐藏生成入口。
	marketplaceService.SetModelStack(modelStack)
	// R17.x: chat → order 派生. marketplace ConfirmMarketApplication
	// 委托 fulfillment 创建真 Order, 让“我的订单”页能看见.
	// 接口定义在 marketplace package (DIP: 消费者侧),
	// fulfillment 包不需改 compile 依赖图.
	activityService := activity.New()
	facetService := facet.New()
	facetService.SeedDefaults()
	// R15.33: mapx 撤了 — /v1/map/items 不再起；LocationPicker
	// 调 /v1/geocode/reverse 拿真实地址，不需要 map service。
	experienceService := experience.New()
	voucherService := voucher.New()
	voucherService.SetSettlementCreator(voucher.LogSettlementCreator{})
	demandService.SetBatchCreator(newSupplyBatchCreator(supplyService))
	authenticator = identityService
	var transactions api.TransactionRunner
	var databaseCloser func()
	var pool *pgxpool.Pool
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		pool, err = postgres.Open(ctx, databaseURL)
		if err != nil {
			log.Fatalf("open postgres: %v", err)
		}
		databaseCloser = pool.Close
		// R15.22: 启动时自动 apply migrations (免运维手动跑 migrate CLI)。
		// 仅在 DATABASE_URL 设置 + migrations dir 可访问时跑。
		// fail-fast: 启动期 migrations 失败应该阻断 service 启动, 不是 warn 后继续。
		if migDir := os.Getenv("PROXY_MIGRATIONS_DIR"); migDir != "" {
			if _, err := os.Stat(migDir); err == nil {
				migrator := postgres.NewMigrator(pool, migDir)
				drift, driftErr := migrator.VerifyDrift(ctx)
				if driftErr != nil {
					log.Fatalf("verify migration drift: %v", driftErr)
				}
				if drift != nil {
					log.Fatalf("migration drift detected: %s (current=%s stored=%s). Run 'migrate -check-drift' and reconcile before starting service.",
						drift.Version, drift.Checksum, drift.StoredChecksum)
				}
				applied, _, applyErr := migrator.Apply(ctx, false)
				if applyErr != nil {
					log.Fatalf("auto-apply migrations: %v", applyErr)
				}
				if len(applied) > 0 {
					log.Printf("auto-applied %d migration(s): %v", len(applied), applied)
				} else {
					log.Printf("migrations up-to-date (%d applied, 0 pending)", len(func() []string {
						statuses, _ := migrator.ListMigrations(ctx)
						out := make([]string, 0, len(statuses))
						for _, s := range statuses {
							if s.Applied {
								out = append(out, s.Version)
							}
						}
						return out
					}()))
				}
			} else {
				log.Printf("PROXY_MIGRATIONS_DIR set but inaccessible: %s (skipping auto-apply)", migDir)
			}
		}
		idempotencyStore = postgres.NewIdempotencyStore(pool)
		outboxRepository := postgres.NewOutboxRepository(pool)
		readyCheck = pool.Ping
		identityService = identity.NewWithRepositoryAndClockAndChallengeProvider(postgres.NewIdentityRepositoryWithOutbox(pool, outboxRepository), nil, loginProvider)
		// Lotus §1: DisplayIdentity PG persistence (038) — wire PG repo so
		// CreateDisplayIdentity/List/Burn survive restarts.
		identityService.SetDisplayIdentityRepository(postgres.NewDisplayIdentityRepository(pool))
		// COMP-ID-001/002: self-destructing personas are refused to any
		// account with money history. The guard must read the REAL payment
		// tables — wired here, inside the `pool != nil` branch, so a
		// database-less boot leaves the lookup nil and identity fails
		// closed (no lookup == no burner) instead of answering "never
		// transacted" for everyone.
		identityService.SetTransactionHistoryLookup(postgres.NewTransactionHistoryRepository(pool))
		// R18.x PROFILE-001: Profile persistence (039) — wire PG repo
		// so the mobile '编辑主页' modal's UpdateProfile call survives
		// restarts. The IdentityRepository implements ProfileRepository.
		identityService.SetProfileRepository(postgres.NewIdentityRepository(pool))
		// R15.27 SMTP 真实发信：把 identity repo 注入 SMTP provider 的
		// email resolver, 让它能用 LoginIdentityID 查到 identifier (email).
		// 必须在 createdLoginProvider 之后、challenge 产生之前 wire.
		wireIdentityEmailResolver(identityService)
		if simulatedLogin {
			if err := seedPostgresIdentity(pool); err != nil {
				log.Fatalf("seed postgres identity: %v", err)
			}
		}
		// R15.32 / MERCHANT-CREATOR-LIVE-002: Supply seed (6 photo-ready
		// Creator profiles with a rolling availability window) used to run
		// only in simulated mode because supply.agent_profiles had FORCE
		// ROW LEVEL SECURITY with no write policy for the `proxy` role
		// (migration 065 turned that off; see the audit note there).
		// MapExploreSurface needs the agent pin layer and the merchant
		// Creator rail reads the same rows, so the seed runs on every boot
		// regardless of login provider — same rule as seedPostgresMedia.
		if err := seedPostgresSupply(pool); err != nil {
			log.Fatalf("seed postgres supply: %v", err)
		}
		// 公开种子帖长期引用这些固定媒体 ID。媒体读模型不能跟登录
		// Provider（simulated / SMTP / SMS）耦合，否则切换认证方式后会出现
		// “帖子还在但图片和视频全部消失”的静默数据断链。
		if err := seedPostgresMedia(pool); err != nil {
			log.Fatalf("seed postgres media: %v", err)
		}
		demandService = demand.NewWithRepository(admissionGate, fundingGate, postgres.NewDemandRepositoryWithOutbox(pool, outboxRepository))
		localContextService = localcontext.NewWithRepository(postgres.NewLocalContextRepository(pool))
		conversationService = conversation.NewWithModelStack(postgres.NewConversationRepository(pool), modelStack)
		conversationService.SetMediaStoreDir(mediaStoreDir)
		engagementService = engagement.NewWithRepository(postgres.NewEngagementRepository(pool))
		fulfillmentService = fulfillment.NewWithRepository(postgres.NewFulfillmentRepositoryWithOutbox(pool, outboxRepository))
		supplyService = supply.NewWithRepository(postgres.NewSupplyRepositoryWithOutbox(pool, outboxRepository))
		mediaService = media.NewWithReviewDecisionRepository(
			postgres.NewMediaRepository(pool),
			postgres.NewMediaReviewDecisionRepository(pool),
			media.NewFFmpegProcessor(mediaStoreDir),
		)
		mediaService.SetStoreDir(mediaStoreDir)
		contributionService = contribution.NewWithRepository(postgres.NewContributionRepository(pool))
		profileService = profile.NewWithRepository(postgres.NewProfileRepository(pool))
		socialSpaceService = socialspace.NewWithRepository(postgres.NewSocialSpaceRepository(pool))
		businessService = business.NewWithRepository(postgres.NewBusinessRepository(pool))
		// R36.x MENU-001: storefront photo/menu uploads go through the
		// media pipeline; attaching them to a store publishes the
		// assets to PUBLIC so thumb/play URLs resolve.
		businessService.SetMediaAuthorizer(mediaService)
		// AVATAR-DELIVER-001: 头像同样要提权——上传默认 OWNER_ONLY，
		// 公开 thumb/play 路由要求 APPROVED && PUBLIC，不提权头像恒 404。
		identityService.SetProfileMediaAuthorizer(mediaService)
		relationshipService = relationship.NewWithRepository(postgres.NewRelationshipRepository(pool))
		paymentService = payment.NewWithRepository(postgres.NewPaymentRepository(pool, outboxRepository))
		notificationService = notification.NewWithPushProvider(postgres.NewNotificationRepository(pool), configuredNotificationPush())
		safetyService = safety.NewWithRepository(postgres.NewSafetyRepository(pool))
		outcomeService = outcome.NewWithRepository(postgres.NewOutcomeRepository(pool))
		localNetService = localnet.NewWithAll(postgres.NewLocalNetRepository(pool), media.NewPostMediaLookup(mediaService), modelStack, scene.NewSceneAestheticAdapter(sceneService))
		cityCompanionService = citycompanion.NewWithRepositoryAndSupplier(postgres.NewCityCompanionRepository(pool), supply.NewCityCompanionSupplier(supplyService))
		// R15.13 P3: bind the scene aggregate to PostgreSQL when
		// DATABASE_URL is set. Without DATABASE_URL the in-memory
		// repository continues to serve (the smoke scripts rely on
		// it for hermetic, no-Docker runs).
		sceneService = scene.NewWithRepository(postgres.NewSceneRepository(pool))
		realitySceneService = realityscene.NewWithRepository(postgres.NewRealitySceneRepository(pool))
		marketplaceService = marketplace.NewWithRepository(postgres.NewMarketplaceRepository(pool))
		activityService = activity.NewWithRepository(postgres.NewActivityRepository(pool))
		facetService = facet.NewWithRepository(postgres.NewFacetRepository(pool))
		facetService.SeedDefaults()
		experienceService = experience.NewWithRepository(postgres.NewExperienceRepository(pool))
		voucherService = voucher.NewWithRepository(postgres.NewVoucherRepository(pool))
		voucherService.SetSettlementCreator(voucher.LogSettlementCreator{})
		demandService.SetBatchCreator(newSupplyBatchCreator(supplyService))
		authenticator = identityService
		transactions = postgres.NewTransactionRunner(pool)
	}
	// AI-POSTS-001: 5 小美写真资产 + 开屏帖（幂等，可重跑；只增不改，
	// 绝不删行）。放 PG 替换之后，对 memory/PG 两种仓储都生效。
	if seedErr := mediaService.SeedXiaomeiAssets(context.Background()); seedErr != nil {
		log.Printf("seed xiaomei media: %v (continuing without seed)", seedErr)
	}
	if seedErr := localNetService.SeedXiaomeiPosts(context.Background()); seedErr != nil {
		log.Printf("seed xiaomei posts: %v (continuing without seed)", seedErr)
	}
	// Wire after the optional PostgreSQL replacements. Wiring before this block
	// leaves marketplace pointing at the discarded in-memory fulfillment repo.
	marketplaceService.SetOrderCreator(marketplaceFulfillmentAdapter{repo: fulfillmentService.Repository()})
	// PROFILE-READ-001: content publishers resolve USER display names from
	// the verified account profile instead of trusting client-supplied
	// strings. Wired here so both the memory and PostgreSQL instances are
	// covered.
	authorNames := identityService.AuthorNameResolver()
	localNetService.SetAuthorNameResolver(authorNames)
	socialSpaceService.SetAuthorNameResolver(authorNames)
	marketplaceService.SetAuthorNameResolver(authorNames)
	sceneService.SetInvitationOrderCreator(sceneFulfillmentAdapter{repo: fulfillmentService.Repository()})
	databaseReadyCheck := readyCheck
	readyCheck = func(ctx context.Context) error {
		if databaseReadyCheck != nil {
			if err := databaseReadyCheck(ctx); err != nil {
				return err
			}
		}
		return mediaService.CheckStorage(ctx)
	}
	defer func() {
		if databaseCloser != nil {
			databaseCloser()
		}
	}()

	server := api.NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, authenticator, transactions)
	server.SocialSpace = socialSpaceService
	server.Business = businessService
	server.Relationship = relationshipService
	server.Payment = paymentService
	server.Notification = notificationService
	server.Safety = safetyService
	server.Outcome = outcomeService
	server.Scene = sceneService
	server.RealityScene = realitySceneService
	server.Profile = profileService
	// R15.32.1.3: /v1/geocode/reverse talks to Nominatim. Wire a
	// 4s-timeout client so a slow upstream doesn't hang the picker.
	server.HTTPClient = &http.Client{Timeout: 4 * time.Second}
	server.Facet = facetService
	server.Experience = experienceService
	server.Voucher = voucherService
	// Activity 域：启动幂等 seed 基线；DATABASE_URL 存在时写入持久仓储。
	activityService.SeedDefaults()
	server.Activity = activityService
	marketplaceService.SeedDefaults()
	server.Marketplace = marketplaceService
	// R16.7-P1-J: precise location consent ledger. We use the
	// Postgres repository when the pool is available; otherwise
	// the in-memory implementation covers tests + local dev.
	if pool != nil {
		locationRepo := postgres.NewLocationConsentRepository(pool)
		locationService := location.NewService(locationRepo)
		server.Location = locationService
		server.LocationRepo = locationRepo
	} else if identityService != nil {
		// No pool: fall back to in-memory so /v1/location/* still
		// works in dev mode (the privacy request center does the
		// same fallback). The repository is in-process so consent
		// state is lost on restart, matching the rest of the
		// in-memory dev path.
		locationRepo := location.NewMemoryRepository(time.Now)
		locationService := location.NewService(locationRepo)
		server.Location = locationService
		server.LocationRepo = locationRepo
	}
	// R16.7-P1-G: remote legal kill switch. Same wiring shape
	// as the location service: Postgres when the pool is
	// available, in-memory otherwise.
	if pool != nil {
		complianceRepo := postgres.NewKillSwitchRepository(pool)
		complianceService := compliance.NewService(complianceRepo)
		server.Compliance = complianceService
	} else {
		complianceRepo := compliance.NewMemoryRepository(time.Now)
		complianceService := compliance.NewService(complianceRepo)
		server.Compliance = complianceService
	}
	// R16.7-P1-B (LC-28): wire the policydecisions service so
	// PLATFORM_PAY Orders cannot reach CONFIRMED without a
	// stamped policy decision. The (user, category, terms,
	// privacy) tuple is unique inside one process; cross-
	// process uniqueness is enforced by the UNIQUE constraint
	// in migration 065 once the PG repository is wired. We
	// use the in-memory repository for now; the Postgres
	// implementation is a follow-up so this commit does not
	// blow up boot ordering. The kill-switch provider is a
	// thin bridge to server.Compliance so the snapshot on
	// each decision reflects the live state at decision time.
	policyRepo := policydecisions.NewMemoryRepository()
	policySvc := policydecisions.NewService(policyRepo,
		"terms-1.1",
		"privacy-1.1",
		func() policydecisions.KillSwitchState {
			if server.Compliance == nil {
				return policydecisions.KillSwitchState{Categories: map[string]policydecisions.KillSwitchEntry{}}
			}
			st, err := server.Compliance.GlobalStatus(ctx)
			if err != nil {
				return policydecisions.KillSwitchState{Categories: map[string]policydecisions.KillSwitchEntry{}}
			}
			out := policydecisions.KillSwitchState{Categories: map[string]policydecisions.KillSwitchEntry{}}
			for k, v := range st {
				out.Categories[k] = policydecisions.KillSwitchEntry{Reason: v.Reason, SetBy: v.SetBy, SetAt: v.SetAt}
			}
			return out
		})
	fulfillmentService.WithPolicyDecisions(policySvc)
	server.PolicyDecisions = policySvc
	// R16.7-P1-K (LC-06) + R16.7-P1-I (LC-07): wire the AI
	// persona service so the media service can fail closed
	// when AI media carries no provenance (LC-06) and so a
	// USER_TWIN persona cannot publish likeness-bearing
	// media without a live consent (LC-07). Memory repo
	// again — the Postgres implementation is a follow-up
	// once the rest of the media data path moves into the
	// transactional outbox.
	var personaRepo aipersona.Repository = aipersona.NewMemoryRepository()
	if pool != nil {
		personaRepo = postgres.NewAIPersonaRepository(pool)
	}
	personaSvc := aipersona.NewService(personaRepo, "terms-1.1")
	mediaService.WithAIPersonaService(personaSvc)
	server.AIPersona = personaSvc
	// R16.7-P1-E: Jurisdiction Policy Engine. The
	// jurisdiction service looks up the requester's
	// (country, region) for the policy decision; the
	// fulfillment service consumes it via a forward-
	// declared interface. We wire the in-memory repo
	// here; the Postgres implementation is a follow-up
	// once the rest of the policy stack moves into the
	// transactional outbox.
	var jurisdictionRepo jurisdiction.Repository = jurisdiction.NewMemoryRepository()
	if pool != nil {
		jurisdictionRepo = postgres.NewJurisdictionRepository(pool)
	}
	jurisdictionSvc := jurisdiction.NewService(jurisdictionRepo)
	// Fulfillment consumes the resolver through a
	// one-method bridge so the fulfillment package does
	// not import the jurisdiction package directly
	// (one-way dependency: api -> both).
	fulfillmentService.WithJurisdictionResolver(jurisdictionAdapter{svc: jurisdictionSvc})
	server.Jurisdiction = jurisdictionSvc
	// R0 / R16.7-P1-H prep: Benefit Routing Network. No Postgres
	// repo is shipped yet (memory_repo.go is the only implementation);
	// we use the memory repo in both pool and no-pool paths so
	// /v1/commands/{CreateCampaign,ClaimBenefit,RedeemBenefit,...}
	// is reachable end-to-end. The eligibility engine is wired
	// inside NewService and fires on every Claim / Redeem.
	benefitRepo := benefit.NewMemoryRepository()
	benefitService := benefit.NewService(benefitRepo)
	server.Benefit = benefitService
	// Operator 门禁白名单（env PROXY_OPERATOR_PRINCIPALS，逗号分隔 principal id）。
	// 未配置时 fail-closed：特权命令（审核/发奖/能力核验/媒体就绪覆盖）一律拒绝。
	if operatorPrincipals := os.Getenv("PROXY_OPERATOR_PRINCIPALS"); operatorPrincipals != "" {
		server.Operator = api.NewStaticOperatorGate(strings.Split(operatorPrincipals, ","))
	}
	address := ":" + port
	if simulatedLogin {
		log.Printf("proxy api go listening on %s with LOCAL simulated login provider", address)
	} else {
		log.Printf("proxy api go listening on %s", address)
	}
	httpServer := &http.Server{
		Addr:              address,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
	}()

	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func configuredLoginChallengeProvider() (identity.LoginChallengeProvider, bool) {
	mode := os.Getenv("PROXY_LOGIN_PROVIDER")
	switch mode {
	case "simulated":
		return identity.NewSimulatedLoginChallengeProvider(os.Getenv("PROXY_SIMULATED_OTP_CODE")), true
	case "smtp":
		// R16.6: fail-fast if smtp mode declared but SMTP env is missing.
		// Without this guard, an operator who exports PROXY_LOGIN_PROVIDER=smtp
		// without sourcing .env ends up with UnconfiguredLoginChallengeProvider
		// — login challenges REJECTED, no email is sent, users see "no OTP
		// arrived" without any boot-time signal. Catch it at boot.
		if os.Getenv("PROXY_SMTP_HOST") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=smtp but PROXY_SMTP_HOST is empty; source .env (PROXY_SMTP_*) before starting the API. Refusing to run with login provider fail-closed.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	case "sms":
		if os.Getenv("PROXY_SMS_URL") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=sms but PROXY_SMS_URL is empty; configure SMS provider before starting the API.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	case "production":
		if os.Getenv("PROXY_SMTP_HOST") == "" && os.Getenv("PROXY_SMS_URL") == "" {
			log.Fatalf("PROXY_LOGIN_PROVIDER=production but neither PROXY_SMTP_HOST nor PROXY_SMS_URL is set; configure one before starting the API.")
		}
		return configuredProductionLoginChallengeProvider(mode)
	default:
		return identity.UnconfiguredLoginChallengeProvider{}, false
	}
}

// configuredProductionLoginChallengeProvider wires up the production
// LoginChallengeProvider by reading env. It always returns a non-nil
// provider: if the required env is missing, it returns a fail-closed
// UnconfiguredLoginChallengeProvider and the (provider, simulated) tuple
// is set so /health/ready surfaces the misconfiguration. A mode of
// "production" means: use SMTP if PROXY_SMTP_HOST is set, otherwise SMS
// if PROXY_SMS_URL is set, otherwise fail-closed.
func configuredProductionLoginChallengeProvider(mode string) (identity.LoginChallengeProvider, bool) {
	host := os.Getenv("PROXY_SMTP_HOST")
	url := os.Getenv("PROXY_SMS_URL")
	var smtpProvider *identity.SMTPLoginChallengeProvider
	var smsProvider *identity.SMSHTTPLoginChallengeProvider
	if (mode == "smtp" || mode == "production") && host != "" {
		portStr := os.Getenv("PROXY_SMTP_PORT")
		port, err := strconv.Atoi(portStr)
		if err != nil || port <= 0 {
			log.Printf("PROXY_SMTP_PORT invalid (%q); smtp provider disabled", portStr)
		} else {
			smtpProvider = identity.NewSMTPLoginChallengeProvider(identity.SMTPConfig{
				Host:     host,
				Port:     port,
				Username: os.Getenv("PROXY_SMTP_USERNAME"),
				Password: os.Getenv("PROXY_SMTP_PASSWORD"),
				From:     os.Getenv("PROXY_SMTP_FROM"),
				TLSMode:  os.Getenv("PROXY_SMTP_TLS"),
				Logger:   slog.Default(),
			})
			if !smtpProvider.Configured() {
				log.Printf("SMTP provider disabled: PROXY_SMTP_HOST, PROXY_SMTP_PORT and PROXY_SMTP_FROM must all be valid")
				smtpProvider = nil
			}
		}
	}

	// Per-domain SMTP routes (R15.28): allow Gmail/QQ/163/126 etc. to be
	// served by their local SMTP backends so mainland-China users (where
	// Gmail is blocked) still receive OTP mail. If no routes are
	// configured, fall through to the single `smtpProvider` above.
	var smtpMultiProvider *identity.SMTPMultiProvider
	if mode == "smtp" || mode == "production" {
		routeDomains := os.Getenv("PROXY_SMTP_ROUTE_DOMAINS")
		if routeDomains != "" {
			var defaultCfg identity.SMTPConfig
			if smtpProvider != nil {
				defaultCfg = identity.SMTPConfig{
					Host: host, Port: parseSMTPPortOrZero(os.Getenv("PROXY_SMTP_PORT")),
					Username: os.Getenv("PROXY_SMTP_USERNAME"),
					Password: os.Getenv("PROXY_SMTP_PASSWORD"),
					From:     os.Getenv("PROXY_SMTP_FROM"),
					TLSMode:  os.Getenv("PROXY_SMTP_TLS"),
					Logger:   slog.Default(),
				}
			}
			var routes []identity.SMTPMultiRoute
			for _, dom := range strings.Split(routeDomains, ",") {
				dom = strings.TrimSpace(dom)
				if dom == "" {
					continue
				}
				// env-var naming rule: dots in the domain are converted
				// to underscores so the variable is a legal shell
				// identifier (e.g. gmail.com -> GMAIL_COM).
				prefix := "PROXY_SMTP_ROUTE_" + strings.ReplaceAll(strings.ToUpper(dom), ".", "_") + "_"
				host := os.Getenv(prefix + "HOST")
				if host == "" {
					log.Printf("SMTP-ROUTES-DEBUG: no host env for domain %q (looked for %s)", dom, prefix+"HOST")
					continue
				}
				port := parseSMTPPortOrZero(os.Getenv(prefix + "PORT"))
				if port == 0 {
					port = 587
				}
				routes = append(routes, identity.SMTPMultiRoute{
					Domain: dom,
					Cfg: identity.SMTPConfig{
						Host:     host,
						Port:     port,
						Username: os.Getenv(prefix + "USERNAME"),
						Password: os.Getenv(prefix + "PASSWORD"),
						From:     os.Getenv(prefix + "FROM"),
						TLSMode:  os.Getenv(prefix + "TLS"),
						Logger:   slog.Default(),
					},
				})
			}
			if len(routes) > 0 {
				smtpMultiProvider = identity.NewSMTPMultiProvider(defaultCfg, routes, slog.Default())
				if !smtpMultiProvider.Configured() {
					log.Printf("SMTP route provider disabled: no route has HOST, PORT and FROM configured")
					smtpMultiProvider = nil
				}
			}
		}
	}
	if (mode == "sms" || mode == "production") && url != "" {
		smsProvider = buildSMSProvider(os.Getenv("PROXY_SMS_PROVIDER"), identity.SMSConfig{
			URL:    url,
			From:   os.Getenv("PROXY_SMS_FROM"),
			Token:  os.Getenv("PROXY_SMS_TOKEN"),
			Logger: slog.Default(),
		})
	}
	// Dev-only smoke resolvers: when PROXY_SMTP_TEST_RECIPIENT is set we
	// hand every EMAIL LoginChallengeRequest a fixed recipient instead of
	// looking the LoginIdentity up in storage. The production path
	// (LoginIdentityID → identifier via PG) is wired in main() via
	// wireIdentityEmailResolver(identityService) after the PG repo is open.
	if smtpProvider != nil {
		if testRecipient := os.Getenv("PROXY_SMTP_TEST_RECIPIENT"); testRecipient != "" {
			identity.RegisterLoginIdentityEmailResolver(func(string) (string, bool) {
				return testRecipient, true
			})
		}
	}
	if smsProvider != nil {
		if testPhone := os.Getenv("PROXY_SMS_TEST_PHONE"); testPhone != "" {
			identity.RegisterLoginIdentityPhoneResolver(func(string) (string, bool) {
				return testPhone, true
			})
		}
	}
	// mode == "production" with no concrete env produces a router with
	// no concrete providers; that is intentionally fail-closed. mode
	// "smtp" / "sms" with the required env set produces a router with
	// one real provider.
	var emailProvider identity.LoginChallengeProvider
	switch {
	case smtpMultiProvider != nil:
		emailProvider = smtpMultiProvider
	case smtpProvider != nil:
		emailProvider = smtpProvider
	}
	var smsProviderIface identity.LoginChallengeProvider
	if smsProvider != nil {
		smsProviderIface = smsProvider
	}
	router := identity.NewChannelRouter(emailProvider, smsProviderIface)
	if smtpProvider == nil && smsProvider == nil && smtpMultiProvider == nil {
		log.Printf("PROXY_LOGIN_PROVIDER=%s but no SMTP/SMS env set; login provider fail-closed", mode)
		return identity.UnconfiguredLoginChallengeProvider{}, false
	}
	routesActive := 0
	if smtpMultiProvider != nil {
		domains := strings.Split(os.Getenv("PROXY_SMTP_ROUTE_DOMAINS"), ",")
		for _, d := range domains {
			if strings.TrimSpace(d) != "" {
				routesActive++
			}
		}
	}
	log.Printf("PROXY_LOGIN_PROVIDER=%s: smtp=%v smtp_routes=%d sms=%v", mode, smtpProvider != nil, routesActive, smsProvider != nil)
	return router, false
}

// configuredModelStack 装配公共模型底座适配器。业务侧契约：只发任务 ID，
// 模型选择/Provider/凭证/failover 全部由底座负责。任一配置缺失时返回
// fail-closed 的 Unconfigured 适配器，Domain 能力视为不可用。
func configuredModelStack() modelstack.Port {
	if strings.EqualFold(os.Getenv("MODELSTACK_USE_PI_CONFIG"), "true") {
		modelsPath := os.Getenv("MODELSTACK_PI_MODELS_PATH")
		settingsPath := os.Getenv("MODELSTACK_PI_SETTINGS_PATH")
		if modelsPath == "" || settingsPath == "" {
			log.Printf("MODELSTACK_USE_PI_CONFIG=true but Pi config paths are missing; model tasks fail-closed")
			return modelstack.Unconfigured{}
		}
		provider, err := modelstack.NewFromPiConfig(modelsPath, settingsPath)
		if err != nil {
			log.Printf("Pi model-stack adapter unavailable: %v", err)
			return modelstack.Unconfigured{}
		}
		log.Printf("model-stack development adapter enabled from Pi provider registry")
		return provider
	}
	controlPlaneURL := os.Getenv("MODELSTACK_CONTROL_PLANE_URL")
	gatewayURL := os.Getenv("MODELSTACK_GATEWAY_URL")
	gatewayAPIKey := os.Getenv("MODELSTACK_GATEWAY_API_KEY")
	if controlPlaneURL == "" || gatewayURL == "" || gatewayAPIKey == "" {
		return modelstack.Unconfigured{}
	}
	return modelstack.New(controlPlaneURL, gatewayURL, gatewayAPIKey)
}

// seedPostgresMedia 幂等写入演示媒体资产（READY，storage key 指向 media_store 现有文件）。
// 固定 ID 供前端种子帖引用（新架构：前端只拿服务端下发的 playbackUrl）。
func seedPostgresMedia(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Now().UTC()
	assets := []struct {
		id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
		width, height                                                  int
		durationMs                                                     int64
	}{
		{"seed_media_hoankiem", "IMAGE", "dkq8mi3yf254_thumb.jpg", "dkq8mi3yf254_thumb.jpg", "dkq8mi3yf254_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_coffee", "IMAGE", "dkq8n8mjr34w_thumb.jpg", "dkq8n8mjr34w_thumb.jpg", "dkq8n8mjr34w_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_westlake", "IMAGE", "dkq8noieylig_thumb.jpg", "dkq8noieylig_thumb.jpg", "dkq8noieylig_thumb.jpg", "image/jpeg", "", 480, 360, 0},
		{"seed_media_route_video", "VIDEO", "dkq8qwqitirc_playback.mp4", "dkq8qwqitirc_playback.mp4", "dkq8qwqitirc_thumb.jpg", "video/mp4", "h264", 1080, 1920, 9833},
		{"seed_media_opening_video", "VIDEO", "dkq8mi3yf254_playback.mp4", "dkq8mi3yf254_playback.mp4", "dkq8mi3yf254_thumb.jpg", "video/mp4", "h264", 320, 240, 2020},
	}
	appendImage := func(id, key string, width, height int) {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{id, "IMAGE", key, key, key, "image/jpeg", "", width, height, 0})
	}
	for _, group := range []struct {
		kind, prefix string
		height       int
		names        []string
	}{
		{"action", "scene_r42_action", 267, []string{"cycling", "shopping", "movie", "music", "food-hunting", "travel", "sport"}},
		{"scene", "scene_r42_scene", 250, []string{"old-town", "beach", "park", "mall", "restaurant", "cafe", "night-market", "event"}},
		{"theme", "scene_r42_theme", 247, []string{"night", "retro", "vietnam", "nature", "art", "daily", "festival", "local"}},
		{"moment", "scene_r42_moment", 260, []string{"morning", "daytime", "sunset", "night", "friends", "solo", "couple", "family"}},
	} {
		for _, name := range group.names {
			appendImage("seed_r42_v2_"+group.kind+"_"+name, group.prefix+"_"+name+"_v2.jpg", 168, group.height)
		}
	}
	for _, service := range []struct {
		name   string
		height int
	}{
		{"business-companion", 225}, {"administrative-companion", 225},
		{"housing-viewing", 227}, {"sim-setup", 227}, {"study-exchange", 227},
		{"content-creation", 227}, {"local-guide", 227},
	} {
		appendImage("seed_scene_service_"+service.name+"_v1", "scene_service_"+service.name+"_v1.jpg", 248, service.height)
	}
	// R42 scene/action editorial samples live in the server media store, never
	// in the mobile bundle. Stable IDs let the catalog change independently of
	// an App Store build while the files can later move to object storage/CDN.
	for row := 0; row < 3; row++ {
		for col := 0; col < 6; col++ {
			id := fmt.Sprintf("seed_scene_action_primary_%d_%d", row, col)
			key := fmt.Sprintf("scene_action_primary_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 250, 288, 0})
		}
	}
	extendedHeights := []int{242, 232, 226, 235}
	for row, height := range extendedHeights {
		for col := 0; col < 6; col++ {
			id := fmt.Sprintf("seed_scene_action_extended_%d_%d", row, col)
			key := fmt.Sprintf("scene_action_extended_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 250, height, 0})
		}
	}
	for row := 0; row < 3; row++ {
		for col := 0; col < 5; col++ {
			id := fmt.Sprintf("seed_scene_theme_%d_%d", row, col)
			key := fmt.Sprintf("scene_theme_%d_%d.jpg", row, col)
			assets = append(assets, struct {
				id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
				width, height                                                  int
				durationMs                                                     int64
			}{id, "IMAGE", key, key, key, "image/jpeg", "", 303, 336, 0})
		}
	}
	for _, portrait := range []struct{ id, key string }{
		{"seed_scene_aodai_rooftop", "scene_aodai_rooftop.jpg"},
		{"seed_scene_aodai_oldtown", "scene_aodai_oldtown.jpg"},
	} {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{portrait.id, "IMAGE", portrait.key, portrait.key, portrait.key, "image/jpeg", "", 1122, 1402, 0})
	}
	// R135 hospital language/companion samples are deliberately separate
	// network assets. The emergency reference crop is retained in storage for
	// editorial use, but is not exposed by the matchmaking catalog.
	for _, medical := range []struct {
		id, key       string
		width, height int
	}{
		{"seed_scene_medical_hero_v1", "scene_medical_hero_v1.jpg", 688, 422},
		{"seed_scene_medical_registration_v1", "scene_medical_registration_v1.jpg", 224, 211},
		{"seed_scene_medical_doctor_translation_v1", "scene_medical_doctor_translation_v1.jpg", 224, 211},
		{"seed_scene_medical_examination_v1", "scene_medical_examination_v1.jpg", 202, 211},
		{"seed_scene_medical_pharmacy_v1", "scene_medical_pharmacy_v1.jpg", 198, 211},
		{"seed_scene_medical_communication_v1", "scene_medical_communication_v1.jpg", 224, 211},
		{"seed_scene_medical_stay_v1", "scene_medical_stay_v1.jpg", 224, 211},
		{"seed_scene_medical_checkup_v1", "scene_medical_checkup_v1.jpg", 202, 211},
		{"seed_scene_medical_hospital_v1", "scene_medical_hospital_v1.jpg", 205, 235},
		{"seed_scene_medical_information_v1", "scene_medical_information_v1.jpg", 205, 235},
		{"seed_scene_medical_waiting_v1", "scene_medical_waiting_v1.jpg", 230, 235},
		{"seed_scene_medical_companion_v1", "scene_medical_companion_v1.jpg", 222, 235},
	} {
		assets = append(assets, struct {
			id, mediaType, originalKey, playbackKey, thumbKey, mime, codec string
			width, height                                                  int
			durationMs                                                     int64
		}{medical.id, "IMAGE", medical.key, medical.key, medical.key, "image/jpeg", "", medical.width, medical.height, 0})
	}
	// MEDIA-FILE-001: a seed row claiming READY for bytes that are not on disk
	// is the same lie the read model used to tell — a URL that 404s, which the
	// client renders as a black frame. It also re-asserts itself on every boot,
	// so quarantining the row by hand never sticks. Derive the status from the
	// filesystem instead.
	storeDir, err := media.ResolveLocalStoreDir(os.Getenv("PROXY_MEDIA_STORE_DIR"))
	if err != nil {
		return err
	}
	for _, a := range assets {
		status := "READY"
		if _, statErr := os.Stat(filepath.Join(storeDir, a.playbackKey)); statErr != nil {
			status = "FAILED"
			log.Printf("seed media %s has no bytes at %s; marking FAILED instead of READY", a.id, a.playbackKey)
		}
		// First-party editorial assets are owned by the PLATFORM principal.
		// Never attribute system content to a synthetic individual account.
		if _, err := pool.Exec(ctx, `
			INSERT INTO media.media_assets (
				media_asset_id, owner_principal_type, owner_principal_id, media_type,
				original_storage_key, playback_storage_key, thumbnail_storage_key,
				mime_type, width, height, duration_ms, codec,
				processing_status, playback_url, thumbnail_url, moderation_status, visibility_class, created_at, updated_at
			) VALUES ($1,'PLATFORM','seed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'APPROVED','PUBLIC',$14,$14)
			ON CONFLICT (media_asset_id) DO UPDATE SET
				owner_principal_type=EXCLUDED.owner_principal_type,
				owner_principal_id=EXCLUDED.owner_principal_id,
				playback_storage_key=EXCLUDED.playback_storage_key,
				thumbnail_storage_key=EXCLUDED.thumbnail_storage_key,
				processing_status=EXCLUDED.processing_status, moderation_status='APPROVED', visibility_class='PUBLIC', updated_at=EXCLUDED.updated_at`,
			a.id, a.mediaType, a.originalKey, a.playbackKey, a.thumbKey, a.mime,
			a.width, a.height, a.durationMs, a.codec, status,
			"/v1/media/play/"+a.id, "/v1/media/thumb/"+a.id, now); err != nil {
			return err
		}
	}
	return nil
}

// seedPostgresIdentity 在 simulated 模式把开发用户幂等写入 Postgres
// （与 localIdentityService 的 memory seed 对齐，保证模拟登录在 DB 模式可用）。
func seedPostgresIdentity(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// user_accounts
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.user_accounts (id, status) VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
		"user_001", "ACTIVE"); err != nil {
		return err
	}
	// login_identities
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.login_identities (id, user_account_id, verified, status, channel, identifier)
		VALUES ($1, $2, TRUE, 'ACTIVE', 'PHONE', 'jvn')
		ON CONFLICT (id) DO UPDATE SET verified = TRUE, status = 'ACTIVE'`,
		"login_001", "user_001"); err != nil {
		return err
	}
	// memberships
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status)
		VALUES ('INDIVIDUAL', 'user_001', 'user_001', 'ACTIVE')
		ON CONFLICT (principal_type, principal_id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status)
		VALUES ('BUSINESS', 'business_001', 'user_001', 'ACTIVE')
		ON CONFLICT (principal_type, principal_id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	// devices
	if _, err := pool.Exec(ctx, `
		INSERT INTO identity.device_registrations (id, user_account_id, platform, status)
		VALUES ('device_001', 'user_001', 'IOS', 'ACTIVE')
		ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`); err != nil {
		return err
	}
	return nil
}

type creatorSeedProfile struct {
	agentID, name, bio string
	languages, areas   []string
}

func merchantCreatorSeedProfiles() []creatorSeedProfile {
	// IDENTITY-ID-001: 头像不再写死外链。候选头像由账号 id 派生（见
	// creatorAvatarPath），与 identity.profiles.avatar_path 指向同一媒体资产——
	// 同一个人的头像只有一处事实源，谁也不会「首页一个新、发布订单一个旧」。
	return []creatorSeedProfile{
		{"agent_linh", "Linh", "河内本地向导，中文流利，擅长摄影", []string{"ZH", "VI"}, []string{"hn"}},
		{"agent_mai", "Mai", "河内本地人，越南语向导", []string{"VI"}, []string{"hn"}},
		{"agent_an", "An", "河内活动接待，熟悉咖啡与餐厅场景", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_thao", "Thao", "河内中越口译与活动协作 Creator", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_yen", "Yen", "河内生活方式 Creator，擅长到店内容", []string{"VI", "ZH"}, []string{"hn"}},
		{"agent_minh", "Minh", "胡志明市中文向导", []string{"ZH"}, []string{"hcm"}},
	}
}

// creatorAccountID / creatorAvatarPath 委托给 mockidentity（唯一事实源）：
// 身份映射只允许有一处实现，避免各 surface 再各自硬编码姓名/头像。
func creatorAccountID(agentID string) string {
	return mockidentity.AccountIDForFacetKey(strings.TrimPrefix(agentID, "agent_"))
}

func creatorAvatarPath(agentID string) string {
	return mockidentity.AvatarPathForFacetKey(strings.TrimPrefix(agentID, "agent_"))
}

func merchantCreatorAvailability(now time.Time) (time.Time, time.Time) {
	return now.Add(time.Hour), now.Add(72 * time.Hour)
}

// creatorAccountID 由固定 facet 键（agent_id）确定性派生出系统账号 id。
// 与可编辑的显示名解耦：改名字不动 id，同名不同人也能区分。

// creatorCity 把服务区映射为账号 profile 的城市（profile 要求 1..60 字符）。
func creatorCity(areas []string) string {
	if len(areas) > 0 && areas[0] == "hcm" {
		return "Ho Chi Minh City"
	}
	return "Hanoi"
}

// seedPostgresSupply 写入可用于商家 Creator 推荐的真实测试 Agent。
// Linh：河内，中文+越南语 VERIFIED+摄影，120 万
// Mai：河内，仅越南语 VERIFIED，100 万（中文查询应被过滤）
// Minh：胡志明市，中文 VERIFIED，110 万（河内查询应被过滤）
func seedPostgresSupply(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Now().UTC()
	// Agent Profile
	profiles := merchantCreatorSeedProfiles()
	for _, p := range profiles {
		photos, _ := json.Marshal([]string{creatorAvatarPath(p.agentID)})
		languages, _ := json.Marshal(p.languages)
		areas, _ := json.Marshal(p.areas)
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7)
			ON CONFLICT (agent_id) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio,
				photos=EXCLUDED.photos, languages=EXCLUDED.languages, service_areas=EXCLUDED.service_areas, status='ACTIVE', updated_at=EXCLUDED.updated_at`,
			p.agentID, p.name, p.bio, photos, languages, areas, now); err != nil {
			return err
		}
		// IDENTITY-ID-001: mock Creator 同样必须是「有系统 id 的账号」，不能只有手写
		// agent_id + 显示名 —— 否则同一显示名在不同页面各持一份头像，无法判断是否同一个人。
		// 账号 id 由 agent_id（固定 facet 键）确定性派生，与可编辑的显示名无关，保证幂等；
		// 名字改了不影响身份，同名也不会互相串头像。
		accountID := creatorAccountID(p.agentID)
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
			VALUES ($1,'REGISTERED',$2,$2)
			ON CONFLICT (id) DO NOTHING`, accountID, now); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
			VALUES ($1,$2,$3,$4,$5,'',1,$6)
			ON CONFLICT (user_account_id) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio,
				city=EXCLUDED.city, updated_at=EXCLUDED.updated_at`,
			accountID, p.name, "creator_"+strings.TrimPrefix(p.agentID, "agent_"), p.bio, creatorCity(p.areas), now); err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, `UPDATE supply.agent_profiles SET user_account_id=$1 WHERE agent_id=$2`, accountID, p.agentID); err != nil {
			return err
		}
	}
	// Agent Service（CITY_COMPANION）
	services := []struct {
		agentID string
		price   int64
		markets []string
	}{
		{"agent_linh", 1200000, []string{"hn"}},
		{"agent_mai", 1000000, []string{"hn"}},
		{"agent_an", 900000, []string{"hn"}},
		{"agent_thao", 1300000, []string{"hn"}},
		{"agent_yen", 1050000, []string{"hn"}},
		{"agent_minh", 1100000, []string{"hcm"}},
	}
	for _, svc := range services {
		markets, _ := json.Marshal(svc.markets)
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_services (agent_id, service_type, status, reference_price, currency, markets, updated_at)
			VALUES ($1,'CITY_COMPANION','ACTIVE',$2,'VND',$3,$4)
			ON CONFLICT (agent_id, service_type) DO UPDATE SET status='ACTIVE',
				reference_price=EXCLUDED.reference_price, markets=EXCLUDED.markets, updated_at=EXCLUDED.updated_at`,
			svc.agentID, svc.price, markets, now); err != nil {
			return err
		}
	}
	// Capability（declared + verified 分开）
	caps := []struct {
		agentID, capability string
		verified            bool
	}{
		{"agent_linh", "ZH", true}, {"agent_linh", "VI", true}, {"agent_linh", "PHOTOGRAPHY", true},
		{"agent_mai", "VI", true}, {"agent_mai", "ZH", false},
		{"agent_an", "VI", true}, {"agent_an", "ZH", true},
		{"agent_thao", "VI", true}, {"agent_thao", "ZH", true},
		{"agent_yen", "VI", true}, {"agent_yen", "ZH", true},
		{"agent_minh", "ZH", true},
	}
	for _, c := range caps {
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.capabilities (agent_id, capability, declared, verified, updated_at)
			VALUES ($1,$2,TRUE,$3,$4)
			ON CONFLICT (agent_id, capability) DO UPDATE SET declared=TRUE, verified=EXCLUDED.verified, updated_at=EXCLUDED.updated_at`,
			c.agentID, c.capability, c.verified, now); err != nil {
			return err
		}
	}
	// CapabilityVerification 记录
	verifications := []struct {
		id, agentID, capability string
	}{
		{"cv_linh_zh", "agent_linh", "ZH"}, {"cv_linh_vi", "agent_linh", "VI"}, {"cv_linh_photo", "agent_linh", "PHOTOGRAPHY"},
		{"cv_mai_vi", "agent_mai", "VI"},
		{"cv_an_vi", "agent_an", "VI"}, {"cv_an_zh", "agent_an", "ZH"},
		{"cv_thao_vi", "agent_thao", "VI"}, {"cv_thao_zh", "agent_thao", "ZH"},
		{"cv_yen_vi", "agent_yen", "VI"}, {"cv_yen_zh", "agent_yen", "ZH"},
		{"cv_minh_zh", "agent_minh", "ZH"},
	}
	for _, v := range verifications {
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.capability_verifications (id, agent_id, capability, status, method, verified_by, verified_at, expires_at, created_at)
			VALUES ($1,$2,$3,'VERIFIED','INTERVIEW','ops_001',$4,$5,$4)
			ON CONFLICT (id) DO UPDATE SET status='VERIFIED'`,
			v.id, v.agentID, v.capability, now, now.AddDate(1, 0, 0)); err != nil {
			return err
		}
	}
	// AvailabilityWindow is a rolling projection refreshed at every boot. A
	// fixed one-day seed becomes permanently stale after its first launch.
	windowStart, windowEnd := merchantCreatorAvailability(now)
	agents := []string{"agent_linh", "agent_mai", "agent_an", "agent_thao", "agent_yen", "agent_minh"}
	for _, agentID := range agents {
		marketID := "hn"
		if agentID == "agent_minh" {
			marketID = "hcm"
		}
		if _, err := pool.Exec(ctx, `
				INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,$6)
				ON CONFLICT (id) DO UPDATE SET start_at=EXCLUDED.start_at, end_at=EXCLUDED.end_at,
					market_id=EXCLUDED.market_id, status='AVAILABLE', updated_at=EXCLUDED.updated_at`,
			"aw_"+agentID, agentID, windowStart, windowEnd, marketID, now); err != nil {
			return err
		}
	}
	return nil
}

func localIdentityService(provider identity.LoginChallengeProvider, simulated bool) *identity.Service {
	if !simulated {
		return identity.NewWithRepositoryAndClockAndChallengeProvider(identity.NewMemoryRepository(nil), nil, provider)
	}
	return identity.NewWithRepositoryAndClockAndChallengeProvider(identity.NewMemoryRepository(&identity.Seed{
		User:          identity.UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: identity.LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships: []identity.Membership{
			{Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
			{Principal: command.Principal{Type: "BUSINESS", ID: "business_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
		},
		Devices: []identity.DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
	}), nil, provider)
}

func configuredDemandGates() (demand.Gate, demand.Gate) {
	if v := strings.TrimSpace(os.Getenv("PROXY_DEMAND_GATES")); strings.EqualFold(v, "allow") {
		allow := func(*demand.TaskDraft, command.Envelope) demand.GateDecision {
			return demand.GateDecision{Status: "ALLOW"}
		}
		log.Printf("proxy demand gates: ALLOW (PROXY_DEMAND_GATES=allow) — PublishTask will ACCEPT in this environment")
		return allow, allow
	}
	// 真实闸：catalog / funding 校验，正确 payload 下直接 ACCEPT，无需 env
	return demand.CatalogAdmissionGate, demand.FundingGate
}

func configuredNotificationPush() notification.PushProvider {
	if v := strings.TrimSpace(os.Getenv("NOTIFICATION_PUSH")); strings.EqualFold(v, "off") || strings.EqualFold(v, "disabled") {
		log.Printf("notification push: disabled (NOTIFICATION_PUSH=off)")
		return nil
	}
	return notification.LogPushProvider{}
}

func newSupplyBatchCreator(supplyService *supply.Service) demand.BatchCreator {
	return &demand.SupplyBatchCreator{
		CreateFunc: func(ctx context.Context, draft demand.TaskDraft) error {
			startAt, _ := draft.Changes["startAt"].(string)
			endAt, _ := draft.Changes["endAt"].(string)
			if startAt == "" {
				return nil
			}
			durationH := 8
			if s, err := time.Parse(time.RFC3339, startAt); err == nil {
				if e, err2 := time.Parse(time.RFC3339, endAt); err2 == nil {
					h := int(e.Sub(s).Hours())
					if h > 0 && h <= 24 {
						durationH = h
					}
				}
			}
			marketID := "hn"
			if loc, ok := draft.Changes["location"].(map[string]any); ok {
				if label, ok := loc["label"].(string); ok && (label == "HCM" || label == "hcm" || label == "胡志明") {
					marketID = "hcm"
				}
			}
			// languages / capabilities from mustRequirements + slotGroups (dynamic, not hard-coded)
			languagesSet := map[string]bool{}
			capabilitiesSet := map[string]bool{}
			collectLangCap := func(s string) {
				ls := strings.ToLower(s)
				if strings.Contains(ls, "zh") || strings.Contains(ls, "中文") || strings.Contains(ls, "chinese") {
					languagesSet["ZH"] = true
				} else if strings.Contains(ls, "vi") || strings.Contains(ls, "越南") {
					languagesSet["VI"] = true
				} else if strings.Contains(ls, "en") || strings.Contains(ls, "英语") || strings.Contains(ls, "english") {
					languagesSet["EN"] = true
				} else if ls != "" {
					// treat as capability code (upper)
					capabilitiesSet[strings.ToUpper(strings.TrimSpace(s))] = true
				}
			}
			if reqs, ok := draft.Changes["mustRequirements"].([]any); ok {
				for _, r := range reqs {
					if s, ok := r.(string); ok {
						collectLangCap(s)
					}
				}
			}
			if groups, ok := draft.Changes["slotGroups"].([]any); ok {
				for _, g := range groups {
					if gm, ok := g.(map[string]any); ok {
						if role, ok := gm["roleId"].(string); ok {
							collectLangCap(role)
						}
					}
				}
			}
			var languages []string
			for k := range languagesSet {
				languages = append(languages, k)
			}
			var capabilities []string
			for k := range capabilitiesSet {
				capabilities = append(capabilities, k)
			}
			payload := map[string]any{
				"needId":    draft.ID,
				"marketId":  marketID,
				"startAt":   startAt,
				"durationH": durationH,
			}
			if len(languages) > 0 {
				payload["languages"] = languages
			}
			if len(capabilities) > 0 {
				payload["capabilities"] = capabilities
			}
			env := command.Envelope{
				CommandID:      "batch_" + draft.ID,
				CommandType:    "CreateCandidateBatch",
				CommandVersion: 1,
				Actor:          command.Actor{Type: "SYSTEM", ID: "system_batch"},
				Principal:      command.Principal{Type: "SYSTEM", ID: "system_batch"},
				Target:         command.Target{Type: "CandidateBatch", ID: draft.ID},
				IdempotencyKey: "batch_" + draft.ID,
				AuthContext:    map[string]any{"system": true},
				Purpose:        "auto_batch",
				CorrelationID:  "batch_" + draft.ID,
				RequestedAt:    time.Now().UTC().Format(time.RFC3339),
				Payload:        payload,
			}
			result := supplyService.HandleContext(ctx, env)
			if result.Outcome == "REJECTED" {
				log.Printf("auto batch: rejected need=%s err=%v", draft.ID, result.Error)
				return nil
			}
			log.Printf("auto batch: created for need=%s market=%s duration=%d", draft.ID, marketID, durationH)
			return nil
		},
	}
}

// bootEnvWarnings returns a list of human-readable warnings when the
// current process is missing env that production deployments are
// expected to set. We never fatal out: an in-memory dev environment
// is still useful. But the warnings appear in `journalctl` so an SRE
// triaging a misconfigured prod box sees them on the first lines of
// the log. Implementation lives in internal/bootenv so it can be
// unit-tested without touching the process environment.

// wireIdentityEmailResolver 把 identity repo 暴露给 SMTP challenge provider,
// 这样 Request 拿 LoginIdentityID 就能找到对应的 email identifier 发邮件。
// resolver 必须是 idempotent + 并发安全 (多 goroutine 同时触发 challenge).
// 不注册此 resolver 会让 SMTP 走 fail-closed 路径, EMAIL challenge 返
// LOGIN_PROVIDER_NOT_CONFIGURED — 因此 PG 模式启动时必须调用。
func wireIdentityEmailResolver(svc *identity.Service) {
	identity.RegisterLoginIdentityEmailResolver(func(loginIdentityID string) (string, bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		li, err := svc.Repository().GetLoginIdentity(ctx, loginIdentityID)
		if err != nil {
			return "", false
		}
		if li.Channel != "EMAIL" {
			return "", false
		}
		return li.Identifier, true
	})
}

// parseSMTPPortOrZero is a tolerant wrapper around strconv.Atoi that
// returns 0 on parse failure or empty input. The caller decides what
// 0 means (e.g. fall back to a default port).
func parseSMTPPortOrZero(s string) int {
	if s == "" {
		return 0
	}
	port, err := strconv.Atoi(s)
	if err != nil || port <= 0 {
		return 0
	}
	return port
}

// buildSMSProvider returns the right SMSHTTPLoginChallengeProvider for
// the chosen vendor. The base `cfg` carries the OTP bookkeeping; the
// per-vendor adapter replaces the transport layer so the same generic
// request/response loop works for all of them.
//
// Recognized vendors (PROXY_SMS_PROVIDER):
//
//	"generic"  - bare bearer-token + JSON (the original behavior)
//	"twilio"   - Twilio Programmable SMS (Basic auth, form-encoded)
//	"esms"     - eSMS.vn SendMultipleMessage_V4_get (GET + query params)
//	"speedsms" - SpeedSMS.vn (POST + JSON with access_token)
//
// Anything else (including empty) falls back to "generic".
func buildSMSProvider(vendor string, cfg identity.SMSConfig) *identity.SMSHTTPLoginChallengeProvider {
	switch strings.ToLower(strings.TrimSpace(vendor)) {
	case "twilio":
		sid := os.Getenv("PROXY_SMS_TWILIO_ACCOUNT_SID")
		token := os.Getenv("PROXY_SMS_TWILIO_AUTH_TOKEN")
		from := os.Getenv("PROXY_SMS_TWILIO_FROM")
		if from == "" {
			from = cfg.From
		}
		if sid == "" || token == "" || from == "" {
			log.Printf("PROXY_SMS_PROVIDER=twilio but missing TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: twilio (AccountSID=%s, From=%s)", sid, from)
		return identity.NewTwilioSMSProvider(cfg, sid, token, from, slog.Default())
	case "esms":
		apiKey := os.Getenv("PROXY_SMS_ESMS_API_KEY")
		secretKey := os.Getenv("PROXY_SMS_ESMS_SECRET_KEY")
		brandname := os.Getenv("PROXY_SMS_ESMS_BRANDNAME")
		smsType := os.Getenv("PROXY_SMS_ESMS_SMS_TYPE")
		if apiKey == "" || secretKey == "" {
			log.Printf("PROXY_SMS_PROVIDER=esms but missing ESMS_API_KEY/SECRET_KEY; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: esms.vn (brandname=%q, smsType=%s)", brandname, smsType)
		return identity.NewESMSSMSProvider(cfg, apiKey, secretKey, brandname, smsType, slog.Default())
	case "speedsms":
		accessToken := os.Getenv("PROXY_SMS_SPEEDSMS_ACCESS_TOKEN")
		sender := os.Getenv("PROXY_SMS_SPEEDSMS_SENDER")
		if accessToken == "" || sender == "" {
			log.Printf("PROXY_SMS_PROVIDER=speedsms but missing SPEEDSMS_ACCESS_TOKEN/SENDER; falling back to generic")
			return identity.NewSMSHTTPLoginChallengeProvider(cfg)
		}
		log.Printf("SMS provider: speedsms.vn (sender=%s)", sender)
		return identity.NewSpeedSMSSMSProvider(cfg, accessToken, sender, slog.Default())
	default:
		log.Printf("SMS provider: generic bearer-token webhook")
		return identity.NewSMSHTTPLoginChallengeProvider(cfg)
	}
}

// jurisdictionAdapter bridges the wire layer's
// *jurisdiction.Service to the fulfillment package's
// one-method jurisdictionResolver interface. The
// fulfillment package does not import the jurisdiction
// package directly (one-way dependency).
type jurisdictionAdapter struct {
	svc *jurisdiction.Service
}

// marketplaceFulfillmentAdapter bridges marketplace.OrderCreator to
// fulfillment.TransactionalRepository. It composes a marketplace
// OrderRecord into a fulfillment.Order snapshot before delegating to
// CreateOrder. ServiceSKU defaults to CITY_COMPANION (matches
// AcceptSlotOffer) until bilateral negotiation fields (duration,
// startTime, meetingContext) are recorded via amendments.
type marketplaceFulfillmentAdapter struct {
	repo fulfillment.TransactionalRepository
}

type sceneFulfillmentAdapter struct {
	repo fulfillment.TransactionalRepository
}

func (a sceneFulfillmentAdapter) EnsureInvitationOrder(ctx context.Context, record scene.InvitationOrderRecord) error {
	now := time.Now().UTC()
	return a.repo.EnsureOrder(ctx, fulfillment.Order{ID: record.ID, RequesterID: record.RequesterID, AgentID: record.AgentID, NeedID: record.SceneID, Lifecycle: "CONFIRMED", Version: 1, Snapshot: fulfillment.OrderSnapshot{Requester: record.RequesterID, Agent: record.AgentID, ServiceSKU: record.ServiceSKU, NeedVersion: record.SceneID, StartTime: record.StartTime, MeetingContext: record.MeetingContext, AgreedCompensation: record.AgreedCompensation, Currency: record.Currency, IncludedScope: record.IncludedScope, SettlementMode: "DIRECT_SETTLEMENT"}, CreatedAt: now, UpdatedAt: now})
}

func (a marketplaceFulfillmentAdapter) EnsureOrder(ctx context.Context, record marketplace.OrderRecord) error {
	now := time.Now().UTC()
	snapshot := fulfillment.OrderSnapshot{
		Requester:          record.RequesterID,
		Agent:              record.AgentID,
		ServiceSKU:         "CITY_COMPANION",
		NeedVersion:        record.NeedID,
		AgreedCompensation: 0, // TBD until CreateOffer replaces this
		Currency:           "VND",
		SettlementMode:     "DIRECT_SETTLEMENT",
	}
	return a.repo.EnsureOrder(ctx, fulfillment.Order{
		ID:          record.ID,
		RequesterID: record.RequesterID,
		AgentID:     record.AgentID,
		NeedID:      record.NeedID,
		Lifecycle:   "CONFIRMED",
		Version:     1,
		Snapshot:    snapshot,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
}

func (a jurisdictionAdapter) Resolve(ctx context.Context, userID string) (fulfillment.JurisdictionResolution, error) {
	row, err := a.svc.Resolve(ctx, userID)
	if err != nil {
		return fulfillment.JurisdictionResolution{}, err
	}
	return fulfillment.JurisdictionResolution{
		Wire:   row.Jurisdiction.String(),
		Source: row.Source,
	}, nil
}
