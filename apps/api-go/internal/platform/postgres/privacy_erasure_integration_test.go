package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// LC-15 erasure, end to end against the real schema.
//
// The hermetic test in internal/identity proves the *decision* logic.
// This one proves the SQL: that every table the executor claims to
// empty really is empty afterwards, that the rows it claims to retain
// really do survive, and that the two-transition lifecycle the
// executor needs actually works against postgres (it did not before —
// every SELECT hardcoded `version = 1`, so a request could be updated
// exactly once).

// seedErasableUser writes one row into every table the erasure is
// supposed to empty, plus the retained ones. It returns a cleanup
// function covering the rows that survive the erasure.
func seedErasableUser(t *testing.T, ctx context.Context, userID string) {
	t.Helper()
	pool := testPool(t)
	now := time.Now().UTC()

	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}

	mustExec(`INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'ACTIVE')`, userID)
	mustExec(`INSERT INTO identity.login_identities (id, user_account_id, verified, status, channel, identifier)
		VALUES ($1, $2, true, 'ACTIVE', 'SMS', '+84900000000')`, userID+"_login", userID)
	mustExec(`INSERT INTO identity.device_registrations (id, user_account_id, platform, status, push_token_ref)
		VALUES ($1, $2, 'IOS', 'ACTIVE', 'push_ref_secret')`, userID+"_device", userID)
	mustExec(`INSERT INTO identity.sessions (id, user_account_id, device_id, status, principal_type, principal_id, issued_at, expires_at)
		VALUES ($1, $2, $3, 'ACTIVE', 'INDIVIDUAL', $2, $4, $5)`,
		userID+"_session", userID, userID+"_device", now, now.Add(24*time.Hour))
	// Hashes must satisfy identity_device_credential_hash_format_check
	// (^[0-9a-f]{64}$) — migration 055 made the device credential
	// mandatory, so the fixture has to look like a real one.
	hash64 := strings.Repeat("ab", 32)
	mustExec(`INSERT INTO identity.session_tokens (session_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, device_credential_hash)
		VALUES ($1, $2, $2, $3, $4, $2)`,
		userID+"_session", hash64, now.Add(time.Hour), now.Add(48*time.Hour))
	mustExec(`INSERT INTO identity.login_challenges (id, user_account_id, login_identity_id, device_id, channel, status, requested_at)
		VALUES ($1, $2, $3, $4, 'SMS', 'PENDING', $5)`,
		userID+"_challenge", userID, userID+"_login", userID+"_device", now)
	mustExec(`INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, updated_at)
		VALUES ($1, 'Nguyen Van A', 'nguyenvana', 'xin chao', 'Ha Noi', 'assets/avatar.png', $2)`, userID, now)
	mustExec(`INSERT INTO identity.account_preferences (user_account_id, collaboration_contact)
		VALUES ($1, 'call me on +84900000000')`, userID)
	mustExec(`INSERT INTO identity.display_identities (id, owner_id, type, alias, display_name, created_at)
		VALUES ($1, $2, 'PRIVATE', 'alias_a', 'Nguyen A', $3)`, userID+"_display", userID, now)
	mustExec(`INSERT INTO identity.memberships (principal_type, principal_id, user_account_id, status)
		VALUES ('INDIVIDUAL', $1, $1, 'ACTIVE')`, userID)
	mustExec(`INSERT INTO identity.user_jurisdiction (user_id, country, region, source)
		VALUES ($1, 'VN', 'HN', 'USER_SELF')`, userID)
	// Retained on purpose: the DOB is COMP-AGE-001 evidence, the ip /
	// user_agent are client metadata with no evidentiary value.
	mustExec(`INSERT INTO identity.user_age_assertions (id, user_account_id, date_of_birth, source, asserted_at, ip, user_agent)
		VALUES ($1, $2, '1995-04-02', 'SELF_DECLARED_AT_SIGNUP', $3, '203.0.113.9', 'Proxy/1.0')`,
		userID+"_age", userID, now)
	// Retained on purpose: the audit trail of the request itself.
	mustExec(`INSERT INTO privacy.privacy_requests (id, user_id, kind, status, requested_at, legal_basis)
		VALUES ($1, $2, 'delete', 'received', $3, 'PDP-91/2025/QH15-Art32')`, userID+"_preq", userID, now)
}

// countForUser counts the rows still attributable to the user in one
// table. The query is supplied by the caller because the join column
// differs per table (user_account_id vs owner_id vs user_id).
func countForUser(t *testing.T, ctx context.Context, query, userID string) int {
	t.Helper()
	pool := testPool(t)
	var n int
	if err := pool.QueryRow(ctx, query, userID).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", query, err)
	}
	return n
}

func TestErasePersonalDataWipesTheIdentityAggregate(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	runID := itoa(time.Now().UnixNano())
	userID := "erase_a_" + runID
	seedErasableUser(t, ctx, userID)
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM privacy.privacy_request_events WHERE request_id IN (SELECT id FROM privacy.privacy_requests WHERE user_id = $1)`, userID)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.privacy_requests WHERE user_id = $1`, userID)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_age_assertions WHERE user_account_id = $1`, userID)
		_, _ = pool.Exec(bg, `DELETE FROM identity.user_accounts WHERE id = $1`, userID)
	})

	receipt, err := repo.ErasePersonalData(ctx, userID)
	if err != nil {
		t.Fatalf("ErasePersonalData: %v", err)
	}

	// Every table the executor claims to have emptied must be empty,
	// and the receipt must have said so. Checking both halves matters:
	// a counter that over-reports is as misleading as one that
	// under-reports.
	erased := []struct {
		name     string
		query    string
		reported int
	}{
		{"login_identities", `SELECT count(*) FROM identity.login_identities WHERE user_account_id = $1`, receipt.LoginIdentities},
		{"login_challenges", `SELECT count(*) FROM identity.login_challenges WHERE user_account_id = $1`, receipt.LoginChallenges},
		{"sessions", `SELECT count(*) FROM identity.sessions WHERE user_account_id = $1`, receipt.Sessions},
		{"devices", `SELECT count(*) FROM identity.device_registrations WHERE user_account_id = $1`, receipt.Devices},
		{"profiles", `SELECT count(*) FROM identity.profiles WHERE user_account_id = $1`, receipt.Profiles},
		{"account_preferences", `SELECT count(*) FROM identity.account_preferences WHERE user_account_id = $1`, receipt.AccountPreferences},
		{"display_identities", `SELECT count(*) FROM identity.display_identities WHERE owner_id = $1`, receipt.DisplayIdentities},
		{"memberships", `SELECT count(*) FROM identity.memberships WHERE user_account_id = $1`, receipt.Memberships},
		{"user_jurisdiction", `SELECT count(*) FROM identity.user_jurisdiction WHERE user_id = $1`, receipt.Jurisdictions},
	}
	for _, tc := range erased {
		if got := countForUser(t, ctx, tc.query, userID); got != 0 {
			t.Errorf("%s: %d row(s) survived the erasure", tc.name, got)
		}
		if tc.reported != 1 {
			t.Errorf("%s: receipt reported %d, the fixture seeded exactly 1", tc.name, tc.reported)
		}
	}
	// session_tokens has no user column, so it is counted via the join.
	if n := countForUser(t, ctx, `SELECT count(*) FROM identity.session_tokens WHERE session_id IN (SELECT id FROM identity.sessions WHERE user_account_id = $1)`, userID); n != 0 {
		t.Errorf("session_tokens: %d row(s) survived the erasure", n)
	}
	if receipt.SessionTokens != 1 {
		t.Errorf("session_tokens: receipt reported %d, the fixture seeded exactly 1", receipt.SessionTokens)
	}

	// The account row survives, anonymised. It has to: the payment and
	// order ledgers reference it for the statutory retention window.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM identity.user_accounts WHERE id = $1`, userID).Scan(&status); err != nil {
		t.Fatalf("the account row must survive the erasure (ledgers reference it): %v", err)
	}
	if status != identity.AccountStatusErased {
		t.Errorf("expected account status %s, got %s", identity.AccountStatusErased, status)
	}
	if !receipt.AccountAnonymised {
		t.Errorf("receipt did not report the account as anonymised")
	}

	// Retained category 1: the age assertion keeps its DOB (COMP-AGE-001
	// minor-protection evidence) and loses the client metadata.
	var ip, ua *string
	var dob time.Time
	if err := pool.QueryRow(ctx, `SELECT date_of_birth, ip, user_agent FROM identity.user_age_assertions WHERE user_account_id = $1`, userID).Scan(&dob, &ip, &ua); err != nil {
		t.Fatalf("the age assertion must be retained as compliance evidence: %v", err)
	}
	if ip != nil || ua != nil {
		t.Errorf("age assertion client metadata must be wiped, got ip=%v ua=%v", ip, ua)
	}
	if receipt.AgeAssertionsWiped != 1 {
		t.Errorf("expected the receipt to report 1 wiped age assertion, got %d", receipt.AgeAssertionsWiped)
	}

	// Retained category 2: the privacy request row is the audit trail
	// of the erasure itself; deleting it would delete the evidence.
	if n := countForUser(t, ctx, `SELECT count(*) FROM privacy.privacy_requests WHERE user_id = $1`, userID); n != 1 {
		t.Errorf("the privacy request audit row must be retained, found %d", n)
	}

	// Idempotent: a second pass removes nothing and reports nothing.
	// The executor erases before it bookkeeps precisely so that a
	// retry is safe; this is the assertion that makes that true.
	second, err := repo.ErasePersonalData(ctx, userID)
	if err != nil {
		t.Fatalf("second ErasePersonalData: %v", err)
	}
	if second.Total() != 0 {
		t.Errorf("a second erasure must be a no-op, got %+v", second)
	}
	if second.AccountAnonymised {
		// The UPDATE matches the row regardless of status, so a second
		// pass re-stamping it is harmless. What must hold is Total().
		t.Logf("note: second pass re-stamped the account row (harmless, idempotent)")
	}
}

// TestPrivacyRequestSupportsTwoTransitions pins the version-column fix
// the executor depends on. Before it, every SELECT in this file
// selected a literal `1` for version, so GetPrivacyRequest always
// reported version=1 while the row climbed past it: the second UPDATE
// passed expectedVersion=1 against a row at 2 and matched nothing.
// A delete request needs received -> in_progress -> completed, so the
// literal made the erasure executor impossible to build.
func TestPrivacyRequestSupportsTwoTransitions(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	runID := itoa(time.Now().UnixNano())
	userID := "erase_b_" + runID
	requestID := userID + "_preq"
	now := time.Now().UTC()

	if _, err := pool.Exec(ctx, `INSERT INTO privacy.privacy_requests (id, user_id, kind, status, requested_at, legal_basis)
		VALUES ($1, $2, 'delete', 'received', $3, 'PDP-91/2025/QH15-Art32')`, requestID, userID, now); err != nil {
		t.Fatalf("seed request: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM privacy.privacy_request_events WHERE request_id = $1`, requestID)
		_, _ = pool.Exec(bg, `DELETE FROM privacy.privacy_requests WHERE id = $1`, requestID)
	})

	first, err := repo.GetPrivacyRequest(ctx, requestID)
	if err != nil {
		t.Fatalf("first read: %v", err)
	}
	if first.Version != 1 {
		t.Fatalf("a fresh request must report version 1, got %d", first.Version)
	}
	first.Status = identity.PrivacyRequestStatusInProgress
	if err := repo.UpdatePrivacyRequest(ctx, first, first.Version); err != nil {
		t.Fatalf("first transition (received -> in_progress): %v", err)
	}

	second, err := repo.GetPrivacyRequest(ctx, requestID)
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	if second.Version != 2 {
		t.Fatalf("the version column must advance in the database, got %d — the SELECT is still hardcoding it", second.Version)
	}
	if second.Status != identity.PrivacyRequestStatusInProgress {
		t.Fatalf("expected in_progress after the first transition, got %s", second.Status)
	}
	completedAt := now.Add(30 * 24 * time.Hour)
	second.Status = identity.PrivacyRequestStatusCompleted
	second.CompletedAt = &completedAt
	second.ErasedAt = &completedAt
	if err := repo.UpdatePrivacyRequest(ctx, second, second.Version); err != nil {
		t.Fatalf("second transition (in_progress -> completed): %v", err)
	}

	final, err := repo.GetPrivacyRequest(ctx, requestID)
	if err != nil {
		t.Fatalf("final read: %v", err)
	}
	if final.Status != identity.PrivacyRequestStatusCompleted {
		t.Fatalf("expected completed, got %s", final.Status)
	}
	if final.ErasedAt == nil {
		t.Fatalf("erasedAt must round-trip through postgres")
	}
	if final.Version != 3 {
		t.Fatalf("expected version 3 after two transitions, got %d", final.Version)
	}
}

// TestListDuePrivacyDeletionsSelectsOnlyDueDeletes checks the query's
// three filters at once: kind (export must never be swept), status
// (completed / cancelled must never be re-swept) and time.
func TestListDuePrivacyDeletionsSelectsOnlyDueDeletes(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	runID := itoa(time.Now().UnixNano())
	now := time.Now().UTC()
	cutoff := now.Add(-24 * time.Hour)

	rows := []struct {
		id          string
		kind        string
		status      string
		requestedAt time.Time
		want        bool
	}{
		{"due_received", "delete", "received", now.Add(-48 * time.Hour), true},
		{"due_in_progress", "delete", "in_progress", now.Add(-72 * time.Hour), true},
		{"fresh", "delete", "received", now, false},
		{"completed", "delete", "completed", now.Add(-96 * time.Hour), false},
		{"cancelled", "delete", "cancelled", now.Add(-96 * time.Hour), false},
		{"export", "export", "received", now.Add(-96 * time.Hour), false},
	}
	// Each row gets its own user id: uq_privacy_requests_user_kind_active
	// allows only one active request per (user, kind), and two of these
	// rows are deliberately active deletes.
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		id := "erase_c_" + runID + "_" + r.id
		ids = append(ids, id)
		if _, err := pool.Exec(ctx, `INSERT INTO privacy.privacy_requests (id, user_id, kind, status, requested_at, legal_basis)
			VALUES ($1, $2, $3, $4, $5, 'test')`, id, id, r.kind, r.status, r.requestedAt); err != nil {
			t.Fatalf("seed %s: %v", r.id, err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range ids {
			_, _ = pool.Exec(bg, `DELETE FROM privacy.privacy_requests WHERE id = $1`, id)
		}
	})

	due, err := repo.ListDuePrivacyDeletions(ctx, cutoff)
	if err != nil {
		t.Fatalf("ListDuePrivacyDeletions: %v", err)
	}
	got := map[string]bool{}
	for _, req := range due {
		got[req.ID] = true
	}
	for _, r := range rows {
		id := "erase_c_" + runID + "_" + r.id
		if r.want && !got[id] {
			t.Errorf("%s (kind=%s status=%s requestedAt=%s) should be due", r.id, r.kind, r.status, r.requestedAt.Format(time.RFC3339))
		}
		if !r.want && got[id] {
			t.Errorf("%s (kind=%s status=%s) must NOT be due", r.id, r.kind, r.status)
		}
	}
	// The due pair must come back oldest first so a backlog drains in
	// submission order.
	var order []string
	for _, req := range due {
		if strings.HasPrefix(req.ID, "erase_c_"+runID+"_") {
			order = append(order, strings.TrimPrefix(req.ID, "erase_c_"+runID+"_"))
		}
	}
	if len(order) != 2 || order[0] != "due_in_progress" || order[1] != "due_received" {
		t.Errorf("expected the two due rows oldest-first (due_in_progress then due_received), got %v", order)
	}
}

// TestErasePersonalDataRejectsEmptyUserID is the guard against a
// caller that lost the user id somewhere: an unguarded DELETE with an
// empty parameter would be a table-wide wipe.
func TestErasePersonalDataRejectsEmptyUserID(t *testing.T) {
	pool := testPool(t)
	repo := NewIdentityRepository(pool)
	if _, err := repo.ErasePersonalData(context.Background(), ""); err == nil {
		t.Fatalf("an empty user id must be rejected, not treated as a table-wide delete")
	}
}
