package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/localnet"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/socialspace"
)

// TestProfileDisplayBackfillClearsLegacyLabels pins migration 079
// (PROFILE-READ-001) through real PostgreSQL: publishers used to store the
// viewer-relative label "你" in display columns, so every user saw foreign
// content as their own. Publish-time server resolution prevents new rows;
// this backfill clears the legacy ones. Real names must be untouched.
func TestProfileDisplayBackfillClearsLegacyLabels(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	now := time.Now().UTC().Truncate(time.Microsecond)

	postID := "post_backfill_" + run
	statusID := "status_backfill_" + run
	oppID := "opp_backfill_" + run
	keepPostID := "post_keep_" + run

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: exact-ID deletes of rows this run created.
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.posts WHERE id IN ($1,$2)`, postID, keepPostID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM socialspace.statuses WHERE status_id = $1`, statusID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM marketplace.opportunities WHERE id = $1`, oppID)
	})

	netRepo := NewLocalNetRepository(pool)
	if err := netRepo.CreatePost(ctx, localnet.Post{
		ID: postID, AuthorType: "USER", AuthorID: "user_backfill_" + run,
		AuthorDisplayName: "你", Body: "legacy poisoned post",
		Visibility: "PUBLIC", Status: "PUBLISHED", SceneType: "UNKNOWN", CreatedAt: now,
	}); err != nil {
		t.Fatalf("seed poisoned post: %v", err)
	}
	if err := netRepo.CreatePost(ctx, localnet.Post{
		ID: keepPostID, AuthorType: "USER", AuthorID: "user_keep_" + run,
		AuthorDisplayName: "Linh", Body: "real name post",
		Visibility: "PUBLIC", Status: "PUBLISHED", SceneType: "UNKNOWN", CreatedAt: now,
	}); err != nil {
		t.Fatalf("seed control post: %v", err)
	}
	spaceRepo := NewSocialSpaceRepository(pool)
	if err := spaceRepo.CreateStatus(ctx, socialspace.Status{
		ID: statusID, AuthorID: "user_backfill_" + run, AuthorDisplayName: "你",
		Body: "legacy status", CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour),
	}); err != nil {
		t.Fatalf("seed poisoned status: %v", err)
	}
	marketRepo := NewMarketplaceRepository(pool)
	if err := marketRepo.Create(ctx, marketplace.Opportunity{
		ID: oppID, OwnerID: "user_backfill_" + run, Owner: "你", OwnerType: "PERSON",
		Title: "legacy opp", Location: "河内",
	}); err != nil {
		t.Fatalf("seed poisoned opportunity: %v", err)
	}

	sql, err := os.ReadFile("../../../migrations/079_profile_display_backfill.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("run backfill migration: %v", err)
	}
	// Re-running must be a no-op (idempotent, replayable).
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("replay backfill migration: %v", err)
	}

	post, err := netRepo.GetPost(ctx, postID)
	if err != nil {
		t.Fatalf("read backfilled post: %v", err)
	}
	if post.AuthorDisplayName != "" {
		t.Fatalf("poisoned post display not cleared: %q", post.AuthorDisplayName)
	}
	if post.AuthorID != "user_backfill_"+run {
		t.Fatalf("backfill must not touch authorship: %q", post.AuthorID)
	}
	kept, err := netRepo.GetPost(ctx, keepPostID)
	if err != nil {
		t.Fatalf("read control post: %v", err)
	}
	if kept.AuthorDisplayName != "Linh" {
		t.Fatalf("real display name must be untouched: %q", kept.AuthorDisplayName)
	}
	statuses, err := spaceRepo.ListActiveStatuses(ctx, now)
	if err != nil {
		t.Fatalf("list statuses: %v", err)
	}
	found := false
	for _, status := range statuses {
		if status.ID == statusID {
			found = true
			if status.AuthorDisplayName != "" {
				t.Fatalf("poisoned status display not cleared: %q", status.AuthorDisplayName)
			}
		}
	}
	if !found {
		t.Fatalf("backfilled status missing from active list")
	}
	opp, err := marketRepo.Get(ctx, oppID)
	if err != nil {
		t.Fatalf("read backfilled opportunity: %v", err)
	}
	if opp.Owner != "" {
		t.Fatalf("poisoned opportunity owner not cleared: %q", opp.Owner)
	}
	if opp.OwnerID != "user_backfill_"+run {
		t.Fatalf("backfill must not touch owner id: %q", opp.OwnerID)
	}
}
