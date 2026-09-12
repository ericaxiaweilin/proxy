package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/localnet"
)

// TestMutedAuthorsFeedFilterLifecycle pins the read side of the mute
// feature (MUTED-AUTHORS-002): ListFeedPage must exclude posts authored
// by anyone the viewer has muted. The write side (AddMutedAuthor) was
// complete and even shipped a mobile UI (feed.tsx handleMuteAuthor: local
// filter + "跟 server mute 同步" comment), but nothing ever read
// engagement.muted_authors back — IsMuted had zero callers. Mutes were
// decoration: the author reappeared on the next page fetch, on any other
// device, and after re-login. The mobile comment promised server sync;
// this test makes the server actually deliver it.
//
// The filter belongs in the SQL (NOT EXISTS against engagement.muted_authors)
// so pagination LIMIT counting is correct — a post-service-loop filter
// would page short when muted posts fill the page.
//
// Constraint audit (four checks before writing data):
//   - localnet.posts: no FK chain for seeding (plain INSERT, same shape
//     the engagement round-trip test uses).
//   - muted pair seeded via EngagementRepository.AddMutedAuthor — the
//     production write path, already pinned by MUTED-AUTHORS-001.
//   - ListFeedPage(actorID, zeroCursor, limit): returns all PUBLISHED
//     PUBLIC posts — assert by specific post IDs, never set equality
//     (shared-DB mode has unrelated rows).
//   - Negative control: a second viewer with no mutes must still see
//     the muted author's post (the filter is per-viewer, not global).
func TestMutedAuthorsFeedFilterLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	localRepo := NewLocalNetRepository(pool)
	engRepo := NewEngagementRepository(pool)

	run := time.Now().UnixNano()
	runID := itoa(run)
	authorM := "mute_feed_author_m_" + runID // the author who gets muted
	authorN := "mute_feed_author_n_" + runID // control author, never muted
	viewer := "mute_feed_viewer_" + runID
	otherViewer := "mute_feed_other_" + runID
	postM := "post_mute_feed_m_" + runID
	postN := "post_mute_feed_n_" + runID

	seed := func(id, authorID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, visibility, city_scope, status, created_at)
			VALUES ($1, 'USER', $2, $3, 'mute feed filter test', 'PUBLIC', 'hn', 'PUBLISHED', NOW())
			ON CONFLICT (id) DO NOTHING`, id, authorID, authorID); err != nil {
			t.Fatalf("seed post %s: %v", id, err)
		}
	}
	seed(postM, authorM)
	seed(postN, authorN)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: exact rows this test created only.
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.posts WHERE id IN ($1, $2)`, postM, postN)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM engagement.muted_authors WHERE actor_id = $1`, viewer)
	})

	// 1. Viewer mutes authorM through the production write path.
	_, _, err := engRepo.AddMutedAuthor(ctx, engagement.MutedAuthor{
		ID:        "mute_feed_" + runID,
		ActorID:   viewer,
		AuthorID:  authorM,
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AddMutedAuthor: %v", err)
	}

	// 2. ListFeedPage for the muting viewer: authorM gone, authorN stays.
	posts, err := localRepo.ListFeedPage(ctx, viewer, time.Time{}, "", 26)
	if err != nil {
		t.Fatalf("ListFeedPage(viewer): %v", err)
	}
	sawM, sawN := false, false
	for _, p := range posts {
		if p.ID == postM {
			sawM = true
		}
		if p.ID == postN {
			sawN = true
		}
	}
	if sawM {
		t.Fatalf("muted author's post %s still in feed for viewer %s", postM, viewer)
	}
	if !sawN {
		t.Fatalf("control post %s missing from feed (filter over-reached)", postN)
	}

	// 3. Negative control: another viewer without mutes sees BOTH posts —
	// the mute is private to the viewer, never a global hide.
	posts, err = localRepo.ListFeedPage(ctx, otherViewer, time.Time{}, "", 26)
	if err != nil {
		t.Fatalf("ListFeedPage(otherViewer): %v", err)
	}
	sawM, sawN = false, false
	for _, p := range posts {
		if p.ID == postM {
			sawM = true
		}
		if p.ID == postN {
			sawN = true
		}
	}
	if !sawM || !sawN {
		t.Fatalf("unmuting viewer lost posts: sawM=%v sawN=%v (want both)", sawM, sawN)
	}

	// 4. The viewer's own muted-author post must remain visible to the
	// author themself (mute is actor-scoped; an author never mutes
	// themself, but the filter must not leak across viewers).
	_ = localnet.Post{} // keep import tied to the repo's return type
	posts, err = localRepo.ListFeedPage(ctx, authorM, time.Time{}, "", 26)
	if err != nil {
		t.Fatalf("ListFeedPage(authorM): %v", err)
	}
	sawM = false
	for _, p := range posts {
		if p.ID == postM {
			sawM = true
		}
	}
	if !sawM {
		t.Fatalf("author M can no longer see their own post — filter is viewer-scoped, must not self-hide")
	}
}
