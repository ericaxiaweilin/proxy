package conversation

import (
	"context"
	"testing"
	"time"
)

func TestPurgeExpiredMessages_MemoryDeletesOnlyExpired(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	clk := &fixedClock{now: now}
	svc := NewWithRepositoryAndClock(repo, clk)

	// conv
	conv := Conversation{ID: "conv_sweep_1", Type: "DM", OriginType: "POST", OriginID: "post_1", State: "ACTIVE", Participants: []string{"a", "b"}, CreatedAt: now, LastMessageAt: now}
	if err := repo.CreateConversation(ctx, conv); err != nil {
		t.Fatalf("create conv: %v", err)
	}
	// expired: TTL 1h ago
	exp := now.Add(-time.Hour)
	keepExp := now.Add(30 * 24 * time.Hour)
	mExpired := Message{ID: "msg_exp", ConversationID: conv.ID, SenderID: "a", MessageType: "TEXT", Body: "old", CreatedAt: now.Add(-2 * time.Hour), Protection: MessageProtection{ExpiresAt: &exp}}
	mKeep := Message{ID: "msg_keep", ConversationID: conv.ID, SenderID: "a", MessageType: "TEXT", Body: "keep", CreatedAt: now, Protection: MessageProtection{ExpiresAt: &keepExp}}
	mNever := Message{ID: "msg_never", ConversationID: conv.ID, SenderID: "a", MessageType: "SYSTEM_CONTEXT", Body: "sys", CreatedAt: now, Protection: MessageProtection{}}
	for _, m := range []Message{mExpired, mKeep, mNever} {
		if err := repo.AppendMessage(ctx, m); err != nil {
			t.Fatalf("append %s: %v", m.ID, err)
		}
	}

	// service sweep should delete 1
	n, err := svc.SweepExpiredMessages(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("swept = %d, want 1", n)
	}
	msgs, _ := repo.Messages(ctx, conv.ID)
	if len(msgs) != 2 {
		t.Fatalf("remaining = %d, want 2", len(msgs))
	}
	for _, m := range msgs {
		if m.ID == "msg_exp" {
			t.Fatal("expired should be gone")
		}
	}
}

type fixedClock struct{ now time.Time }
func (c *fixedClock) Now() time.Time { return c.now }
