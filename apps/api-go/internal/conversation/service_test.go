package conversation

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

type capturingModelStack struct {
	messages []modelstack.ChatMessage
}

func TestHomeProxyConversationIsReusedAndSeparated(t *testing.T) {
	s := New()
	start := func(originID, text string) string {
		result := s.Handle(envelopeFor("StartConversation", map[string]any{
			"conversationType": "DM", "originType": "HOME", "originId": originID,
			"participantId": "proxy_ai", "firstMessage": text,
		}, ""))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("start home conversation: %+v", result.Error)
		}
		var view struct {
			ConversationID string `json:"conversationId"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		return view.ConversationID
	}
	firstID := start("home_old_client_1", "第一轮")
	secondID := start("proxy_ai_home", "第二轮")
	if firstID != secondID {
		t.Fatalf("Home Proxy AI must reuse one durable conversation: %s != %s", firstID, secondID)
	}
	messages, err := s.repository.Messages(context.Background(), firstID)
	if err != nil || len(messages) != 3 {
		t.Fatalf("expected first message + separator + second message: %+v err=%v", messages, err)
	}
	if messages[1].SenderID != "SYSTEM" || messages[1].Kind != "system_event" || messages[1].Body != "新的 Home 对话" {
		t.Fatalf("second Home exchange must have a durable divider: %+v", messages[1])
	}
}

func TestDirectMessageReusesLatestConversationForSameAccountPair(t *testing.T) {
	s := New()
	start := func(originType, originID string) string {
		result := s.Handle(envelopeFor("StartConversation", map[string]any{
			"conversationType": "DM", "originType": originType, "originId": originID,
			"participantId": "user_002", "firstMessage": "你好",
		}, ""))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("start DM: %+v", result.Error)
		}
		var view struct {
			ConversationID string `json:"conversationId"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		return view.ConversationID
	}
	first := start("PROFILE", "user_002")
	second := start("POST", "post_by_user_002")
	if first != second {
		t.Fatalf("same account pair must reuse one DM: %s != %s", first, second)
	}
}

func TestInboxCollapsesHistoricalDuplicateDMsByCounterparty(t *testing.T) {
	repo := NewMemoryRepository()
	now := time.Now().UTC()
	for index, at := range []time.Time{now.Add(-time.Hour), now} {
		conv := Conversation{ID: "duplicate_" + string(rune('a'+index)), Type: "DM", OriginType: "PROFILE", OriginID: "user_002", State: "ACTIVE", Participants: []string{"user_001", "user_002"}, CreatedAt: at, LastMessageAt: at}
		if err := repo.CreateConversation(context.Background(), conv); err != nil {
			t.Fatal(err)
		}
	}
	s := NewWithModelStack(repo, modelstack.Unconfigured{})
	result := s.Handle(envelopeFor("ListConversations", map[string]any{}, "user_001"))
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatal(err)
	}
	if len(view.Conversations) != 1 || view.Conversations[0].Conversation.ID != "duplicate_b" {
		t.Fatalf("want only newest DM for user_002, got %+v", view.Conversations)
	}
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

// CONTACT-CARD-001：对话里能发**名片**。
//
// 以前消息类型白名单里没有 CONTACT，客户端就算画出了「发名片」的入口，服务端
// 也会回 INVALID_MESSAGE_TYPE —— 又是一个「UI 有、服务端没有」的静默降级。
//
// 这里钉三件事：
//   1. CONTACT 能被接受（不是被白名单挡掉）；
//   2. 空名片必须被拒 —— 渲染侧认不出就不画卡，会变成一条无法解释的空白气泡；
//   3. 默认保护是**可转发**：名片的意义就是被转给第三个人，照抄 LOCATION
//      （1 次查看 / 1 小时）会让它自相矛盾。
func TestSendMessageContactCardIsAcceptedAndForwardable(t *testing.T) {
	s := New()
	created := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "PROFILE", "originId": "profile_card", "participantId": "user_card",
	}, ""))
	var createdView struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(created.OperationRef), &createdView)
	convID := createdView.ConversationID

	vcard := "BEGIN:VCARD\r\nVERSION:3.0\r\nN:晴晴;;;;\r\nFN:晴晴\r\nNICKNAME:@qingqing\r\nX-PROXY-HANDLE:qingqing\r\nEND:VCARD"
	sent := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "CONTACT", "body": vcard}, convID))
	if sent.Outcome != "ACCEPTED" {
		t.Fatalf("contact card message: got %s (%+v)", sent.Outcome, sent.Error)
	}

	empty := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "CONTACT", "body": "   "}, convID))
	if empty.Outcome == "ACCEPTED" {
		t.Fatal("empty contact card must be rejected — it renders as an unexplainable blank bubble")
	}

	listed := s.Handle(envelopeFor("ListConversationMessages", map[string]any{}, convID))
	if listed.Outcome != "ACCEPTED" {
		t.Fatalf("list messages: %s", listed.Outcome)
	}
	var listView struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal([]byte(listed.OperationRef), &listView)
	if len(listView.Messages) != 1 {
		t.Fatalf("want 1 message (the empty one rejected), got %d", len(listView.Messages))
	}
	got := listView.Messages[0]
	if got.MessageType != "CONTACT" {
		t.Fatalf("messageType = %q, want CONTACT", got.MessageType)
	}
	if got.Kind != "contact" {
		t.Fatalf("kind = %q, want contact — the client switches on kind to draw the card", got.Kind)
	}
	if !got.Protection.Forwardable {
		t.Fatal("a contact card must be forwardable by default: passing someone's card on is the whole point")
	}
	if got.Protection.ViewLimit != 0 {
		t.Fatalf("viewLimit = %d, want 0 (unlimited) — a card you may look at once is not a card", got.Protection.ViewLimit)
	}
	if got.Protection.ExpiresAt == nil {
		t.Fatal("a contact card must still expire (30d like every other message), not live forever")
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

func TestAudioMessageRequiresMediaAndPersists(t *testing.T) {
	s := New()
	started := s.Handle(envelopeFor("StartConversation", map[string]any{"conversationType": "DM", "originType": "PROFILE", "originId": "user_002", "participantId": "user_002"}, ""))
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal([]byte(started.OperationRef), &view); err != nil {
		t.Fatal(err)
	}
	missing := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "AUDIO", "body": "语音消息"}, view.ConversationID))
	if missing.Outcome != "REJECTED" {
		t.Fatalf("audio without media must fail: %+v", missing)
	}
	sent := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "AUDIO", "body": "语音消息", "mediaRef": "media_audio_1"}, view.ConversationID))
	if sent.Outcome != "ACCEPTED" {
		t.Fatalf("audio send: %+v", sent)
	}
	rows, err := s.repository.Messages(context.Background(), view.ConversationID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("audio history missing: %v", err)
	}
	last := rows[len(rows)-1]
	if last.MessageType != "AUDIO" || last.MediaRef != "media_audio_1" || last.Kind != "audio" {
		t.Fatalf("wrong audio record: %+v", last)
	}
}
// AI-CONV-001: 小美主页发消息必须端到端进消息模块。客户端曾传
// originType=AI_ASSISTANT，被服务端 validOrigins 拒（INVALID_ORIGIN_TYPE），
// 用户看到“已发起”了吗？没有——直接失败。现在固定用 PROFILE 来源。
// 本测试锁死：PROFILE + AI participant 建会话成功，且出现在发起人 inbox。
func TestXiaomeiDMProfileOriginAppearsInInbox(t *testing.T) {
	s := New()
	start := envelopeFor("StartConversation", map[string]any{
		"originType": "PROFILE", "originId": "ai_001", "participantId": "ai_001",
		"firstMessage": "你好小美，我想聊聊周末企划。",
	}, "")
	r := s.Handle(start)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("xiaomei DM start: got %s (%+v)", r.Outcome, r.Error)
	}
	list := s.Handle(envelopeFor("ListConversations", map[string]any{}, "user_001"))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list: %s (%+v)", list.Outcome, list.Error)
	}
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range view.Conversations {
		if c.CounterpartyID == "ai_001" {
			found = true
			if c.LatestMessage == nil || c.LatestMessage.Body == "" {
				t.Fatalf("xiaomei DM must carry the first message: %+v", c.LatestMessage)
			}
		}
	}
	if !found {
		t.Fatalf("xiaomei DM missing from inbox: %+v", view.Conversations)
	}
}

// ---------- GROUP-CREATE-001: 真·多人建群 ----------
//
// 以前 startConversation 只认单个 participantId，参与者恒为 {actor, participantId}
// 两个 —— 于是「群组」最多也就两个人。更糟的是 conversationType 由客户端直接给、
// 服务端从不校验，而 DefaultProtectionFor 对 GROUP 给出**更弱**的保护（可转发 /
// 可复制 / 不警告截屏）。两者合起来就是一条降级通道：任何人都能把一条 1:1 对话
// 声明成 GROUP，从而把对方消息的保护降级。
// 所以建群要真能建多人，同时把「两人 GROUP」这条路堵死。

func groupConversationID(t *testing.T, s *Service, result command.Result) string {
	t.Helper()
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start must be accepted: %+v", result.Error)
	}
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	if view.ConversationID == "" {
		t.Fatalf("no conversationId in operationRef: %s", result.OperationRef)
	}
	return view.ConversationID
}

func TestStartConversationCreatesGroupWithAllMembers(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "GROUP", "originType": "PROFILE", "originId": "grp_1",
		"participantIds": []string{"user_002", "user_003"}, "firstMessage": "大家好",
	}, ""))
	id := groupConversationID(t, s, result)
	conv, err := s.repository.GetConversation(context.Background(), id)
	if err != nil {
		t.Fatalf("missing conversation: %v", err)
	}
	if conv.Type != "GROUP" {
		t.Fatalf("expected GROUP, got %q", conv.Type)
	}
	if len(conv.Participants) != 3 {
		t.Fatalf("expected 3 participants (actor + 2), got %v", conv.Participants)
	}
	if conv.Participants[0] != "user_001" {
		t.Fatalf("the actor must always be a member, got %v", conv.Participants)
	}
}

func TestStartConversationRejectsTwoPersonGroup(t *testing.T) {
	// 两个人叫「GROUP」没有任何群组语义，只是把 DM 的保护降级 —— 必须拒绝。
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "GROUP", "originType": "PROFILE", "originId": "grp_2",
		"participantId": "user_002",
	}, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("two-person GROUP must be rejected (protection downgrade), got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "GROUP_REQUIRES_MULTIPLE_PARTICIPANTS" {
		t.Fatalf("expected GROUP_REQUIRES_MULTIPLE_PARTICIPANTS, got %+v", result.Error)
	}
}

func TestStartConversationRejectsUnknownConversationType(t *testing.T) {
	// conversationType 决定消息保护强度，绝不能由客户端任意取值。
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "TOTALLY_A_GROUP", "originType": "PROFILE", "originId": "grp_3",
		"participantIds": []string{"user_002", "user_003"},
	}, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("unknown conversationType must be rejected, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "INVALID_CONVERSATION_TYPE" {
		t.Fatalf("expected INVALID_CONVERSATION_TYPE, got %+v", result.Error)
	}
}

func TestStartConversationDedupesGroupParticipants(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "GROUP", "originType": "PROFILE", "originId": "grp_4",
		// 故意重复，并把本人也列进来 —— 结果应折叠成 3 人。
		"participantIds": []string{"user_002", "user_003", "user_002", "user_001"},
	}, ""))
	conv, _ := s.repository.GetConversation(context.Background(), groupConversationID(t, s, result))
	if len(conv.Participants) != 3 {
		t.Fatalf("duplicates and the actor must collapse to 3, got %v", conv.Participants)
	}
}

func TestStartConversationRejectsTooManyParticipants(t *testing.T) {
	s := New()
	tooMany := make([]string, 0, maxGroupParticipants+1)
	for i := 0; i <= maxGroupParticipants; i++ {
		tooMany = append(tooMany, "user_"+strconv.Itoa(10000+i))
	}
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "GROUP", "originType": "PROFILE", "originId": "grp_5",
		"participantIds": tooMany,
	}, ""))
	if result.Outcome != "REJECTED" {
		t.Fatalf("oversized group must be rejected, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "TOO_MANY_PARTICIPANTS" {
		t.Fatalf("expected TOO_MANY_PARTICIPANTS, got %+v", result.Error)
	}
}

func TestStartConversationStillAcceptsLegacySingleParticipant(t *testing.T) {
	// participantId（单数）是既有客户端的写法，必须继续能用，且仍是 2 人 DM。
	s := New()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "PROFILE", "originId": "profile_legacy", "participantId": "user_002", "firstMessage": "hi",
	}, ""))
	conv, _ := s.repository.GetConversation(context.Background(), groupConversationID(t, s, result))
	if conv.Type != "DM" || len(conv.Participants) != 2 {
		t.Fatalf("expected 2-person DM, got %s %v", conv.Type, conv.Participants)
	}
}

// ASSISTANT-THREAD-001: 助手入口再多（首页/任务/帖子），串只有一个；
// 收件箱只露最新的一行，身份永远是 proxy_ai / AI助手。
// ai_account_*（AI 小美等用户自选陪伴）与真人一样是「用户」，不受影响。
func TestAssistantConversationsUnifyIntoOneThread(t *testing.T) {
	s := New()
	start := func(originType, originID, participant, text string) string {
		result := s.Handle(envelopeFor("StartConversation", map[string]any{
			"conversationType": "DM", "originType": originType, "originId": originID,
			"participantId": participant, "firstMessage": text,
		}, ""))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("start %s/%s: %+v", originType, participant, result.Error)
		}
		var view struct {
			ConversationID string `json:"conversationId"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		return view.ConversationID
	}
	proxyID := start("HOME", "proxy_ai_home", "proxy_ai", "你好")
	taskID := start("TASK", "goal_1", "user_proxy_ai", "排个计划")
	if proxyID != taskID {
		t.Fatalf("assistant entries must reuse one thread: %s != %s", proxyID, taskID)
	}
	humanID := start("PROFILE", "user_9", "user_9", "你好")
	if humanID == proxyID {
		t.Fatalf("human DM must not merge into the assistant thread")
	}
	companionID := start("PROFILE", "ai_account_001", "ai_account_001", "嗨")
	if companionID == proxyID {
		t.Fatalf("companion chats are users, must not merge into the assistant thread")
	}

	result := s.Handle(envelopeFor("ListConversations", map[string]any{}, "user_001"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list conversations: %s", result.Outcome)
	}
	var view struct {
		Conversations []ConversationSummary `json:"conversations"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &view)
	assistantRows := 0
	for _, summary := range view.Conversations {
		if summary.CounterpartyID == "proxy_ai" {
			assistantRows++
			if summary.CounterpartySnapshot == nil || summary.CounterpartySnapshot.DisplayName != "AI助手" {
				t.Fatalf("assistant row identity = %+v, want proxy_ai/AI助手", summary.CounterpartySnapshot)
			}
		}
		if summary.CounterpartyID == "user_proxy_ai" {
			t.Fatalf("legacy assistant id must not surface in the inbox: %+v", summary.CounterpartyID)
		}
	}
	if assistantRows != 1 {
		t.Fatalf("want exactly 1 assistant row, got %d (total %d)", assistantRows, len(view.Conversations))
	}
	if len(view.Conversations) != 3 {
		t.Fatalf("want 3 rows (assistant + human + companion), got %d", len(view.Conversations))
	}
}

// CONVO-LIST-BLOCKED-001: 模型生成期间列表不能被堵住。
//
// 根因：HandleContext 对整条命令持有 s.mu，而 start/send 里的 generateAIReply
// 一次要几秒 —— 生成期间 ListConversations 也在排队，客户端列表一直"加载中"
// 直到 AI 回复出来。用一个门控 modelStack 复现：生成不放行，列表必须先返回。
type gateModelStack struct {
	release chan struct{}
}

func (gateModelStack) Available() bool { return true }

func (g gateModelStack) Complete(ctx context.Context, _ string, _ []modelstack.ChatMessage) (modelstack.Completion, error) {
	select {
	case <-g.release:
		return modelstack.Completion{Content: "好的"}, nil
	case <-ctx.Done():
		return modelstack.Completion{}, ctx.Err()
	}
}

func TestListConversationsNotBlockedByModelGeneration(t *testing.T) {
	s := NewWithModelStack(nil, gateModelStack{release: make(chan struct{})})
	startDone := make(chan command.Result, 1)
	go func() {
		startDone <- s.Handle(envelopeFor("StartConversation", map[string]any{
			"conversationType": "DM", "originType": "HOME", "originId": "proxy_ai_home",
			"participantId": "proxy_ai", "firstMessage": "你好",
		}, ""))
	}()
	// 给 start 一点时间走到模型调用里（内存仓极快，50ms 足够）。
	time.Sleep(50 * time.Millisecond)

	listDone := make(chan command.Result, 1)
	go func() {
		listDone <- s.Handle(envelopeFor("ListConversations", map[string]any{}, "user_001"))
	}()
	select {
	case result := <-listDone:
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("list during generation: %s", result.Outcome)
		}
		var view struct {
			Conversations []ConversationSummary `json:"conversations"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		if len(view.Conversations) != 1 {
			t.Fatalf("user message must already be listed while AI generates, got %d rows", len(view.Conversations))
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("ListConversations blocked behind model generation")
	}
}
