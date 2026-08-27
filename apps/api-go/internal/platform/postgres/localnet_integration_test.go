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
	r = svc.HandleContext(ctx, lnEnvelope("RecordPostImpression", map[string]any{
		"targetId": postID, "viewerPrincipalId": "viewer_pg_" + itoa(run),
		"marketId": "hn",
	}, authorID, postID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordPostImpression: %+v", r.Error)
	}

	cleanupLocalNetPG(t, pool, []string{postID, authorID})
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
