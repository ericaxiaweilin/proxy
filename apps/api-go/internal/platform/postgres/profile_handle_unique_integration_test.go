package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

// TestProfileHandleUniquenessIsEnforced pins HANDLE-UNIQUE-001.
//
// The bug: handle uniqueness existed ONLY as a comment in profile.go
// ("uniqueness is per-tenant, enforced by repository on create").
// 039_profile.sql built a PLAIN index on handle, never a unique one, and
// neither repository checked for a conflict — while initialProfileFor derives
// the handle from the email local-part, so linh@gmail.com and linh@outlook.com
// reliably both got @linh. A profile QR / invite link is proxy.app/@linh and
// the client parses it case-insensitively, so an ambiguous handle means
// scanning one person's code can add a different person.
//
// Why this needs a Postgres-level tripwire rather than a unit test: every unit
// test runs against MemoryProfileRepository, which had no check either — so a
// fully green suite proved nothing about production. This test goes through
// the real repository AND asserts the constraint lives in the schema, because
// a Go-level check alone stops protecting anything the moment a row is written
// outside the repository (migration, backfill, repair script, seed).
func TestProfileHandleUniquenessIsEnforced(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewIdentityRepository(pool)

	runID := itoa(time.Now().UnixNano())
	handle := "@dup" + runID
	userA := "uniq_a_" + runID
	userB := "uniq_b_" + runID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM identity.profiles WHERE user_account_id IN ($1,$2)`, userA, userB)
	})

	mk := func(accountID, h string) identity.Profile {
		return identity.Profile{
			UserAccountID: accountID, Name: "Dup Probe", Handle: h,
			City: "Hanoi", UpdatedAt: time.Now().UTC(),
		}
	}

	if _, err := repo.UpsertProfile(ctx, mk(userA, handle)); err != nil {
		t.Fatalf("first profile must save: %v", err)
	}

	// A second account taking the same handle must be refused, and refused as
	// its own outcome — not folded into a generic failure.
	if _, err := repo.UpsertProfile(ctx, mk(userB, handle)); !errors.Is(err, identity.ErrProfileHandleTaken) {
		t.Fatalf("second account taking %q must fail with ErrProfileHandleTaken, got %v", handle, err)
	}

	// Case and the leading @ are not part of the identity: the client parser
	// matches proxy.app/@<handle> case-insensitively, so @Linh and linh are
	// the same destination and must be the same row.
	for _, variant := range []string{strings.ToUpper(handle), strings.TrimPrefix(handle, "@")} {
		if _, err := repo.UpsertProfile(ctx, mk(userB, variant)); !errors.Is(err, identity.ErrProfileHandleTaken) {
			t.Fatalf("variant %q must collide with %q, got %v", variant, handle, err)
		}
	}

	// A genuinely free handle still saves — the check must not be a blanket
	// refusal that makes profiles uneditable.
	free := handle + "x"
	if _, err := repo.UpsertProfile(ctx, mk(userB, free)); err != nil {
		t.Fatalf("free handle must save: %v", err)
	}

	// Reads resolve through the same normalization.
	for _, lookup := range []string{handle, strings.ToUpper(handle), strings.TrimPrefix(handle, "@")} {
		got, err := repo.GetProfileByHandle(ctx, lookup)
		if err != nil {
			t.Fatalf("GetProfileByHandle(%q): %v", lookup, err)
		}
		if got.UserAccountID != userA {
			t.Fatalf("GetProfileByHandle(%q) resolved to %s, want %s", lookup, got.UserAccountID, userA)
		}
	}

	// The constraint must live in the SCHEMA, not only in Go.
	_, err := pool.Exec(ctx, `
		INSERT INTO identity.profiles (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
		VALUES ($1,'Raw Probe',$2,'','Hanoi','',1,now())`, "uniq_raw_"+runID, handle)
	if err == nil {
		t.Fatalf("a raw INSERT with a duplicate handle must be rejected by the unique index")
	}
	if !strings.Contains(err.Error(), "idx_profiles_handle_unique") {
		t.Fatalf("expected idx_profiles_handle_unique to be the rejecting constraint, got: %v", err)
	}
}
