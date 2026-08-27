package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/engagement"
)

// TestEngagementPostgresRoundTrip wires the engagement Service through the
// real PostgreSQL repository and proves the four core social primitives
// (follow / react / reply / repost / bookmark) round-trip to schema and
// aggregate back into PostEngagement counts.
func TestEngagementPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)
	svc := engagement.NewWithRepository(repo)

	// Use a unique post id per test run so cross-test bleed is impossible.
	postID := "post_eng_pg_" + time.Now().Format("150405.000000")

	r := svc.HandleContext(ctx, engagementEnvelope("FollowProfile", map[string]any{"followeeId": "agent_linh"}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("FollowProfile: outcome=%s err=%v", r.Outcome, r.Error)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("ReactToPost", map[string]any{"postId": postID, "kind": "LIKE"}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ReactToPost: outcome=%s err=%v", r.Outcome, r.Error)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("ReplyToPost", map[string]any{"postId": postID, "body": "ngon quá"}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ReplyToPost: outcome=%s err=%v", r.Outcome, r.Error)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("RepostPost", map[string]any{"postId": postID}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RepostPost: outcome=%s err=%v", r.Outcome, r.Error)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("BookmarkPost", map[string]any{"postId": postID}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("BookmarkPost: outcome=%s err=%v", r.Outcome, r.Error)
	}

	// Aggregate back through the same PG repo: counts must reflect the
	// five writes we just made (one reaction, one reply, one repost).
	eng, err := repo.Engagement(ctx, postID)
	if err != nil {
		t.Fatalf("Engagement: %v", err)
	}
	if eng.Reactions != 1 || eng.Replies != 1 || eng.Reposts != 1 {
		t.Fatalf("Engagement counts wrong: %+v", eng)
	}

	// Negative path: a follow with a missing followeeId is a 4xx, must
	// not reach the schema. The pool is unshared with this assertion but
	// we still confirm the row count for user_001 has not changed.
	var before, after int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM engagement.follows WHERE follower_id=$1`, "user_001").Scan(&before); err != nil {
		t.Fatalf("count before: %v", err)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("FollowProfile", map[string]any{}, "user_001"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("empty followeeId must be REJECTED, got %s", r.Outcome)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM engagement.follows WHERE follower_id=$1`, "user_001").Scan(&after); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if after != before {
		t.Fatalf("rejected follow leaked into schema: before=%d after=%d", before, after)
	}

	// Feed preference + report exercise the remaining writes; both are
	// append-only and must succeed even though no post exists yet.
	r = svc.HandleContext(ctx, engagementEnvelope("RecordFeedPreference", map[string]any{
		"postId": postID, "authorId": "agent_linh", "action": "REDUCE_AUTHOR",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RecordFeedPreference: outcome=%s err=%v", r.Outcome, r.Error)
	}
	r = svc.HandleContext(ctx, engagementEnvelope("ReportPost", map[string]any{
		"postId": postID, "reason": "SPAM", "state": "OPEN",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ReportPost: outcome=%s err=%v", r.Outcome, r.Error)
	}
	var prefCount, reportCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM engagement.feed_preferences WHERE post_id=$1`, postID).Scan(&prefCount); err != nil {
		t.Fatalf("feed_preferences: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM engagement.post_reports WHERE post_id=$1`, postID).Scan(&reportCount); err != nil {
		t.Fatalf("post_reports: %v", err)
	}
	if prefCount != 1 || reportCount != 1 {
		t.Fatalf("preference/report not persisted: pref=%d report=%d", prefCount, reportCount)
	}

	// Engagement summary should also work on a post with zero rows so the
	// caller gets a 0/0/0 view rather than a 404.
	emptyPost := "post_eng_pg_empty_" + time.Now().Format("150405.000000")
	eng, err = repo.Engagement(ctx, emptyPost)
	if err != nil {
		t.Fatalf("Engagement(empty): %v", err)
	}
	if eng.Reactions != 0 || eng.Replies != 0 || eng.Reposts != 0 {
		t.Fatalf("empty post must return zeros, got %+v", eng)
	}

	// Cleanup. We do not touch engagement.follows globally (other tests
	// share the user_001 row); only the per-post rows we created.
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.reactions WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup reactions: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.replies WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup replies: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.reposts WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup reposts: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.bookmarks WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup bookmarks: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.feed_preferences WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup feed_preferences: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM engagement.post_reports WHERE post_id=$1`, postID); err != nil {
		t.Fatalf("cleanup post_reports: %v", err)
	}
}

// engagementEnvelope mirrors the shape used by the in-memory engagement
// tests so PG and in-memory exercise the same command boundary.
func engagementEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_eng_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "Post", ID: actorID},
		IdempotencyKey: "test_eng_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_eng_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}
