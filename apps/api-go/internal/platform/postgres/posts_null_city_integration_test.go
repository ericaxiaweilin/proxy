package postgres

import (
	"context"
	"testing"
	"time"
)

// TestFeedReadsSurviveNullCityScope pins FEED-NULL-CITY-001.
//
// The bug: `city_scope` is a nullable column, but every read path scanned it
// straight into `post.CityScope`, a plain `string`. pgx refuses to scan NULL
// into a *string destination ("cannot scan NULL into *string"), and
// ListFeedPage returns the raw error — so ONE row with a NULL city_scope made
// the entire feed read fail for EVERY user, not just for that row.
//
// Why it never showed up in `go test ./...`: the in-memory repository has no
// NULLs at all, and the Go write path always binds "" rather than NULL. The
// only ways to create the row are a raw INSERT (migration, backfill, manual
// repair, seed script) or a future code path that omits the column — exactly
// the situations that are least likely to be exercised before shipping and
// most likely to happen at 2am.
//
// The failure mode is what makes this worth a tripwire rather than a shrug:
// it is not "one post renders oddly", it is "nobody's feed loads at all".
func TestFeedReadsSurviveNullCityScope(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)

	runID := itoa(time.Now().UnixNano())
	// Deliberately inserted with raw SQL and NO city_scope, so the column is
	// genuinely NULL — going through CreatePost would bind "" and the test
	// would quietly stop testing anything.
	postID := "post_nullcity_" + runID
	handle := "nullcity" + runID
	_, err := pool.Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, body, visibility, status, created_at, context_refs)
		VALUES ($1, 'USER', $2, $3, 'PUBLIC', 'PUBLISHED', now(), $4::jsonb)`,
		postID, "nullcity_author_"+runID, "FEED-NULL-CITY-001 探针帖", `[]`)
	if err != nil {
		t.Fatalf("seed post: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM localnet.posts WHERE id = $1`, postID)
		_, _ = pool.Exec(ctx, `DELETE FROM identity.handles WHERE handle = $1`, handle)
	})

	var isNull bool
	if err := pool.QueryRow(ctx, `SELECT city_scope IS NULL FROM localnet.posts WHERE id = $1`, postID).Scan(&isNull); err != nil {
		t.Fatalf("guard: %v", err)
	}
	if !isNull {
		t.Fatalf("guard failed: city_scope is not NULL, the test would prove nothing")
	}

	// The whole point: this must not error out.
	page, err := repo.ListFeedPage(ctx, "", time.Now().UTC().Add(time.Hour), "", 50)
	if err != nil {
		t.Fatalf("ListFeedPage must tolerate a NULL city_scope, got: %v", err)
	}
	found := false
	for _, p := range page {
		if p.ID == postID {
			found = true
			if p.CityScope != "" {
				t.Fatalf("NULL city_scope should read back as empty string, got %q", p.CityScope)
			}
		}
	}
	if !found {
		t.Fatalf("probe post missing from the feed page (n=%d)", len(page))
	}

	// The other read paths scan the same column and must not regress either.
	if _, err := repo.Snapshot(ctx); err != nil {
		t.Fatalf("Snapshot must tolerate a NULL city_scope, got: %v", err)
	}
	if _, err := repo.ListPostsMentioning(ctx, "nullcity_nobody_"+runID, handle, 20); err != nil {
		t.Fatalf("ListPostsMentioning must tolerate a NULL city_scope, got: %v", err)
	}
	got, err := repo.GetPost(ctx, postID)
	if err != nil {
		t.Fatalf("GetPost must tolerate a NULL city_scope, got: %v", err)
	}
	if got.ID != postID {
		t.Fatalf("GetPost returned %+v, want the probe post", got)
	}
}
