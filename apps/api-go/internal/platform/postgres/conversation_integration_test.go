package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/conversation"
)

// TestConversationPostgresLifecycle covers the M3 conversation chain
// through real PostgreSQL: StartConversation (state=ACTIVE, participants
// persisted, origin preserved) → the auto-appended first message is
// stored in conversation.messages → invalid origin type / missing
// participant rejections. Cross-actor: a third user cannot read
// messages they were not a participant of (ListConversationMessages
// requires participant membership).
func TestConversationPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewConversationRepository(pool)
	svc := conversation.NewWithModelStack(repo, nil)

	run := time.Now().UnixNano()
	actorID := "user_conv_pg_a_" + itoa(run)
	participantID := "user_conv_pg_b_" + itoa(run)
	strangerID := "user_conv_pg_c_" + itoa(run)

	// 1. StartConversation: actor + participant, origin=POST,
	// firstMessage="你好，明天 8 点可以吗？". Must produce
	// state=ACTIVE, conversationId returned, the first message
	// appended to conversation.messages.
	r := svc.HandleContext(ctx, convEnvelope("StartConversation", map[string]any{
		"originType":    "POST",
		"originId":      "post_pg_" + itoa(run),
		"participantId": participantID,
		"firstMessage":  "你好，明天 8 点可以吗？",
		"marketId":      "hn",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("StartConversation: %+v", r.Error)
	}
	if r.Aggregate.State != "ACTIVE" {
		t.Fatalf("new conversation must be ACTIVE, got %s", r.Aggregate.State)
	}
	convID := r.Aggregate.ID
	if convID == "" {
		t.Fatalf("StartConversation: missing conversationId")
	}

	// 2. The conversation must exist in PG with both participants
	// and the right origin.
	conv, err := repo.GetConversation(ctx, convID)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if conv.OriginType != "POST" || conv.OriginID != "post_pg_"+itoa(run) {
		t.Fatalf("origin not persisted: %+v", conv)
	}
	if len(conv.Participants) != 2 {
		t.Fatalf("must have 2 participants, got %d: %v", len(conv.Participants), conv.Participants)
	}
	hasActor, hasOther := false, false
	for _, p := range conv.Participants {
		if p == actorID {
			hasActor = true
		}
		if p == participantID {
			hasOther = true
		}
	}
	if !hasActor || !hasOther {
		t.Fatalf("participants must include both %s and %s, got %v", actorID, participantID, conv.Participants)
	}

	// 3. The first message must have been appended via
	// AppendMessage in the same CreateConversation flow.
	msgs, err := repo.Messages(ctx, convID)
	if err != nil {
		t.Fatalf("Messages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 first message, got %d", len(msgs))
	}
	if msgs[0].SenderID != actorID || msgs[0].Body != "你好，明天 8 点可以吗？" {
		t.Fatalf("first message not appended correctly: %+v", msgs[0])
	}

	// 4. ListConversationMessages (by actor, who IS a participant):
	// must return the first message.
	r = svc.HandleContext(ctx, convEnvelope("ListConversationMessages", map[string]any{
		"conversationId": convID, "limit": 50,
	}, actorID, convID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListConversationMessages: %+v", r.Error)
	}
	if !listConvHasMessagePG(t, r.OperationRef, "你好，明天 8 点可以吗？") {
		t.Fatalf("ListConversationMessages must include the first message body, op=%s", r.OperationRef)
	}

	// 5. Cross-actor: a stranger trying to read messages of a
	// conversation they were never a participant of must be
	// REJECTED with NOT_CONVERSATION_PARTICIPANT.
	r = svc.HandleContext(ctx, convEnvelope("ListConversationMessages", map[string]any{
		"conversationId": convID, "limit": 50,
	}, strangerID, convID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("stranger list must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "NOT_CONVERSATION_PARTICIPANT" {
		t.Fatalf("expected NOT_CONVERSATION_PARTICIPANT, got %+v", r.Error)
	}

	// 6. The participant (not the actor) can also list messages.
	r = svc.HandleContext(ctx, convEnvelope("ListConversationMessages", map[string]any{
		"conversationId": convID, "limit": 50,
	}, participantID, convID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("participant list: %+v", r.Error)
	}

	// 7. Invalid origin type: must be REJECTED with
	// INVALID_ORIGIN_TYPE.
	r = svc.HandleContext(ctx, convEnvelope("StartConversation", map[string]any{
		"originType":    "INTERSTELLAR",
		"originId":      "x",
		"participantId": participantID,
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("bad origin must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_ORIGIN_TYPE" {
		t.Fatalf("expected INVALID_ORIGIN_TYPE, got %+v", r.Error)
	}

	// 8. Missing participantId: must be REJECTED with
	// INVALID_CONVERSATION_START.
	r = svc.HandleContext(ctx, convEnvelope("StartConversation", map[string]any{
		"originType": "POST", "originId": "x",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("missing participant must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_CONVERSATION_START" {
		t.Fatalf("expected INVALID_CONVERSATION_START, got %+v", r.Error)
	}

	// 9. Two conversations on the same origin (different actors):
	// must each get their own conversationId (Conversation 必须保存
	// 来源；同一 Post 不同用户发起 DM 时 Conversation 独立).
	r = svc.HandleContext(ctx, convEnvelope("StartConversation", map[string]any{
		"originType":    "POST",
		"originId":      "post_pg_" + itoa(run),
		"participantId": actorID,
	}, participantID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("reverse StartConversation: %+v", r.Error)
	}
	if r.Aggregate.ID == convID {
		t.Fatalf("reverse conversation must have a different id, got the same one")
	}

	cleanupConversationPG(t, pool, []string{convID, r.Aggregate.ID})
}

func listConvHasMessagePG(t *testing.T, op, body string) bool {
	t.Helper()
	var top map[string]any
	if err := jsonUnmarshalConv(op, &top); err != nil {
		return false
	}
	raw, ok := top["messages"]
	if !ok {
		raw, ok = top["items"]
		if !ok {
			return false
		}
	}
	arr, ok := raw.([]any)
	if !ok {
		return false
	}
	for _, m := range arr {
		mm, ok := m.(map[string]any)
		if !ok {
			continue
		}
		if b, _ := mm["body"].(string); b == body {
			return true
		}
	}
	return false
}

func jsonUnmarshalConv(s string, v any) error {
	return json.Unmarshal([]byte(s), v)
}

func cleanupConversationPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM conversation.messages WHERE conversation_id=$1`, id); err != nil {
			t.Logf("cleanup messages: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM conversation.conversations WHERE id=$1`, id); err != nil {
			t.Logf("cleanup conversations: %v", err)
		}
	}
}

func convEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	envelope := command.Envelope{
		CommandID:      "cmd_conv_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_conv_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_conv_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "Conversation", ID: targetID[0]}
	}
	return envelope
}
