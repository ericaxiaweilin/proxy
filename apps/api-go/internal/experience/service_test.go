package experience

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeForExperience(contextName string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_experience_001",
		CommandType:    CommandGetExperienceManifest,
		CommandVersion: 1,
		Actor: command.Actor{
			Type: "USER",
			ID:   "user_001",
		},
		Principal: command.Principal{
			Type: "USER",
			ID:   "user_001",
		},
		Target: command.Target{
			Type: "ExperienceManifest",
			ID:   contextName,
		},
		IdempotencyKey: "idem_experience_001",
		AuthContext:    map[string]any{"role": "USER"},
		Purpose:        "experience_manifest",
		CorrelationID:  "corr_experience_001",
		RequestedAt:    "2026-08-17T14:00:00Z",
		Payload: map[string]any{
			"context": contextName,
		},
	}
}

func TestRequesterManifest(t *testing.T) {
	service := New()

	result := service.Handle(envelopeForExperience("REQUESTER"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", result.Outcome, result.Error)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("manifest operationRef is not JSON: %v", err)
	}

	if payload["schemaVersion"] != "1.0" {
		t.Fatalf("unexpected schemaVersion: %+v", payload["schemaVersion"])
	}

	if payload["context"] != "REQUESTER" {
		t.Fatalf("unexpected context: %+v", payload["context"])
	}

	me, ok := payload["me"].(map[string]any)
	if !ok {
		t.Fatalf("missing me payload")
	}

	sections, ok := me["sections"].([]any)
	if !ok || len(sections) != 4 {
		t.Fatalf("expected four server-composed Me sections, got %+v", me["sections"])
	}

	if me["mode"] != "REPLACE" {
		t.Fatalf("expected REPLACE mode, got %+v", me["mode"])
	}

	var typed manifest
	if err := json.Unmarshal([]byte(result.OperationRef), &typed); err != nil {
		t.Fatalf("manifest did not decode to typed payload: %v", err)
	}
	if got := typed.Me.Sections[0].Items[0].Icon; got != "profile-ring" {
		t.Fatalf("homepage icon drifted from Module Logo Master: %q", got)
	}
	if got := typed.Me.Sections[1].Items[0].Icon; got != "target" {
		t.Fatalf("friend relationship icon drifted from Module Logo Master: %q", got)
	}
}

func TestRejectsUnknownContext(t *testing.T) {
	service := New()

	result := service.Handle(envelopeForExperience("ADMIN"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", result.Outcome)
	}

	if result.Error == nil || result.Error.ErrorCode != "INVALID_EXPERIENCE_CONTEXT" {
		t.Fatalf("unexpected error: %+v", result.Error)
	}
}
