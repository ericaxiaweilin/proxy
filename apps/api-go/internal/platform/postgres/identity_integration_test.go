package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// TestIdentityPostgresRoundTrip covers the M1 acceptance chain through
// real PostgreSQL: anonymous session creation (EnsureAnonymousIdentity
// is idempotent per device+platform), device registration (the binding
// invariant: one device belongs to one user), and the cross-user
// "device already bound to someone else" rejection.
func TestIdentityPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, nil, nil)

	run := time.Now().UnixNano()
	deviceA := "dev_pg_" + itoa(run) + "_a"
	deviceB := "dev_pg_" + itoa(run) + "_b"

	// 1. First anonymous session: creates a new user (Status=ANONYMOUS)
	// and binds deviceA to that user.
	r := svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceA, "platform": "IOS", "dateOfBirth": "1990-01-01",
		"consents":       map[string]any{"terms": true, "privacy": true},
		"legalDocVersion": "1.1",
	}, "anon_init"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateAnonymousSession #1: %+v", r.Error)
	}
	if r.Aggregate.State != "ACTIVE" {
		t.Fatalf("session must be ACTIVE, got %s", r.Aggregate.State)
	}
	if r.Auth == nil || r.Auth.AccessToken == "" || r.Auth.RefreshToken == "" {
		t.Fatalf("session must return non-empty auth tokens: %+v", r.Auth)
	}
	userID1 := lookupUserIDForDevicePG(t, pool, deviceA)
	if userID1 == "" {
		t.Fatalf("CreateAnonymousSession #1: no user bound to deviceA after first call")
	}

	// 2. Second anonymous session on the SAME device: must be
	// idempotent (returns the SAME user, not a new one). This proves
	// EnsureAnonymousIdentity held the per-device user invariant
	// through real PostgreSQL, not just the in-memory map.
	r = svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceA, "platform": "IOS", "dateOfBirth": "1990-01-01",
		"consents":       map[string]any{"terms": true, "privacy": true},
		"legalDocVersion": "1.1",
	}, "anon_init"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateAnonymousSession #2: %+v", r.Error)
	}
	userID2 := lookupUserIDForDevicePG(t, pool, deviceA)
	if userID2 != userID1 {
		t.Fatalf("EnsureAnonymousIdentity must be idempotent per device: user1=%s user2=%s", userID1, userID2)
	}

	// 3. A different device (deviceB) produces a NEW user — proving
	// the per-device user creation is keyed on device, not on
	// global counter.
	r = svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceB, "platform": "ANDROID", "dateOfBirth": "1990-01-01",
		"consents":       map[string]any{"terms": true, "privacy": true},
		"legalDocVersion": "1.1",
	}, "anon_init"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateAnonymousSession deviceB: %+v", r.Error)
	}
	userID3 := lookupUserIDForDevicePG(t, pool, deviceB)
	if userID3 == userID1 {
		t.Fatalf("deviceB must produce a NEW user, got same as user1: %s", userID1)
	}
	if userID3 == "" {
		t.Fatalf("deviceB must be bound to a user")
	}

	// 5. Each user must have an ACTIVE session row in PG, not just an
	// in-memory cache.
	var sessionCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM identity.sessions WHERE user_account_id=$1 AND status='ACTIVE'`, userID1).Scan(&sessionCount); err != nil {
		t.Fatalf("query sessions user1: %v", err)
	}
	if sessionCount < 1 {
		t.Fatalf("user1 must have ≥1 ACTIVE session in PG, got %d", sessionCount)
	}

	// 6. RegisterDevice is gated on user.Status=ACTIVE. Anonymous
	// users are Status=ANONYMOUS, so RegisterDevice on a freshly
	// created anonymous user must be REJECTED with
	// DEVICE_REGISTRATION_NOT_ALLOWED. This proves the gate is
	// enforced on the PG path, not just on the seed in-memory path.
	r = svc.HandleContext(ctx, idEnvelope("RegisterDevice", map[string]any{
		"userAccountId": userID1, "deviceId": deviceB, "platform": "ANDROID",
		"pushTokenRef": "fcm_token_pg_" + itoa(run),
	}, userID1, "sess_pg_1"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("RegisterDevice on ANONYMOUS user must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "DEVICE_REGISTRATION_NOT_ALLOWED" {
		t.Fatalf("expected DEVICE_REGISTRATION_NOT_ALLOWED, got %+v", r.Error)
	}

	// 7. deviceB must STILL be bound to userID3 (its anonymous
	// creator), not flipped to userID1 by the rejected RegisterDevice.
	if got := lookupDevicePG(t, pool, deviceB); got != userID3 {
		t.Fatalf("deviceB must remain bound to userID3=%s after rejected register, got %s", userID3, got)
	}

	// cleanup (cascade to devices + sessions + login_identities + outbox)
	cleanupIdentityPG(t, pool, []string{userID1, userID3, deviceA, deviceB, ""})
}

func lookupUserIDForDevicePG(t *testing.T, pool *pgxpool.Pool, deviceID string) string {
	t.Helper()
	ctx := context.Background()
	var uid string
	err := pool.QueryRow(ctx, `SELECT user_account_id FROM identity.device_registrations WHERE id=$1`, deviceID).Scan(&uid)
	if err != nil {
		return ""
	}
	return uid
}

func lookupDevicePG(t *testing.T, pool *pgxpool.Pool, deviceID string) string {
	t.Helper()
	return lookupUserIDForDevicePG(t, pool, deviceID)
}

func cleanupIdentityPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	user1, user2, devA, devB, devC := ids[0], ids[1], ids[2], ids[3], ids[4]
	for _, d := range []string{devA, devB, devC} {
		if d == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM identity.device_registrations WHERE id=$1`, d); err != nil {
			t.Logf("cleanup devices: %v", err)
		}
	}
	for _, u := range []string{user1, user2} {
		if u == "" {
			continue
		}
		// FK order: session_tokens → sessions → login_identities → memberships → user_accounts
		if _, err := pool.Exec(ctx, `DELETE FROM identity.session_tokens WHERE session_id IN (SELECT id FROM identity.sessions WHERE user_account_id=$1)`, u); err != nil {
			t.Logf("cleanup session_tokens: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM identity.sessions WHERE user_account_id=$1`, u); err != nil {
			t.Logf("cleanup sessions: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM identity.login_identities WHERE user_account_id=$1`, u); err != nil {
			t.Logf("cleanup login_identities: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM identity.user_accounts WHERE id=$1`, u); err != nil {
			t.Logf("cleanup user_accounts: %v", err)
		}
	}
}

func idEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	if commandType == "CreateSession" || commandType == "CreateAnonymousSession" || commandType == "RefreshSession" || commandType == "AuthenticateWithGoogle" {
		if _, exists := payload["deviceCredential"]; !exists {
			payload["deviceCredential"] = strings.Repeat("b", 64)
		}
	}
	envelope := command.Envelope{
		CommandID:      "cmd_id_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_id_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_id_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "UserAccount", ID: targetID[0]}
	}
	return envelope
}

// R16.7-P0-A/B/C: anonymous-session legal-consent + age gate. Defense in
// depth: the same predicates enforced on the mobile client must also
// hold server-side. Any of the three failure modes must reject before
// the user row is created.
func TestCreateAnonymousSessionRejectsMissingConsents(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, nil, nil)

	run := time.Now().UnixNano()
	deviceID := "dev_consent_missing_" + itoa(run)

	r := svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceID, "platform": "IOS", "dateOfBirth": "1990-01-01",
	}, "anon_no_consent"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED without consents, got %+v", r)
	}
	if r.Error == nil || r.Error.ErrorCode != "LEGAL_CONSENT_REQUIRED" {
		t.Fatalf("expected LEGAL_CONSENT_REQUIRED, got %+v", r.Error)
	}
}

func TestCreateAnonymousSessionRejectsUnder18(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, nil, nil)

	run := time.Now().UnixNano()
	deviceID := "dev_under_18_" + itoa(run)

	r := svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceID, "platform": "IOS", "dateOfBirth": "2015-01-01",
		"consents":        map[string]any{"terms": true, "privacy": true},
		"legalDocVersion": "1.1",
	}, "anon_under_18"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED under 18, got %+v", r)
	}
	if r.Error == nil || r.Error.ErrorCode != "AGE_RESTRICTED" {
		t.Fatalf("expected AGE_RESTRICTED, got %+v", r.Error)
	}
}

func TestCreateAnonymousSessionPersistsLegalConsentRows(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepositoryWithOutbox(pool, NewOutboxRepository(pool))
	svc := identity.NewWithRepositoryAndClockAndChallengeProvider(repo, nil, nil)

	run := time.Now().UnixNano()
	deviceID := "dev_consent_ok_" + itoa(run)

	r := svc.HandleContext(ctx, idEnvelope("CreateAnonymousSession", map[string]any{
		"deviceId": deviceID, "platform": "ANDROID", "dateOfBirth": "1990-01-01",
		"consents":        map[string]any{"terms": true, "privacy": true},
		"legalDocVersion": "1.1",
	}, "anon_consent_ok"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateAnonymousSession with consent: %+v", r.Error)
	}
	userID := lookupUserIDForDevicePG(t, pool, deviceID)
	if userID == "" {
		t.Fatalf("no user bound to %s after success", deviceID)
	}
	var termsCount, privacyCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM privacy.legal_consent_records WHERE user_id = $1 AND doc_kind = 'TERMS' AND doc_version = '1.1'`, userID).Scan(&termsCount); err != nil {
		t.Fatalf("count terms consents: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM privacy.legal_consent_records WHERE user_id = $1 AND doc_kind = 'PRIVACY' AND doc_version = '1.1'`, userID).Scan(&privacyCount); err != nil {
		t.Fatalf("count privacy consents: %v", err)
	}
	if termsCount != 1 || privacyCount != 1 {
		t.Fatalf("expected 1 TERMS + 1 PRIVACY row for user %s, got terms=%d privacy=%d", userID, termsCount, privacyCount)
	}
}
