package conversation

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(commandType string, payload map[string]any, targetID string) command.Envelope {
	return command.Envelope{
		CommandID:       "cmd_test_1",
		CommandType:     commandType,
		CommandVersion:  1,
		Actor:           command.Actor{Type: "USER", ID: "user_001"},
		Principal:       command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:          command.Target{Type: "Conversation", ID: targetID},
		IdempotencyKey:  "test_key_123456",
		AuthContext:     map[string]any{"session": "s1"},
		Purpose:         "test",
		CorrelationID:   "corr_1",
		RequestedAt:     "2026-08-16T00:00:00Z",
		Payload:         payload,
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

func TestSendMessageAndList(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "NEED", "originId": "need_1", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct{ ConversationID string `json:"conversationId"` }
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

// Gate D：普通消息不创建 Need；Need Draft → 用户确认 → 正式 Need。
func TestNeedDraftExplicitConfirm(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "POST", "originId": "post_1", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct{ ConversationID string `json:"conversationId"` }
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
	var view struct{ ConversationID string `json:"conversationId"` }
	_ = json.Unmarshal([]byte(r.OperationRef), &view)

	e2 := envelopeFor("SendMessage", map[string]any{"body": "闯入"}, view.ConversationID)
	e2.Actor = command.Actor{Type: "USER", ID: "user_evil"}
	r2 := s.Handle(e2)
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "NOT_CONVERSATION_PARTICIPANT" {
		t.Fatalf("want NOT_PARTICIPANT, got %s/%+v", r2.Outcome, r2.Error)
	}
}
