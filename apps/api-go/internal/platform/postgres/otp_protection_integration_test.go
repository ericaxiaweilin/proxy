package postgres

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// otpClock is a controllable clock.Clock for TTL / throttle tests.
type otpClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *otpClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *otpClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// beginOtp drives BeginPasswordlessAuthentication and returns the
// challenge id (OperationRef) or the raw result when not PENDING.
func beginOtp(t *testing.T, svc *identity.Service, ctx context.Context, email, deviceID string) (string, bool) {
	t.Helper()
	r := svc.HandleContext(ctx, idEnvelope("BeginPasswordlessAuthentication", map[string]any{
		"channel": "EMAIL", "identifier": email, "deviceId": deviceID, "platform": "IOS",
	}, "ignored"))
	if r.Outcome != "PENDING" {
		return "", false
	}
	return r.OperationRef, true
}

func verifyOtp(t *testing.T, svc *identity.Service, ctx context.Context, challengeID, code string) string {
	t.Helper()
	r := svc.HandleContext(ctx, idEnvelope("VerifyLoginChallenge", map[string]any{
		"challengeId": challengeID, "code": code,
	}, "ignored"))
	if r.Outcome == "ACCEPTED" {
		return "ACCEPTED"
	}
	if r.Error != nil {
		return r.Error.ErrorCode
	}
	return r.Outcome
}

func cleanupOtpRows(t *testing.T, pool *pgxpool.Pool, email string, devices ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Outbox rows FIRST (principal_id = the account resolved from the
	// login identity, which the deletes below remove): leftover PENDING
	// outbox events from this test would crowd the Claim(limit) window
	// and break TestOutboxPostgresLifecycle's e2 re-claim assertion —
	// exactly the shared-DB hygiene TEST-HYGIENE-001 pins.
	_, _ = pool.Exec(ctx, `DELETE FROM integration.outbox_messages WHERE principal_id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.session_tokens WHERE session_id IN (SELECT id FROM identity.sessions WHERE device_id = ANY($1))`, devices)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.sessions WHERE device_id = ANY($1)`, devices)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.login_challenges WHERE device_id = ANY($1)`, devices)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.login_challenges WHERE login_identity_id IN (SELECT id FROM identity.login_identities WHERE identifier = $1)`, email)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.device_registrations WHERE id = ANY($1)`, devices)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.memberships WHERE user_account_id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.login_identities WHERE identifier = $1`, email)
	_, _ = pool.Exec(ctx, `DELETE FROM identity.user_accounts WHERE id IN (SELECT user_account_id FROM identity.login_identities WHERE identifier = $1)`, email)
}

// OTP-BRUTEFORCE-001: a single login challenge allows at most 5 wrong
// codes, then LOCKS; the correct code afterwards is rejected; a correct
// code after the 5-minute TTL is rejected too. Pins EXISTING behavior
// (industry standard: bounded attempts + short TTL per code).
func TestLoginChallengeBruteForceLockout(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	fc := &otpClock{now: time.Now().UTC()}
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, fc, switchTestChallengeProvider{})

	run := time.Now().UnixNano()
	email := fmt.Sprintf("otp-bf-%d@switch.test", run)
	device := fmt.Sprintf("dev_otpbf_%d", run)
	t.Cleanup(func() { cleanupOtpRows(t, pool, email, device) })

	// 1. Five wrong codes: each REJECTED; the 5th tips Attempts to
	// MaxAttempts and LOCKs the challenge in the DB.
	ch, ok := beginOtp(t, svc, ctx, email, device)
	if !ok {
		t.Fatalf("begin: challenge not pending")
	}
	for i := 1; i <= 5; i++ {
		if got := verifyOtp(t, svc, ctx, ch, "000000"); got != "LOGIN_CHALLENGE_INVALID" {
			t.Fatalf("wrong code #%d: got %s, want LOGIN_CHALLENGE_INVALID", i, got)
		}
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM identity.login_challenges WHERE id = $1`, ch).Scan(&status); err != nil {
		t.Fatalf("challenge row: %v", err)
	}
	if status != "LOCKED" {
		t.Fatalf("after 5 wrong codes: status %s, want LOCKED", status)
	}

	// 2. The CORRECT code on the locked challenge is rejected.
	if got := verifyOtp(t, svc, ctx, ch, "123456"); got != "LOGIN_CHALLENGE_INVALID" {
		t.Fatalf("correct code on locked challenge: got %s, want LOGIN_CHALLENGE_INVALID", got)
	}

	// 3. TTL: a fresh challenge whose 5-minute window has elapsed rejects
	// even the correct code. (61s gap respects OTP-THROTTLE-001 — a real
	// user must also wait out the resend window.)
	fc.advance(61 * time.Second)
	ch2, ok := beginOtp(t, svc, ctx, email, device)
	if !ok {
		t.Fatalf("begin #2: challenge not pending")
	}
	fc.advance(5*time.Minute + time.Second)
	if got := verifyOtp(t, svc, ctx, ch2, "123456"); got != "LOGIN_CHALLENGE_INVALID" {
		t.Fatalf("correct code after TTL: got %s, want LOGIN_CHALLENGE_INVALID", got)
	}
}

// OTP-SINGLE-CODE-001: requesting a new code SUPERSEDES the previous
// PENDING one — only the most recent code is valid (WhatsApp / Telegram
// / Twilio Verify semantics). Previously every Begin created another
// 5-attempt code, multiplying brute-force surface per identifier.
func TestLoginChallengeSingleActiveCode(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	fc := &otpClock{now: time.Now().UTC()}
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, fc, switchTestChallengeProvider{})

	run := time.Now().UnixNano()
	email := fmt.Sprintf("otp-sc-%d@switch.test", run)
	device := fmt.Sprintf("dev_otpsc_%d", run)
	t.Cleanup(func() { cleanupOtpRows(t, pool, email, device) })

	ch1, ok := beginOtp(t, svc, ctx, email, device)
	if !ok {
		t.Fatalf("begin #1: challenge not pending")
	}
	// User taps "resend" after 61s (throttle window) — old code must die.
	fc.advance(61 * time.Second)
	ch2, ok := beginOtp(t, svc, ctx, email, device)
	if !ok {
		t.Fatalf("begin #2 (resend): challenge not pending")
	}

	// The FIRST code is superseded: correct code rejected.
	if got := verifyOtp(t, svc, ctx, ch1, "123456"); got != "LOGIN_CHALLENGE_INVALID" {
		t.Fatalf("superseded code accepted: got %s, want LOGIN_CHALLENGE_INVALID", got)
	}
	// ...and its DB row left the PENDING state.
	var st1 string
	if err := pool.QueryRow(ctx, `SELECT status FROM identity.login_challenges WHERE id = $1`, ch1).Scan(&st1); err != nil {
		t.Fatalf("superseded row: %v", err)
	}
	if st1 == "PENDING" {
		t.Fatalf("superseded challenge still PENDING in DB")
	}

	// The SECOND (most recent) code verifies.
	if got := verifyOtp(t, svc, ctx, ch2, "123456"); got != "ACCEPTED" {
		t.Fatalf("newest code rejected: got %s, want ACCEPTED", got)
	}
}

// OTP-THROTTLE-001: code requests are throttled per identifier — at
// most 1 per minute and 10 per hour (Twilio Verify's standard ladder).
// Previously a caller could mint unlimited 5-attempt codes.
func TestLoginChallengeRequestThrottle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	fc := &otpClock{now: time.Now().UTC()}
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, fc, switchTestChallengeProvider{})

	run := time.Now().UnixNano()
	email := fmt.Sprintf("otp-th-%d@switch.test", run)
	device := fmt.Sprintf("dev_otpth_%d", run)
	t.Cleanup(func() { cleanupOtpRows(t, pool, email, device) })

	begin := func() (string, string) {
		r := svc.HandleContext(ctx, idEnvelope("BeginPasswordlessAuthentication", map[string]any{
			"channel": "EMAIL", "identifier": email, "deviceId": device, "platform": "IOS",
		}, "ignored"))
		if r.Outcome == "PENDING" {
			return "PENDING", r.OperationRef
		}
		if r.Error != nil {
			return r.Error.ErrorCode, ""
		}
		return r.Outcome, ""
	}

	// 1. First request passes.
	if outcome, _ := begin(); outcome != "PENDING" {
		t.Fatalf("first request: %s, want PENDING", outcome)
	}
	// 2. Immediate resend is throttled.
	if outcome, _ := begin(); outcome != "OTP_THROTTLED" {
		t.Fatalf("immediate resend: %s, want OTP_THROTTLED", outcome)
	}
	// 3. After the 1-minute window a resend passes.
	fc.advance(61 * time.Second)
	if outcome, _ := begin(); outcome != "PENDING" {
		t.Fatalf("resend after 61s: %s, want PENDING", outcome)
	}

	// 4. Hourly cap: 10 requests inside one hour max. Two already used;
	// burn the remaining 8 at 61s intervals, then the 11th throttles.
	for i := 0; i < 8; i++ {
		fc.advance(61 * time.Second)
		if outcome, _ := begin(); outcome != "PENDING" {
			t.Fatalf("hourly-ladder request #%d: %s, want PENDING", i+3, outcome)
		}
	}
	fc.advance(61 * time.Second)
	if outcome, _ := begin(); outcome != "OTP_THROTTLED" {
		t.Fatalf("11th request in the hour: %s, want OTP_THROTTLED", outcome)
	}
}
