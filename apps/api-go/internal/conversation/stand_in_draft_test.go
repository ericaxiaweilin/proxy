package conversation

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// AI-MANAGE-013：「每次确认」= AI 替本人起草，只有本人看得到；本人发出后就是本人的消息。
// dmHuman：user_001 私信 user_002（owner，设置为每次确认）。

type draftListView struct {
	Messages     []Message     `json:"messages"`
	StandInDraft *StandInDraft `json:"standInDraft"`
}

func confirmService(t *testing.T) (*Service, *MemoryRepository, *recordingModelStack, *string) {
	t.Helper()
	model := &recordingModelStack{}
	repo := NewMemoryRepository()
	s := NewWithModelStack(repo, model)
	// 起草在请求之外跑；测试里就地执行，结果可断言。
	s.SetStandInScheduler(func(_ time.Duration, run func()) { run() })
	var asked []string
	s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{
		"user_002": {ChatPermission: "confirm", OwnerName: "Linh"},
	}, &asked))
	metered := new(string)
	s.SetTokenMeter(func(_ context.Context, userID string, _, _ int) { *metered = userID })
	return s, repo, model, metered
}

func listAs(t *testing.T, s *Service, convID, actor string) draftListView {
	t.Helper()
	result := s.Handle(envelopeAs("ListConversationMessages", map[string]any{}, convID, actor))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list as %s: %s %+v", actor, result.Outcome, result.Error)
	}
	var view draftListView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	return view
}

func TestConfirmDraftsForTheOwnerOnlyAndNeverAnswersTheSender(t *testing.T) {
	s, repo, model, metered := confirmService(t)
	opened := dmHuman(t, s)
	if opened.AssistantStatus != "AWAITING_OWNER" || opened.AIMessage != nil || opened.AIDraft != nil {
		t.Fatalf("the sender only learns the owner has not answered yet: %+v", opened)
	}
	if model.calls != 1 {
		t.Fatalf("confirm must draft once for the owner, model calls=%d", model.calls)
	}
	if *metered != "user_002" {
		t.Fatalf("drafting is the owner's AI working, metered %q", *metered)
	}
	messages, _ := repo.Messages(context.Background(), opened.ConversationID)
	for _, m := range messages {
		if m.SenderID != "user_001" {
			t.Fatalf("a draft is not a message: found %q in the thread", m.SenderID)
		}
	}
	if listAs(t, s, opened.ConversationID, "user_001").StandInDraft != nil {
		t.Fatal("the sender must never see the owner's draft")
	}
	owner := listAs(t, s, opened.ConversationID, "user_002")
	if owner.StandInDraft == nil || owner.StandInDraft.Body == "" || owner.StandInDraft.OwnerID != "user_002" {
		t.Fatalf("the owner must see the pending draft: %+v", owner.StandInDraft)
	}
	// 发消息的人拿到 draftId 也不能替本人发 / 丢。
	for _, cmd := range []string{"SendStandInDraft", "DiscardStandInDraft"} {
		r := s.Handle(envelopeAs(cmd, map[string]any{"draftId": owner.StandInDraft.ID}, opened.ConversationID, "user_001"))
		if r.Outcome == "ACCEPTED" {
			t.Fatalf("%s by the sender must be refused", cmd)
		}
	}
}

func TestOwnerSendsTheDraftAsTheirOwnMessage(t *testing.T) {
	s, _, _, _ := confirmService(t)
	opened := dmHuman(t, s)
	draft := listAs(t, s, opened.ConversationID, "user_002").StandInDraft
	if draft == nil {
		t.Fatal("expected a pending draft")
	}
	r := s.Handle(envelopeAs("SendStandInDraft", map[string]any{"draftId": draft.ID, "body": "改过的：晚点回你～"}, opened.ConversationID, "user_002"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("owner send: %s %+v", r.Outcome, r.Error)
	}
	sender := listAs(t, s, opened.ConversationID, "user_001")
	last := sender.Messages[len(sender.Messages)-1]
	if last.SenderID != "user_002" || last.Body != "改过的：晚点回你～" || last.AuthoredBy != "" {
		t.Fatalf("an approved draft is the owner's own message (edited body, no AI tag): %+v", last)
	}
	if listAs(t, s, opened.ConversationID, "user_002").StandInDraft != nil {
		t.Fatal("a sent draft is no longer pending")
	}
	again := s.Handle(envelopeAs("SendStandInDraft", map[string]any{"draftId": draft.ID}, opened.ConversationID, "user_002"))
	if again.Outcome == "ACCEPTED" {
		t.Fatal("a draft can only be sent once")
	}
}

func TestStaleDraftsAreSupersededAndCanBeDiscarded(t *testing.T) {
	s, _, _, _ := confirmService(t)
	opened := dmHuman(t, s)
	first := listAs(t, s, opened.ConversationID, "user_002").StandInDraft
	sendIn(t, s, opened.ConversationID, "还在吗？")
	second := listAs(t, s, opened.ConversationID, "user_002").StandInDraft
	if first == nil || second == nil || second.ID == first.ID {
		t.Fatalf("a new message from the sender replaces the old draft: %+v -> %+v", first, second)
	}
	if r := s.Handle(envelopeAs("SendStandInDraft", map[string]any{"draftId": first.ID}, opened.ConversationID, "user_002")); r.Outcome == "ACCEPTED" {
		t.Fatal("a superseded draft must not be sendable")
	}
	// 本人自己直接回了：草稿过时作废。
	own := s.Handle(envelopeAs("SendMessage", map[string]any{"messageType": "TEXT", "body": "我自己回你"}, opened.ConversationID, "user_002"))
	if own.Outcome != "ACCEPTED" {
		t.Fatalf("owner reply: %+v", own.Error)
	}
	if listAs(t, s, opened.ConversationID, "user_002").StandInDraft != nil {
		t.Fatal("the owner replying themselves supersedes the draft")
	}
	// 丢弃
	sendIn(t, s, opened.ConversationID, "那明天呢")
	third := listAs(t, s, opened.ConversationID, "user_002").StandInDraft
	if third == nil {
		t.Fatal("expected a new draft")
	}
	if r := s.Handle(envelopeAs("DiscardStandInDraft", map[string]any{"draftId": third.ID}, opened.ConversationID, "user_002")); r.Outcome != "ACCEPTED" {
		t.Fatalf("discard: %+v", r.Error)
	}
	if listAs(t, s, opened.ConversationID, "user_002").StandInDraft != nil {
		t.Fatal("a discarded draft is gone")
	}
}
