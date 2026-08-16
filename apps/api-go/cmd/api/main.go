package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/identity"
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
		demandService = demand.NewWithRepository(nil, nil, postgres.NewDemandRepositoryWithOutbox(pool, outboxRepository))
		authenticator = identityService
		transactions = postgres.NewTransactionRunner(pool)
	}
	defer func() {
		if databaseCloser != nil {
			databaseCloser()
		}
	}()

	server := api.NewServerWithRuntime(identityService, demandService, cityCompanionService, localNetService, idempotencyStore, readyCheck, authenticator, transactions)
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
