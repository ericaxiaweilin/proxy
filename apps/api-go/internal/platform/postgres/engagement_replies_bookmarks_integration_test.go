package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/engagement"
)

// R16.4: ReplyToPost + ListRepliesByActor / BookmarkPost + ListBookmarksByActor
// round-trip via real PostgreSQL.
//
// R16.3 migration 058 rename engagement.replies.id → reply_id,
// engagement.bookmarks.id → bookmark_id. R16.4.1 修 server.go
// INSERT 也改 reply_id/bookmark_id (之前还是 'id').
//
// 这条 test 验 R16.3 + R16.4.1 后 server 端真接 PG.

func TestEngagementPostgresReplyBookmarkRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)
	svc := engagement.NewWithRepository(repo)

	postID := "post_eng_rb_pg_" + time.Now().Format("150405.000000")
	if _, err := pool.Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, visibility, city_scope, status, created_at)
		VALUES ($1, 'USER', 'agent_linh', 'Linh', 'rb test seed', 'PUBLIC', 'hanoi', 'PUBLISHED', NOW())
		ON CONFLICT (id) DO NOTHING`, postID); err != nil {
		t.Fatalf("seed post: %v", err)
	}

	actor := "user_rb_pg_" + time.Now().Format("150405.000000")

	r := svc.HandleContext(ctx, rbEnvelope("ReplyToPost", map[string]any{"postId": postID, "body": "R16.4 reply test"}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ReplyToPost: outcome=%s err=%+v", r.Outcome, r.Error)
	}

	r = svc.HandleContext(ctx, rbEnvelope("ListUserReplies", map[string]any{"userId": actor, "limit": 30}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListUserReplies: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	var replyPayload struct {
		UserID  string `json:"userId"`
		Replies []struct {
			ReplyID string `json:"replyId"`
			PostID  string `json:"postId"`
			Body    string `json:"body"`
		} `json:"replies"`
		Count int `json:"count"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &replyPayload); err != nil {
		t.Fatalf("unmarshal reply payload: %v", err)
	}
	if replyPayload.UserID != actor {
		t.Fatalf("expected userId %q, got %q", actor, replyPayload.UserID)
	}
	if len(replyPayload.Replies) != 1 || replyPayload.Replies[0].Body != "R16.4 reply test" {
		t.Fatalf("expected 1 reply with body 'R16.4 reply test', got %+v", replyPayload.Replies)
	}

	r = svc.HandleContext(ctx, rbEnvelope("BookmarkPost", map[string]any{"postId": postID}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("BookmarkPost: outcome=%s err=%+v", r.Outcome, r.Error)
	}

	r = svc.HandleContext(ctx, rbEnvelope("ListUserBookmarks", map[string]any{"userId": actor, "limit": 60}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListUserBookmarks: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	var bookmarkPayload struct {
		UserID    string   `json:"userId"`
		Bookmarks []string `json:"bookmarks"`
		Count     int      `json:"count"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &bookmarkPayload); err != nil {
		t.Fatalf("unmarshal bookmark payload: %v", err)
	}
	if bookmarkPayload.UserID != actor {
		t.Fatalf("expected userId %q, got %q", actor, bookmarkPayload.UserID)
	}
	if len(bookmarkPayload.Bookmarks) != 1 || bookmarkPayload.Bookmarks[0] != postID {
		t.Fatalf("expected bookmarks=[%s], got %v", postID, bookmarkPayload.Bookmarks)
	}
}

func rbEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_eng_rb_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "Post", ID: actorID},
		IdempotencyKey: "test_eng_rb_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_eng_rb_1",
		RequestedAt:    "2026-09-03T00:00:00Z",
		Payload:        payload,
	}
}