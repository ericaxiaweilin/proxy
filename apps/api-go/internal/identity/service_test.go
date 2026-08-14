package identity

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

type testLoginChallengeProvider struct{}

func (testLoginChallengeProvider) Request(context.Context, LoginChallengeRequest) (ProviderChallenge, error) {
	return ProviderChallenge{ProviderRef: "provider_ref_001"}, nil
}

func (testLoginChallengeProvider) Verify(_ context.Context, verification LoginChallengeVerification) (ProviderVerification, error) {
	return ProviderVerification{Verified: verification.Code == "123456"}, nil
}

func testService() *Service {
	challenge := func(id string) LoginChallenge {
		return LoginChallenge{ID: id, UserAccountID: "user_001", LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "EMAIL", ProviderRef: "provider_" + id, Status: "VERIFIED", MaxAttempts: 5, Version: 1, RequestedAt: time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2099, 8, 14, 0, 0, 0, 0, time.UTC), VerifiedAt: time.Date(2026, 8, 14, 0, 1, 0, 0, time.UTC)}
	}
	return New(&Seed{
		User:          UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships: []Membership{
			{Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
			{Principal: command.Principal{Type: "BUSINESS", ID: "business_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
		},
		Devices:    []DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
		Challenges: []LoginChallenge{challenge("challenge_001"), challenge("challenge_002")},
	})
}

func testEnvelope(commandType string, payload map[string]any, target command.Target) command.Envelope {
	expectedVersion := 1
	return command.Envelope{
		CommandID:                "cmd_" + commandType,
		CommandType:              commandType,
		CommandVersion:           1,
		Actor:                    command.Actor{Type: "USER", ID: "user_001"},
		Principal:                command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:                   target,
		ExpectedAggregateVersion: &expectedVersion,
		IdempotencyKey:           "idem_" + commandType + "_001",
		Purpose:                  "identity_lifecycle",
		CorrelationID:            "corr_" + commandType,
		Payload:                  payload,
	}
}

func TestCreatesAndRevokesAllSessions(t *testing.T) {
	service := testService()
	payload := map[string]any{"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001", "requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"}}
	first := service.Handle(testEnvelope("CreateSession", payload, command.Target{Type: "Session", ID: "new"}))
	payload["challengeId"] = "challenge_002"
	second := service.Handle(testEnvelope("CreateSession", payload, command.Target{Type: "Session", ID: "new"}))
	if first.Outcome != "ACCEPTED" || second.Outcome != "ACCEPTED" {
		t.Fatalf("expected two accepted sessions, got %#v %#v", first, second)
	}
	revoked := service.Handle(testEnvelope("RevokeAllSessions", map[string]any{"reason": "USER_LOGOUT"}, command.Target{Type: "SessionBatch", ID: "all"}))
	if revoked.Outcome != "ACCEPTED" || len(revoked.EventRefs) != 2 {
		t.Fatalf("expected two revoked session events, got %#v", revoked)
	}
	sessions, _ := service.Snapshot()
	for _, session := range sessions {
		if session.Status != "REVOKED" {
			t.Fatalf("session %s was not revoked", session.ID)
		}
	}
}

func TestRecoveryRemainsPendingWithoutSecret(t *testing.T) {
	result := testService().Handle(testEnvelope("RequestAccountRecovery", map[string]any{"loginIdentity": "person@example.com", "requestedChannel": "EMAIL"}, command.Target{Type: "AccountRecovery", ID: "new"}))
	if result.Outcome != "PENDING" || result.Error == nil || result.Error.ErrorCode != "RECOVERY_PROVIDER_NOT_CONFIGURED" {
		t.Fatalf("expected provider pending result, got %#v", result)
	}
	if _, exists := result.Error.SafeDetails["otp"]; exists {
		t.Fatal("OTP must not be returned")
	}
}

func TestLoginChallengeMustBeVerifiedAndIsConsumedOnce(t *testing.T) {
	fixed := clock.NewFixed(time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC))
	service := NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(&Seed{
		User:          UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships:   []Membership{{Principal: command.Principal{Type: "BUSINESS", ID: "business_001"}, UserAccountID: "user_001", Status: "ACTIVE"}},
		Devices:       []DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
	}), fixed, testLoginChallengeProvider{})
	requested := service.Handle(testEnvelope("RequestLoginChallenge", map[string]any{
		"loginIdentityId": "login_001", "deviceId": "device_001", "channel": "EMAIL",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if requested.Outcome != "PENDING" || requested.OperationRef == "" {
		t.Fatalf("expected pending challenge request, got %#v", requested)
	}
	verified := service.Handle(testEnvelope("VerifyLoginChallenge", map[string]any{
		"challengeId": requested.OperationRef, "code": "123456",
	}, command.Target{Type: "LoginChallenge", ID: requested.OperationRef}))
	if verified.Outcome != "ACCEPTED" || verified.Aggregate.State != "VERIFIED" {
		t.Fatalf("expected verified challenge, got %#v", verified)
	}
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": requested.OperationRef,
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Outcome != "ACCEPTED" || created.Auth == nil {
		t.Fatalf("expected session from verified challenge, got %#v", created)
	}
	reused := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": requested.OperationRef,
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if reused.Outcome != "REJECTED" || reused.Error == nil || reused.Error.ErrorCode != "LOGIN_CHALLENGE_REQUIRED" {
		t.Fatalf("expected consumed challenge rejection, got %#v", reused)
	}
}

func TestRefreshTokenRotationRejectsReplay(t *testing.T) {
	service := testService()
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Outcome != "ACCEPTED" || created.Auth == nil || created.Auth.RefreshToken == "" {
		t.Fatalf("expected token pair on session creation, got %#v", created)
	}
	refresh := func(token string) command.Result {
		return service.Handle(testEnvelope("RefreshSession", map[string]any{"refreshToken": token}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
	}
	rotated := refresh(created.Auth.RefreshToken)
	if rotated.Outcome != "ACCEPTED" || rotated.Auth == nil || rotated.Auth.Rotation != 2 {
		t.Fatalf("expected first refresh to rotate, got %#v", rotated)
	}
	replay := refresh(created.Auth.RefreshToken)
	if replay.Outcome != "REJECTED" || replay.Error == nil || replay.Error.ErrorCode != "REFRESH_TOKEN_INVALID" {
		t.Fatalf("expected refresh replay rejection, got %#v", replay)
	}
	authenticated, err := service.Authenticate(context.Background(), rotated.Auth.AccessToken)
	if err != nil || authenticated.SessionID != created.Aggregate.ID || authenticated.Principal.ID != "business_001" {
		t.Fatalf("expected rotated access token to authenticate, session=%#v err=%v", authenticated, err)
	}
}

func TestRefreshTokenRaceHasOneWinner(t *testing.T) {
	service := testService()
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Auth == nil {
		t.Fatalf("expected auth tokens, got %#v", created)
	}
	const callers = 8
	results := make(chan error, callers)
	var wait sync.WaitGroup
	for i := 0; i < callers; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, _, err := service.tokenManager.Rotate(context.Background(), created.Auth.RefreshToken)
			results <- err
		}()
	}
	wait.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("expected exactly one refresh winner, got %d", winners)
	}
}

func TestSessionVersionGuardAcrossServiceInstances(t *testing.T) {
	repository := NewMemoryRepository(&Seed{
		User:          UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships: []Membership{
			{Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
			{Principal: command.Principal{Type: "BUSINESS", ID: "business_001"}, UserAccountID: "user_001", Status: "ACTIVE"},
		},
		Devices:    []DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
		Challenges: []LoginChallenge{{ID: "challenge_001", UserAccountID: "user_001", LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "EMAIL", ProviderRef: "provider_challenge_001", Status: "VERIFIED", MaxAttempts: 5, Version: 1, RequestedAt: time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2099, 8, 14, 0, 0, 0, 0, time.UTC), VerifiedAt: time.Date(2026, 8, 14, 0, 1, 0, 0, time.UTC)}},
	})
	first := NewWithRepository(repository)
	second := NewWithRepository(repository)
	session := first.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"requestedPrincipal": map[string]any{"type": "INDIVIDUAL", "id": "user_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if session.Outcome != "ACCEPTED" {
		t.Fatalf("create session failed: %#v", session)
	}

	var wait sync.WaitGroup
	results := make(chan command.Result, 2)
	for _, service := range []*Service{first, second} {
		wait.Add(1)
		go func(service *Service) {
			defer wait.Done()
			results <- service.Handle(testEnvelope("SwitchPrincipalContext", map[string]any{
				"principal": map[string]any{"type": "BUSINESS", "id": "business_001"},
			}, command.Target{Type: "Session", ID: session.Aggregate.ID}))
		}(service)
	}
	wait.Wait()
	close(results)

	accepted := 0
	conflicted := 0
	for result := range results {
		switch {
		case result.Outcome == "ACCEPTED":
			accepted++
		case result.Error != nil && result.Error.ErrorCode == "SESSION_VERSION_CONFLICT":
			conflicted++
		}
	}
	if accepted != 1 || conflicted != 1 {
		t.Fatalf("expected one accepted and one conflict, got accepted=%d conflicted=%d", accepted, conflicted)
	}
}
