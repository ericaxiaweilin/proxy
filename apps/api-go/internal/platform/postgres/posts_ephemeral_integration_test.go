package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

// TestEphemeralPostFeedFilterLifecycle pins the read side of the 24h
// ephemeral post feature (GHOST-24H-001).
//
// Before this test existed the field ONLY lived in packages/contracts (zod)
// and in the mobile publish payload — api-go had zero occurrences. Go's JSON
// decoder silently drops unknown fields, so the app toasted "24h 动态已发布"
// and the post stayed forever. That is not a missing feature, it is a path
// that lies to the user: they posted *because* they believed it would vanish.
//
// Why this needs a real Postgres and not just the in-memory service tests:
// the expiry filter lives in SQL (so pagination LIMIT counting stays correct),
// and the SQL is exactly what the in-memory tests never execute. That blind
// spot already bit once — EphemeralUntil was added to three rows.Scan calls
// (Snapshot / ListFeedPage / ListPostsMentioning) without adding the column
// to their SELECT lists, which made every feed read fail with a scan-count
// error on any real DB while `go test ./...` stayed green. Every read path
// below therefore doubles as a column-count tripwire.
func TestEphemeralPostFeedFilterLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)

	runID := itoa(time.Now().UnixNano())
	viewer := "ghost24h_viewer_" + runID
	// The author must NOT be the viewer: ListPostsMentioning deliberately
	// excludes the viewer's own posts, so seeding as the viewer would make
	// the mention assertions vacuous.
	author := "ghost24h_author_" + runID
	postPermanent := "post_ghost24h_perm_" + runID
	postLive := "post_ghost24h_live_" + runID
	postExpired := "post_ghost24h_expired_" + runID
	handle := "ghost24h" + runID

	liveUntil := time.Now().UTC().Add(time.Hour)
	expiredAt := time.Now().UTC().Add(-time.Hour)

	seed := func(id, body string, ephemeralUntil *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body,
				visibility, city_scope, status, created_at, ephemeral_until)
			VALUES ($1, 'USER', $2, $3, $4, 'PUBLIC', 'hn', 'PUBLISHED', NOW(), $5)
			ON CONFLICT (id) DO NOTHING`,
			id, author, author, body, ephemeralUntil); err != nil {
			t.Fatalf("seed post %s: %v", id, err)
		}
	}
	seed(postPermanent, "permanent @"+handle, nil)
	seed(postLive, "live ephemeral @"+handle, &liveUntil)
	seed(postExpired, "expired ephemeral @"+handle, &expiredAt)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: exact rows this test created only.
		_, _ = pool.Exec(cleanupCtx,
			`DELETE FROM localnet.posts WHERE id IN ($1, $2, $3)`,
			postPermanent, postLive, postExpired)
	})

	saw := func(posts []localnet.Post, id string) (bool, *time.Time) {
		for _, p := range posts {
			if p.ID == id {
				return true, p.EphemeralUntil
			}
		}
		return false, nil
	}

	// 1. ListFeedPage: the expired post is gone, the other two stay.
	//    (Also the tripwire for the SELECT/scan column count.)
	posts, err := repo.ListFeedPage(ctx, viewer, time.Time{}, "", 51)
	if err != nil {
		t.Fatalf("ListFeedPage: %v", err)
	}
	gotPerm, permUntil := saw(posts, postPermanent)
	gotLive, liveGot := saw(posts, postLive)
	gotExpired, _ := saw(posts, postExpired)
	if !gotPerm {
		t.Fatalf("permanent post %s missing from the feed", postPermanent)
	}
	if permUntil != nil {
		t.Fatalf("permanent post %s came back with ephemeralUntil=%v (want nil)", postPermanent, permUntil)
	}
	if !gotLive {
		t.Fatalf("unexpired ephemeral post %s missing from the feed — filter over-reached", postLive)
	}
	if liveGot == nil {
		t.Fatalf("ephemeral post %s lost its ephemeralUntil on read: the column is not selected or not scanned", postLive)
	}
	if gotExpired {
		t.Fatalf("expired ephemeral post %s is still in the feed", postExpired)
	}

	// 2. ListPostsMentioning: the same rule through the TAGGED back door,
	//    otherwise an expired post resurrects as soon as someone @mentions.
	// Bare handle, no "@": MentionRegex prepends the @ itself, and stripping
	// a leading @ is the SERVICE layer's job (normalizeMentionHandle), not
	// the repository's. Passing "@x" here would build an @@x regex.
	mentioned, err := repo.ListPostsMentioning(ctx, viewer, handle, 51)
	if err != nil {
		t.Fatalf("ListPostsMentioning: %v", err)
	}
	if gotExpired, _ := saw(mentioned, postExpired); gotExpired {
		t.Fatalf("expired ephemeral post %s is visible through the mention tab", postExpired)
	}
	if gotLive, _ := saw(mentioned, postLive); !gotLive {
		t.Fatalf("unexpired ephemeral post %s missing from the mention tab", postLive)
	}

	// 3. Snapshot: the third read path that shares the bug shape.
	snap, err := repo.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if gotLive, _ := saw(snap, postLive); !gotLive {
		t.Fatalf("unexpired ephemeral post %s missing from Snapshot", postLive)
	}

	// 4. GetPost: the expiry survives a direct fetch (clients render the
	//    countdown from this), and the expired ROW is still on disk —
	//    filtering is read-time, not deletion, so "it expired" stays provable.
	got, err := repo.GetPost(ctx, postLive)
	if err != nil {
		t.Fatalf("GetPost(%s): %v", postLive, err)
	}
	if got.EphemeralUntil == nil {
		t.Fatalf("GetPost(%s): ephemeralUntil is nil, want %v", postLive, liveUntil)
	}
	if !got.EphemeralUntil.Equal(liveUntil) {
		t.Fatalf("GetPost(%s): ephemeralUntil=%v want %v", postLive, got.EphemeralUntil, liveUntil)
	}

	var stillThere bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM localnet.posts WHERE id=$1 AND ephemeral_until IS NOT NULL)`,
		postExpired).Scan(&stillThere); err != nil {
		t.Fatalf("existence probe for %s: %v", postExpired, err)
	}
	if !stillThere {
		t.Fatalf("expired post %s was physically deleted — expiry must filter at read time and keep the row", postExpired)
	}
}
