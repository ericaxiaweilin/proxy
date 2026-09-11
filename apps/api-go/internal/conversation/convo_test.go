package conversation

import (
	"context"
	"encoding/json"
	"testing"
)

// Lotus v1 Convo (Message Branch) 命令测试：建分支 / 列表 / 分支内收发 / 越权拒绝。

func startDMForConvoTest(t *testing.T, s *Service) string {
	t.Helper()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM", "originType": "PROFILE", "originId": "user_002",
		"participantId": "user_002", "firstMessage": "你好",
	}, ""))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start DM: %+v", result.Error)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if view.ConversationID == "" {
		t.Fatal("start DM returned no conversationId")
	}
	return view.ConversationID
}

func sendTextForConvoTest(t *testing.T, s *Service, convID, body string) string {
	t.Helper()
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT", "body": body,
	}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send text: %+v", result.Error)
	}
	var view struct {
		MessageID string `json:"messageId"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	return view.MessageID
}

func createConvoForTest(t *testing.T, s *Service, messageID string) Convo {
	t.Helper()
	result := s.Handle(envelopeFor("CreateConvo", map[string]any{"messageId": messageID}, ""))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("create convo: %+v", result.Error)
	}
	var view struct {
		Convo Convo `json:"convo"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode convo: %v", err)
	}
	if view.Convo.ID == "" || view.Convo.SeedMessageID != messageID {
		t.Fatalf("convo missing id/seed: %+v", view.Convo)
	}
	return view.Convo
}

func TestCreateConvoFromSeed(t *testing.T) {
	s := New()
	convID := startDMForConvoTest(t, s)
	msgID := sendTextForConvoTest(t, s, convID, "周六下午去西湖拍照怎么样")
	convo := createConvoForTest(t, s, msgID)
	if convo.ParentDialogID != convID {
		t.Fatalf("parent mismatch: %s != %s", convo.ParentDialogID, convID)
	}
	if convo.Title == "" {
		t.Fatal("convo should default its title from the seed")
	}
	found := false
	for _, p := range convo.ParticipantIDs {
		if p == "user_001" {
			found = true
		}
	}
	if !found {
		t.Fatalf("creator must be a participant: %v", convo.ParticipantIDs)
	}
}

func TestCreateConvoRejectsUnknownSeed(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("CreateConvo", map[string]any{"messageId": "msg_missing"}, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected rejection, got %+v", result)
	}
}

func TestCreateConvoRejectsNonParticipant(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	conv := Conversation{ID: "conv_private", Type: "DM", OriginType: "PROFILE", OriginID: "x", State: "ACTIVE", Participants: []string{"user_002", "user_003"}}
	if err := repo.CreateConversation(ctx, conv); err != nil {
		t.Fatal(err)
	}
	if err := repo.AppendMessage(ctx, Message{ID: "msg_private_1", ConversationID: conv.ID, SenderID: "user_002", MessageType: "TEXT", Body: "secret"}); err != nil {
		t.Fatal(err)
	}
	s := NewWithRepository(repo)
	result := s.Handle(envelopeFor("CreateConvo", map[string]any{"messageId": "msg_private_1"}, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("non-participant must be rejected, got %+v", result)
	}
}

func TestListMyConvosOnlyMine(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	convID := startDMForConvoTest(t, s)
	msgID := sendTextForConvoTest(t, s, convID, "branch me")
	createConvoForTest(t, s, msgID)
	// 对照组：别人的会话 + 别人的分支，绝不能漏进来。
	ctx := context.Background()
	other := Conversation{ID: "conv_other", Type: "DM", OriginType: "PROFILE", OriginID: "x", State: "ACTIVE", Participants: []string{"user_002", "user_003"}}
	if err := repo.CreateConversation(ctx, other); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateConvo(ctx, Convo{ID: "convo_other", ParentDialogID: other.ID, SeedMessageID: "msg_x", Title: "other", ParticipantIDs: []string{"user_002", "user_003"}}); err != nil {
		t.Fatal(err)
	}
	result := s.Handle(envelopeFor("ListMyConvos", map[string]any{}, ""))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list convos: %+v", result.Error)
	}
	var view struct {
		Convos []struct {
			Convo        Convo  `json:"convo"`
			SeedPreview  string `json:"seedPreview"`
			LatestBody   string `json:"latestBody"`
			MessageCount int    `json:"messageCount"`
		} `json:"convos"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(view.Convos) != 1 {
		t.Fatalf("expected exactly my convo, got %d", len(view.Convos))
	}
	entry := view.Convos[0]
	if entry.Convo.SeedMessageID != msgID {
		t.Fatalf("seed mismatch: %s", entry.Convo.SeedMessageID)
	}
	if entry.SeedPreview == "" {
		t.Fatal("seed preview must be present")
	}
}

func TestSendAndReadInsideConvo(t *testing.T) {
	s := New()
	convID := startDMForConvoTest(t, s)
	seedID := sendTextForConvoTest(t, s, convID, "seed for branch")
	convo := createConvoForTest(t, s, seedID)

	// 分支内发言：归属分支，不触发 AI 状态。
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT", "body": "branch reply", "convoId": convo.ID,
	}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send in convo: %+v", result.Error)
	}
	var sent struct {
		MessageID       string `json:"messageId"`
		AssistantStatus string `json:"assistantStatus"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &sent)
	if sent.AssistantStatus != "NOT_REQUESTED" {
		t.Fatalf("branch send must not summon AI: %s", sent.AssistantStatus)
	}
	stored, err := s.repository.GetMessage(context.Background(), sent.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ConvoID == nil || *stored.ConvoID != convo.ID {
		t.Fatalf("message must carry the branch id: %+v", stored.ConvoID)
	}

	// 分支读：只返分支消息 + seed，不混入主线。
	listed := s.Handle(envelopeFor("ListConversationMessages", map[string]any{"convoId": convo.ID}, convID))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("list branch: %+v", listed.Error)
	}
	var view struct {
		Messages []Message       `json:"messages"`
		Seed     *Message        `json:"seed"`
		ConvoID  string          `json:"convoId"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &view); err != nil {
		t.Fatalf("decode branch list: %v", err)
	}
	if view.ConvoID != convo.ID {
		t.Fatalf("convo echo mismatch: %s", view.ConvoID)
	}
	if view.Seed == nil || view.Seed.ID != seedID {
		t.Fatalf("seed must ride along: %+v", view.Seed)
	}
	if len(view.Messages) != 1 || view.Messages[0].ID != sent.MessageID {
		t.Fatalf("branch must contain only branch messages: %d", len(view.Messages))
	}

	// 主线读：分支消息仍在全量里（ConvoID 透出），seed 照常。
	all := s.Handle(envelopeFor("ListConversationMessages", map[string]any{}, convID))
	var allView struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal([]byte(all.OperationRef), &allView)
	if len(allView.Messages) < 3 {
		t.Fatalf("main thread must keep every message: %d", len(allView.Messages))
	}
}

func TestSendMessageRejectsForeignConvo(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	convA := startDMForConvoTest(t, s)
	seedA := sendTextForConvoTest(t, s, convA, "seed a")
	convoA := createConvoForTest(t, s, seedA)
	// 另一会话（同属 user_001，排除成员权限干扰）往 A 的分支里发：必须拒绝。
	convB := Conversation{ID: "conv_b", Type: "DM", OriginType: "PROFILE", OriginID: "y", State: "ACTIVE", Participants: []string{"user_001", "user_009"}}
	if err := repo.CreateConversation(context.Background(), convB); err != nil {
		t.Fatal(err)
	}
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT", "body": "hijack", "convoId": convoA.ID,
	}, convB.ID))
	if result.Outcome != "REJECTED" {
		t.Fatalf("foreign convo send must be rejected, got %+v", result)
	}
}
