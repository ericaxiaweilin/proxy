package activity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func forYouJoin(actor, activityID, companionID string) command.Envelope {
	e := activityEnvelope("JoinActivity", actor, activityID)
	e.IdempotencyKey = "join_" + actor + "_" + companionID
	e.Payload = map[string]any{"activityId": activityID, "recipe": map[string]any{
		"source": "FOR_YOU", "companion": map[string]any{"id": companionID, "name": companionID},
	}}
	return e
}

// FOR-YOU-SLOT-001：命令层口径 —— 资源单位是「小美 × 时段」。
func TestForYouOrdersLockTheCompanionTimeSlot(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy" // capacity 2：For You 单不受它限制

	for _, companion := range []string{"alice", "bob", "carol"} {
		if got := s.HandleContext(t.Context(), forYouJoin("me", id, companion)); got.Outcome != "ACCEPTED" {
			t.Fatalf("me + %s at the same slot is its own order (no requester time clash, no capacity cap): %+v", companion, got)
		}
	}
	again := s.HandleContext(t.Context(), forYouJoin("me", id, "alice"))
	if again.Error == nil || again.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" {
		t.Fatalf("same (activity, me, alice) again must be ACTIVITY_ALREADY_JOINED: %+v", again)
	}
	taken := s.HandleContext(t.Context(), forYouJoin("someone_else", id, "alice"))
	if taken.Error == nil || taken.Error.ErrorCode != "COMPANION_SLOT_TAKEN" {
		t.Fatalf("alice's slot is taken for everyone else: %+v", taken)
	}

	list := activityEnvelope("ListCompanionBookedSlots", "someone_else", "mine")
	list.Payload = map[string]any{"companionIds": []any{"alice", "dave"}}
	out := s.HandleContext(t.Context(), list)
	if out.Outcome != "ACCEPTED" {
		t.Fatalf("list booked slots: %+v", out)
	}
	var body struct {
		Slots []CompanionSlot `json:"slots"`
	}
	if err := json.Unmarshal([]byte(out.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Slots) != 1 || body.Slots[0].CompanionID != "alice" || body.Slots[0].Time == "" {
		t.Fatalf("only alice is booked, and only her slot is returned (not who booked): %+v", body.Slots)
	}

	cancel := activityEnvelope("CancelActivity", "me", id)
	cancel.Payload = map[string]any{"activityId": id, "companionId": "alice"}
	if got := s.HandleContext(t.Context(), cancel); got.Outcome != "ACCEPTED" {
		t.Fatalf("cancel the alice order: %+v", got)
	}
	if got := s.HandleContext(t.Context(), forYouJoin("someone_else", id, "alice")); got.Outcome != "ACCEPTED" {
		t.Fatalf("after the cancel alice's slot is free again: %+v", got)
	}
}
