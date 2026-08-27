package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/outcome"
)

// TestOutcomePostgresLifecycle exercises the M6.5 acceptance chain end to
// end through the real PostgreSQL repository:
//   CreateObservationSet
//   → RecordOutcomeObservation (DRAFT only)
//   → FinalizeObservationSet  (locks the set, no further observations)
//   → CreateOutcomeComparison (only when both sets are FINALIZED + match
//     on target/template/venue; else rejected with a stable error code)
//   → ConfirmOutcomeLearning / DismissOutcomeLearning
// We also assert the negative invariant: a comparison on a still-DRAFT set
// must be REJECTED, never silently create a delta.
func TestOutcomePostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewOutcomeRepository(pool)
	svc := outcome.NewWithRepository(repo)

	run := time.Now().UnixNano()
	targetID := "target_out_pg_" + itoa(run)
	templateID := "tpl_out_pg_" + itoa(run)
	venueID := "venue_out_pg_" + itoa(run)

	// 1. Create a DRAFT set.
	r := svc.HandleContext(ctx, outcomeEnvelope("CreateObservationSet", map[string]any{
		"targetId": targetID, "templateId": templateID, "venueId": venueID,
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateObservationSet: outcome=%s err=%v", r.Outcome, r.Error)
	}
	if r.Aggregate.State != "DRAFT" {
		t.Fatalf("new set must be DRAFT, got %s", r.Aggregate.State)
	}
	setA := r.Aggregate.ID
	if setA == "" {
		t.Fatalf("CreateObservationSet: missing aggregate id; %+v", r)
	}

	// 2. Try to compare against a DRAFT set — must be REJECTED.
	r = svc.HandleContext(ctx, outcomeEnvelope("CreateOutcomeComparison", map[string]any{
		"baselineId": setA, "resultId": setA, "policyVersion": "v1",
	}, "user_001"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("comparison on DRAFT must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "NOT_FINALIZED" {
		t.Fatalf("expected NOT_FINALIZED, got %+v", r.Error)
	}

	// 3. Record two observations while still DRAFT.
	r = svc.HandleContext(ctx, outcomeEnvelope("RecordOutcomeObservation", map[string]any{
		"setId": setA, "key": "TEMP_C", "value": "36", "unit": "C",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("record obs A: %+v", r.Error)
	}
	r = svc.HandleContext(ctx, outcomeEnvelope("RecordOutcomeObservation", map[string]any{
		"setId": setA, "key": "HUMIDITY", "value": "62", "unit": "%",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("record obs B: %+v", r.Error)
	}

	// 4. Recording on a finalized set must fail.
	r = svc.HandleContext(ctx, outcomeEnvelope("FinalizeObservationSet", map[string]any{"setId": setA}, "user_001"))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "FINALIZED" {
		t.Fatalf("FinalizeObservationSet: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}
	r = svc.HandleContext(ctx, outcomeEnvelope("RecordOutcomeObservation", map[string]any{
		"setId": setA, "key": "LATE", "value": "x", "unit": "u",
	}, "user_001"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("record after finalize must be REJECTED, got %s", r.Outcome)
	}

	// 5. Create a second set with the SAME target/template/venue, record
	// the same keys, then finalize it.
	r = svc.HandleContext(ctx, outcomeEnvelope("CreateObservationSet", map[string]any{
		"targetId": targetID, "templateId": templateID, "venueId": venueID,
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateObservationSet B: %+v", r.Error)
	}
	setB := r.Aggregate.ID
	for _, k := range []struct{ key, val, unit string }{
		{"TEMP_C", "38", "C"}, {"HUMIDITY", "55", "%"},
	} {
		r = svc.HandleContext(ctx, outcomeEnvelope("RecordOutcomeObservation", map[string]any{
			"setId": setB, "key": k.key, "value": k.val, "unit": k.unit,
		}, "user_001"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("record obs %s: %+v", k.key, r.Error)
		}
	}
	r = svc.HandleContext(ctx, outcomeEnvelope("FinalizeObservationSet", map[string]any{"setId": setB}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("FinalizeObservationSet B: %+v", r.Error)
	}

	// 6. Comparison must now succeed and create a delta + a SUGGESTED
	// learning (M6.5 acceptance: Finalized + same target/template/venue +
	// policy version → Delta + Suggested).
	r = svc.HandleContext(ctx, outcomeEnvelope("CreateOutcomeComparison", map[string]any{
		"baselineId": setA, "resultId": setB, "policyVersion": "v1",
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateOutcomeComparison: %+v", r.Error)
	}
	deltaID := readString(r, "deltaId")
	learningID := readString(r, "learningId")
	if deltaID == "" || learningID == "" {
		t.Fatalf("comparison must return delta + learning ids, got %q", r.OperationRef)
	}

	// 7. Target mismatch must be REJECTED.
	r = svc.HandleContext(ctx, outcomeEnvelope("CreateObservationSet", map[string]any{
		"targetId": "target_out_pg_other_" + itoa(run), "templateId": templateID, "venueId": venueID,
	}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateObservationSet C: %+v", r.Error)
	}
	setC := r.Aggregate.ID
	for _, k := range []struct{ key, val, unit string }{
		{"TEMP_C", "37", "C"}, {"HUMIDITY", "60", "%"},
	} {
		r = svc.HandleContext(ctx, outcomeEnvelope("RecordOutcomeObservation", map[string]any{
			"setId": setC, "key": k.key, "value": k.val, "unit": k.unit,
		}, "user_001"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("record obs C/%s: %+v", k.key, r.Error)
		}
	}
	r = svc.HandleContext(ctx, outcomeEnvelope("FinalizeObservationSet", map[string]any{"setId": setC}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("FinalizeObservationSet C: %+v", r.Error)
	}
	r = svc.HandleContext(ctx, outcomeEnvelope("CreateOutcomeComparison", map[string]any{
		"baselineId": setA, "resultId": setC, "policyVersion": "v1",
	}, "user_001"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("target mismatch must be REJECTED, got %s", r.Outcome)
	}

	// 8. Confirm + dismiss the learning, then assert the row's status.
	r = svc.HandleContext(ctx, outcomeEnvelope("ConfirmOutcomeLearning", map[string]any{"learningId": learningID}, "user_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ConfirmOutcomeLearning: %+v", r.Error)
	}
	got, err := repo.GetLearning(ctx, learningID)
	if err != nil {
		t.Fatalf("GetLearning: %v", err)
	}
	if got.Status != "CONFIRMED" {
		t.Fatalf("learning not persisted as CONFIRMED: %+v", got)
	}

	// 9. Cleanup. cascade the observations + sets + delta + learning.
	cleanupOutcomePG(t, pool, setA, setB, setC, deltaID, learningID)
}

func cleanupOutcomePG(t *testing.T, pool *pgxpool.Pool, sets ...string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range sets {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM outcome.observations WHERE set_id=$1`, id); err != nil {
			t.Logf("cleanup obs for %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM outcome.learnings WHERE delta_id IN (SELECT id FROM outcome.deltas WHERE baseline_id=$1 OR result_id=$1)`, id); err != nil {
			t.Logf("cleanup learnings for %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM outcome.deltas WHERE baseline_id=$1 OR result_id=$1`, id); err != nil {
			t.Logf("cleanup deltas for %s: %v", id, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM outcome.observation_sets WHERE id=$1`, id); err != nil {
			t.Logf("cleanup set %s: %v", id, err)
		}
	}
}

func outcomeEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_out_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "ObservationSet", ID: actorID},
		IdempotencyKey: "test_out_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_out_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

// readString reads a string field from Result.OperationRef, which is a
// JSON-encoded payload for commands that return a body (e.g. comparison).
func readString(r command.Result, key string) string {
	if r.OperationRef == "" {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(r.OperationRef), &m); err != nil {
		return ""
	}
	if s, ok := m[key].(string); ok {
		return s
	}
	return ""
}

func itoa(i int64) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = digits[i%10]
		i /= 10
	}
	return string(b[pos:])
}
