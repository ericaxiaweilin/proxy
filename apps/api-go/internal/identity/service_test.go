package identity

import (
	"context"
	"errors"
	"strings"
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
	if commandType == "CreateSession" || commandType == "CreateAnonymousSession" || commandType == "RefreshSession" || commandType == "AuthenticateWithGoogle" {
		if _, exists := payload["deviceCredential"]; !exists {
			payload["deviceCredential"] = strings.Repeat("a", 64)
		}
	}
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

func TestPasswordlessEmailCreatesAccountThenSessionWithoutClientAccountIDs(t *testing.T) {
	fixed := clock.NewFixed(time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC))
	service := NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(nil), fixed, testLoginChallengeProvider{})
	begin := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": "New.Person@Example.com", "deviceId": "device_new", "platform": "ANDROID",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if begin.Outcome != "PENDING" || begin.OperationRef == "" {
		t.Fatalf("expected pending passwordless challenge, got %#v", begin)
	}
	verified := service.Handle(testEnvelope("VerifyLoginChallenge", map[string]any{"challengeId": begin.OperationRef, "code": "123456"}, command.Target{Type: "LoginChallenge", ID: begin.OperationRef}))
	if verified.Outcome != "ACCEPTED" {
		t.Fatalf("expected verified challenge, got %#v", verified)
	}
	session := service.Handle(testEnvelope("CreateSession", map[string]any{"challengeId": begin.OperationRef, "deviceId": "device_new"}, command.Target{Type: "Session", ID: "new"}))
	if session.Outcome != "ACCEPTED" || session.Auth == nil || session.Auth.AccessToken == "" {
		t.Fatalf("expected session without client-supplied account IDs, got %#v", session)
	}
}

func TestAnonymousSessionIsDurableAndReusesDeviceIdentity(t *testing.T) {
	service := NewWithRepositoryAndClock(NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)))
	anonPayload := map[string]any{"deviceId": "device_guest", "platform": "ANDROID", "dateOfBirth": "1990-01-01", "consents": map[string]any{"terms": true, "privacy": true}, "legalDocVersion": "1.1"}
	first := service.Handle(testEnvelope("CreateAnonymousSession", anonPayload, command.Target{Type: "Session", ID: "new"}))
	second := service.Handle(testEnvelope("CreateAnonymousSession", anonPayload, command.Target{Type: "Session", ID: "new"}))
	if first.Outcome != "ACCEPTED" || first.Auth == nil || second.Outcome != "ACCEPTED" || second.Auth == nil {
		t.Fatalf("expected anonymous sessions with tokens, got %#v %#v", first, second)
	}
	if first.Auth.UserAccountID != second.Auth.UserAccountID || first.Auth.Principal.ID != first.Auth.UserAccountID {
		t.Fatalf("anonymous sessions must reuse one durable individual identity, got %#v %#v", first.Auth, second.Auth)
	}
}

func TestPhoneUpgradeKeepsGuestPersonAndExistingCredentialWins(t *testing.T) {
	repository := NewMemoryRepository(nil)
	service := NewWithRepositoryAndClockAndChallengeProvider(repository, clock.NewFixed(time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)), testLoginChallengeProvider{})
	guest := service.Handle(testEnvelope("CreateAnonymousSession", map[string]any{"deviceId": "device_guest", "platform": "ANDROID", "dateOfBirth": "1990-01-01", "consents": map[string]any{"terms": true, "privacy": true}, "legalDocVersion": "1.1"}, command.Target{Type: "Session", ID: "new"}))
	if guest.Outcome != "ACCEPTED" || guest.Auth == nil {
		t.Fatalf("expected guest session, got %#v", guest)
	}
	upgradeEnvelope := testEnvelope("BeginPasswordlessAuthentication", map[string]any{"channel": "SMS", "identifier": "+84912345678", "deviceId": "device_guest", "platform": "ANDROID"}, command.Target{Type: "LoginChallenge", ID: "new"})
	upgradeEnvelope.Actor = command.Actor{Type: "USER", ID: guest.Auth.UserAccountID}
	upgradeEnvelope.AuthContext = map[string]any{"sessionId": guest.Auth.SessionID}
	upgrade := service.Handle(upgradeEnvelope)
	if upgrade.Outcome != "PENDING" {
		t.Fatalf("expected phone upgrade challenge, got %#v", upgrade)
	}
	if user, err := repository.GetUser(context.Background(), guest.Auth.UserAccountID); err != nil || user.Status != "REGISTERED" {
		t.Fatalf("guest should become REGISTERED, got %#v %v", user, err)
	}
	if device, err := repository.GetDevice(context.Background(), "device_guest"); err != nil || device.UserAccountID != guest.Auth.UserAccountID {
		t.Fatalf("device must remain on guest person, got %#v %v", device, err)
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
		return service.Handle(testEnvelope("RefreshSession", map[string]any{"refreshToken": token, "deviceId": "device_001"}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
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

func TestRefreshRejectsCopiedTokenWithoutOriginalDeviceProof(t *testing.T) {
	service := testService()
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"deviceCredential":   strings.Repeat("a", 64),
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Outcome != "ACCEPTED" || created.Auth == nil {
		t.Fatalf("expected session, got %#v", created)
	}

	wrongSecret := service.Handle(testEnvelope("RefreshSession", map[string]any{
		"refreshToken":     created.Auth.RefreshToken,
		"deviceId":         "device_001",
		"deviceCredential": strings.Repeat("b", 64),
	}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
	if wrongSecret.Outcome != "REJECTED" || wrongSecret.Error == nil || wrongSecret.Error.ErrorCode != "DEVICE_PROOF_INVALID" {
		t.Fatalf("copied token without device credential must be rejected, got %#v", wrongSecret)
	}

	wrongDevice := service.Handle(testEnvelope("RefreshSession", map[string]any{
		"refreshToken":     created.Auth.RefreshToken,
		"deviceId":         "device_other",
		"deviceCredential": strings.Repeat("a", 64),
	}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
	if wrongDevice.Outcome != "REJECTED" || wrongDevice.Error == nil || wrongDevice.Error.ErrorCode != "DEVICE_PROOF_INVALID" {
		t.Fatalf("original credential on a different device id must be rejected, got %#v", wrongDevice)
	}
}

func TestRevokeSessionDeletesTokens(t *testing.T) {
	service := testService()
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"requestedPrincipal": map[string]any{"type": "BUSINESS", "id": "business_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Outcome != "ACCEPTED" || created.Auth == nil {
		t.Fatalf("expected session, got %#v", created)
	}
	revoked := service.Handle(testEnvelope("RevokeSession", map[string]any{"reason": "USER_LOGOUT"}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
	if revoked.Outcome != "ACCEPTED" {
		t.Fatalf("expected revoked session, got %#v", revoked)
	}
	if _, err := service.Authenticate(context.Background(), created.Auth.AccessToken); !errors.Is(err, ErrTokenNotFound) {
		t.Fatalf("revoked access token remained stored: %v", err)
	}
}

func TestTrustedDeviceCanCreateFreshSessionAfterLogoutButOtherDeviceCannot(t *testing.T) {
	service := testService()
	credential := strings.Repeat("c", 64)
	created := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"deviceCredential":   credential,
		"requestedPrincipal": map[string]any{"type": "INDIVIDUAL", "id": "user_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("expected initial verified login, got %#v", created)
	}
	revoked := service.Handle(testEnvelope("RevokeSession", map[string]any{"reason": "USER_LOGOUT"}, command.Target{Type: "Session", ID: created.Aggregate.ID}))
	if revoked.Outcome != "ACCEPTED" {
		t.Fatalf("expected real server logout, got %#v", revoked)
	}

	wrong := service.Handle(testEnvelope("ResumeTrustedDeviceSession", map[string]any{
		"deviceId": "device_001", "deviceCredential": strings.Repeat("d", 64),
	}, command.Target{Type: "Session", ID: "new"}))
	if wrong.Outcome != "REJECTED" || wrong.Error == nil || wrong.Error.ErrorCode != "DEVICE_PROOF_INVALID" {
		t.Fatalf("wrong installation proof must be rejected, got %#v", wrong)
	}

	resumed := service.Handle(testEnvelope("ResumeTrustedDeviceSession", map[string]any{
		"deviceId": "device_001", "deviceCredential": credential,
	}, command.Target{Type: "Session", ID: "new"}))
	if resumed.Outcome != "ACCEPTED" || resumed.Auth == nil || resumed.Auth.SessionID == created.Auth.SessionID {
		t.Fatalf("trusted device must receive a fresh session after logout, got %#v", resumed)
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
			_, _, err := service.tokenManager.Rotate(context.Background(), created.Auth.RefreshToken, "device_001", strings.Repeat("a", 64))
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
