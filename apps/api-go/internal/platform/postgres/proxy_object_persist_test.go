package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/conversation"
)

// TestAppendMessagePersistsProxyObject 是 PROXY-OBJECT-PERSIST-001 的回归钉。
//
// conversation.messages.proxy_object 列在迁移 039 就存在，但 AppendMessage /
// Messages / GetMessage 从没读写过它——任何带 ProxyObject 的消息（结构化建议、
// 活动分享、ROOM-CREATE-001 的见面邀约卡片）落到 Postgres 后 proxy_object 静默
// 变 NULL，客户端收到一条没有卡片内容的空气泡。内存版 Repository（大多数单测
// 用）不受影响，这个洞只有真接 Postgres 才会暴露——这正是它一直没被测出来的
// 原因，所以这个回归测试必须直接打 Postgres，不能改用内存版。
func TestAppendMessagePersistsProxyObject(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewConversationRepository(pool)

	run := time.Now().UnixNano()
	actorID := "user_proxyobj_pg_a_" + itoa(run)
	participantID := "user_proxyobj_pg_b_" + itoa(run)
	convID := "conv_proxyobj_pg_" + itoa(run)

	if err := repo.CreateConversation(ctx, conversation.Conversation{
		ID: convID, Type: "DM", OriginType: "PROFILE", OriginID: participantID,
		State: "ACTIVE", Participants: []string{actorID, participantID},
		CreatedAt: time.Now().UTC(), LastMessageAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	t.Cleanup(func() { cleanupConversationPG(t, pool, []string{convID}) })

	msgID := "msg_proxyobj_pg_" + itoa(run)
	proxy := &conversation.ProxyObjectRef{
		ObjectType: "invitation",
		ObjectID:   "meetup_test_1",
		Snapshot:   map[string]any{"sceneName": "City Walk + 拍照", "place": "老城区"},
		LiveState:  map[string]any{"status": "PENDING"},
	}
	if err := repo.AppendMessage(ctx, conversation.Message{
		ID: msgID, ConversationID: convID, DialogID: convID, SenderID: actorID,
		MessageType: "STRUCTURED_SUGGESTION", Kind: "proxy_object", ProxyObject: proxy,
		CreatedAt: time.Now().UTC(), Delivery: &conversation.MessageDelivery{State: "sent"},
	}); err != nil {
		t.Fatalf("AppendMessage: %v", err)
	}

	// Messages(): the round-trip that ListConversationMessages actually uses.
	msgs, err := repo.Messages(ctx, convID)
	if err != nil {
		t.Fatalf("Messages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	got := msgs[0].ProxyObject
	if got == nil {
		t.Fatalf("ProxyObject must survive the Postgres round-trip, got nil (PROXY-OBJECT-PERSIST-001 regressed)")
	}
	if got.ObjectType != "invitation" || got.ObjectID != "meetup_test_1" {
		t.Fatalf("ProxyObject fields not persisted correctly: %+v", got)
	}
	if got.Snapshot["sceneName"] != "City Walk + 拍照" {
		t.Fatalf("ProxyObject.Snapshot not persisted correctly: %+v", got.Snapshot)
	}
	if got.LiveState["status"] != "PENDING" {
		t.Fatalf("ProxyObject.LiveState not persisted correctly: %+v", got.LiveState)
	}

	// GetMessage(): the other read path (MarkMessageRead / ForwardMessage / etc).
	single, err := repo.GetMessage(ctx, msgID)
	if err != nil {
		t.Fatalf("GetMessage: %v", err)
	}
	if single.ProxyObject == nil || single.ProxyObject.ObjectType != "invitation" {
		t.Fatalf("GetMessage must also round-trip ProxyObject, got %+v", single.ProxyObject)
	}
}
