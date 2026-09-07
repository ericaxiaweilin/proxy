package conversation

import (
	"encoding/json"
	"fmt"
	"testing"
)

// PERF-001: list-history payloads are capped so unbounded conversations
// cannot degrade serialization or device memory. The tail is kept and
// the response flags truncation for future "view earlier" flows.
func TestListMessagesCapsHistoryAt200(t *testing.T) {
	s := New()
	e := envelopeFor("StartConversation", map[string]any{
		"originType": "NEED", "originId": "need_cap", "participantId": "agent_linh",
	}, "")
	r := s.Handle(e)
	var view struct {
		ConversationID string `json:"conversationId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	convID := view.ConversationID
	for i := 0; i < 205; i++ {
		ri := s.Handle(envelopeFor("SendMessage", map[string]any{
			"messageType": "TEXT", "body": fmt.Sprintf("msg %d", i),
		}, convID))
		if ri.Outcome != "ACCEPTED" {
			t.Fatalf("send %d: got %s (%+v)", i, ri.Outcome, ri.Error)
		}
	}
	listed := s.Handle(envelopeFor("ListConversationMessages", map[string]any{}, convID))
	var listView struct {
		Messages  []Message `json:"messages"`
		Truncated bool      `json:"truncated"`
	}
	_ = json.Unmarshal([]byte(listed.OperationRef), &listView)
	if len(listView.Messages) != 200 {
		t.Fatalf("want capped 200 messages, got %d", len(listView.Messages))
	}
	if !listView.Truncated {
		t.Fatal("expected truncated=true when history exceeds the cap")
	}
	last, _ := json.Marshal(listView.Messages[len(listView.Messages)-1])
	var lastBody struct {
		Body string `json:"body"`
	}
	_ = json.Unmarshal(last, &lastBody)
	if lastBody.Body != "msg 204" {
		t.Fatalf("tail must keep newest message, got %q", lastBody.Body)
	}
}
