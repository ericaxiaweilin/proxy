package identity

import (
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

func TestSessionExpiryUsesInjectedClock(t *testing.T) {
	fixed := clock.NewFixed(time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC))
	service := NewWithClock(&Seed{
		User:          UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE"},
		Memberships: []Membership{{
			Principal:     command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
			UserAccountID: "user_001",
			Status:        "ACTIVE",
		}},
		Devices:    []DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
		Challenges: []LoginChallenge{{ID: "challenge_001", UserAccountID: "user_001", LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "EMAIL", ProviderRef: "provider_challenge_001", Status: "VERIFIED", MaxAttempts: 5, Version: 1, RequestedAt: time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC), ExpiresAt: time.Date(2099, 8, 14, 0, 0, 0, 0, time.UTC), VerifiedAt: time.Date(2026, 8, 14, 0, 1, 0, 0, time.UTC)}},
	}, fixed)

	session := service.Handle(testEnvelope("CreateSession", map[string]any{
		"userAccountId": "user_001", "loginIdentityId": "login_001", "deviceId": "device_001", "challengeId": "challenge_001",
		"requestedPrincipal": map[string]any{"type": "INDIVIDUAL", "id": "user_001"},
	}, command.Target{Type: "Session", ID: "new"}))
	if session.Outcome != "ACCEPTED" {
		t.Fatalf("create session failed: %#v", session)
	}

	fixed.Advance(30 * 24 * time.Hour)
	expired := service.Handle(testEnvelope("SwitchPrincipalContext", map[string]any{
		"principal": map[string]any{"type": "INDIVIDUAL", "id": "user_001"},
	}, command.Target{Type: "Session", ID: session.Aggregate.ID}))
	if expired.Outcome != "REJECTED" || expired.Error == nil || expired.Error.ErrorCode != "SESSION_NOT_USABLE" {
		t.Fatalf("expected expired session rejection, got %#v", expired)
	}
}
