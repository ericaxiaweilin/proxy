package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/contribution"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
	"github.com/proxy-app/proxy-api/internal/supply"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "4100"
	}

	var idempotencyStore command.IdempotencyStore = command.NewMemoryIdempotencyStore()
	var readyCheck func(context.Context) error
	var authenticator api.Authenticator
	loginProvider, simulatedLogin := configuredLoginChallengeProvider()
	identityService := localIdentityService(loginProvider, simulatedLogin)
	demandService := demand.New(nil, nil)
	cityCompanionService := citycompanion.New()
	localNetService := localnet.New()
	localContextService := localcontext.New()
	conversationService := conversation.New()
	engagementService := engagement.New()
	fulfillmentService := fulfillment.New()
	supplyService := supply.New()
	mediaService := media.New()
	contributionService := contribution.New()
	authenticator = identityService
	var transactions api.TransactionRunner
	var databaseCloser func()
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		pool, err := postgres.Open(ctx, databaseURL)
		if err != nil {
			log.Fatalf("open postgres: %v", err)
		}
		databaseCloser = pool.Close
		idempotencyStore = postgres.NewIdempotencyStore(pool)
		outboxRepository := postgres.NewOutboxRepository(pool)
		readyCheck = pool.Ping
		identityService = identity.NewWithRepositoryAndClockAndChallengeProvider(postgres.NewIdentityRepositoryWithOutbox(pool, outboxRepository), nil, loginProvider)
		if simulatedLogin {
			if err := seedPostgresIdentity(pool); err != nil {
				log.Fatalf("seed postgres identity: %v", err)
			}
			if err := seedPostgresSupply(pool); err != nil {
				log.Fatalf("seed postgres supply: %v", err)
			}
		}
		demandService = demand.NewWithRepository(nil, nil, postgres.NewDemandRepositoryWithOutbox(pool, outboxRepository))
		localContextService = localcontext.NewWithRepository(postgres.NewLocalContextRepository(pool))
		conversationService = conversation.NewWithRepository(postgres.NewConversationRepository(pool))
		engagementService = engagement.NewWithRepository(postgres.NewEngagementRepository(pool))
		fulfillmentService = fulfillment.NewWithRepository(postgres.NewFulfillmentRepositoryWithOutbox(pool, outboxRepository))
		supplyService = supply.NewWithRepository(postgres.NewSupplyRepository(pool))
		mediaService = media.NewWithDependencies(postgres.NewMediaRepository(pool), media.NewFFmpegProcessor(filepath.Join("media_store")))
		contributionService = contribution.NewWithRepository(postgres.NewContributionRepository(pool))
		localNetService = localnet.NewWithMediaLookup(postgres.NewLocalNetRepository(pool), media.NewPostMediaLookup(mediaService))
		cityCompanionService = citycompanion.NewWithRepositoryAndSupplier(postgres.NewCityCompanionRepository(pool), supply.NewCityCompanionSupplier(supplyService))
		authenticator = identityService
		transactions = postgres.NewTransactionRunner(pool)
	}
	defer func() {
		if databaseCloser != nil {
			databaseCloser()
		}
	}()

	server := api.NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, supplyService, mediaService, contributionService, idempotencyStore, readyCheck, authenticator, transactions)
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
	if os.Getenv("PROXY_LOGIN_PROVIDER") != "simulated" {
		return identity.UnconfiguredLoginChallengeProvider{}, false
	}
	return identity.NewSimulatedLoginChallengeProvider(os.Getenv("PROXY_SIMULATED_OTP_CODE")), true
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
	// AvailabilityWindow（明天 9:00-19:00，幂等按 agent+时间查重）
	agents := []string{"agent_linh", "agent_mai", "agent_minh"}
	for _, agentID := range agents {
		var exists int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM supply.availability_windows WHERE agent_id=$1 AND start_at=$2`,
			agentID, tomorrow9).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if _, err := pool.Exec(ctx, `
				INSERT INTO supply.availability_windows (id, agent_id, start_at, end_at, market_id, status, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,'AVAILABLE',$6,$6)`,
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
