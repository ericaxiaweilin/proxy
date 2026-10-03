package main

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/aisystem"
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
	"github.com/proxy-app/proxy-api/internal/emergency"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/experience"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/growth"
	"github.com/proxy-app/proxy-api/internal/identity"
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
	"github.com/proxy-app/proxy-api/internal/opsmetrics"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
	"github.com/proxy-app/proxy-api/internal/outcome"
	"github.com/proxy-app/proxy-api/internal/payment"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
	"github.com/proxy-app/proxy-api/internal/profile"
	"github.com/proxy-app/proxy-api/internal/providerapp"
	"github.com/proxy-app/proxy-api/internal/rating"
	"github.com/proxy-app/proxy-api/internal/realityscene"
	"github.com/proxy-app/proxy-api/internal/relationship"
	"github.com/proxy-app/proxy-api/internal/safety"
	"github.com/proxy-app/proxy-api/internal/scene"
	"github.com/proxy-app/proxy-api/internal/scenereview"
	"github.com/proxy-app/proxy-api/internal/socialspace"
	"github.com/proxy-app/proxy-api/internal/storeonboarding"
	"github.com/proxy-app/proxy-api/internal/supply"
	"github.com/proxy-app/proxy-api/internal/usermodel"
	"github.com/proxy-app/proxy-api/internal/voucher"
	"github.com/proxy-app/proxy-api/internal/wallet"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
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

	// AI-SYSTEM-REGISTER-001：把 AI 系统登记册（internal/aisystem）的体检
	// 结果打到启动日志。Điều 10.3 要求中/高风险系统的分级结果在**投入使用前**
	// 报送科技部；仓里今天一条报送都没有，那就不该只在文档里可见。
	//
	// 这里**不拦启动**：停掉正在跑的 AI 系统是经营决定（Điều 67.4(b) 的停运
	// 是**处罚**，不是自助动作），需要时由运维走已有的 kill switch
	// （AI_MEDIA）闸停。这条日志的作用是让「带缺口在跑」从没人知道变成
	// 每次启动都看得见。运维查询走 GET /v1/operator/ai/systems。
	{
		assessments := aisystem.AssessAll()
		summary := aisystem.Summarize(assessments)
		log.Printf("ai system register: %d system(s), %d ready, %d blocked, %d notified to MoST (Điều 10.3)",
			summary.Total, summary.ReadyForUse, summary.Blocked, summary.NotifiedToMoST)
		for _, a := range assessments {
			if a.ReadyForUse {
				log.Printf("AI SYSTEM OK: %s (%s)", a.ID, a.Tier)
				continue
			}
			codes := make([]string, 0, len(a.Blockers))
			for _, b := range a.Blockers {
				codes = append(codes, string(b.Code))
			}
			log.Printf("AI SYSTEM GAP: %s (%s): %s", a.ID, a.Tier, strings.Join(codes, ","))
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
	conversationService.SetMediaAuthorizer(mediaService)
	contributionService := contribution.New()
	// WALLET-001：默认内存仓；DATABASE_URL 分支换 PG（与 profileService 同模式）。
	// SIMULATED 充值渠道只在 WALLET_SIMULATED_RECHARGE=1 时打开（dev 联调），
	// 默认关闭；真渠道逐个配商户凭证（见 wallet.Providers）。
	walletService := wallet.New()
	walletService.SetSimulatedRecharge(os.Getenv("WALLET_SIMULATED_RECHARGE") == "1")
	// Profile 域（P1，audit 2026-09-04）：默认内存仓；DATABASE_URL 存在时
	// 在 DB 分支换成 postgres.NewProfileRepository（服务端持久化名片）。
	profileService := profile.New()
	socialSpaceService := socialspace.New()
	businessService := business.New()
	relationshipService := relationship.New()
	paymentService := payment.New()
	// NOTIF-PUSH-001：内存模式没有 PG，也就没有设备令牌表 —— 传 nil 给
	// 分发器（它会在拿不到 lister 时不推），这里只记日志。
	notificationService := notification.NewWithPushProvider(nil, configuredNotificationPush(nil))
	safetyService := safety.New()
	// COMP-REPORT-001: 举报受理。法律文件 §38 承诺可举报八类目标，
	// 之前只有 engagement.ReportPost（POST）一类接得上。
	moderationService := moderation.New()
	// STORE-REC-001: 店铺推荐受理（独立模块「企业/店铺」的增长入口：
	// 用户/小美推荐商铺进体系）。无 DB 时用内存仓，重启即失，但命令面照常。
	storeOnboardingService := storeonboarding.New()
	outcomeService := outcome.New()
	sceneService := scene.New()
	realitySceneService := realityscene.New()
	marketplaceService := marketplace.New()
	// OPP-SUGGEST-001 / STORE-REC-003: 语义层（modelstack）注入见下方
	// 「Wire after the optional PostgreSQL replacements」区块 —— 必须在
	// PG 替换之后注入。这里注入会被 NewWithRepository 重建的对象丢掉，
	// 结果是配了 DATABASE_URL 时 SuggestOpportunityTemplate /
	// SuggestStoreRecommendation 永远只能返回 AI_NOT_CONFIGURED。
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
	// R0 / R16.7-P1-H: Benefit Routing Network. Defaults to the in-memory
	// repo; the DATABASE_URL branch below swaps in postgres.NewBenefitRepository
	// so /v1/commands/{CreateCampaign,ClaimBenefit,RedeemBenefit,...} persists
	// across restarts. BENEFIT-REDEEM-002 merchant verifier is wired near the
	// bottom of this function, once businessService has its final (memory or
	// Postgres) form.
	benefitService := benefit.NewService(benefit.NewMemoryRepository())
	// CLIENT-RATING-001: defaults to the in-memory repo; the DATABASE_URL
	// branch below swaps in postgres.NewRatingRepository. Depends only on
	// fulfillmentService.Repository() (read-only GetOrder), same pattern
	// as growthService below.
	ratingService := rating.New(rating.NewMemoryRepository(), fulfillmentService.Repository())
	// SCENE-REVIEW-001: defaults to the in-memory repo; the DATABASE_URL
	// branch below swaps in postgres.NewSceneReviewRepository. Depends only
	// on realitySceneService.ListMyCheckinHistory (read-only), same pattern
	// as ratingService above.
	sceneReviewService := scenereview.New(scenereview.NewMemoryRepository(), realitySceneService)
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
		// ORDER-ROLE-001：运行角色是否满足订单守卫 / 审计表的前提（默认只打日志，
		// PROXY_ENFORCE_DB_ROLE_SEPARATION=true 时不满足就拒绝启动）。
		enforceDBRolePosture(ctx, pool)
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
		// HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：首页「真人推荐」rail
		// 上有 21 个人在服务端没有账号 —— 点 + 只会得到「还没有账号，暂时加不了
		// 好友」，卡片却顶着「真人」徽标。必须在 supply 之后跑：rail 里 linh /
		// mai / an / minh 的资料由供给域种子先写，这里只补缺、不覆盖。
		if err := seedPostgresHomeRail(pool, mediaStoreDir); err != nil {
			log.Fatalf("seed postgres home rail: %v", err)
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
		// UNREAD-PIPELINE-001: 阅读位走 PG（和消息同 durability 口径）。
		conversationService.WithDialogs(postgres.NewDialogRepository(pool))
		conversationService.SetMediaStoreDir(mediaStoreDir)
		engagementService = engagement.NewWithRepository(postgres.NewEngagementRepository(pool))
		fulfillmentService = fulfillment.NewWithRepository(postgres.NewFulfillmentRepositoryWithOutbox(pool, outboxRepository))
		supplyService = supply.NewWithRepository(postgres.NewSupplyRepositoryWithOutbox(pool, outboxRepository))
		// COMP-SELLER-001：候选资格只认已实名且未过期的卖家。接在这里（pool 分支内）
		// 意味着没有数据库时 lookup 为 nil → 撮合不出候选，而不是「照常撮合」。
		supplyService.SetSellerIdentityLookup(postgres.NewSellerRealNameRepository(pool))
		// MATCH-RANK-001: 撮合排序读真实履约 / 需求方评价 / 引力响应（不读任何曝光数据）。
		supplyService.SetRankingSignals(matching.NewPostgres(pool))
		mediaService = media.NewWithReviewDecisionRepository(
			postgres.NewMediaRepository(pool),
			postgres.NewMediaReviewDecisionRepository(pool),
			media.NewFFmpegProcessor(mediaStoreDir),
		)
		mediaService.SetStoreDir(mediaStoreDir)
		conversationService.SetMediaAuthorizer(mediaService)
		contributionService = contribution.NewWithRepository(postgres.NewContributionRepository(pool))
		walletService = wallet.NewWithRepository(postgres.NewWalletRepository(pool))
		walletService.SetSimulatedRecharge(os.Getenv("WALLET_SIMULATED_RECHARGE") == "1")
		profileService = profile.NewWithRepository(postgres.NewProfileRepository(pool))
		socialSpaceService = socialspace.NewWithRepository(postgres.NewSocialSpaceRepository(pool))
		businessRepository := postgres.NewBusinessRepository(pool)
		businessService = business.NewWithRepository(businessRepository)
		// R36.x MENU-001: storefront photo/menu uploads go through the
		// media pipeline; attaching them to a store publishes the
		// assets to PUBLIC so thumb/play URLs resolve.
		businessService.SetMediaAuthorizer(mediaService)
		// AVATAR-DELIVER-001: 头像同样要提权——上传默认 OWNER_ONLY，
		// 公开 thumb/play 路由要求 APPROVED && PUBLIC，不提权头像恒 404。
		identityService.SetProfileMediaAuthorizer(mediaService)
		relationshipService = relationship.NewWithRepository(postgres.NewRelationshipRepository(pool))
		paymentService = payment.NewWithRepository(postgres.NewPaymentRepository(pool, outboxRepository))
		// NOTIF-PUSH-001：推送通道要能把「收件人」翻译成「哪几台设备」，
		// 所以分发器必须拿到 **PG 的** notification 仓（内存仓没有设备令牌）。
		notificationRepository := postgres.NewNotificationRepository(pool)
		notificationService = notification.NewWithPushProvider(notificationRepository, configuredNotificationPush(notificationRepository))
		safetyService = safety.NewWithRepository(postgres.NewSafetyRepository(pool))
		moderationService = moderation.NewWithRepository(postgres.NewModerationRepository(pool))
		storeOnboardingService = storeonboarding.NewWithRepository(postgres.NewStoreOnboardingRepository(pool))
		outcomeService = outcome.NewWithRepository(postgres.NewOutcomeRepository(pool))
		localNetService = localnet.NewWithAll(postgres.NewLocalNetRepository(pool), media.NewPostMediaLookup(mediaService), modelStack, scene.NewSceneAestheticAdapter(sceneService))
		cityCompanionService = citycompanion.NewWithRepositoryAndSupplier(postgres.NewCityCompanionRepository(pool), supply.NewCityCompanionSupplier(supplyService))
		// R15.13 P3: bind the scene aggregate to PostgreSQL when
		// DATABASE_URL is set. Without DATABASE_URL the in-memory
		// repository continues to serve (the smoke scripts rely on
		// it for hermetic, no-Docker runs).
		sceneService = scene.NewWithRepository(postgres.NewSceneRepository(pool))
		realitySceneService = realityscene.NewWithRepository(postgres.NewRealitySceneRepository(pool))
		sceneReviewService = scenereview.New(postgres.NewSceneReviewRepository(pool), realitySceneService)
		marketplaceService = marketplace.NewWithRepository(postgres.NewMarketplaceRepository(pool))
		activityService = activity.NewWithRepository(postgres.NewActivityRepository(pool))
		// MERCHANT-OUTCOME-PROJECTION-001：活动订单投影商家经营结果（spend_daily）。
		activityService.SetOrderProjector(businessRepository)
		facetService = facet.NewWithRepository(postgres.NewFacetRepository(pool))
		facetService.SeedDefaults()
		experienceService = experience.NewWithRepository(postgres.NewExperienceRepository(pool))
		voucherService = voucher.NewWithRepository(postgres.NewVoucherRepository(pool))
		voucherService.SetSettlementCreator(voucher.LogSettlementCreator{})
		benefitService = benefit.NewService(postgres.NewBenefitRepository(pool))
		ratingService = rating.New(postgres.NewRatingRepository(pool), fulfillmentService.Repository())
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
	// ORDER-NO-001：全数字订单编号只有一个分配器 —— 履约订单、跨域物化订单、
	// 活动报名共用，保证不同类型的订单之间也不撞号。有库用 Postgres 序列。
	var orderNumbers ordernumber.Allocator = ordernumber.NewMemory()
	if pool != nil {
		orderNumbers = postgres.NewOrderNumberAllocator(pool)
	}
	fulfillmentService.WithOrderNumbers(orderNumbers)
	activityService.SetOrderNumbers(orderNumbers)
	marketplaceService.SetNumbers(orderNumbers)
	// ORDER-AGENT-CLAIM-NO-001：接单编号（技师号）随订单快照冻结。无库模式不接
	// （nil = 未分配，客户端隐藏那一行）—— 与其它可选依赖同一套接线规矩。
	var claimNumbers fulfillment.AgentClaimNumberReader
	if pool != nil {
		claimNumbers = postgres.NewIdentityRepository(pool)
		fulfillmentService.WithAgentClaimNumbers(claimNumbers)
	}
	marketplaceService.SetOrderCreator(marketplaceFulfillmentAdapter{repo: fulfillmentService.Repository(), numbers: orderNumbers, claimNumbers: claimNumbers})
	// STORE-STATS-001：RecordOutcome 归因校验 —— 必须是真实存在的 ACTIVE 店。
	// 跟 SetOrderCreator 一样，必须在 PG 替换之后接（否则接到被丢弃的内存实例上）。
	// 无库模式不接（SetStoreLookup nil = 不校验，测试/内存行为不变）。
	if pool != nil {
		storeLookupRepo := postgres.NewBusinessRepository(pool)
		fulfillmentService.SetStoreLookup(func(ctx context.Context, storeID string) (bool, error) {
			store, err := storeLookupRepo.GetStore(ctx, storeID)
			if err != nil {
				return false, err
			}
			return store.Status == "ACTIVE", nil
		})
	}
	// ORDER-STORE-STATS-AUTHZ-001 / ORDER-SLOT-OWNER-001：两处都是 fail closed ——
	// 不接就一律拒绝，所以无库模式也要接（business / demand / marketplace 此时已是最终实例）。
	fulfillmentService.SetStoreAccess(businessService.StoreMemberAccess)
	fulfillmentService.SetSlotOfferAuthorizer(func(ctx context.Context, taskID, slotID, requesterID, agentID string) (bool, error) {
		if owned, err := demandService.TaskSlotOwnedBy(ctx, taskID, slotID, requesterID); err != nil || owned {
			return owned, err
		}
		// 市场机会的快速报价：移动端用 opportunityId 当 taskId、"<id>_slot_1" 当 slotId
		// （apps/mobile/src/market-fixtures.ts buildSlotOfferInput）。
		if slotID != taskID+"_slot_1" {
			return false, nil
		}
		return marketplaceService.OfferEligibility(ctx, taskID, requesterID, agentID)
	})
	// 语义层同理：必须在 PG 替换之后注入，否则配了 DATABASE_URL 时
	// NewWithRepository 重建的 Service 会丢掉 modelstack，AI 能力被静默降级成
	// 「永远 AI_NOT_CONFIGURED」—— 而客户端会因此把入口藏起来，从外部看
	// 就像是这个功能从来没做过。
	marketplaceService.SetModelStack(modelStack)
	storeOnboardingService.SetModelStack(modelStack)
	// PROFILE-READ-001: content publishers resolve USER display names from
	// the verified account profile instead of trusting client-supplied
	// strings. Wired here so both the memory and PostgreSQL instances are
	// covered.
	authorNames := identityService.AuthorNameResolver()
	localNetService.SetAuthorNameResolver(authorNames)
	// POST-PROFILE-GATE-001：真人发帖前必须有用户名 + 平台头像（assets/…），缺什么就拒绝什么。
	profileCompleteness := func(ctx context.Context, userAccountID string) []string {
		missing := []string{}
		if _, ok := authorNames.ResolveAuthorDisplayName(ctx, userAccountID); !ok {
			missing = append(missing, "name")
		}
		if path, ok := authorNames.ResolveAuthorAvatarPath(ctx, userAccountID); !ok || !strings.HasPrefix(path, "assets/") {
			missing = append(missing, "avatar")
		}
		return missing
	}
	localNetService.SetProfileCompleteness(profileCompleteness)
	// 评论同一道门（POST-PROFILE-GATE-001）。
	engagementService.SetProfileCompleteness(profileCompleteness)
	socialSpaceService.SetAuthorNameResolver(authorNames)
	marketplaceService.SetAuthorNameResolver(authorNames)
	// FEED-REPLY-001: comments resolve the author name from the profile too —
	// otherwise the feed can only render the raw account id.
	engagementService.SetAuthorNameResolver(authorNames)
	sceneService.SetInvitationOrderCreator(sceneFulfillmentAdapter{repo: fulfillmentService.Repository(), numbers: fulfillmentService.OrderNumbers(), claimNumbers: claimNumbers})
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
	// RELATIONSHIP-DISPLAYNAME-001（2026-09-22 修）：SetDisplayNameResolver 定义了
	// 却从没被任何生产代码调用过 —— relationship/service.go 的兜底于是把
	// DisplayName 写成原始账号 id，好友列表里显示的是那一长串 id 而不是「Mai」
	// （friend-crm 渲染 displayName || userId）。
	//
	// 名字的事实源是 identity.profiles，identity 服务已经为内容发布方（localnet /
	// socialspace / marketplace）暴露了同一个解析器 AuthorNameResolver，这里直接复用
	// —— 不再另开一条读名片的路径。（注意 profile.Repository 读的是
	// profile.user_profiles，那是 Profile 域自己的表，本地库里是空的；
	// 真人名字都在 identity.profiles，别读错。）复用上面 PROFILE-READ-001 那个实例。
	// AI-FRIEND-REQUEST-001：平台 AI 是可寻址、可聊天、可关注的账号，但不会
	// accept 双向好友申请。只改移动端按钮挡不住旧客户端 / curl，所以服务端
	// SendFriendRequest 也要识别并拒绝；relationship 只持窄函数，不 import AI 目录。
	relationshipService.SetCannotFriendTarget(func(targetUserID string) bool {
		account, err := aipersona.GetPlatformAccount(targetUserID)
		return err == nil && account.PersonaType == aipersona.PersonaTypePlatformAI
	})
	// FRIEND-TARGET-EXISTS-001：目标账号不存在时必须拒绝，而不是写一条永远
	// 没人能同意的 PENDING（首页 rail 曾把本地 fixture id 当账号 id 发出来）。
	//
	// 判定用 identity.user_accounts 的**精确**存在性（GetUser → ErrUserNotFound），
	// 不用 AuthorNameResolver：后者要求 profile.name 非空，账号存在但还没起名字
	// 的人会被误判成"不存在"，那会把正常申请也拒掉 —— 比原 bug 更糟。
	// identityService.Repository() 在 pool 可用时是 PG 仓储（main.go 上面的替换），
	// 没有 pool 时是内存仓储，两者 GetUser 语义一致（都是 ErrUserNotFound）。
	identityRepository := identityService.Repository()
	relationshipService.SetTargetAccountExists(func(ctx context.Context, targetUserID string) bool {
		_, err := identityRepository.GetUser(ctx, targetUserID)
		return err == nil
	})
	relationshipService.SetDisplayNameResolver(func(ctx context.Context, userID string) (relationship.DisplayNameHint, bool) {
		name, ok := authorNames.ResolveAuthorDisplayName(ctx, userID)
		if !ok {
			return relationship.DisplayNameHint{}, false
		}
		// AI-TWIN-AUDIENCE-AVATAR-001: 帖文编排的「指定好友」是对
		// 真实关系对象的选择，不能只给名字而让 UI 再猜一张头像。profile
		// 的 assets/<id> 是存储指针，必须在 API 边界转成公开缩略图路由；
		// 未设置/不认识的路径保持空串，由客户端显示首字回退。
		avatarURL := ""
		if avatarPath, hasAvatar := authorNames.ResolveAuthorAvatarPath(ctx, userID); hasAvatar {
			avatarPath = strings.TrimSpace(avatarPath)
			switch {
			case strings.HasPrefix(avatarPath, "assets/"):
				if assetID := strings.TrimSpace(strings.TrimPrefix(avatarPath, "assets/")); assetID != "" {
					avatarURL = "/v1/media/thumb/" + assetID
				}
			case strings.HasPrefix(avatarPath, "/"), strings.HasPrefix(avatarPath, "http://"), strings.HasPrefix(avatarPath, "https://"):
				avatarURL = avatarPath
			}
		}
		return relationship.DisplayNameHint{UserID: userID, DisplayName: name, AvatarURL: avatarURL}, true
	})
	server.Relationship = relationshipService
	server.Payment = paymentService
	server.Notification = notificationService
	server.Safety = safetyService
	server.Moderation = moderationService
	server.StoreOnboarding = storeOnboardingService
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
	// WALLET-001：签到发豆桥（签到成功固定奖金豆，失败不回滚考勤）。
	activityService.SetBeansAwarder(walletService)
	server.Activity = activityService
	marketplaceService.SeedDefaults()
	server.Marketplace = marketplaceService
	// PUBLIC-NO-LOOKUP-001：客服按全数字公共编号反查（operator 门 + CASE scope）。有库时
	// 每次查询写 operator.number_lookups（与命令同一事务，写不进去就不返回数据）；没库
	// 用进程内记录（开发 / 测试）。
	var lookupRecorder numberlookup.Recorder = numberlookup.NewMemoryRecorder()
	if pool != nil {
		lookupRecorder = postgres.NewNumberLookupRecorder(pool)
	}
	server.NumberLookup = numberlookup.New(lookupRecorder,
		numberlookup.OrderFinder(fulfillmentService),
		numberlookup.ParticipationFinder(activityService),
		numberlookup.ActivityFinder(activityService),
		numberlookup.OpportunityFinder(marketplaceService))
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
	// SAFETY-NET-001: the caller's own safety net (emergency contacts +
	// the append-only emergency-event log).
	//
	// The location repository doubles as the consent gate: an emergency
	// event may only carry a coarse location while a location consent is
	// actually active. When there is no gate (no pool, no identity) the
	// service fails CLOSED — it records the event and drops the
	// coordinates rather than writing a location it cannot justify.
	var emergencyRepo emergency.Repository
	if pool != nil {
		emergencyRepo = postgres.NewEmergencyRepository(pool)
	} else {
		emergencyRepo = emergency.NewMemoryRepository()
	}
	var emergencyConsent emergency.ConsentGate
	if server.LocationRepo != nil {
		emergencyConsent = server.LocationRepo
	}
	server.Emergency = emergency.NewService(emergencyRepo, emergencyConsent)
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
	// in migration 065. POLICY-STAMP-DURABLE-001: with a pool the
	// decisions and stamps live in Postgres (policy schema), and
	// stamps share the order transition's transaction; the memory
	// repository is only for the no-database dev server. The
	// kill-switch provider is a thin bridge to server.Compliance so
	// the snapshot on each decision reflects the live state at
	// decision time.
	var policyRepo policydecisions.Repository = policydecisions.NewMemoryRepository()
	if pool != nil {
		policyRepo = postgres.NewPolicyDecisionRepository(pool)
	}
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
	// COMP-AI-MINOR-001: 数字分身 / AI 伴侣不对未成年人开放。年龄查询结果
	// 由 identity 侧提供（identity.user_age_assertions，见 COMP-AGE-001）。
	// 同样只在 pool 可用时接：没有数据库 → nil lookup → CreatePersona 一律拒绝
	// （fail-closed），功能宁可关闭也不能对未成年人开放。
	if pool != nil {
		personaSvc.SetAgeLookup(postgres.NewIdentityRepository(pool))
	}
	mediaService.WithAIPersonaService(personaSvc)
	server.AIPersona = personaSvc
	// AI-MANAGE-015: 用户建模。有库用 PG，识图走模型底座的 vision 任务。
	// OPS-REAL-001: 运营控制台真实指标（只在有库时）。
	if pool != nil {
		server.OpsMetrics = opsmetrics.NewPostgres(pool)
		server.Gravity = gravity.NewPostgres(pool)
		// PROVIDER-APPLY-001：申请成为小美 + 运营审核。资料门与发帖同一道（profileCompleteness）。
		providerStore := providerapp.NewPostgres(pool)
		server.ProviderApps = providerapp.NewService(providerStore, providerStore, providerapp.Deps{
			Missing: profileCompleteness,
			DisplayName: func(ctx context.Context, userAccountID string) string {
				name, _ := authorNames.ResolveAuthorDisplayName(ctx, userAccountID)
				return name
			},
			Terms: api.ProviderTermsLoader(),
			// KYC-PHONE-ONLY-001: 同一个已经配好的登录 OTP 供应商（Twilio / eSMS /
			// SpeedSMS 任一个，见 wire_providers.go），不是另起一套短信通道。
			Phone: providerPhoneChallengeSender{provider: loginProvider},
			// 服务者主页照片用本人资料头像（已是公开媒体）；KYC 不再收证件/自拍。
			Activate: func(ctx context.Context, app providerapp.Application) (string, error) {
				if path, ok := authorNames.ResolveAuthorAvatarPath(ctx, app.UserAccountID); ok && strings.HasPrefix(path, "assets/") {
					app.PhotoAssetIDs = []string{strings.TrimPrefix(path, "assets/")}
				}
				return providerStore.ActivateSupply(ctx, app)
			},
		})
		// ORDER-PERMISSION-TWIN-001：AI 分身（建分身 / 模型读本人照片 / 代回复）只对有接单权限的人开。
		server.OrderPermission = server.ProviderApps.Granted
		conversationService.SetOrderPermission(server.ProviderApps.Granted)
		// ORDER-APPLY-KYC-GATE-001：市场报名同样只对 KYC 通过的人开（没过驳回 KYC_REQUIRED）。
		marketplaceService.SetOrderPermission(server.ProviderApps.Granted)
	}
	if pool != nil {
		server.UserModel = usermodel.NewService(postgres.NewUserModelRepository(pool), modelStack)
	} else {
		server.UserModel = usermodel.NewService(nil, modelStack)
	}
	// COMP-AI-MINOR-001（聊天侧）：上面那道门只守在「建分身」上。平台 AI 伴侣
	// （ai_001..005）是平台自带账号 —— 带 assistantMode 建会话就能直接拿到开场白，
	// 一条消息都不用发，所以聊天入口必须再拦一道；否则"未成年人不发消息也拿不到
	// AI"是假的。判定复用 aipersona.CompanionAllowedFor（同一个年龄事实源、
	// 同一套三态全拒），这里不另写年龄规则 —— 两条路给同一个账号不同答案比没有门禁更糟。
	//
	// 只在 pool 可用时接：没有数据库就没有年龄查询，门禁保持 nil → fail-closed
	// → AI 伴侣聊天整体关闭。与上面 CreatePersona 同口径：宁可关功能，也不对
	// 未成年人开放。客户端拦得住手，拦不住 curl。
	if pool != nil {
		conversationService.SetCompanionGate(func(ctx context.Context, ownerID string) error {
			ok, err := aipersona.CompanionAllowedFor(ctx, postgres.NewIdentityRepository(pool), ownerID, time.Now().UTC())
			if err != nil {
				return err
			}
			if !ok {
				return aipersona.ErrMinorForbidden
			}
			return nil
		})
	}
	// AI-MANAGE-002：AI 管理页的暂停/对话权限必须在服务端拦（客户端开关
	// 挡不住 curl）；Token 计量在真实推理成功后累加当月用量。没接 = 不拦
	// 不记 —— 见 conversation/ai_engine_gate.go 的 fail-open 说明。
	conversationService.SetAiEngineChatStateReader(func(ctx context.Context, ownerID string) (conversation.AiEngineChatState, error) {
		settings, err := identityService.GetAiEngineChatState(ctx, ownerID)
		if err != nil {
			return conversation.AiEngineChatState{}, err
		}
		return conversation.AiEngineChatState{
			Paused:         settings.Paused,
			ChatPermission: settings.ChatPermission,
			Tone:           settings.ChatTone,
			ReplyLength:    settings.ChatReplyLength,
			Emoji:          settings.ChatEmoji,
			// AI-MANAGE-014：全自动代回复按本人设置的节奏延迟发出。
			Rhythm: settings.ChatRhythm,
			// AI-MANAGE-008：代回复以本人身份说话 —— 带上 TA 的名字和简介。
			OwnerName: func() string { name, _ := authorNames.ResolveAuthorDisplayName(ctx, ownerID); return name }(),
			OwnerBio:  func() string { bio, _ := authorNames.ResolveAuthorBio(ctx, ownerID); return bio }(),
		}, nil
	})
	conversationService.SetTokenMeter(identityService.RecordAiTokens)
	// TWIN-INSIGHT-002: AI 分身「好友洞察」。跨 relationship / localnet /
	// conversation / engagement 四个域合成，所以它是独立读模型包而不是挂在
	// 任何单一域上（见 internal/twininsight 的包注释）。接线细节与
	// fail-closed 规则见 wire_twininsight.go。
	server.TwinInsight = newTwinInsightService(pool, relationshipService, facetService, modelStack)
	// TWIN-INSIGHT-TARGETS-001：陌生互动者的展示名用同一套作者名解析
	//（relationship 的 resolveNameCtx 也是它）。nil-safe：解析不到就显示
	// 账号 id，不断屏。
	server.TwinInsight.SetDisplayNameSource(authorNames.ResolveAuthorDisplayName)
	// TWIN-INSIGHT-AVATAR-001：好友洞察头像恒空白 —— buildInsight 曾写死
	// AvatarURL: ""，好友/陌生人都不带脸。头像事实源与名字同一条
	// identity.profiles，复用 AuthorNameResolver 的 avatar 路径读法；
	// 解析不到保持空串（客户端首字回退），绝不下发必 404 的坏地址。
	server.TwinInsight.SetAvatarSource(authorNames.ResolveAuthorAvatarPath)
	// TWIN-INSIGHT-ENTITLEMENT-001：洞察工具只向实名创作者发放。
	// 凭证 = 实名核验 VERIFIED 行（见 wire_twininsight.go），没行/过期/坏池
	// 一律拒绝。main.go 只挂载，不写判定。
	server.TwinInsight.SetViewerGate(newTwinInsightViewerGate(pool))
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
	// BENEFIT-REDEEM-002: RedeemBenefit for a merchant-owned campaign now
	// fails closed (MERCHANT_VERIFIER_UNAVAILABLE) unless a MerchantVerifier
	// is wired — without this call every such redemption would be rejected.
	// businessService's role check (hasRole OWNER/ADMIN/OPERATOR) is the
	// same verified-identity pattern MerchantPublishIdentity already uses.
	benefitService.WithMerchantVerifier(businessService)
	server.Benefit = benefitService
	// WALLET-001：挂载钱包域（内存默认 / PG 分支已在上面换好）。
	server.Wallet = walletService
	// GROWTH-REAL-DATA-001: read-only over fulfillmentService's own Order
	// store (same repo, same Snapshot() read listMyOrders already uses) —
	// no separate service construction order to worry about, no new
	// repository to open.
	server.Growth = growth.New(fulfillmentService.Repository())
	// CLIENT-RATING-001: ratingService already has its final (memory or
	// Postgres) form by here — wire it into both the command surface and
	// marketplace's read-through lookup (ListMarketOpportunities attaches
	// a client's real rating to their listings; no data means no field,
	// never a fabricated default).
	server.Rating = ratingService
	marketplaceService.SetRatingLookup(ratingService)
	// SCENE-REVIEW-001: sceneReviewService already has its final (memory or
	// Postgres) form by here — wire it into the command surface and
	// realityscene's read-through lookup (Scene/Detail attach a real
	// rating when one exists; no data means no field, never a fabricated
	// default).
	server.SceneReview = sceneReviewService
	realitySceneService.SetRatingLookup(sceneReviewService)
	// SCENE-COMPANION-001: real, friend-only companion suggestions — both
	// relationshipService and activityService already have their final
	// (memory or Postgres) form by here.
	realitySceneService.SetFriendLister(relationshipService)
	realitySceneService.SetActivityVisitorFilter(activityService)
	// STORE-SCENE-LINK-001: a store that has claimed this scene (LinkStoreToRealityScene)
	// gets its real photo album onto the scene's photo wall. businessService
	// already has its final (memory or Postgres) form by here.
	realitySceneService.SetMerchantPhotoLister(storeScenePhotoAdapter{business: businessService})
	// VOUCHER-DEFAULTS-001: the voucher wallet no longer mints free vouchers
	// (see voucher.Service.ensureDefaults) — this is how a user's real,
	// merchant-funded benefit.Claim rows show up in that same wallet
	// UI/protocol instead. Read-only; see voucher.BenefitBridgePrefix's doc
	// comment for why redemption itself isn't bridged yet.
	voucherService.SetBenefitBridge(voucher.NewBenefitBridge(benefitService))
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
