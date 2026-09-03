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

// R16.2: PinPost/UnpinPost/ListPinnedPosts round-trip via real PostgreSQL.
//
// R16.1 migration 057 建了 engagement.post_pins 表 (之前 server.go 一直
// 引用但 migration 缺, server 端 500 'command_transaction_failed').
//
// 这条测试验证 R16.1 后, 三个 PinPost 命令真接 PG schema.
// 跟 TestEngagementPostgresRoundTrip 拆开 — 后者需要 ReactToPost 不挂
// 的环境 (react 跟 post_stats trigger 有依赖), 这条只验 pin.

func TestEngagementPostgresPinRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewEngagementRepository(pool)
	svc := engagement.NewWithRepository(repo)

	postID := "post_eng_pin_pg_" + time.Now().Format("150405.000000")
	if _, err := pool.Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, visibility, city_scope, status, created_at)
		VALUES ($1, 'USER', 'agent_linh', 'Linh', 'pin test seed', 'PUBLIC', 'hanoi', 'PUBLISHED', NOW())
		ON CONFLICT (id) DO NOTHING`, postID); err != nil {
		t.Fatalf("seed post: %v", err)
	}

	actor := "user_pin_pg_" + time.Now().Format("150405.000000")

	r := svc.HandleContext(ctx, pinEnvelope("PinPost", map[string]any{"postId": postID}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("PinPost: outcome=%s err=%+v", r.Outcome, r.Error)
	}

	r = svc.HandleContext(ctx, pinEnvelope("ListPinnedPosts", map[string]any{"ownerId": actor}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListPinnedPosts after pin: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	var pinnedPayload struct {
		OwnerID string   `json:"ownerId"`
		PostIDs []string `json:"postIds"`
		Count   int      `json:"count"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &pinnedPayload); err != nil {
		t.Fatalf("unmarshal pinned payload: %v", err)
	}
	if pinnedPayload.OwnerID != actor {
		t.Fatalf("expected ownerId %q, got %q", actor, pinnedPayload.OwnerID)
	}
	if len(pinnedPayload.PostIDs) != 1 || pinnedPayload.PostIDs[0] != postID {
		t.Fatalf("expected postIds=[%s], got %v", postID, pinnedPayload.PostIDs)
	}
	if pinnedPayload.Count != 1 {
		t.Fatalf("expected count=1, got %d", pinnedPayload.Count)
	}

	r = svc.HandleContext(ctx, pinEnvelope("UnpinPost", map[string]any{"postId": postID}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("UnpinPost: outcome=%s err=%+v", r.Outcome, r.Error)
	}

	r = svc.HandleContext(ctx, pinEnvelope("ListPinnedPosts", map[string]any{"ownerId": actor}, actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListPinnedPosts after unpin: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &pinnedPayload); err != nil {
		t.Fatalf("unmarshal pinned payload 2: %v", err)
	}
	if len(pinnedPayload.PostIDs) != 0 {
		t.Fatalf("expected postIds=[] after unpin, got %v", pinnedPayload.PostIDs)
	}
}

func pinEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_eng_pin_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "Post", ID: actorID},
		IdempotencyKey: "test_eng_pin_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_eng_pin_1",
		RequestedAt:    "2026-09-03T00:00:00Z",
		Payload:        payload,
	}
}