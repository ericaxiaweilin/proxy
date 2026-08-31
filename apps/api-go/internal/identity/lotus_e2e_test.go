package identity

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func TestLotus_MaxConcurrentSessions_EvictsOldest(t *testing.T) {
	clk := &fixedLotusClock{now: time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)}
	repo := NewMemoryRepository(&Seed{
		User: UserAccount{ID: "user_lotus_e2e", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_lotus", UserAccountID: "user_lotus_e2e", Channel: "EMAIL", Identifier: "lotus@test.com", Verified: true, Status: "ACTIVE"},
		Devices: []DeviceRegistration{
			{ID: "dev_a", UserAccountID: "user_lotus_e2e", Platform: "IOS", Status: "ACTIVE"},
			{ID: "dev_b", UserAccountID: "user_lotus_e2e", Platform: "IOS", Status: "ACTIVE"},
			{ID: "dev_c", UserAccountID: "user_lotus_e2e", Platform: "IOS", Status: "ACTIVE"},
		},
	})
	svc := NewWithRepositoryAndClock(repo, clk)
	ctx := context.Background()

	// seed 2 sessions directly via repo (bypass service) to simulate pre-existing logins
	s1 := Session{ID: "sess_a", UserAccountID: "user_lotus_e2e", DeviceID: "dev_a", Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_lotus_e2e"}, IssuedAt: clk.now.Add(-2 * time.Hour), ExpiresAt: clk.now.Add(30 * 24 * time.Hour), Version: 1}
	s2 := Session{ID: "sess_b", UserAccountID: "user_lotus_e2e", DeviceID: "dev_b", Status: "ACTIVE", Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_lotus_e2e"}, IssuedAt: clk.now.Add(-1 * time.Hour), ExpiresAt: clk.now.Add(30 * 24 * time.Hour), Version: 1}
	if err := repo.CreateSession(ctx, s1); err != nil {
		t.Fatalf("seed s1: %v", err)
	}
	if err := repo.CreateSession(ctx, s2); err != nil {
		t.Fatalf("seed s2: %v", err)
	}

	// prepare a verified challenge for dev_c
	ch := LoginChallenge{ID: "chal_c", UserAccountID: "user_lotus_e2e", LoginIdentityID: "login_lotus", DeviceID: "dev_c", Channel: "EMAIL", ProviderRef: "ref", Status: "VERIFIED", MaxAttempts: 5, Version: 1, RequestedAt: clk.now.Add(-1 * time.Minute), ExpiresAt: clk.now.Add(5 * time.Minute), VerifiedAt: clk.now}
	// directly insert via repo's internal challenge map via CreateLoginChallenge path: use UpdateLoginChallenge after inserting via Save? easier: use repository's Create via Service's persist path is private.
	// Instead use the repository's underlying method: we can cheat by calling svc.Handle VerifyLoginChallenge with a PENDING challenge that we insert via t helper.
	// For determinism, insert challenge via reflection of MemoryRepository's private field using exported helper: we can use repo.CreateSessionWithTokensAndChallengeAndPublish dummy to insert challenge? Simplest: use repo's challenge storage via Ensure? Instead manually set via type assertion to *MemoryRepository and set map via unsafe exposed helper NewMemoryRepository already seeds Challenges empty, but we can add via direct field access if we expose.
	// Workaround: use the public API: Create a challenge via login flow is complex, so test enforceMaxConcurrentSessions directly via unexported method call.
	// Since enforceMaxConcurrentSessions is unexported but same package, we can call it directly.
	env := command.Envelope{CommandID: "cmd_c", CorrelationID: "corr_c", Actor: command.Actor{Type: "USER", ID: "user_lotus_e2e"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_lotus_e2e"}}
	if err := svc.enforceMaxConcurrentSessions(ctx, "user_lotus_e2e", env); err != nil {
		t.Fatalf("enforce: %v", err)
	}
	// after enforce, oldest sess_a should be REVOKED
	sess, err := repo.GetSession(ctx, "sess_a")
	if err != nil {
		t.Fatalf("get sess_a: %v", err)
	}
	if sess.Status != "REVOKED" {
		t.Fatalf("sess_a status = %s, want REVOKED", sess.Status)
	}
	sessB, _ := repo.GetSession(ctx, "sess_b")
	if sessB.Status != "ACTIVE" {
		t.Fatalf("sess_b should stay ACTIVE, got %s", sessB.Status)
	}
	_ = ch // challenge not needed for direct enforce test
}

type fixedLotusClock struct{ now time.Time }
func (c *fixedLotusClock) Now() time.Time { return c.now }
