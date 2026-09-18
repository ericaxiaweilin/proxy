package conversation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// QUOTE-REPLY-001: 引用回复端到端 —— 发消息可带 replyToMessageId，落库、
// 列表透出、AI 上下文都得跟上；不存在的引用和跨会话引用直接拒绝。
func TestQuoteReplyPersistsResolvesAndGuards(t *testing.T) {
	model := &capturingModelStack{}
	s := NewWithModelStack(NewMemoryRepository(), model)

	start := func(originID, peer string) string {
		result := s.Handle(envelopeFor("StartConversation", map[string]any{
			"conversationType": "DM", "originType": "PROFILE", "originId": originID, "participantId": peer,
		}, ""))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("start conversation: %+v", result.Error)
		}
		var view struct {
			ConversationID string `json:"conversationId"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		if view.ConversationID == "" {
			t.Fatalf("start conversation returned no id: %+v", result.OperationRef)
		}
		return view.ConversationID
	}
	send := func(convID string, payload map[string]any) string {
		result := s.Handle(envelopeFor("SendMessage", payload, convID))
		if result.Outcome != "ACCEPTED" {
			return ""
		}
		var view struct {
			MessageID string `json:"messageId"`
		}
		_ = json.Unmarshal([]byte(result.OperationRef), &view)
		return view.MessageID
	}

	convID := start("user_002", "user_002")
	idA := send(convID, map[string]any{"messageType": "TEXT", "body": "这家多少钱"})
	if idA == "" {
		t.Fatal("first message returned no id")
	}

	// 引用存在的本会话消息：接受 + 落库 + 列表透出。
	idB := send(convID, map[string]any{"messageType": "TEXT", "body": "就这个呢", "replyToMessageId": idA})
	if idB == "" {
		t.Fatal("quoting send was not accepted")
	}
	stored, err := s.repository.Messages(context.Background(), convID)
	if err != nil {
		t.Fatal(err)
	}
	var foundB *Message
	for i := range stored {
		if stored[i].ID == idB {
			foundB = &stored[i]
		}
	}
	if foundB == nil || foundB.ReplyTo == nil || *foundB.ReplyTo != idA {
		t.Fatalf("quoting message must persist replyTo=%s: %+v", idA, foundB)
	}
	listed := s.Handle(envelopeFor("ListConversationMessages", map[string]any{}, convID))
	var listView struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal([]byte(listed.OperationRef), &listView)
	listedOK := false
	for _, m := range listView.Messages {
		if m.ID == idB && m.ReplyTo != nil && *m.ReplyTo == idA {
			listedOK = true
		}
	}
	if !listedOK {
		t.Fatalf("list must carry replyTo for the quoting message: %+v", listView.Messages)
	}
	// AI 必须知道用户在针对哪条说话：新一轮 system prompt 里要有被引原文。
	// （capturing 每次整体覆盖，断言时直接看最后一次调用的 system 位。）
	aiSawQuote := false
	if len(model.messages) > 0 && model.messages[0].Role == "system" &&
		strings.Contains(model.messages[0].Content, "这家多少钱") &&
		strings.Contains(model.messages[0].Content, "被引用的内容作答") {
		aiSawQuote = true
	}
	if !aiSawQuote {
		t.Fatalf("model never saw the quoted message: %+v", model.messages)
	}

	// 引用不存在的消息：拒绝。
	bad := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "?", "replyToMessageId": "msg_nope"}, convID))
	if bad.Outcome != "REJECTED" || bad.Error.ErrorCode != "REPLY_TARGET_NOT_FOUND" {
		t.Fatalf("want REPLY_TARGET_NOT_FOUND, got %s/%+v", bad.Outcome, bad.Error)
	}
	// 引用别的会话的消息：拒绝（跨会话带内容 = 越权读）。
	otherID := start("user_003", "user_003")
	idOther := send(otherID, map[string]any{"messageType": "TEXT", "body": "别处的话"})
	foreign := s.Handle(envelopeFor("SendMessage", map[string]any{"messageType": "TEXT", "body": "?", "replyToMessageId": idOther}, convID))
	if foreign.Outcome != "REJECTED" || foreign.Error.ErrorCode != "REPLY_TARGET_FOREIGN" {
		t.Fatalf("want REPLY_TARGET_FOREIGN, got %s/%+v", foreign.Outcome, foreign.Error)
	}
}
