package identity

import (
	"context"
	"encoding/json"
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

func TestPasswordlessEmailLengthBoundaryIsSharedByRegisterAndLogin(t *testing.T) {
	service := NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)), testLoginChallengeProvider{})
	exactly50 := strings.Repeat("a", 38) + "@example.com"
	accepted := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": exactly50, "deviceId": "device_50", "platform": "IOS",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if accepted.Outcome != "PENDING" {
		t.Fatalf("expected 50-character email accepted, got %#v", accepted)
	}
	tooLong := strings.Repeat("a", 39) + "@example.com"
	rejected := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": tooLong, "deviceId": "device_51", "platform": "IOS",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if rejected.Outcome != "REJECTED" || rejected.Error == nil || rejected.Error.ErrorCode != "INVALID_PASSWORDLESS_AUTHENTICATION" {
		t.Fatalf("expected 51-character email rejected, got %#v", rejected)
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

// --- R16.10-P1-F: privacy request center tests (Vietnam PDP 91/2025/QH15 Art. 31/32) ---

// privacyTestService is a small helper that builds a Service backed by
// the in-memory repository. The memory repo implements
// PrivacyRequestRepository, so the service can route privacy commands
// without a real database. The test is fully hermetic: no env, no DB,
// no goroutines.
func privacyTestService(t *testing.T) *Service {
	t.Helper()
	clock := clock.NewFixed(time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC))
	return NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(nil), clock, testLoginChallengeProvider{})
}

func privacyEnvelopeForUser(userID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "test_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: userID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: userID},
		Target:         command.Target{Type: "PrivacyRequest", ID: userID},
		AuthContext:    map[string]any{"clientIp": "203.0.113.7", "userAgent": "vitest"},
		Payload:        payload,
		CorrelationID:  "test-corr-" + commandType,
	}
}

// anonUserID runs a CreateAnonymousSession through the service and
// returns the resulting user account id. The command.Aggregate.ID
// returned by the service is the session id; the user id is the
// Principal stamped onto the issued session, which we read out of the
// Body for the simple in-memory test repository.
func anonUserID(t *testing.T, svc *Service, deviceID, credential string) string {
	t.Helper()
	result := svc.HandleContext(context.Background(), privacyEnvelopeForUser("ignored", "CreateAnonymousSession", map[string]any{
		"deviceId":         deviceID,
		"platform":         "IOS",
		"deviceCredential": credential,
		"dateOfBirth":      "2000-01-01",
		"legalDocVersion":  "1.1",
		"consents":         map[string]any{"terms": true, "privacy": true},
	}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("anon signup failed: %+v", result.Error)
	}
	if result.Auth == nil || result.Auth.Principal.ID == "" {
		t.Fatalf("anon signup returned no principal id: %+v", result)
	}
	return result.Auth.Principal.ID
}

// TestPrivacyRequestExportAndStatus walks the happy path: an
// authenticated user submits an export request, then immediately
// queries its status. The status should be 'received' and the audit
// log should record exactly one transition.
func TestPrivacyRequestExportAndStatus(t *testing.T) {
	svc := privacyTestService(t)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_export_1", "0123456789012345678901234567890123456789")

	// Submit an export request.
	exportEnvelope := privacyEnvelopeForUser(userID, "RequestPrivacyExport", map[string]any{"legalBasis": "PDP-91/2025/QH15-Art31"})
	exportResult := svc.HandleContext(ctx, exportEnvelope)
	if exportResult.Outcome != "ACCEPTED" {
		t.Fatalf("export request failed: %+v", exportResult.Error)
	}
	reqAny, ok := exportResult.Body["privacyRequest"]
	if !ok {
		t.Fatalf("export result missing privacyRequest body: %+v", exportResult.Body)
	}
	req, ok := reqAny.(PrivacyRequest)
	if !ok {
		t.Fatalf("privacyRequest body has wrong type: %T", reqAny)
	}
	if req.Status != PrivacyRequestStatusReceived {
		t.Fatalf("expected status=received, got %s", req.Status)
	}
	if req.LegalBasis != "PDP-91/2025/QH15-Art31" {
		t.Fatalf("legalBasis not preserved: %s", req.LegalBasis)
	}

	// Status query: should match the same request id and status.
	statusEnvelope := privacyEnvelopeForUser(userID, "GetPrivacyRequestStatus", map[string]any{"requestId": req.ID})
	statusResult := svc.HandleContext(ctx, statusEnvelope)
	if statusResult.Outcome != "ACCEPTED" {
		t.Fatalf("status query failed: %+v", statusResult.Error)
	}
	if _, ok := statusResult.Body["privacyRequest"]; !ok {
		t.Fatalf("status result missing privacyRequest: %+v", statusResult.Body)
	}
}

// TestPrivacyRequestDeleteAndCancel checks the 30-day grace window:
// the user submits a delete request, then immediately cancels it. The
// request must end up in 'cancelled' state, and a second delete
// request must succeed (the partial unique index allows it once the
// first one is no longer active).
func TestPrivacyRequestDeleteAndCancel(t *testing.T) {
	svc := privacyTestService(t)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_delete_1", "0123456789012345678901234567890123456789")

	deleteEnvelope := privacyEnvelopeForUser(userID, "RequestPrivacyDelete", map[string]any{"reason": "user testing"})
	deleteResult := svc.HandleContext(ctx, deleteEnvelope)
	if deleteResult.Outcome != "ACCEPTED" {
		t.Fatalf("delete request failed: %+v", deleteResult.Error)
	}
	req := deleteResult.Body["privacyRequest"].(PrivacyRequest)
	if req.Status != PrivacyRequestStatusReceived {
		t.Fatalf("expected received, got %s", req.Status)
	}

	// Cancel it.
	cancelEnvelope := privacyEnvelopeForUser(userID, "CancelPrivacyRequest", map[string]any{"requestId": req.ID, "reason": "changed mind"})
	cancelResult := svc.HandleContext(ctx, cancelEnvelope)
	if cancelResult.Outcome != "ACCEPTED" {
		t.Fatalf("cancel request failed: %+v", cancelResult.Error)
	}
	cancelled := cancelResult.Body["privacyRequest"].(PrivacyRequest)
	if cancelled.Status != PrivacyRequestStatusCancelled {
		t.Fatalf("expected cancelled, got %s", cancelled.Status)
	}

	// Now we should be able to submit a fresh delete request.
	secondDelete := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyDelete", map[string]any{}))
	if secondDelete.Outcome != "ACCEPTED" {
		t.Fatalf("second delete should succeed after cancel, got: %+v", secondDelete.Error)
	}
}

// TestPrivacyRequestDuplicateRefused ensures that two active requests
// of the same kind are not allowed for the same user. The service
// surfaces the partial-unique-index violation as
// PRIVACY_REQUEST_ACTIVE, which the transport layer renders as 409.
func TestPrivacyRequestDuplicateRefused(t *testing.T) {
	svc := privacyTestService(t)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_dup_1", "0123456789012345678901234567890123456789")

	first := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyExport", map[string]any{}))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first export failed: %+v", first.Error)
	}

	second := svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyExport", map[string]any{}))
	if second.Outcome != "REJECTED" {
		t.Fatalf("expected second export to be rejected, got outcome=%s", second.Outcome)
	}
	if second.Error == nil || second.Error.ErrorCode != "PRIVACY_REQUEST_ACTIVE" {
		t.Fatalf("expected PRIVACY_REQUEST_ACTIVE, got %+v", second.Error)
	}
}

// TestPrivacyRequestForbiddenForOtherUsers makes sure user A cannot
// cancel user B's request, even if they know the request id.
func TestPrivacyRequestForbiddenForOtherUsers(t *testing.T) {
	svc := privacyTestService(t)
	ctx := context.Background()

	aliceID := anonUserID(t, svc, "dev_alice", "0123456789012345678901234567890123456789")
	bobID := anonUserID(t, svc, "dev_bob", "abcdefghijklmnopqrstuvwxyz1234567890")

	// Alice submits a delete.
	aliceDelete := svc.HandleContext(ctx, privacyEnvelopeForUser(aliceID, "RequestPrivacyDelete", map[string]any{}))
	if aliceDelete.Outcome != "ACCEPTED" {
		t.Fatalf("alice delete failed: %+v", aliceDelete.Error)
	}
	aliceReqID := aliceDelete.Body["privacyRequest"].(PrivacyRequest).ID

	// Bob tries to cancel Alice's request.
	bobCancel := svc.HandleContext(ctx, privacyEnvelopeForUser(bobID, "CancelPrivacyRequest", map[string]any{"requestId": aliceReqID}))
	if bobCancel.Outcome != "REJECTED" {
		t.Fatalf("expected rejection, got %s", bobCancel.Outcome)
	}
	if bobCancel.Error == nil || bobCancel.Error.ErrorCode != "PRIVACY_REQUEST_FORBIDDEN" {
		t.Fatalf("expected PRIVACY_REQUEST_FORBIDDEN, got %+v", bobCancel.Error)
	}
}

// TestPrivacyDataExport verifies that GeneratePrivacyExportData
// returns a non-empty payload that includes the user's account,
// sessions, devices, and request history.
func TestPrivacyDataExport(t *testing.T) {
	svc := privacyTestService(t)
	ctx := context.Background()

	userID := anonUserID(t, svc, "dev_export_2", "0123456789012345678901234567890123456789")

	// Submit a privacy request so the export has at least one history row.
	_ = svc.HandleContext(ctx, privacyEnvelopeForUser(userID, "RequestPrivacyExport", map[string]any{}))

	export, err := svc.GeneratePrivacyExportData(ctx, userID)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if export.Account.ID != userID {
		t.Fatalf("export account id mismatch: got %s want %s", export.Account.ID, userID)
	}
	if len(export.Sessions) == 0 {
		t.Fatalf("export sessions should include the anon session")
	}
	if len(export.PrivacyRequests) == 0 {
		t.Fatalf("export should include the privacy request we just made")
	}
	if export.LegalBasis != "PDP-91/2025/QH15-Art31" {
		t.Fatalf("export legalBasis wrong: %s", export.LegalBasis)
	}
}

// PROFILE-READ-001: the verified login identifier provisions the home-page
// identity. Registration binds email / phone but created no Profile row, so
// fresh accounts rendered a hardcoded demo identity on the client.
func TestVerifyChallengeProvisionsInitialProfile(t *testing.T) {
	fixed := clock.NewFixed(time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC))
	service := NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(nil), fixed, testLoginChallengeProvider{})
	begin := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": "NguyenThanhHuyen@Example.com", "deviceId": "device_profile", "platform": "ANDROID",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if begin.Outcome != "PENDING" || begin.OperationRef == "" {
		t.Fatalf("expected pending passwordless challenge, got %#v", begin)
	}
	challenge, err := service.repository.GetLoginChallenge(context.Background(), begin.OperationRef)
	if err != nil || challenge.UserAccountID == "" {
		t.Fatalf("expected stored challenge with account, got %#v %v", challenge, err)
	}
	verified := service.Handle(testEnvelope("VerifyLoginChallenge", map[string]any{
		"challengeId": begin.OperationRef, "code": "123456",
	}, command.Target{Type: "LoginChallenge", ID: begin.OperationRef}))
	if verified.Outcome != "ACCEPTED" {
		t.Fatalf("expected verified challenge, got %#v", verified)
	}
	read := service.Handle(profileEnvelope("GetProfile", challenge.UserAccountID, nil))
	if read.Outcome != "ACCEPTED" {
		t.Fatalf("expected provisioned profile, got %#v", read)
	}
	var body struct {
		Profile Profile `json:"profile"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Profile.Name != "nguyenthanhhuyen" || body.Profile.Handle != "@nguyenthanhhuyen" {
		t.Fatalf("profile not derived from verified identifier: %#v", body.Profile)
	}
	// An explicit UpdateProfile always wins over later verifications.
	edited := service.Handle(profileEnvelope("UpdateProfile", challenge.UserAccountID, map[string]any{
		"name": "My Name", "handle": "@myname", "bio": "", "city": "河内", "avatarPath": "",
	}))
	if edited.Outcome != "ACCEPTED" {
		t.Fatalf("explicit edit failed: %#v", edited)
	}
	// OTP-THROTTLE-001: a second code for the same identifier within one
	// minute is throttled; advance the clock so this profile-provision
	// re-verification exercises the user path, not the throttle.
	fixed.Advance(time.Minute)
	second := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": "nguyenthanhhuyen@example.com", "deviceId": "device_profile", "platform": "ANDROID",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	reverified := service.Handle(testEnvelope("VerifyLoginChallenge", map[string]any{
		"challengeId": second.OperationRef, "code": "123456",
	}, command.Target{Type: "LoginChallenge", ID: second.OperationRef}))
	if reverified.Outcome != "ACCEPTED" {
		t.Fatalf("expected second verification, got %#v", reverified)
	}
	reread := service.Handle(profileEnvelope("GetProfile", challenge.UserAccountID, nil))
	var rebody struct {
		Profile Profile `json:"profile"`
	}
	if err := json.Unmarshal([]byte(reread.OperationRef), &rebody); err != nil {
		t.Fatal(err)
	}
	if rebody.Profile.Name != "My Name" || rebody.Profile.Handle != "@myname" {
		t.Fatalf("explicit profile must survive re-verification: %#v", rebody.Profile)
	}
}

// AUTH-LOGIN-HINT-001: the login tab probes existence before sending a
// code. Unknown identifiers must NOT silently start a registration flow.
func TestLookupPasswordlessIdentityHintsUnregistered(t *testing.T) {
	service := NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)), testLoginChallengeProvider{})
	lookup := func(channel, identifier string) command.Result {
		return service.Handle(testEnvelope("LookupPasswordlessIdentity", map[string]any{
			"channel": channel, "identifier": identifier,
		}, command.Target{Type: "LoginIdentity", ID: "lookup"}))
	}
	missing := lookup("EMAIL", "nobody@example.com")
	if missing.Outcome != "REJECTED" || missing.Error == nil || missing.Error.ErrorCode != "LOGIN_IDENTITY_NOT_FOUND" {
		t.Fatalf("unknown email must hint unregistered, got %#v", missing)
	}
	begin := service.Handle(testEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": "Somebody@Example.com", "deviceId": "device_lookup", "platform": "ANDROID",
	}, command.Target{Type: "LoginChallenge", ID: "new"}))
	if begin.Outcome != "PENDING" {
		t.Fatalf("begin failed: %#v", begin)
	}
	// Lookup is case-insensitive like registration and finds the row the
	// begin call just created — without creating anything itself.
	found := lookup("EMAIL", "somebody@example.com")
	if found.Outcome != "ACCEPTED" {
		t.Fatalf("registered email must look up ACCEPTED, got %#v", found)
	}
	bad := lookup("EMAIL", "not-an-email")
	if bad.Outcome != "REJECTED" || bad.Error == nil || bad.Error.ErrorCode != "INVALID_PASSWORDLESS_LOOKUP" {
		t.Fatalf("malformed identifier must reject INVALID, got %#v", bad)
	}
}
