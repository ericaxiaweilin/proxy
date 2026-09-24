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
//
// 5aa88a8 (SCENE-PHOTO-WALL-001, Rev289) then deduplicated three of those scans
// into the shared scanPostRows and added a fifth post-row SELECT
// (ListPostsAtScene). SELECT lists are no longer 1:1 with rows.Scan sites, so
// the count-based pin in scripts/check-regression-contracts.sh had to start
// counting scan *paths* instead of scan sites — and the photo wall is exercised
// below because it is the newest SELECT and the one nothing else covers.
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
	// 场景照片墙（ListPostsAtScene）那一条读路径用的一组。
	sceneID := "scene_ghost24h_" + runID
	postSceneLive := "post_ghost24h_scene_live_" + runID
	postSceneExpired := "post_ghost24h_scene_expired_" + runID
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

	// 照片墙要求「带媒体 + context_refs 里标了这个真实场景」，所以单列一个 seed。
	seedScene := func(id string, ephemeralUntil *time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body,
				media_refs, visibility, city_scope, status, context_refs, created_at, ephemeral_until)
			VALUES ($1, 'USER', $2, $3, $4,
				'[{"mediaAssetId":"ma_ghost24h","mediaType":"IMAGE","sortOrder":0}]'::jsonb,
				'PUBLIC', 'hn', 'PUBLISHED',
				jsonb_build_array(jsonb_build_object('contextType', 'REALITY_SCENE', 'contextId', $5::text)),
				NOW(), $6)
			ON CONFLICT (id) DO NOTHING`,
			id, author, author, "scene wall "+id, sceneID, ephemeralUntil); err != nil {
			t.Fatalf("seed scene post %s: %v", id, err)
		}
	}
	seedScene(postSceneLive, &liveUntil)
	seedScene(postSceneExpired, &expiredAt)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// TEST-HYGIENE-001: exact rows this test created only.
		_, _ = pool.Exec(cleanupCtx,
			`DELETE FROM localnet.posts WHERE id IN ($1, $2, $3, $4, $5)`,
			postPermanent, postLive, postExpired, postSceneLive, postSceneExpired)
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

	// 5. ListPostsAtScene（场景照片墙）：5aa88a8 加的第 5 条帖子 SELECT，也走
	//    scanPostRows。它不被这条测试覆盖时，单独改它自己的列清单（少选或多选
	//    一列）不会有任何测试变红 —— 而真机上照片墙会整片读不出来，跟当年 feed
	//    那次是同一个形状。补上第 5 条路径，让列数漂移在任何一条读路径上都当场红。
	wall, err := repo.ListPostsAtScene(ctx, viewer, sceneID, 51)
	if err != nil {
		t.Fatalf("ListPostsAtScene: %v", err)
	}
	if gotLive, liveWall := saw(wall, postSceneLive); !gotLive {
		t.Fatalf("unexpired scene post %s missing from the photo wall — filter over-reached", postSceneLive)
	} else if liveWall == nil {
		t.Fatalf("scene post %s lost its ephemeralUntil on read: the column is not selected or not scanned", postSceneLive)
	}
	if gotExpired, _ := saw(wall, postSceneExpired); gotExpired {
		t.Fatalf("expired scene post %s is still on the photo wall", postSceneExpired)
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
