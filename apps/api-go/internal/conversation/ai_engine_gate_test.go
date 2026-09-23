package conversation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// AI-MANAGE-003：「对话管理 —— AI 怎么替你聊天」管的是**被代表的人**。
// 私聊真人时，决定 AI 要不要回、怎么回的是对面那个真人（owner）的设置，
// 不是发消息的人；跟 Proxy 助手的会话不受对话管理影响。
// 拒绝方向同时看 assistantStatus 和模型调用次数，避免"拦了但照样调模型"。

type recordingModelStack struct {
	calls   int
	prompts []string
}

func (m *recordingModelStack) Available() bool { return true }

func (m *recordingModelStack) Complete(_ context.Context, _ string, messages []modelstack.ChatMessage) (modelstack.Completion, error) {
	m.calls++
	if len(messages) > 0 {
		m.prompts = append(m.prompts, messages[0].Content)
	}
	return modelstack.Completion{
		Content:      "你好呀，TA 现在不在，我先替 TA 回你～",
		Model:        "test-model",
		Provider:     "test-provider",
		PromptTokens: 11,
		OutputTokens: 7,
	}, nil
}

type aiEngineView struct {
	ConversationID  string   `json:"conversationId"`
	MessageID       string   `json:"messageId"`
	AssistantStatus string   `json:"assistantStatus"`
	AIMessage       *Message `json:"aiMessage"`
	AIDraft         *Message `json:"aiDraft"`
}

func decodeAiEngineView(t *testing.T, raw string) aiEngineView {
	t.Helper()
	var view aiEngineView
	if err := json.Unmarshal([]byte(raw), &view); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return view
}

// user_001（actor）私信真人 user_002（owner）。
func dmHuman(t *testing.T, s *Service) aiEngineView {
	t.Helper()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"conversationType": "DM", "originType": "PROFILE", "originId": "user_002", "participantId": "user_002",
		"firstMessage": "嗨，你好呀",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start DM: %s %+v", result.Outcome, result.Error)
	}
	return decodeAiEngineView(t, result.OperationRef)
}

func sendIn(t *testing.T, s *Service, convID string, body string) aiEngineView {
	t.Helper()
	result := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": body}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send: %s %+v", result.Outcome, result.Error)
	}
	return decodeAiEngineView(t, result.OperationRef)
}

func startAssistantThread(t *testing.T, s *Service) aiEngineView {
	t.Helper()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "HOME", "originId": "home_ai_manage", "participantId": "proxy_ai",
		"firstMessage": "帮我安排周三河内的咖啡局",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start assistant: %s %+v", result.Outcome, result.Error)
	}
	return decodeAiEngineView(t, result.OperationRef)
}

// stateByUser 让每个用户有自己的设置，并记录会话侧问过谁。
func stateByUser(states map[string]AiEngineChatState, asked *[]string) AiEngineChatStateReader {
	return func(_ context.Context, userID string) (AiEngineChatState, error) {
		*asked = append(*asked, userID)
		return states[userID], nil
	}
}

func TestStandInReadsTheRecipientsSettingsNotTheSenders(t *testing.T) {
	model := &recordingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	var asked []string
	// 发消息的人（user_001）把自己暂停了 —— 这不该影响别人私信里的代回复；
	// 收消息的 user_002 是全自动，所以要替 user_002 回。
	s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{
		"user_001": {Paused: true, ChatPermission: "off"},
		"user_002": {ChatPermission: "auto"},
	}, &asked))

	opened := dmHuman(t, s)
	if opened.AssistantStatus != "RESPONDED" || opened.AIMessage == nil {
		t.Fatalf("recipient on auto must get a stand-in reply, got %q", opened.AssistantStatus)
	}
	for _, id := range asked {
		if id != "user_002" {
			t.Fatalf("stand-in must only consult the represented person, also asked %q", id)
		}
	}
	if len(asked) == 0 {
		t.Fatal("stand-in must consult the represented person's settings")
	}
}

func TestStandInHonoursRecipientPauseOffAndConfirmBeforeTheModel(t *testing.T) {
	for _, tc := range []struct {
		state  AiEngineChatState
		status string
	}{
		{AiEngineChatState{Paused: true, ChatPermission: "auto"}, "PAUSED"},
		{AiEngineChatState{ChatPermission: "off"}, "OFF"},
		{AiEngineChatState{ChatPermission: "confirm"}, "AWAITING_OWNER"},
	} {
		model := &recordingModelStack{}
		repo := NewMemoryRepository()
		s := NewWithModelStack(repo, model)
		var asked []string
		s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{"user_002": tc.state}, &asked))

		opened := dmHuman(t, s)
		sent := sendIn(t, s, opened.ConversationID, "在吗？")
		for _, view := range []aiEngineView{opened, sent} {
			if view.AssistantStatus != tc.status {
				t.Fatalf("state %+v must report %s, got %q", tc.state, tc.status, view.AssistantStatus)
			}
			if view.AIMessage != nil || view.AIDraft != nil {
				t.Fatalf("state %+v must not answer the sender (no reply, no draft leaked to them): %+v %+v", tc.state, view.AIMessage, view.AIDraft)
			}
		}
		if model.calls != 0 {
			t.Fatalf("state %+v must block before the model is called, got %d", tc.state, model.calls)
		}
		messages, _ := repo.Messages(context.Background(), opened.ConversationID)
		for _, m := range messages {
			if m.SenderID != "user_001" {
				t.Fatalf("state %+v: only the sender's own messages may be in the thread, found %q", tc.state, m.SenderID)
			}
		}
	}
}

func TestStandInAutoUsesTheOwnersStyleAndMetersTheOwner(t *testing.T) {
	model := &recordingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	var asked []string
	s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{
		"user_002": {ChatPermission: "auto", Tone: "lively", ReplyLength: "xshort", Emoji: "never", OwnerName: "Linh", OwnerBio: "胶片 / 街拍"},
	}, &asked))
	var meteredUser string
	s.SetTokenMeter(func(_ context.Context, userID string, _, _ int) { meteredUser = userID })

	opened := dmHuman(t, s)
	if opened.AIMessage == nil {
		t.Fatalf("auto must reply, got %q", opened.AssistantStatus)
	}
	if len(model.prompts) == 0 {
		t.Fatal("model must be called with a system prompt")
	}
	prompt := model.prompts[len(model.prompts)-1]
	if strings.Contains(prompt, "需求构建助手") {
		t.Fatalf("a stand-in reply must not use the demand-assistant persona: %s", prompt)
	}
	// AI-MANAGE-008：代回复 = 以真人本人身份、第一人称说话，带本人名字和简介。
	for _, want := range []string{"「Linh」本人", "第一人称", "胶片 / 街拍", "活泼", "不超过 15 个字", "不要使用 emoji", "我确认一下再回你"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("stand-in prompt must carry %q: %s", want, prompt)
		}
	}
	if strings.Contains(prompt, "助手") && !strings.Contains(prompt, "不要说自己是助手") {
		t.Fatalf("a stand-in speaks as the person, not as an assistant: %s", prompt)
	}
	if opened.AIMessage.SenderID != "user_002" || opened.AIMessage.AuthoredBy != "ai_stand_in" {
		t.Fatalf("a stand-in reply is sent as the represented person and marked AI-authored: sender=%q authoredBy=%q", opened.AIMessage.SenderID, opened.AIMessage.AuthoredBy)
	}
	if meteredUser != "user_002" {
		t.Fatalf("tokens of a stand-in reply belong to the represented person, metered %q", meteredUser)
	}
}

func TestAssistantThreadIsNotGovernedByChatManagement(t *testing.T) {
	// 跟 Proxy 助手聊天不是「替谁聊天」：自己暂停了 AI 管理，也照样能问助手。
	model := &recordingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	var asked []string
	s.SetAiEngineChatStateReader(stateByUser(map[string]AiEngineChatState{
		"user_001": {Paused: true, ChatPermission: "off"},
	}, &asked))
	var meteredUser string
	s.SetTokenMeter(func(_ context.Context, userID string, _, _ int) { meteredUser = userID })

	opened := startAssistantThread(t, s)
	if opened.AssistantStatus != "RESPONDED" || model.calls == 0 {
		t.Fatalf("assistant thread must still answer, got %q (calls=%d)", opened.AssistantStatus, model.calls)
	}
	if len(asked) != 0 {
		t.Fatalf("assistant thread must not consult AI management at all, asked %v", asked)
	}
	if meteredUser != "user_001" {
		t.Fatalf("the actor's own assistant usage is metered to the actor, got %q", meteredUser)
	}
}

func TestStandInUnwiredReaderKeepsReplying(t *testing.T) {
	// 没接 = 不拦（fail-open）：避免"没接线"和"故意关掉"无法区分。
	model := &recordingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	opened := dmHuman(t, s)
	if opened.AssistantStatus != "RESPONDED" || model.calls == 0 {
		t.Fatalf("unwired reader must keep the stand-in alive, got %q", opened.AssistantStatus)
	}
}
