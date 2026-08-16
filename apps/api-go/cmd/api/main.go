package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
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
		}
		demandService = demand.NewWithRepository(nil, nil, postgres.NewDemandRepositoryWithOutbox(pool, outboxRepository))
		cityCompanionService = citycompanion.NewWithRepositoryAndClock(postgres.NewCityCompanionRepository(pool), nil)
		localNetService = localnet.NewWithRepositoryAndClock(postgres.NewLocalNetRepository(pool), nil)
		localContextService = localcontext.NewWithRepository(postgres.NewLocalContextRepository(pool))
		conversationService = conversation.NewWithRepository(postgres.NewConversationRepository(pool))
		engagementService = engagement.NewWithRepository(postgres.NewEngagementRepository(pool))
		fulfillmentService = fulfillment.NewWithRepository(postgres.NewFulfillmentRepositoryWithOutbox(pool, outboxRepository))
		authenticator = identityService
		transactions = postgres.NewTransactionRunner(pool)
	}
	defer func() {
		if databaseCloser != nil {
			databaseCloser()
		}
	}()

	server := api.NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, localContextService, conversationService, engagementService, fulfillmentService, idempotencyStore, readyCheck, authenticator, transactions)
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
