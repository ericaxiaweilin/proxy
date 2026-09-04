package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/identity"
)

func TestAccountPreferencesPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := "user_preferences_" + itoa(time.Now().UnixNano())
	if _, err := pool.Exec(ctx, `INSERT INTO identity.user_accounts (id, status) VALUES ($1, 'ACTIVE')`, userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM identity.user_accounts WHERE id=$1`, userID)
	})
	repo := NewIdentityRepository(pool)
	saved, err := repo.UpsertAccountPreferences(ctx, identity.AccountPreferences{UserAccountID: userID, SocialAccounts: []any{map[string]any{"platform": "instagram"}}, ShowOnProfile: true, CollaborationTypes: []string{"UGC"}, CollaborationContact: "hello@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != 1 {
		t.Fatalf("version=%d, want 1", saved.Version)
	}
	got, err := repo.GetAccountPreferences(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ShowOnProfile || got.CollaborationContact != "hello@example.com" || len(got.SocialAccounts) != 1 {
		t.Fatalf("unexpected preferences: %#v", got)
	}
	updated, err := repo.UpsertAccountPreferences(ctx, got)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 {
		t.Fatalf("version=%d, want 2", updated.Version)
	}
}
