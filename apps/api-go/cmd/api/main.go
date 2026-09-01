package main

import (
	"context"
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/bootenv"
	"github.com/proxy-app/proxy-api/internal/business"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/modelstack"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
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
	socialSpaceService := socialspace.New()
	businessService := business.New()
	paymentService := payment.New()
	notificationService := notification.NewWithPushProvider(nil, configuredNotificationPush())
	safetyService := safety.New()
	outcomeService := outcome.New()
	sceneService := scene.New()
	marketplaceService := marketplace.New()
	activityService := activity.New()
	facetService := facet.New()
	facetService.SeedDefaults()
	experienceService := experience.New()
	voucherService := voucher.New()
	voucherService.SetSettlementCreator(voucher.LogSettlementCreator{})
	demandService.SetBatchCreator(newSupplyBatchCreator(supplyService))
	authenticator = identityService
	var transactions api.TransactionRunner
	var databaseCloser func()
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		pool, err := postgres.Open(ctx, databaseURL)
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
		// R15.27 SMTP 真实发信：把 identity repo 注入 SMTP provider 的
		// email resolver, 让它能用 LoginIdentityID 查到 identifier (email).
		// 必须在 createdLoginProvider 之后、challenge 产生之前 wire.
		wireIdentityEmailResolver(identityService)
		if simulatedLogin {
			if err := seedPostgresIdentity(pool); err != nil {
				log.Fatalf("seed postgres identity: %v", err)
			}
			if err := seedPostgresSupply(pool); err != nil {
				log.Fatalf("seed postgres supply: %v", err)
			}
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
		socialSpaceService = socialspace.NewWithRepository(postgres.NewSocialSpaceRepository(pool))
		businessService = business.NewWithRepository(postgres.NewBusinessRepository(pool))
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
	server.Payment = paymentService
	server.Notification = notificationService
	server.Safety = safetyService
	server.Outcome = outcomeService
	server.Scene = sceneService
	server.Facet = facetService
	server.Experience = experienceService
	server.Voucher = voucherService
	// Activity 域：启动幂等 seed 基线；DATABASE_URL 存在时写入持久仓储。
	activityService.SeedDefaults()
	server.Activity = activityService
	marketplaceService.SeedDefaults()
	server.Marketplace = marketplaceService
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
	case "smtp", "sms", "production":
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
		}
	}
	if (mode == "sms" || mode == "production") && url != "" {
		smsProvider = identity.NewSMSHTTPLoginChallengeProvider(identity.SMSConfig{
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
	if smtpProvider != nil {
		emailProvider = smtpProvider
	}
	var smsProviderIface identity.LoginChallengeProvider
	if smsProvider != nil {
		smsProviderIface = smsProvider
	}
	router := identity.NewChannelRouter(emailProvider, smsProviderIface)
	if smtpProvider == nil && smsProvider == nil {
		log.Printf("PROXY_LOGIN_PROVIDER=%s but no SMTP/SMS env set; login provider fail-closed", mode)
		return identity.UnconfiguredLoginChallengeProvider{}, false
	}
	log.Printf("PROXY_LOGIN_PROVIDER=%s: smtp=%v sms=%v", mode, smtpProvider != nil, smsProvider != nil)
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
	for _, a := range assets {
		if _, err := pool.Exec(ctx, `
			INSERT INTO media.media_assets (
				media_asset_id, owner_principal_type, owner_principal_id, media_type,
				original_storage_key, playback_storage_key, thumbnail_storage_key,
				mime_type, width, height, duration_ms, codec,
				processing_status, playback_url, thumbnail_url, moderation_status, visibility_class, created_at, updated_at
			) VALUES ($1,'PLATFORM','seed',$2,$3,$4,$5,$6,$7,$8,$9,$10,'READY',$11,$12,'APPROVED','PUBLIC',$13,$13)
			ON CONFLICT (media_asset_id) DO UPDATE SET
				playback_storage_key=EXCLUDED.playback_storage_key,
				thumbnail_storage_key=EXCLUDED.thumbnail_storage_key,
				processing_status='READY', moderation_status='APPROVED', visibility_class='PUBLIC', updated_at=EXCLUDED.updated_at`,
			a.id, a.mediaType, a.originalKey, a.playbackKey, a.thumbKey, a.mime,
			a.width, a.height, a.durationMs, a.codec,
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

// seedPostgresSupply 写入 3 个真实测试 Agent（B 完成标准）。
// Linh：河内，中文+越南语 VERIFIED+摄影，120 万
// Mai：河内，仅越南语 VERIFIED，100 万（中文查询应被过滤）
// Minh：胡志明市，中文 VERIFIED，110 万（河内查询应被过滤）
func seedPostgresSupply(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	now := time.Now().UTC()
	// 明天 9:00 UTC 起 10 小时（与 e2e 查询一致）
	tomorrow9 := time.Now().UTC().Truncate(24 * time.Hour).Add(24*time.Hour + 9*time.Hour)
	tomorrow19 := tomorrow9.Add(10 * time.Hour)
	// Agent Profile
	profiles := []struct {
		agentID, name, bio string
		languages, areas   []string
	}{
		{"agent_linh", "Linh", "河内本地向导，中文流利，擅长摄影", []string{"ZH", "VI"}, []string{"hn"}},
		{"agent_mai", "Mai", "河内本地人，越南语向导", []string{"VI"}, []string{"hn"}},
		{"agent_minh", "Minh", "胡志明市中文向导", []string{"ZH"}, []string{"hcm"}},
	}
	for _, p := range profiles {
		languages, _ := json.Marshal(p.languages)
		areas, _ := json.Marshal(p.areas)
		if _, err := pool.Exec(ctx, `
			INSERT INTO supply.agent_profiles (agent_id, name, bio, photos, languages, service_areas, status, created_at, updated_at)
			VALUES ($1,$2,$3,'[]',$4,$5,'ACTIVE',$6,$6)
			ON CONFLICT (agent_id) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio,
				languages=EXCLUDED.languages, service_areas=EXCLUDED.service_areas, status='ACTIVE', updated_at=EXCLUDED.updated_at`,
			p.agentID, p.name, p.bio, languages, areas, now); err != nil {
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
	// AvailabilityWindow（明天 9:00-19:00，幂等按固定 id 查重，跨天重启不冲突）
	agents := []string{"agent_linh", "agent_mai", "agent_minh"}
	for _, agentID := range agents {
		var exists int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM supply.availability_windows WHERE id=$1`,
			"aw_"+agentID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if _, err := pool.Exec(ctx, `
				INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,$6)
				ON CONFLICT (id) DO NOTHING`,
				"aw_"+agentID, agentID, tomorrow9, tomorrow19, "hn", now); err != nil {
				return err
			}
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
