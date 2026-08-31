package activity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func activityEnvelope(kind, actor, activityID string) command.Envelope {
	return command.Envelope{
		CommandID: kind + "_1", CommandType: kind, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "Activity", ID: activityID}, IdempotencyKey: kind + "_" + actor,
		CorrelationID: "corr", RequestedAt: "2026-08-30T00:00:00Z", Payload: map[string]any{"activityId": activityID},
	}
}

func TestActivityInterestAndJoinAreRepositoryFacts(t *testing.T) {
	s := New()
	s.SeedDefaults()
	id := "user_photo_buddy"

	toggled := s.HandleContext(t.Context(), activityEnvelope("ToggleActivityInterest", "user_a", id))
	if toggled.Outcome != "ACCEPTED" {
		t.Fatalf("toggle interest: %+v", toggled)
	}
	var toggleBody struct {
		Activity   Activity `json:"activity"`
		Interested bool     `json:"interested"`
	}
	if err := json.Unmarshal([]byte(toggled.OperationRef), &toggleBody); err != nil {
		t.Fatal(err)
	}
	if !toggleBody.Interested || toggleBody.Activity.Interested != 6 {
		t.Fatalf("unexpected interest state: %+v", toggleBody)
	}

	joined := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if joined.Outcome != "ACCEPTED" {
		t.Fatalf("join: %+v", joined)
	}
	repeated := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_a", id))
	if repeated.Outcome != "REJECTED" || repeated.Error == nil || repeated.Error.ErrorCode != "ACTIVITY_ALREADY_JOINED" {
		t.Fatalf("duplicate join was not rejected: %+v", repeated)
	}

	full := s.HandleContext(t.Context(), activityEnvelope("JoinActivity", "user_b", id))
	if full.Outcome != "REJECTED" || full.Error == nil || full.Error.ErrorCode != "ACTIVITY_FULL" {
		t.Fatalf("capacity was not enforced: %+v", full)
	}
}
