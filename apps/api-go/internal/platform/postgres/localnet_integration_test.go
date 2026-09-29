package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/localnet"
)

// TestLocalNetPostgresLifecycle covers the M1 localnet chain through
// real PostgreSQL: CreatePost (PUBLISHED + media limit + alt-text
// length cap + visibility whitelist) → ListFeedPosts (the post is
// readable) → invalid author / oversize / visibility guard rejections.
// Records an interaction event after the post is published to prove
// the list-of-events path can re-read it back.
func TestLocalNetPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)
	svc := localnet.NewWithMediaLookupAndModelStack(repo, nil, nil)

	run := time.Now().UnixNano()
	authorID := "user_ln_pg_" + itoa(run)

	// 1. Empty body and no media: must be REJECTED with
	// POST_EMPTY_CONTENT, no row in PG.
	r := svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "", "mediaRefs": []any{},
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("empty post must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "POST_EMPTY_CONTENT" {
		t.Fatalf("expected POST_EMPTY_CONTENT, got %+v", r.Error)
	}

	// 2. Body-only post: ACCEPTED, status=PUBLISHED.
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "今天的河内太好看了 ☀️", "visibility": "PUBLIC",
		"cityScope": "hn",
	}, authorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreatePost body-only: %+v", r.Error)
	}
	if r.Aggregate.State != "PUBLISHED" {
		t.Fatalf("new post must be PUBLISHED, got %s", r.Aggregate.State)
	}
	postID := r.Aggregate.ID
	if postID == "" {
		t.Fatalf("CreatePost: missing post id")
	}

	// 3. The post row must exist in PG with the right author + body.
	stored, err := repo.GetPost(ctx, postID)
	if err != nil {
		t.Fatalf("GetPost: %v", err)
	}
	if stored.AuthorID != authorID || stored.Body != "今天的河内太好看了 ☀️" {
		t.Fatalf("post not persisted correctly: %+v", stored)
	}
	if stored.Visibility != "PUBLIC" || stored.Status != "PUBLISHED" {
		t.Fatalf("post visibility/status wrong: %+v", stored)
	}

	// 4. Media limit: 7 mediaRefs (max 6) must be REJECTED with
	// POST_MEDIA_LIMIT_EXCEEDED.
	mediaRefs := make([]any, 0, 7)
	for i := 0; i < 7; i++ {
		mediaRefs = append(mediaRefs, map[string]any{
			"mediaAssetId": "ma_pg_" + itoa(run) + "_" + itoa(int64(i)),
			"sortOrder":     i,
			"altText":       "",
		})
	}
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "7 张图", "mediaRefs": mediaRefs,
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("7 mediaRefs must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "POST_MEDIA_LIMIT_EXCEEDED" {
		t.Fatalf("expected POST_MEDIA_LIMIT_EXCEEDED, got %+v", r.Error)
	}

	// 5. Invalid visibility: must be REJECTED with INVALID_POST_VISIBILITY.
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "x", "visibility": "PUBLIC_ENEMY",
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("bad visibility must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_POST_VISIBILITY" {
		t.Fatalf("expected INVALID_POST_VISIBILITY, got %+v", r.Error)
	}

	// 6. Invalid author type: must be REJECTED with INVALID_AUTHOR_TYPE.
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "ROBOT", "body": "x",
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("bad authorType must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_AUTHOR_TYPE" {
		t.Fatalf("expected INVALID_AUTHOR_TYPE, got %+v", r.Error)
	}

	// 7. Alt text too long (>500 chars) must be REJECTED.
	altText := strings.Repeat("很长的 alt text ", 30) // ~360 chars + a bit more → 500+
	if utf8RuneCount(altText) <= 500 {
		altText += strings.Repeat("x", 200)
	}
	badAltRefs := []any{map[string]any{
		"mediaAssetId": "ma_pg_alt_" + itoa(run),
		"sortOrder":     0,
		"altText":       altText,
	}}
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "x", "mediaRefs": badAltRefs,
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("oversize alt text must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_POST_MEDIA_REF" {
		t.Fatalf("expected INVALID_POST_MEDIA_REF, got %+v", r.Error)
	}

	// 8. Duplicate sortOrder in mediaRefs → REJECTED with INVALID_POST_MEDIA_REF.
	dupOrderRefs := []any{
		map[string]any{"mediaAssetId": "ma_pg_dup_a", "sortOrder": 0, "altText": ""},
		map[string]any{"mediaAssetId": "ma_pg_dup_b", "sortOrder": 0, "altText": ""},
	}
	r = svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "x", "mediaRefs": dupOrderRefs,
	}, authorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("duplicate sortOrder must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_POST_MEDIA_REF" {
		t.Fatalf("expected INVALID_POST_MEDIA_REF, got %+v", r.Error)
	}

	// 9. The valid post must still be in the feed.
	r = svc.HandleContext(ctx, lnEnvelope("ListFeedPosts", map[string]any{
		"marketId": "hn", "limit": 20,
	}, authorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts: %+v", r.Error)
	}
	if !feedContainsPG(t, r.OperationRef, postID) {
		t.Fatalf("ListFeedPosts must include the just-created post %s, op=%s", postID, r.OperationRef)
	}

	// 10. RecordPostImpression on the post → ACCEPTED + the post
	// impression count must increment.
	// COMP-PURPOSE-CONSENT-001：先取同意，否则服务端按 COMPLIANCE 拒收。
	grantBehaviorAnalyticsPG(t, pool, svc, ctx, authorID)
	r = svc.HandleContext(ctx, lnEnvelope("RecordPostImpression", map[string]any{
		"targetId": postID, "viewerPrincipalId": "viewer_pg_" + itoa(run),
		"marketId": "hn",
	}, authorID, postID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordPostImpression: %+v", r.Error)
	}

	cleanupLocalNetPG(t, pool, []string{postID, authorID})
}

// grantBehaviorAnalyticsPG 走**真实的** RecordPurposeConsent 命令取得同意。
//
// COMP-PURPOSE-CONSENT-001：行为追踪事件在服务端要先有按目的的同意。
// 这里刻意走命令而不是直接 INSERT —— 顺带证明 Postgres 侧的同意写/读是通的
// （如果哪天 postgres 实现漏了某个方法，这些集成测试会先红）。
func grantBehaviorAnalyticsPG(t *testing.T, pool *pgxpool.Pool, svc *localnet.Service, ctx context.Context, actorID string) {
	t.Helper()
	res := svc.HandleContext(ctx, lnEnvelope("RecordPurposeConsent", map[string]any{
		"purpose": localnet.PurposeBehaviorAnalytics, "granted": true, "source": "INTEGRATION_TEST",
	}, actorID))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("grant consent for %s: got %s (%+v)", actorID, res.Outcome, res.Error)
	}
	// 同意行是 append-only 的审计数据，测试自己收尾 —— 否则它会一直堆在测试库里，
	// 而这条表**故意**没有 TTL/清理任务（它是证据）。
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM privacy.purpose_consents WHERE user_id=$1`, actorID)
	})
}

func feedContainsPG(t *testing.T, op, postID string) bool {
	t.Helper()
	var top map[string]any
	if err := jsonUnmarshalLocalNet(op, &top); err != nil {
		return false
	}
	raw, ok := top["posts"]
	if !ok {
		return false
	}
	arr, ok := raw.([]any)
	if !ok {
		return false
	}
	for _, p := range arr {
		m, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if id, _ := m["postId"].(string); id == postID {
			return true
		}
	}
	return false
}

func utf8RuneCount(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

func jsonUnmarshalLocalNet(s string, v any) error {
	return json.Unmarshal([]byte(s), v)
}

func cleanupLocalNetPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	postID := ids[0]
	if postID != "" {
		if _, err := pool.Exec(ctx, `DELETE FROM localnet.interaction_events WHERE target_id=$1 AND target_type='POST'`, postID); err != nil {
			t.Logf("cleanup interaction_events: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM localnet.posts WHERE id=$1`, postID); err != nil {
			t.Logf("cleanup posts: %v", err)
		}
	}
}

// TestProfileViewersPostgresRoundTrip: PROFILE-VIEWERS-001's query is a
// GROUP BY actor_id + MAX(created_at) ordered by recency — not exercised by
// the memory-repo test (TestProfileViewersRoundTrip only pins MemoryRepository).
// Pins the real SQL: two viewers, one of them opens twice, counts and
// last-opened-at must be per person, not per event.
func TestProfileViewersPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)
	svc := localnet.NewWithMediaLookupAndModelStack(repo, nil, nil)

	run := time.Now().UnixNano()
	ownerID := "user_viewers_pg_" + itoa(run)
	viewer1 := "viewer_1_pg_" + itoa(run)
	viewer2 := "viewer_2_pg_" + itoa(run)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.interaction_events WHERE target_type='PROFILE' AND target_id=$1`, ownerID)
	})

	open := func(actor string) {
		res := svc.HandleContext(ctx, lnEnvelope("RecordProfileOpen", map[string]any{
			"targetId": ownerID,
		}, actor))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("RecordProfileOpen(%s): %+v", actor, res.Error)
		}
	}
	// COMP-PURPOSE-CONSENT-001：PROFILE_OPEN 也是行为追踪，先取同意。
	grantBehaviorAnalyticsPG(t, pool, svc, ctx, viewer1)
	grantBehaviorAnalyticsPG(t, pool, svc, ctx, viewer2)
	open(viewer1)
	open(viewer2)
	open(viewer1)

	viewers, err := repo.ListProfileViewers(ctx, ownerID, 50)
	if err != nil {
		t.Fatalf("ListProfileViewers: %v", err)
	}
	byActor := map[string]localnet.ProfileViewerStat{}
	for _, v := range viewers {
		byActor[v.ActorID] = v
	}
	if len(byActor) != 2 {
		t.Fatalf("viewers = %d, want 2 (one row per person), got %+v", len(byActor), viewers)
	}
	if byActor[viewer1].Opens != 2 {
		t.Fatalf("%s opens = %d, want 2", viewer1, byActor[viewer1].Opens)
	}
	if byActor[viewer2].Opens != 1 {
		t.Fatalf("%s opens = %d, want 1", viewer2, byActor[viewer2].Opens)
	}
}

// TestMediaImpressionStatsPostgresRoundTrip: MEDIA-DWELL-001's real risk is
// the SQL, not the Go — jsonb_array_elements + LATERAL join over media_refs
// is new syntax nothing else in this codebase exercises, and a placeholder/
// join bug there is invisible to the in-memory test (TestMediaImpressionStats-
// RoundTrip in the localnet package only exercises MemoryRepository). This
// pins the actual query against real PostgreSQL: two photos in one post,
// different viewers/watch time, must aggregate per photo, not per post.
func TestMediaImpressionStatsPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)
	svc := localnet.NewWithMediaLookupAndModelStack(repo, nil, nil)

	run := time.Now().UnixNano()
	authorID := "user_media_pg_" + itoa(run)
	mediaA := "ma_pg_a_" + itoa(run)
	mediaB := "ma_pg_b_" + itoa(run)

	r := svc.HandleContext(ctx, lnEnvelope("CreatePost", map[string]any{
		"authorType": "USER", "body": "西湖两张照片", "visibility": "PUBLIC", "cityScope": "hn",
		"mediaRefs": []any{
			map[string]any{"mediaAssetId": mediaA, "sortOrder": 0},
			map[string]any{"mediaAssetId": mediaB, "sortOrder": 1},
		},
	}, authorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreatePost: %+v", r.Error)
	}
	postID := r.Aggregate.ID
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.interaction_events WHERE target_type='MEDIA' AND target_id IN ($1,$2)`, mediaA, mediaB)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.posts WHERE id=$1`, postID)
	})

	impress := func(actor, mediaAssetID string, watchMs int64) {
		res := svc.HandleContext(ctx, lnEnvelope("RecordMediaImpression", map[string]any{
			"targetId": mediaAssetID, "watchMs": watchMs,
		}, actor))
		if res.Outcome != "ACCEPTED" {
			t.Fatalf("RecordMediaImpression(%s, %s): %+v", actor, mediaAssetID, res.Error)
		}
	}
	// COMP-PURPOSE-CONSENT-001：逐张照片的停留是敏感行为追踪，先取同意。
	grantBehaviorAnalyticsPG(t, pool, svc, ctx, "viewer_1_"+itoa(run))
	grantBehaviorAnalyticsPG(t, pool, svc, ctx, "viewer_2_"+itoa(run))
	impress("viewer_1_"+itoa(run), mediaA, 900)
	impress("viewer_1_"+itoa(run), mediaB, 7000)
	impress("viewer_2_"+itoa(run), mediaB, 3000)

	stats, err := repo.ListMediaImpressionStats(ctx, authorID, time.Time{}, 20)
	if err != nil {
		t.Fatalf("ListMediaImpressionStats: %v", err)
	}
	byMedia := map[string]localnet.MediaImpressionStats{}
	for _, row := range stats {
		if row.PostID != postID {
			t.Fatalf("row %+v has wrong postID, want %s", row, postID)
		}
		byMedia[row.MediaAssetID] = row
	}
	if len(byMedia) != 2 {
		t.Fatalf("stats rows = %d, want 2 (one per photo), got %+v", len(byMedia), stats)
	}
	a, b := byMedia[mediaA], byMedia[mediaB]
	if a.Impressions != 1 || a.Viewers != 1 || a.TotalWatchMs != 900 {
		t.Fatalf("media_a = %+v, want {1 impression, 1 viewer, 900ms}", a)
	}
	if b.Impressions != 2 || b.Viewers != 2 || b.TotalWatchMs != 10000 {
		t.Fatalf("media_b = %+v, want {2 impressions, 2 viewers, 10000ms}", b)
	}

	// VIEWER-ACTIVITY-001: the actual risk here is the INNER JOIN with an
	// extra actor_id predicate — viewer_1's activity must show both photos
	// with their own watch times, viewer_2's must show only mediaB.
	viewer1Activity, err := repo.ListMediaActivityForViewer(ctx, authorID, "viewer_1_"+itoa(run), 20)
	if err != nil {
		t.Fatalf("ListMediaActivityForViewer(viewer_1): %v", err)
	}
	byMediaV1 := map[string]localnet.ViewerMediaActivity{}
	for _, row := range viewer1Activity {
		if row.PostID != postID {
			t.Fatalf("row %+v has wrong postID, want %s", row, postID)
		}
		byMediaV1[row.MediaAssetID] = row
	}
	if len(byMediaV1) != 2 {
		t.Fatalf("viewer_1 activity rows = %d, want 2, got %+v", len(byMediaV1), viewer1Activity)
	}
	if byMediaV1[mediaA].Opens != 1 || byMediaV1[mediaA].TotalWatchMs != 900 {
		t.Fatalf("viewer_1 on mediaA = %+v, want {1 open, 900ms}", byMediaV1[mediaA])
	}
	if byMediaV1[mediaB].Opens != 1 || byMediaV1[mediaB].TotalWatchMs != 7000 {
		t.Fatalf("viewer_1 on mediaB = %+v, want {1 open, 7000ms}", byMediaV1[mediaB])
	}

	viewer2Activity, err := repo.ListMediaActivityForViewer(ctx, authorID, "viewer_2_"+itoa(run), 20)
	if err != nil {
		t.Fatalf("ListMediaActivityForViewer(viewer_2): %v", err)
	}
	if len(viewer2Activity) != 1 || viewer2Activity[0].MediaAssetID != mediaB {
		t.Fatalf("viewer_2 activity = %+v, want exactly [mediaB]", viewer2Activity)
	}
}

func lnEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	envelope := command.Envelope{
		CommandID:      "cmd_ln_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_ln_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_ln_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "Post", ID: targetID[0]}
	}
	return envelope
}

// TestProfileViewStatsSinceDaysPostgresRoundTrip: sinceDays 只限制读窗口 ——
// 40 天前的访问在全量口径里，30 天口径里没有；事件本身不删。
func TestProfileViewStatsSinceDaysPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewLocalNetRepository(pool)

	run := time.Now().UnixNano()
	ownerID := "user_viewwin_pg_" + itoa(run)
	oldViewer := "viewer_old_pg_" + itoa(run)

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM localnet.interaction_events WHERE target_type='PROFILE' AND target_id=$1`, ownerID)
	})
	if _, err := pool.Exec(ctx, `INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at) VALUES ($1,'PROFILE_OPEN',$2,'PROFILE',$3,$4)`,
		"ev_viewwin_old_"+itoa(run), oldViewer, ownerID, time.Now().UTC().AddDate(0, 0, -40)); err != nil {
		t.Fatalf("seed old open: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, created_at) VALUES ($1,'PROFILE_OPEN',$2,'PROFILE',$3, NOW())`,
		"ev_viewwin_new_"+itoa(run), "viewer_new_pg_"+itoa(run), ownerID); err != nil {
		t.Fatalf("seed new open: %v", err)
	}

	all, err := repo.ListProfileViewStats(ctx, ownerID, time.Time{})
	if err != nil {
		t.Fatalf("all-time: %v", err)
	}
	if all.Opens != 2 || all.UniqueViewers != 2 {
		t.Fatalf("all-time = %+v, want {2 2}", all)
	}
	win, err := repo.ListProfileViewStats(ctx, ownerID, time.Now().UTC().AddDate(0, 0, -30))
	if err != nil {
		t.Fatalf("30d: %v", err)
	}
	if win.Opens != 1 || win.UniqueViewers != 1 {
		t.Fatalf("30d = %+v, want {1 1}", win)
	}
}
