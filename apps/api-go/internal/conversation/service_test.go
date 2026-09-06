package conversation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

type capturingModelStack struct {
	messages []modelstack.ChatMessage
}

func (m *capturingModelStack) Available() bool { return true }

func (m *capturingModelStack) Complete(_ context.Context, _ string, messages []modelstack.ChatMessage) (modelstack.Completion, error) {
	m.messages = append([]modelstack.ChatMessage(nil), messages...)
	return modelstack.Completion{Content: "照片和文字都已收到。", Model: "test-model", Provider: "test-provider"}, nil
}

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Conversation", ID: targetID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

// Gate C：Post → Conversation；origin 必存；同一 Post 不同用户 DM 独立。
func TestStartConversationKeepsOrigin(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "POST",
		"originId":         "post_1",
		"participantId":    "agent_linh",
		"firstMessage":     "看到你的帖子，想聊聊城市同行",
	}, "")
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start conversation: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
		OriginType     string `json:"originType"`
		OriginID       string `json:"originId"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if view.OriginType != "POST" || view.OriginID != "post_1" {
		t.Fatalf("origin must be preserved: %+v", view)
	}
	convID := view.ConversationID

	// 同一 Post 不同用户发起 → 新 Conversation（独立）
	e2 := envelopeFor("StartConversation", map[string]any{
		"originType":    "POST",
		"originId":      "post_1",
		"participantId": "agent_mai",
	}, "")
	e2.Actor = command.Actor{Type: "USER", ID: "user_002"}
	result2 := s.Handle(e2)
	var view2 struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(result2.OperationRef), &view2)
	if view2.ConversationID == convID {
		t.Fatal("different users DMing same post must get independent conversations")
	}
}

// AI-PERSONA-CHAT-001: entering from a platform AI profile creates a durable
// welcome message owned by that specific account, not the generic proxy_ai id.
func TestPlatformAIPersonaConversationGetsAccountBoundWelcome(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "PROFILE",
		"originId":         "ai_account_001",
		"participantId":    "ai_account_001",
		"firstMessage":     "",
		"assistantMode":    "AI_PERSONA:ai_001",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start AI account conversation: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		ConversationID string  `json:"conversationId"`
		AIMessage      Message `json:"aiMessage"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode operation ref: %v", err)
	}
	if view.AIMessage.SenderID != "ai_account_001" || strings.TrimSpace(view.AIMessage.Body) == "" {
		t.Fatalf("welcome must belong to AI account: %+v", view.AIMessage)
	}
	if view.AIMessage.SenderSnapshot == nil || !strings.Contains(view.AIMessage.SenderSnapshot.DisplayName, "晴晴") {
		t.Fatalf("welcome must expose the AI account identity: %+v", view.AIMessage.SenderSnapshot)
	}
	messages, err := s.repository.Messages(context.Background(), view.ConversationID)
	if err != nil || len(messages) != 1 || messages[0].SenderID != "ai_account_001" {
		t.Fatalf("welcome must be durable and account-bound: messages=%+v err=%v", messages, err)
	}
}

func TestImageMessageNeverSendsEmptyContentToTextModel(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "HOME", "originId": "home_photo", "participantId": "proxy_ai",
		"firstMessage": "请根据我拍的照片帮我看看", "mediaRef": "media_photo_1",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start photo conversation: got %s (%+v)", result.Outcome, result.Error)
	}
	if len(model.messages) < 2 {
		t.Fatalf("want system and user text messages, got %+v", model.messages)
	}
	for _, message := range model.messages {
		if strings.TrimSpace(message.Content) == "" {
			t.Fatalf("model message content must never be empty: %+v", model.messages)
		}
	}
	if !strings.Contains(model.messages[0].Content, "图片附件") {
		t.Fatalf("system prompt must preserve media context: %q", model.messages[0].Content)
	}
}

func TestInvalidOriginType(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "RANDOM", "originId": "x", "participantId": "agent_linh",
	}, "")
	result := s.Handle(e)
	if result.Outcome != "REJECTED" || result.Error.ErrorCode != "INVALID_ORIGIN_TYPE" {
		t.Fatalf("want INVALID_ORIGIN_TYPE, got %s/%+v", result.Outcome, result.Error)
	}
}

func TestServerReturnsTranslationBriefInsteadOfNumberedFollowUp(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "HOME", "originId": "home_translation", "participantId": "proxy_ai",
		"firstMessage": "I need a girl translator in Hanoi",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start conversation: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		TemporaryUI *TemporaryUI `json:"temporaryUI"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if view.TemporaryUI == nil || view.TemporaryUI.ID != "translation_brief.v1" {
		t.Fatalf("want server translation brief, got %+v", view.TemporaryUI)
	}
	if len(view.TemporaryUI.Fields) != 3 || view.TemporaryUI.Fields[0].Type != "SINGLE_SELECT" {
		t.Fatalf("want short selectable form, got %+v", view.TemporaryUI.Fields)
	}
}

func TestRelationshipIntroductionIsConsentBasedAndNonTransactional(t *testing.T) {
	ui := temporaryUIFor("Hi I need girlfriend")
	if ui == nil || ui.ID != "relationship_introduction_brief.v1" {
		t.Fatalf("want relationship introduction brief, got %+v", ui)
	}
	if ui.Kind != "SHORT_FORM" || ui.Fields[0].ID != "intent" {
		t.Fatalf("want generic server-side short form, got %+v", ui)
	}
	if ui.Description == "" || !containsAll(ui.Description, "自愿", "成年", "不涉及交易") {
		t.Fatalf("relationship guardrail missing: %q", ui.Description)
	}
}

func TestTemporaryUIResponseDoesNotRetriggerSameForm(t *testing.T) {
	s := New()
	started := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "HOME", "originId": "home_translation", "participantId": "proxy_ai",
		"firstMessage": "需要翻译",
	}, "new"))
	var startView struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(started.OperationRef), &startView)
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT", "body": "我的补充信息：语言：中 ↔ 英；方式：现场口译", "temporaryUIResponseId": "translation_brief.v1",
	}, startView.ConversationID))
	var view map[string]any
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if _, retriggered := view["temporaryUI"]; retriggered {
		t.Fatalf("temporary form response must not retrigger a form: %+v", view)
	}
	if result.Outcome != "ACCEPTED" || view["assistantStatus"] != "RESPONDED" {
		t.Fatalf("server must acknowledge temporary form response without model follow-up: %+v", view)
	}
}

func containsAll(value string, tokens ...string) bool {
	for _, token := range tokens {
		if !strings.Contains(value, token) {
			return false
		}
	}
	return true
}

func TestSendMessageAndList(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "NEED", "originId": "need_1", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	convID := view.ConversationID

	// 发消息
	e2 := envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "你好"}, convID)
	r2 := s.Handle(e2)
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("send message: got %s (%+v)", r2.Outcome, r2.Error)
	}
	// 结构化建议
	e3 := envelopeFor("SendMessage", map[string]any{
		"messageType": "STRUCTURED_SUGGESTION",
		"body":        "建议 4 小时行程：还剑湖 + 鸡蛋咖啡",
	}, convID)
	r3 := s.Handle(e3)
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("structured suggestion: got %s", r3.Outcome)
	}
	// 列表
	e4 := envelopeFor("ListConversationMessages", map[string]any{}, convID)
	r4 := s.Handle(e4)
	var listView struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal([]byte(r4.OperationRef), &listView)
	if len(listView.Messages) != 2 {
		t.Fatalf("want 2 messages, got %d", len(listView.Messages))
	}
}

func TestListConversationsReturnsOnlyActorInboxWithLatestMessage(t *testing.T) {
	s := New()
	created := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "PROFILE", "originId": "profile_linh", "participantId": "user_linh",
	}, ""))
	var createdView struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(created.OperationRef), &createdView)
	_ = s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "真实收件箱消息"}, createdView.ConversationID))

	other := envelopeFor("StartConversation", map[string]any{
		"originType": "PROFILE", "originId": "profile_other", "participantId": "user_other",
	}, "")
	other.Actor = command.Actor{Type: "USER", ID: "user_outside"}
	other.Principal = command.Principal{Type: "INDIVIDUAL", ID: "user_outside"}
	_ = s.Handle(other)

	result := s.Handle(envelopeFor("ListConversations", map[string]any{}, "user_001"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list conversations: %s", result.Outcome)
	}
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if len(view.Conversations) != 1 {
		t.Fatalf("want actor's 1 conversation, got %d", len(view.Conversations))
	}
	if view.Conversations[0].LatestMessage == nil || view.Conversations[0].LatestMessage.Body != "真实收件箱消息" {
		t.Fatalf("latest message missing: %+v", view.Conversations[0].LatestMessage)
	}
}

// Gate D：普通消息不创建 Need；Need Draft → 用户确认 → 正式 Need。
func TestNeedDraftExplicitConfirm(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "POST", "originId": "post_1", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	convID := view.ConversationID

	// 创建 Need Draft
	e2 := envelopeFor("CreateNeedDraft", map[string]any{"summary": "想要 8 小时河内城市同行"}, convID)
	r2 := s.Handle(e2)
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("create need draft: got %s", r2.Outcome)
	}
	var draftView struct {
		DraftID   string `json:"draftId"`
		Confirmed bool   `json:"confirmed"`
	}
	_ = json.Unmarshal([]byte(r2.OperationRef), &draftView)
	if draftView.Confirmed {
		t.Fatal("draft must not be confirmed initially (Gate D)")
	}

	// 确认 → 正式 Need
	e3 := envelopeFor("ConfirmNeedDraft", map[string]any{"draftId": draftView.DraftID}, convID)
	r3 := s.Handle(e3)
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("confirm need draft: got %s (%+v)", r3.Outcome, r3.Error)
	}
	var confirmView struct {
		NeedID    string `json:"needId"`
		Confirmed bool   `json:"confirmed"`
	}
	_ = json.Unmarshal([]byte(r3.OperationRef), &confirmView)
	if !confirmView.Confirmed || confirmView.NeedID == "" {
		t.Fatalf("need must be confirmed with id: %+v", confirmView)
	}

	// 重复确认 → 拒绝
	r4 := s.Handle(e3)
	if r4.Outcome != "REJECTED" || r4.Error.ErrorCode != "NEED_DRAFT_ALREADY_CONFIRMED" {
		t.Fatalf("want ALREADY_CONFIRMED, got %s/%+v", r4.Outcome, r4.Error)
	}
}

func TestNonParticipantCannotSend(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "POST", "originId": "post_1", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)

	e2 := envelopeFor("SendMessage", map[string]any{"body": "闯入"}, view.ConversationID)
	e2.Actor = command.Actor{Type: "USER", ID: "user_evil"}
	r2 := s.Handle(e2)
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "NOT_CONVERSATION_PARTICIPANT" {
		t.Fatalf("want NOT_PARTICIPANT, got %s/%+v", r2.Outcome, r2.Error)
	}
}

func TestConversationBlockPersistsAndGuardsSending(t *testing.T) {
	s := New()
	started := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM",
		"originType":       "PROFILE",
		"originId":         "user_002",
		"participantId":    "user_002",
	}, ""))
	if started.Outcome != "ACCEPTED" {
		t.Fatalf("start conversation: %+v", started)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal([]byte(started.OperationRef), &view); err != nil {
		t.Fatal(err)
	}

	blocked := s.Handle(envelopeFor("SetConversationBlocked", map[string]any{"blocked": true}, view.ConversationID))
	if blocked.Outcome != "ACCEPTED" {
		t.Fatalf("block conversation: %+v", blocked)
	}
	conv, err := s.repository.GetConversation(context.Background(), view.ConversationID)
	if err != nil || conv.State != "BLOCKED" {
		t.Fatalf("blocked state was not persisted: state=%q err=%v", conv.State, err)
	}

	sent := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "不应发出"}, view.ConversationID))
	if sent.Outcome != "REJECTED" || sent.Error == nil || sent.Error.ErrorCode != "CONVERSATION_BLOCKED" {
		t.Fatalf("blocked conversation must reject sends: %+v", sent)
	}

	unblocked := s.Handle(envelopeFor("SetConversationBlocked", map[string]any{"blocked": false}, view.ConversationID))
	if unblocked.Outcome != "ACCEPTED" {
		t.Fatalf("unblock conversation: %+v", unblocked)
	}
	sent = s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "恢复发送"}, view.ConversationID))
	if sent.Outcome != "ACCEPTED" {
		t.Fatalf("unblocked conversation should allow sends: %+v", sent)
	}
}
