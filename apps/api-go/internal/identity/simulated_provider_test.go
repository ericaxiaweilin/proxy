package identity

import (
	"context"
	"testing"
	"time"
)

func TestSimulatedLoginChallengeProviderUsesConfiguredCodeOnce(t *testing.T) {
	now := time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC)
	provider := NewSimulatedLoginChallengeProviderWithClock("246810", func() time.Time { return now })
	challenge, err := provider.Request(context.Background(), LoginChallengeRequest{LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "EMAIL"})
	if err != nil || challenge.ProviderRef == "" || !challenge.ExpiresAt.Equal(now.Add(5*time.Minute)) {
		t.Fatalf("unexpected simulated challenge: %#v err=%v", challenge, err)
	}
	wrong, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: "123456"})
	if err != nil || wrong.Verified {
		t.Fatalf("wrong code should be rejected: %#v err=%v", wrong, err)
	}
	verified, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: "246810"})
	if err != nil || !verified.Verified {
		t.Fatalf("configured code should verify: %#v err=%v", verified, err)
	}
	replayed, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: "246810"})
	if err != nil || replayed.Verified {
		t.Fatalf("simulated challenge must be one-time: %#v err=%v", replayed, err)
	}
}

func TestSimulatedLoginChallengeProviderExpires(t *testing.T) {
	now := time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC)
	provider := NewSimulatedLoginChallengeProviderWithClock("246810", func() time.Time { return now })
	challenge, err := provider.Request(context.Background(), LoginChallengeRequest{})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(5 * time.Minute)
	verified, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: "246810"})
	if err != nil || verified.Verified {
		t.Fatalf("expired challenge should be rejected: %#v err=%v", verified, err)
	}
}
