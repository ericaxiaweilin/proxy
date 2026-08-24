package outcome

import (
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(cmd string, payload map[string]any, target string) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_test_1", CommandType: cmd, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: "user_001"}, Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target: command.Target{Type: "Outcome", ID: target}, IdempotencyKey: "test_key_123456",
		AuthContext: map[string]any{"session": "s1"}, Purpose: "test", CorrelationID: "corr_1", RequestedAt: "2026-08-16T00:00:00Z", Payload: payload,
	}
}

func TestOutcomeGates(t *testing.T) {
	s := New()
	// create two sets with same target/venue/template
	r1 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_1", "venueId": "venue_1"}, "new"))
	if r1.Outcome != "ACCEPTED" {
		t.Fatalf("create set1: %s", r1.Outcome)
	}
	baselineID := r1.Aggregate.ID
	r2 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_1", "venueId": "venue_1"}, "new"))
	resultID := r2.Aggregate.ID
	// record observations
	s.Handle(envelopeFor("RecordOutcomeObservation", map[string]any{"setId": baselineID, "key": "clean", "value": "70", "unit": "%"}, baselineID))
	s.Handle(envelopeFor("RecordOutcomeObservation", map[string]any{"setId": resultID, "key": "clean", "value": "85", "unit": "%"}, resultID))
	// finalize
	s.Handle(envelopeFor("FinalizeObservationSet", map[string]any{"setId": baselineID}, baselineID))
	s.Handle(envelopeFor("FinalizeObservationSet", map[string]any{"setId": resultID}, resultID))
	// try comparison with missing policy -> should fail POLICY_MISSING
	r := s.Handle(envelopeFor("CreateOutcomeComparison", map[string]any{"baselineId": baselineID, "resultId": resultID}, "new"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "POLICY_MISSING" {
		t.Fatalf("want POLICY_MISSING got %s %+v", r.Outcome, r.Error)
	}
	// success with policy
	r = s.Handle(envelopeFor("CreateOutcomeComparison", map[string]any{"baselineId": baselineID, "resultId": resultID, "policyVersion": "v1"}, "new"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("comparison: %s %+v", r.Outcome, r.Error)
	}
	// confirm learning
}

func TestNotFinalizedCannotCompare(t *testing.T) {
	s := New()
	r1 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_1", "venueId": "venue_1"}, "new"))
	baselineID := r1.Aggregate.ID
	r2 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_1", "venueId": "venue_1"}, "new"))
	resultID := r2.Aggregate.ID
	// only finalize baseline
	s.Handle(envelopeFor("FinalizeObservationSet", map[string]any{"setId": baselineID}, baselineID))
	r := s.Handle(envelopeFor("CreateOutcomeComparison", map[string]any{"baselineId": baselineID, "resultId": resultID, "policyVersion": "v1"}, "new"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "NOT_FINALIZED" {
		t.Fatalf("want NOT_FINALIZED got %s %+v", r.Outcome, r.Error)
	}
}

func TestTemplateMismatch(t *testing.T) {
	s := New()
	r1 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_1", "venueId": "venue_1"}, "new"))
	baselineID := r1.Aggregate.ID
	r2 := s.Handle(envelopeFor("CreateObservationSet", map[string]any{"targetId": "store_1", "templateId": "tmpl_2", "venueId": "venue_1"}, "new"))
	resultID := r2.Aggregate.ID
	s.Handle(envelopeFor("FinalizeObservationSet", map[string]any{"setId": baselineID}, baselineID))
	s.Handle(envelopeFor("FinalizeObservationSet", map[string]any{"setId": resultID}, resultID))
	r := s.Handle(envelopeFor("CreateOutcomeComparison", map[string]any{"baselineId": baselineID, "resultId": resultID, "policyVersion": "v1"}, "new"))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "TEMPLATE_LINEAGE_MISMATCH" {
		t.Fatalf("want TEMPLATE_LINEAGE_MISMATCH got %s %+v", r.Outcome, r.Error)
	}
}
