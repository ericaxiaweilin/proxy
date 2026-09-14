package api

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// envelopeWithTargetID builds a structurally complete envelope whose only
// variable is the target id, so a failure can only come from that field.
func envelopeWithTargetID(targetID string) command.Envelope {
	return command.Envelope{
		CommandID:      "command_1",
		CommandType:    "ListPostsByIds",
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_1"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_1"},
		Target:         command.Target{Type: "Post", ID: targetID},
		IdempotencyKey: "idempotency_key_1",
		AuthContext:    map[string]any{},
		Purpose:        "localnet_feed",
		CorrelationID:  "correlation_1",
		RequestedAt:    "2026-09-13T12:00:00Z",
		Payload:        map[string]any{"postIds": []string{"post_1"}},
	}
}

// TestMissingEnvelopeFieldNamesTheEmptyTargetID is the regression for a real
// escape: the saved-posts client sent target.id = "" and every read was
// rejected before dispatch, with no way to tell which field was wrong.
func TestMissingEnvelopeFieldNamesTheEmptyTargetID(t *testing.T) {
	if got := missingEnvelopeField(envelopeWithTargetID("")); got != "target.id" {
		t.Fatalf("missingEnvelopeField(empty target id) = %q, want %q", got, "target.id")
	}
}

func TestMissingEnvelopeFieldAcceptsACompleteEnvelope(t *testing.T) {
	if got := missingEnvelopeField(envelopeWithTargetID("by_ids")); got != "" {
		t.Fatalf("missingEnvelopeField(complete envelope) = %q, want empty", got)
	}
}

// TestMissingEnvelopeFieldNamesEachRequiredField walks every required field so
// a future field addition that is checked but not named cannot slip through.
func TestMissingEnvelopeFieldNamesEachRequiredField(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*command.Envelope)
		want   string
	}{
		{"commandId", func(e *command.Envelope) { e.CommandID = "" }, "commandId"},
		{"commandType", func(e *command.Envelope) { e.CommandType = "" }, "commandType"},
		{"commandVersion", func(e *command.Envelope) { e.CommandVersion = 0 }, "commandVersion"},
		{"actor.type", func(e *command.Envelope) { e.Actor.Type = "" }, "actor.type"},
		{"actor.id", func(e *command.Envelope) { e.Actor.ID = "" }, "actor.id"},
		{"principal.type", func(e *command.Envelope) { e.Principal.Type = "" }, "principal.type"},
		{"principal.id", func(e *command.Envelope) { e.Principal.ID = "" }, "principal.id"},
		{"target.type", func(e *command.Envelope) { e.Target.Type = "" }, "target.type"},
		{"target.id", func(e *command.Envelope) { e.Target.ID = "" }, "target.id"},
		{"idempotencyKey", func(e *command.Envelope) { e.IdempotencyKey = "short" }, "idempotencyKey"},
		{"authContext", func(e *command.Envelope) { e.AuthContext = nil }, "authContext"},
		{"purpose", func(e *command.Envelope) { e.Purpose = "" }, "purpose"},
		{"correlationId", func(e *command.Envelope) { e.CorrelationID = "" }, "correlationId"},
		{"requestedAt", func(e *command.Envelope) { e.RequestedAt = "" }, "requestedAt"},
		{"payload", func(e *command.Envelope) { e.Payload = nil }, "payload"},
	}
	for _, tc := range cases {
		envelope := envelopeWithTargetID("by_ids")
		tc.mutate(&envelope)
		if got := missingEnvelopeField(envelope); got != tc.want {
			t.Errorf("missingEnvelopeField(%s) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// TestValidateEnvelopeStillRejectsBlankTargetID keeps the fail-closed
// behaviour: naming the field must not soften the rejection.
func TestValidateEnvelopeStillRejectsBlankTargetID(t *testing.T) {
	result := validateEnvelope(envelopeWithTargetID(""), "ListPostsByIds")
	if result == nil {
		t.Fatal("validateEnvelope accepted an envelope with an empty target id")
	}
	if result.Error == nil {
		t.Fatal("rejection carried no error envelope")
	}
	if result.Error.ErrorCode != "INVALID_COMMAND_ENVELOPE" {
		t.Fatalf("errorCode = %q, want INVALID_COMMAND_ENVELOPE", result.Error.ErrorCode)
	}
	if field, _ := result.Error.SafeDetails["field"].(string); field != "target.id" {
		t.Fatalf("safeDetails.field = %v, want %q", result.Error.SafeDetails["field"], "target.id")
	}
}

func TestValidateEnvelopeAcceptsTheBatchReaderSentinel(t *testing.T) {
	if result := validateEnvelope(envelopeWithTargetID("by_ids"), "ListPostsByIds"); result != nil {
		t.Fatalf("validateEnvelope rejected the batch-reader sentinel: %+v", result.Error)
	}
}
