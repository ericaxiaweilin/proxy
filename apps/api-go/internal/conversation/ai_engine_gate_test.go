package conversation

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// AI-MANAGE-002：暂停 / 对话权限必须在服务端拦在模型调用之前。
// 与 companion_gate 同款：拒绝方向同时看 assistantStatus 和模型调用次数，
// 避免"拦了但照样调模型"。

type countingModelStack struct {
	calls int
}

func (m *countingModelStack) Available() bool { return true }

func (m *countingModelStack) Complete(_ context.Context, _ string, _ []modelstack.ChatMessage) (modelstack.Completion, error) {
	m.calls++
	return modelstack.Completion{
		Content:      "草稿或回复",
		Model:        "test-model",
		Provider:     "test-provider",
		PromptTokens: 11,
		OutputTokens: 7,
	}, nil
}

type aiEngineStartView struct {
	ConversationID  string   `json:"conversationId"`
	AssistantStatus string   `json:"assistantStatus"`
	AIMessage       *Message `json:"aiMessage"`
	AIDraft         *Message `json:"aiDraft"`
}

type aiEngineSendView struct {
	MessageID       string   `json:"messageId"`
	AssistantStatus string   `json:"assistantStatus"`
	AIMessage       *Message `json:"aiMessage"`
	AIDraft         *Message `json:"aiDraft"`
}

func startHomeWithFirstMessage(t *testing.T, s *Service) aiEngineStartView {
	t.Helper()
	result := s.Handle(envelopeFor("StartConversation", map[string]any{
		"originType": "HOME", "originId": "home_ai_manage", "participantId": "proxy_ai",
		"firstMessage": "帮我安排周三河内的咖啡局",
	}, "new"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("start: got %s (%+v)", result.Outcome, result.Error)
	}
	var view aiEngineStartView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode start: %v", err)
	}
	return view
}

func sendHomeMessage(t *testing.T, s *Service, convID string) aiEngineSendView {
	t.Helper()
	result := s.Handle(envelopeFor("SendMessage", map[string]any{
		"messageType": "TEXT", "body": "预算 50 万盾，两个人",
	}, convID))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("send: got %s (%+v)", result.Outcome, result.Error)
	}
	var view aiEngineSendView
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("decode send: %v", err)
	}
	return view
}

func TestAiEnginePauseBlocksStartAndSendBeforeModelCall(t *testing.T) {
	model := &countingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetAiEngineChatStateReader(func(context.Context, string) (AiEngineChatState, error) {
		return AiEngineChatState{Paused: true, ChatPermission: "auto"}, nil
	})

	opened := startHomeWithFirstMessage(t, s)
	if opened.AssistantStatus != "PAUSED" {
		t.Fatalf("paused start must report PAUSED, got %q", opened.AssistantStatus)
	}
	if opened.AIMessage != nil {
		t.Fatalf("paused start must not produce an AI message: %+v", opened.AIMessage)
	}
	sent := sendHomeMessage(t, s, opened.ConversationID)
	if sent.AssistantStatus != "PAUSED" {
		t.Fatalf("paused send must report PAUSED, got %q", sent.AssistantStatus)
	}
	if sent.AIMessage != nil {
		t.Fatalf("paused send must not produce an AI reply: %+v", sent.AIMessage)
	}
	if model.calls != 0 {
		t.Fatalf("pause must block before the model is called, got %d calls", model.calls)
	}
}

func TestAiEngineChatPermissionOffBlocksGeneration(t *testing.T) {
	model := &countingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetAiEngineChatStateReader(func(context.Context, string) (AiEngineChatState, error) {
		return AiEngineChatState{Paused: false, ChatPermission: "off"}, nil
	})
	opened := startHomeWithFirstMessage(t, s)
	if opened.AssistantStatus != "OFF" {
		t.Fatalf("off permission must report OFF, got %q", opened.AssistantStatus)
	}
	if model.calls != 0 {
		t.Fatalf("off permission must block before the model is called, got %d", model.calls)
	}
}

func TestAiEngineConfirmPermissionReturnsDraftWithoutPersisting(t *testing.T) {
	model := &countingModelStack{}
	repo := NewMemoryRepository()
	s := NewWithModelStack(repo, model)
	s.SetAiEngineChatStateReader(func(context.Context, string) (AiEngineChatState, error) {
		return AiEngineChatState{Paused: false, ChatPermission: "confirm"}, nil
	})

	opened := startHomeWithFirstMessage(t, s)
	if opened.AssistantStatus != "DRAFT" {
		// 首条引导也走确认：草稿不落库，assistantStatus=DRAFT。
		t.Fatalf("confirm permission must draft the opening, got %q", opened.AssistantStatus)
	}
	if opened.AIMessage != nil {
		t.Fatalf("confirm permission must not persist the opening message: %+v", opened.AIMessage)
	}
	sent := sendHomeMessage(t, s, opened.ConversationID)
	if sent.AssistantStatus != "DRAFT" {
		t.Fatalf("confirm permission must report DRAFT, got %q", sent.AssistantStatus)
	}
	if sent.AIDraft == nil || sent.AIDraft.Body == "" {
		t.Fatalf("confirm permission must return an aiDraft: %+v", sent.AIDraft)
	}
	if sent.AIMessage != nil {
		t.Fatalf("confirm permission must not persist aiMessage: %+v", sent.AIMessage)
	}
	messages, err := repo.Messages(context.Background(), opened.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range messages {
		if m.SenderID == "proxy_ai" && m.Body == "草稿或回复" {
			t.Fatalf("draft must not be appended to the thread: %+v", m)
		}
	}
	if model.calls == 0 {
		t.Fatal("confirm permission must still reach the model to draft")
	}
}

func TestAiEngineAutoPermissionPersistsReplyAndMetersTokens(t *testing.T) {
	model := &countingModelStack{}
	var meteredPrompt, meteredOutput int
	var meteredUser string
	s := NewWithModelStack(NewMemoryRepository(), model)
	s.SetAiEngineChatStateReader(func(context.Context, string) (AiEngineChatState, error) {
		return AiEngineChatState{Paused: false, ChatPermission: "auto"}, nil
	})
	s.SetTokenMeter(func(_ context.Context, userID string, prompt, output int) {
		meteredUser = userID
		meteredPrompt += prompt
		meteredOutput += output
	})

	opened := startHomeWithFirstMessage(t, s)
	sent := sendHomeMessage(t, s, opened.ConversationID)
	if sent.AssistantStatus != "RESPONDED" || sent.AIMessage == nil {
		t.Fatalf("auto permission must persist a reply, got status=%q draft=%+v", sent.AssistantStatus, sent.AIDraft)
	}
	if model.calls == 0 {
		t.Fatal("auto permission must reach the model")
	}
	if meteredUser != "user_001" || meteredPrompt == 0 || meteredOutput == 0 {
		t.Fatalf("successful inference must meter tokens for the actor: user=%q prompt=%d output=%d", meteredUser, meteredPrompt, meteredOutput)
	}
}

func TestAiEngineUnwiredStateReaderDoesNotBlock(t *testing.T) {
	// 没接 = 不拦：fail-open 与 companionGate 的 fail-closed 相反，
	// 避免"没接线"和"故意关掉"在行为上无法区分（见 ai_engine_gate.go）。
	model := &countingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)
	opened := startHomeWithFirstMessage(t, s)
	if opened.AssistantStatus != "RESPONDED" {
		t.Fatalf("unwired reader must keep AI alive, got %q", opened.AssistantStatus)
	}
	if model.calls == 0 {
		t.Fatal("unwired reader must still reach the model")
	}
}
