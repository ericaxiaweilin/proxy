package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// ACCOUNT-MULTIDEVICE-001: same account logging in on two real phones —
// the second device must NOT break the first, and the third login must
// evict the OLDEST device's session (MaxConcurrentSessions=2, FIFO
// eviction AUTO_EVICT_NEW_LOGIN, matching the WhatsApp / Telegram
// behavior of "your account is now active on another device").
//
// Pinned end-to-end through the REAL service command chain
// (Begin -> Verify -> CreateSession):
//  1. phone1 logs in  -> ACTIVE, device1 owner = user
//  2. phone2 logs in  -> ACTIVE, device2 owner = user, phone1 session
//     STILL ACTIVE (same account may hold 2 devices)
//  3. phone1's token and phone2's token resolve to the same user but
//     are distinct tokens (no cross-device token reuse)
//  4. phone3 logs in  -> ACTIVE, and the OLDEST session (phone1) is
//     evicted REVOKED (AUTO_EVICT_NEW_LOGIN) — phone1's token dies
//  5. phone2's token still authenticates an ACTIVE session
func TestAccountMultiDeviceSameAccount(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	// Controlled clock: same email on three devices back-to-back — the
	// OTP-THROTTLE-001 ladder (1 code/min per identifier) applies, so
	// the clock must advance past each resend window, exactly like a
	// human re-requesting a code on the next phone.
	fc := &otpClock{now: time.Now().UTC()}
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, fc, switchTestChallengeProvider{})

	run := time.Now().UnixNano()
	email := fmt.Sprintf("md-a-%d@switch.test", run)
	devices := []string{
		fmt.Sprintf("dev_md1_%d", run),
		fmt.Sprintf("dev_md2_%d", run),
		fmt.Sprintf("dev_md3_%d", run),
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// Outbox rows FIRST (see cleanupOtpRows): leftover PENDING outbox
		// events crowd the Claim(limit) window and break the outbox
		// lifecycle test on the shared dev DB — TEST-HYGIENE-001.
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM integration.outbox_messages WHERE principal_id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.session_tokens WHERE session_id IN (SELECT id FROM identity.sessions WHERE device_id = ANY($1))`, devices)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.sessions WHERE device_id = ANY($1)`, devices)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.login_challenges WHERE device_id = ANY($1)`, devices)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.device_registrations WHERE id = ANY($1)`, devices)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.login_identities WHERE identifier = $1`, email)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.user_accounts WHERE id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
		// memberships point at user accounts resolved by login identity
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM identity.memberships WHERE user_account_id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
	})

	// loginOnDevice drives Begin -> Verify -> CreateSession and returns
	// (result, userID) exactly like the app's auth-client login chain.
	// fc.advance first: all three phones sign in with the SAME email, so
	// the OTP-THROTTLE-001 ladder (1 code/min per identifier) must see
	// the previous code's minute window elapsed between devices.
	loginOnDevice := func(deviceID, deviceCredential string) (command.Result, string) {
		fc.advance(61 * time.Second)
		r := svc.HandleContext(ctx, idEnvelope("BeginPasswordlessAuthentication", map[string]any{
			"channel": "EMAIL", "identifier": email, "deviceId": deviceID, "platform": "IOS",
		}, "ignored"))
		if r.Outcome != "PENDING" {
			t.Fatalf("BeginPasswordlessAuthentication on %s: outcome=%s err=%+v", deviceID, r.Outcome, r.Error)
		}
		challengeID := r.OperationRef
		v := svc.HandleContext(ctx, idEnvelope("VerifyLoginChallenge", map[string]any{
			"challengeId": challengeID, "code": "123456",
		}, "ignored"))
		if v.Outcome != "ACCEPTED" {
			t.Fatalf("VerifyLoginChallenge on %s: outcome=%s err=%+v", deviceID, v.Outcome, v.Error)
		}
		s := svc.HandleContext(ctx, idEnvelope("CreateSession", map[string]any{
			"challengeId": challengeID, "deviceId": deviceID, "deviceCredential": deviceCredential,
		}, "ignored"))
		if s.Outcome != "ACCEPTED" {
			t.Fatalf("CreateSession on %s: outcome=%s err=%+v", deviceID, s.Outcome, s.Error)
		}
		return s, s.Auth.UserAccountID
	}

	// 1. phone1 logs in.
	res1, user := loginOnDevice(devices[0], "cred_md_phone1_"+repeatChars("1", 40))
	if user == "" {
		t.Fatalf("phone1 login: empty user id")
	}

	// 2. phone2 logs in — same account, different real phone. Must be
	// ACCEPTED (same account may hold MaxConcurrentSessions devices).
	res2, user2 := loginOnDevice(devices[1], "cred_md_phone2_"+repeatChars("2", 40))
	if user2 != user {
		t.Fatalf("phone2 login resolved to %s, want same user %s", user2, user)
	}

	// phone1's session is still ACTIVE at this point.
	if st := sessionStatus(t, pool, res1.Aggregate.ID); st != "ACTIVE" {
		t.Fatalf("phone1 session after phone2 login: %s, want ACTIVE", st)
	}

	// 3. tokens: same user, distinct tokens, both alive.
	if res1.Auth.AccessToken == res2.Auth.AccessToken {
		t.Fatalf("phone1 and phone2 share an access token — cross-device token reuse")
	}
	if got := lookupSessionAccountByAccessToken(t, pool, res1.Auth.AccessToken); got != user {
		t.Fatalf("phone1 token resolves to %s, want %s", got, user)
	}
	if got := lookupSessionAccountByAccessToken(t, pool, res2.Auth.AccessToken); got != user {
		t.Fatalf("phone2 token resolves to %s, want %s", got, user)
	}

	// 4. phone3 logs in -> OLDEST (phone1) evicted.
	res3, _ := loginOnDevice(devices[2], "cred_md_phone3_"+repeatChars("3", 40))
	if res3.Outcome != "ACCEPTED" {
		t.Fatalf("phone3 login: outcome=%s", res3.Outcome)
	}
	if st := sessionStatus(t, pool, res1.Aggregate.ID); st != "REVOKED" {
		t.Fatalf("phone1 session after phone3 login: %s, want REVOKED (AUTO_EVICT_NEW_LOGIN)", st)
	}
	if active := countActiveSessionsForToken(t, pool, res1.Auth.AccessToken); active != 0 {
		t.Fatalf("phone1's evicted token still authenticates %d ACTIVE sessions", active)
	}

	// 5. phone2's session and token survive.
	if st := sessionStatus(t, pool, res2.Aggregate.ID); st != "ACTIVE" {
		t.Fatalf("phone2 session after phone3 login: %s, want ACTIVE", st)
	}
	if got := lookupSessionAccountByAccessToken(t, pool, res2.Auth.AccessToken); got != user {
		t.Fatalf("phone2 token after phone3 login resolves to %s, want %s", got, user)
	}
}

func sessionStatus(t *testing.T, pool *pgxpool.Pool, sessionID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM identity.sessions WHERE id = $1`, sessionID).Scan(&status); err != nil {
		t.Fatalf("session status lookup %s: %v", sessionID, err)
	}
	return status
}

func repeatChars(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
