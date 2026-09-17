package conversation

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func unreadTestActor(e command.Envelope, actorID string) command.Envelope {
	e.Actor.ID = actorID
	e.Principal.ID = actorID
	return e
}

func startUnreadDM(t *testing.T, s *Service, participant string) string {
	t.Helper()
	r := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "NEED", "originId": "need_unread", "participantId": participant,
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("start conversation: got %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	if view.ConversationID == "" {
		t.Fatal("no conversationId returned")
	}
	return view.ConversationID
}

func sendUnreadText(t *testing.T, s *Service, actor, convID, body string) {
	t.Helper()
	r := s.Handle(unreadTestActor(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": body}, convID), actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("send message as %s: got %s (%+v)", actor, r.Outcome, r.Error)
	}
}

func listUnread(t *testing.T, s *Service, actor, convID string) int {
	t.Helper()
	r := s.Handle(unreadTestActor(envelopeFor("ListConversations", map[string]any{}, ""), actor))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list conversations as %s: got %s (%+v)", actor, r.Outcome, r.Error)
	}
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	for _, summary := range view.Conversations {
		if summary.Conversation.ID == convID {
			return summary.UnreadCount
		}
	}
	t.Fatalf("conversation %s missing from %s's list", convID, actor)
	return -1
}

func markUnreadRead(t *testing.T, s *Service, actor, convID string) command.Result {
	t.Helper()
	return s.Handle(unreadTestActor(envelopeFor("MarkDialogRead", map[string]any{"conversationId": convID}, convID), actor))
}

// UNREAD-PIPELINE-001: 未读数按人算 —— 对方发的才算，标了就清零。
func TestMarkDialogReadFlow(t *testing.T) {
	s := New()
	convID := startUnreadDM(t, s, "agent_linh")
	sendUnreadText(t, s, "agent_linh", convID, "在的")
	sendUnreadText(t, s, "agent_linh", convID, "周末有空")
	sendUnreadText(t, s, "user_001", convID, "好的")

	if got := listUnread(t, s, "user_001", convID); got != 2 {
		t.Fatalf("user_001 unread = %d, want 2 (agent's messages only)", got)
	}
	if got := listUnread(t, s, "agent_linh", convID); got != 1 {
		t.Fatalf("agent_linh unread = %d, want 1", got)
	}
	if r := markUnreadRead(t, s, "user_001", convID); r.Outcome != "ACCEPTED" {
		t.Fatalf("mark read: got %s (%+v)", r.Outcome, r.Error)
	}
	if got := listUnread(t, s, "user_001", convID); got != 0 {
		t.Fatalf("user_001 unread after mark = %d, want 0", got)
	}
	// 对方没点开就不受影响。
	if got := listUnread(t, s, "agent_linh", convID); got != 1 {
		t.Fatalf("agent_linh unread = %d, want 1 (untouched)", got)
	}
	// 标完之后的新消息重新亮。
	sendUnreadText(t, s, "agent_linh", convID, "那周六见")
	if got := listUnread(t, s, "user_001", convID); got != 1 {
		t.Fatalf("user_001 unread after new message = %d, want 1", got)
	}
}

func TestMarkDialogReadRejectsOutsider(t *testing.T) {
	s := New()
	convID := startUnreadDM(t, s, "agent_linh")
	r := markUnreadRead(t, s, "stranger", convID)
	if r.Outcome != "REJECTED" {
		t.Fatalf("outsider mark must be rejected, got %q", r.Outcome)
	}
	r = markUnreadRead(t, s, "stranger", "no-such-dialog")
	if r.Outcome != "REJECTED" {
		t.Fatalf("unknown dialog mark must be rejected, got %q", r.Outcome)
	}
}

// countUnread 的边角：自己的不算，删掉的不算，序号缺失的老消息按时间算。
func TestCountUnreadEdges(t *testing.T) {
	now := time.Now().UTC()
	past := now.Add(-time.Hour)
	deletedAt := now.Add(-time.Minute)
	messages := []Message{
		{SenderID: "me", Seq: 5, CreatedAt: past},
		{SenderID: "peer", Seq: 6, DeletedAt: &deletedAt, CreatedAt: past},
		{SenderID: "peer", Seq: 7, CreatedAt: past},
		{SenderID: "peer", Seq: 0, CreatedAt: past}, // PG 落库不存 seq 的老消息
	}
	cursor := ReadCursor{UserID: "me", DialogID: "d1", LastReadSeq: 6, LastReadAt: now}
	// Seq 7 一条；Seq 0 那条创建时间早于最后已读，不算。
	if got := countUnread(messages, "me", cursor); got != 1 {
		t.Fatalf("countUnread = %d, want 1", got)
	}
	// 从没标过（双零）：对方没删的两条都算 —— 上线亮一次，点开即灭。
	fresh := ReadCursor{UserID: "me", DialogID: "d1"}
	if got := countUnread(messages, "me", fresh); got != 2 {
		t.Fatalf("fresh cursor countUnread = %d, want 2", got)
	}
}
