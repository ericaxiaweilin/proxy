package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// ACCOUNT-SWITCH-001: same physical phone, log out of A, log into B —
// was REJECTED with PASSWORDLESS_IDENTITY_UNAVAILABLE because
// RevokeSession never releases the device row and upsertDevice's
// owner guard is absolute. PRODUCT INTENT (native-app.tsx keeps a
// last-sign-in list per device, me.tsx signOut → RevokeSession +
// keychain clear) requires the switch to work after logout.
//
// Fix semantics (takeover device binding): when the device's owning
// account has no ACTIVE session on that device, the new login silently
// reassigns the device (reassignDevice ON CONFLICT DO UPDATE). When the
// owner still has an ACTIVE session on the device, the guard stays
// absolute — one active account per device at a time.
//
// The switch chain pinned here end-to-end through the REAL service
// command path (Begin → Verify → CreateSession → RevokeSession):
//  1. A logs in on device D            → ACCEPTED, device owner = A
//  2. B logs in on D while A ACTIVE    → REJECTED (one active account
//     per device; B must wait for A to log out)
//  3. A logs out (RevokeSession)       → ACCEPTED
//  4. B logs in on D                   → ACCEPTED, device owner = B
//  5. A's revoked session stays REVOKED (no resurrection)
//  6. A's OLD access token no longer resolves to an ACTIVE session —
//     token cross-link guard at the protocol layer
//  7. B's token resolves to B (identity hydration follows the login
//     account, never the device — PROFILE-READ-001 class)
//  8. A logs back in on D (switch back) → ACCEPTED, owner = A again
func TestAccountSwitchSameDeviceLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, nil, switchTestChallengeProvider{})

	run := time.Now().UnixNano()
	runID := itoa(run)
	deviceID := "dev_sw_" + runID
	emailA := "sw-a-" + runID + "@switch.test"
	emailB := "sw-b-" + runID + "@switch.test"
	credA := stringsRepeat("a", 64)
	credB := stringsRepeat("b", 64)
	credA2 := stringsRepeat("c", 64)

	// TEST-HYGIENE-001: run-scoped cleanup — only rows this test created.
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.session_tokens WHERE session_id IN (SELECT id FROM identity.sessions WHERE device_id = $1)`, deviceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.sessions WHERE device_id = $1`, deviceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.login_challenges WHERE device_id = $1`, deviceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.device_registrations WHERE id = $1`, deviceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.memberships WHERE user_account_id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier IN ($1, $2))`, emailA, emailB)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.login_identities WHERE identifier IN ($1, $2)`, emailA, emailB)
		// user_accounts: exact run-scoped IDs (owned by this test's login identities).
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.user_accounts WHERE id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier IN ($1, $2))`, emailA, emailB)
	})

	// login drives the full passwordless chain through the service layer.
	login := func(email, deviceCredential string) (command.Result, string) {
		r := svc.HandleContext(ctx, idEnvelope("BeginPasswordlessAuthentication", map[string]any{
			"channel": "EMAIL", "identifier": email, "deviceId": deviceID, "platform": "IOS",
		}, "ignored"))
		if r.Outcome != "PENDING" {
			t.Fatalf("BeginPasswordlessAuthentication for %s: outcome=%s err=%+v", email, r.Outcome, r.Error)
		}
		challengeID := r.OperationRef
		v := svc.HandleContext(ctx, idEnvelope("VerifyLoginChallenge", map[string]any{
			"challengeId": challengeID, "code": "123456",
		}, "ignored"))
		if v.Outcome != "ACCEPTED" {
			t.Fatalf("VerifyLoginChallenge for %s: outcome=%s err=%+v", email, v.Outcome, v.Error)
		}
		s := svc.HandleContext(ctx, idEnvelope("CreateSession", map[string]any{
			"challengeId": challengeID, "deviceId": deviceID, "deviceCredential": deviceCredential,
		}, "ignored"))
		if s.Outcome != "ACCEPTED" {
			t.Fatalf("CreateSession for %s: outcome=%s err=%+v", email, s.Outcome, s.Error)
		}
		if s.Auth == nil || s.Auth.AccessToken == "" {
			t.Fatalf("CreateSession for %s: no auth tokens", email)
		}
		return s, s.Auth.UserAccountID
	}

	logout := func(userID, sessionID string) command.Result {
		return svc.HandleContext(ctx, idEnvelope("RevokeSession", map[string]any{"reason": "USER_LOGOUT"}, userID, sessionID))
	}

	deviceOwner := func() string {
		dev, err := repo.GetDevice(ctx, deviceID)
		if err != nil {
			t.Fatalf("GetDevice: %v", err)
		}
		return dev.UserAccountID
	}

	// 1. Account A logs in on the device.
	resA, userA := login(emailA, credA)
	if userA == "" {
		t.Fatalf("account A: empty user id")
	}
	if owner := deviceOwner(); owner != userA {
		t.Fatalf("step 1: device owner %s, want A %s", owner, userA)
	}

	// 2. B tries while A's session is ACTIVE — must stay REJECTED
	// (one active account per device; this is the security invariant,
	// not a bug).
	rB := svc.HandleContext(ctx, idEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": emailB, "deviceId": deviceID, "platform": "IOS",
	}, "ignored"))
	if rB.Outcome != "REJECTED" {
		t.Fatalf("step 2: B login while A active must be REJECTED, got %s (one-active-account-per-device guard)", rB.Outcome)
	}

	// 3. A logs out — exactly like auth-client.ts signOut().
	if out := logout(userA, resA.Aggregate.ID); out.Outcome != "ACCEPTED" {
		t.Fatalf("step 3: A logout: outcome=%s err=%+v", out.Outcome, out.Error)
	}

	// 4. B logs in on the SAME device — the account switch.
	resB, userB := login(emailB, credB)
	if userB == "" || userB == userA {
		t.Fatalf("step 4: B login must be a distinct account: A=%s B=%s", userA, userB)
	}
	if owner := deviceOwner(); owner != userB {
		t.Fatalf("step 4: device must be reassigned to B after switch: owner=%s want=%s", owner, userB)
	}

	// 5. A's session stays REVOKED (no resurrection via the switch).
	var state string
	if err := pool.QueryRow(ctx, `SELECT status FROM identity.sessions WHERE id = $1`, resA.Aggregate.ID).Scan(&state); err != nil {
		t.Fatalf("step 5: A session row: %v", err)
	}
	if state != "REVOKED" {
		t.Fatalf("step 5: A session status %s, want REVOKED", state)
	}

	// 6. A's OLD access token must not authenticate an ACTIVE session —
	// protocol-layer cross-link guard (TokenManager.Authenticate path).
	if active := countActiveSessionsForToken(t, pool, resA.Auth.AccessToken); active != 0 {
		t.Fatalf("step 6: A's revoked token still points at an ACTIVE session (count=%d) — token cross-link after switch", active)
	}

	// 7. B's token resolves to B, never A (identity hydration follows
	// the login account — PROFILE-READ-001 class guard).
	if got := lookupSessionAccountByAccessToken(t, pool, resB.Auth.AccessToken); got != userB {
		t.Fatalf("step 7: B's access token resolves to %s, want B %s", got, userB)
	}

	// 8. Switch BACK to A (B logs out first): the phone must be able to
	// return to the earlier account — the last-sign-in list round-trip.
	if out := logout(userB, resB.Aggregate.ID); out.Outcome != "ACCEPTED" {
		t.Fatalf("step 8: B logout: outcome=%s err=%+v", out.Outcome, out.Error)
	}
	resA2, userA2 := login(emailA, credA2)
	_ = resA2
	if userA2 != userA {
		t.Fatalf("step 8: switch-back login resolved to %s, want original A %s", userA2, userA)
	}
	if owner := deviceOwner(); owner != userA {
		t.Fatalf("step 8: device must return to A: owner=%s want=%s", owner, userA)
	}
}

// countActiveSessionsForToken replicates TokenManager.Authenticate's
// acceptance condition for a raw access token: it counts ACTIVE
// sessions the token's hash still points at (0 = token dead).
func countActiveSessionsForToken(t *testing.T, pool *pgxpool.Pool, accessToken string) int {
	t.Helper()
	digest := sha256Sum(accessToken)
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*)
		FROM identity.session_tokens st
		JOIN identity.sessions s ON s.id = st.session_id
		WHERE st.access_token_hash = $1 AND s.status = 'ACTIVE'`, digest).Scan(&n)
	if err != nil {
		t.Fatalf("active-token count for %q: %v", accessToken, err)
	}
	return n
}

// lookupSessionAccountByAccessToken resolves which user account an access
// token belongs to, through the same tables the API middleware uses
// (TokenManager.Authenticate -> GetByAccessTokenHash(hashToken(raw))).
func lookupSessionAccountByAccessToken(t *testing.T, pool *pgxpool.Pool, accessToken string) string {
	t.Helper()
	var accountID string
	err := pool.QueryRow(context.Background(), `
		SELECT s.user_account_id
		FROM identity.session_tokens st
		JOIN identity.sessions s ON s.id = st.session_id
		WHERE st.access_token_hash = $1`, sha256Sum(accessToken)).Scan(&accountID)
	if err != nil {
		t.Fatalf("token lookup for %q: %v", accessToken, err)
	}
	return accountID
}

// sha256Sum mirrors identity.hashToken (unexported): sha256 hex of the
// raw token. Must stay in sync with internal/identity/token.go.
func sha256Sum(raw string) string {
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:])
}

// stringsRepeat avoids importing strings for a one-liner.
func stringsRepeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}

// switchTestChallengeProvider mirrors identity.testLoginChallengeProvider:
// Request records the challenge, Verify accepts the fixed code "123456"
// (the OTP delivery round-trip itself is pinned by
// TestRequestLoginChallengeDeliversSMSToUpstream in internal/identity).
type switchTestChallengeProvider struct{}

func (switchTestChallengeProvider) Request(context.Context, identity.LoginChallengeRequest) (identity.ProviderChallenge, error) {
	return identity.ProviderChallenge{ProviderRef: "provider_ref_switch_test"}, nil
}

func (switchTestChallengeProvider) Verify(_ context.Context, verification identity.LoginChallengeVerification) (identity.ProviderVerification, error) {
	return identity.ProviderVerification{Verified: verification.Code == "123456"}, nil
}
