package event

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestNewCreatesSharedContractShape(t *testing.T) {
	e := New("TaskDraftCreated", "TaskDraft", "draft_1", 1, "org_1", "corr_1", "cmd_1", time.Now(), map[string]any{"sourceInput": "brief"})
	if e.EventID == "" || !strings.Contains(e.EventID, "-") {
		t.Fatalf("expected UUID-shaped event id, got %q", e.EventID)
	}
	if e.EventType != "TaskDraftCreated" || e.AggregateType != "TaskDraft" || e.AggregateVersion != 1 {
		t.Fatalf("unexpected event: %#v", e)
	}
}

func TestMemoryPublisherCopiesEvents(t *testing.T) {
	publisher := NewMemoryPublisher()
	e := New("TaskDraftUpdated", "TaskDraft", "draft_1", 2, "org_1", "corr_1", "cmd_1", time.Now(), map[string]any{"field": "before"})
	if err := publisher.Publish(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	e.Payload["field"] = "after"
	got := publisher.Events()
	if len(got) != 1 || got[0].Payload["field"] != "before" {
		t.Fatalf("publisher did not copy event payload: %#v", got)
	}
}
