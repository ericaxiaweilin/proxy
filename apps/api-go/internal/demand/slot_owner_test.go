package demand

import (
	"context"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// ORDER-SLOT-OWNER-001：只有已提交任务的主人能对其开放档位发报价。
func TestTaskSlotOwnedBy(t *testing.T) {
	allow := func(*TaskDraft, command.Envelope) GateDecision { return GateDecision{Status: "ALLOW"} }
	service := New(allow, allow)
	draftID := completeDraft(t, service)
	if r := service.Handle(demandEnvelope("PublishTask", map[string]any{"expectedVersion": 2, "online": true}, command.Target{Type: "TaskDraft", ID: draftID})); r.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %#v", r)
	}
	draft := service.Snapshot()[0]
	owner, slotID := draft.OwnerUserAccountID, draft.Slots[0].ID
	ctx := context.Background()
	cases := []struct {
		task, slot, user string
		want             bool
	}{
		{draftID, slotID, owner, true},
		{draftID, slotID, "stranger", false},
		{draftID, "slot_missing", owner, false},
		{"task_missing", slotID, owner, false},
	}
	for _, c := range cases {
		got, err := service.TaskSlotOwnedBy(ctx, c.task, c.slot, c.user)
		if err != nil || got != c.want {
			t.Fatalf("TaskSlotOwnedBy(%q,%q,%q) = %v, %v; want %v", c.task, c.slot, c.user, got, err, c.want)
		}
	}
}
