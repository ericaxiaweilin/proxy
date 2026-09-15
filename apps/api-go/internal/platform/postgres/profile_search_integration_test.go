package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// TestSearchProfilesIsLiteralNotWildcard pins PROFILE-SEARCH-001.
//
// The bug: the add-friend sheet's 「搜索 Proxy」 box rendered SEARCH_RESULTS — a
// hardcoded array — so there was no server-side people search at all. A Profile
// could be read only by userAccountID (yourself) or by an exact handle.
//
// Adding the search is the easy half. The half worth a tripwire is the
// predicate. The obvious implementation is
//
//	WHERE lower(handle) LIKE '%' || $1 || '%'
//
// which silently hands the caller LIKE's wildcard grammar: a query of "%%" is
// two characters, so it sails past MinProfileSearchQuery, and then matches
// EVERY row. "_" matches every single-character handle. One request dumps the
// user table, and no amount of length validation catches it. The predicate
// uses strpos() instead — a literal substring test, which is what the
// in-memory store does with strings.Contains.
//
// This needs Postgres on purpose: MemoryProfileRepository uses
// strings.Contains and is structurally incapable of having this bug, so a unit
// test would be green under either implementation and prove nothing about the
// query production actually runs.
func TestSearchProfilesIsLiteralNotWildcard(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	runID := itoa(time.Now().UnixNano())
	userA := "srch_a_" + runID
	userB := "srch_b_" + runID
	handleA := "@srch" + runID
	handleB := "@other" + runID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM identity.profiles WHERE user_account_id IN ($1,$2)`, userA, userB)
	})

	mk := func(accountID, name, h string) identity.Profile {
		return identity.Profile{
			UserAccountID: accountID, Name: name, Handle: h,
			City: "Hanoi", UpdatedAt: time.Now().UTC(),
		}
	}
	if _, err := repo.UpsertProfile(ctx, mk(userA, "Search Probe", handleA)); err != nil {
		t.Fatalf("seed A: %v", err)
	}
	if _, err := repo.UpsertProfile(ctx, mk(userB, "Unrelated Person", handleB)); err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// Sanity: the literal substring finds the intended row, and only it.
	found, err := repo.SearchProfiles(ctx, "srch"+runID, 20)
	if err != nil {
		t.Fatalf("literal search: %v", err)
	}
	if len(found) != 1 || found[0].UserAccountID != userA {
		t.Fatalf("literal search returned %d rows, want just %s", len(found), userA)
	}

	// The payloads that break a LIKE-based predicate. Each is 2 characters, so
	// the min-length gate passes them through — the predicate is the only thing
	// standing between them and the whole table. None of them can occur in a
	// handle derived by sanitizeHandle (a-z0-9._ only), so the correct answer is
	// zero rows in any database.
	for _, wildcard := range []string{"%%", "%_", "_%"} {
		got, err := repo.SearchProfiles(ctx, wildcard, 200)
		if err != nil {
			t.Fatalf("search %q: %v", wildcard, err)
		}
		if len(got) != 0 {
			t.Fatalf("search %q matched %d rows — the predicate is treating it as a LIKE pattern, not a literal", wildcard, len(got))
		}
	}

	// "@" alone normalizes to an empty handle needle, and strpos(x, '') is 1 —
	// i.e. "matches everything". The service rejects it before it gets here,
	// but the repository must not be the weak link if it is ever called
	// directly.
	got, err := repo.SearchProfiles(ctx, "@", 200)
	if err != nil {
		t.Fatalf("search \"@\": %v", err)
	}
	for _, p := range got {
		if p.UserAccountID == userA || p.UserAccountID == userB {
			t.Fatalf("an empty handle needle matched %s — strpos(x,'') leaked through", p.UserAccountID)
		}
	}
}
