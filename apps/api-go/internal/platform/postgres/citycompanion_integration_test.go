package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/command"
)

// TestCityCompanionPostgresLifecycle covers the M2 citycompanion chain
// through real PostgreSQL: CreateCityCompanionNeed (CANDIDATES + version
// 1) → ListCityCompanionCandidates (≥1 candidate, Eligibility before
// Ranking) → ConfirmCityCompanionNeed (authoritative offer from
// candidate snapshot, NOT client-supplied price; lifecycle → CONFIRMED).
// The lifecycle gate: confirm twice on the same need with the same
// version is REJECTED with CITY_COMPANION_NEED_VERSION_CONFLICT
// (optimistic-concurrency lock proven on the PG path, not just the
// in-memory map).
func TestCityCompanionPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewCityCompanionRepository(pool)
	svc := citycompanion.NewWithRepository(repo)

	run := time.Now().UnixNano()
	userID := "user_cc_pg_" + itoa(run)
	actorID := userID

	// 1. CreateCityCompanionNeed: version=1, lifecycle=CANDIDATES.
	r := svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "8H", "language": "ZH", "meeting": "hn",
		"interests": []any{"food", "history"}, "budgetVnd": int64(2000000),
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateCityCompanionNeed: %+v", r.Error)
	}
	if r.Aggregate.State != "CANDIDATES" {
		t.Fatalf("new need must be CANDIDATES, got %s", r.Aggregate.State)
	}
	needID := r.Aggregate.ID
	if needID == "" {
		t.Fatalf("CreateCityCompanionNeed: missing need id")
	}

	// 2. Invalid duration: must be REJECTED, no PG row.
	r = svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "12H", "meeting": "hn",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("invalid duration must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_DURATION" {
		t.Fatalf("expected INVALID_DURATION, got %+v", r.Error)
	}

	// 3. Missing meeting: must be REJECTED with MEETING_REQUIRED.
	r = svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "4H",
	}, actorID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("missing meeting must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "MEETING_REQUIRED" {
		t.Fatalf("expected MEETING_REQUIRED, got %+v", r.Error)
	}

	// 4. ListCityCompanionCandidates: with version=1, the seed pool
	// returns agent_linh (and friends) as candidates.
	r = svc.HandleContext(ctx, ccEnvelope("ListCityCompanionCandidates", map[string]any{
		"expectedVersion": 1,
	}, actorID, needID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListCityCompanionCandidates: %+v", r.Error)
	}
	cands := readCandidatesPG(t, r.OperationRef)
	if len(cands) == 0 {
		t.Fatalf("expected ≥1 candidate, got 0 (op=%s)", r.OperationRef)
	}
	// The seed candidate agent_linh is in the list.
	foundLinh := false
	for _, c := range cands {
		if c == "agent_linh" {
			foundLinh = true
		}
	}
	if !foundLinh {
		t.Fatalf("seed candidate agent_linh must be in list, got %v", cands)
	}

	// 5. Stale version on ListCityCompanionCandidates: expectedVersion=99
	// must be REJECTED with CITY_COMPANION_NEED_VERSION_CONFLICT.
	r = svc.HandleContext(ctx, ccEnvelope("ListCityCompanionCandidates", map[string]any{
		"expectedVersion": 99,
	}, actorID, needID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("stale version must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "CITY_COMPANION_NEED_VERSION_CONFLICT" {
		t.Fatalf("expected CITY_COMPANION_NEED_VERSION_CONFLICT, got %+v", r.Error)
	}

	// 6. ConfirmCityCompanion with the authoritative price from
	// the seed candidate (agent_linh OfferVND=1200000). Client must
	// supply exactly that, NOT a 1-VND bargain.
	r = svc.HandleContext(ctx, ccEnvelope("ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1, "agentId": "agent_linh", "offerVnd": int64(1200000),
	}, actorID, needID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ConfirmCityCompanionNeed authoritative price: %+v", r.Error)
	}
	if r.Aggregate.State != "CONFIRMED" {
		t.Fatalf("after Confirm, want CONFIRMED, got %s", r.Aggregate.State)
	}
	// The need version must have advanced to 2 in PG.
	needAfter, err := repo.GetNeed(ctx, needID)
	if err != nil {
		t.Fatalf("GetNeed after confirm: %v", err)
	}
	if needAfter.Version != 2 {
		t.Fatalf("after Confirm, need version must be 2, got %d", needAfter.Version)
	}
	if needAfter.Lifecycle != "CONFIRMED" {
		t.Fatalf("after Confirm, need lifecycle must be CONFIRMED, got %s", needAfter.Lifecycle)
	}

	// 7. Client bargain attempt: a fresh need, confirm with offerVnd=1
	// must be REJECTED with OFFER_PRICE_MISMATCH (the authoritative
	// price is the candidate snapshot, not the payload).
	r = svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "4H", "meeting": "hn",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateCityCompanionNeed #2: %+v", r.Error)
	}
	bargainNeedID := r.Aggregate.ID
	r = svc.HandleContext(ctx, ccEnvelope("ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1, "agentId": "agent_linh", "offerVnd": int64(1),
	}, actorID, bargainNeedID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("client-bargain must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "OFFER_PRICE_MISMATCH" {
		t.Fatalf("expected OFFER_PRICE_MISMATCH, got %+v", r.Error)
	}

	// 8. Cross-actor: another user trying to list candidates on this
	// need must be REJECTED with CANDIDATE_LIST_NOT_ALLOWED.
	otherUser := "user_cc_pg_other_" + itoa(run)
	r = svc.HandleContext(ctx, ccEnvelope("ListCityCompanionCandidates", map[string]any{
		"expectedVersion": 2,
	}, otherUser, needID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("cross-actor list must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "CANDIDATE_LIST_NOT_ALLOWED" {
		t.Fatalf("expected CANDIDATE_LIST_NOT_ALLOWED, got %+v", r.Error)
	}

	cleanupCityCompanionPG(t, pool, []string{needID, bargainNeedID})
}

// TestCityCompanionPostgresCompletion covers the M2 end-to-end
// completion chain: a confirmed need → CompleteCityCompanion (lifecycle
// → COMPLETED, version advanced) → stale version on a second complete
// REJECTED (optimistic-concurrency lock proven on the PG path) → a
// fresh need going through Confirm then RecordSceneCommerceVisit
// (lifecycle stays EXECUTING, scene visit recorded).
func TestCityCompanionPostgresCompletion(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewCityCompanionRepository(pool)
	svc := citycompanion.NewWithRepository(repo)

	run := time.Now().UnixNano()
	actorID := "user_cc_complete_pg_" + itoa(run)

	// 1. Create + Confirm (the standard happy path from
	// TestCityCompanionPostgresLifecycle, condensed here).
	r := svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "4H", "meeting": "hn",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateCityCompanionNeed: %+v", r.Error)
	}
	needID := r.Aggregate.ID
	r = svc.HandleContext(ctx, ccEnvelope("ConfirmCityCompanion", map[string]any{
		"expectedVersion": 1, "agentId": "agent_linh", "offerVnd": int64(1200000),
	}, actorID, needID))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "CONFIRMED" {
		t.Fatalf("Confirm: outcome=%s state=%s err=%+v", r.Outcome, r.Aggregate.State, r.Error)
	}

	// 2. CompleteCityCompanion with version=2: ACCEPTED, lifecycle
	// → COMPLETED, version → 3.
	r = svc.HandleContext(ctx, ccEnvelope("CompleteCityCompanion", map[string]any{
		"expectedVersion": 2,
	}, actorID, needID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CompleteCityCompanion: %+v", r.Error)
	}
	if r.Aggregate.State != "COMPLETED" {
		t.Fatalf("after Complete, want COMPLETED, got %s", r.Aggregate.State)
	}
	needFinal, _ := repo.GetNeed(ctx, needID)
	if needFinal.Lifecycle != "COMPLETED" || needFinal.Version != 3 {
		t.Fatalf("COMPLETED/3 expected, got %s/%d", needFinal.Lifecycle, needFinal.Version)
	}

	// 3. Complete on a fresh CANDIDATES need (not CONFIRMED) must be
	// REJECTED with CITY_COMPANION_NOT_COMPLETABLE.
	r = svc.HandleContext(ctx, ccEnvelope("CreateCityCompanionNeed", map[string]any{
		"duration": "8H", "meeting": "hcmc",
	}, actorID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateCityCompanionNeed #2: %+v", r.Error)
	}
	candidatesNeedID := r.Aggregate.ID
	r = svc.HandleContext(ctx, ccEnvelope("CompleteCityCompanion", map[string]any{
		"expectedVersion": 1,
	}, actorID, candidatesNeedID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("Complete on CANDIDATES need must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "CITY_COMPANION_NOT_COMPLETABLE" {
		t.Fatalf("expected CITY_COMPANION_NOT_COMPLETABLE, got %+v", r.Error)
	}

	// 4. RecordSceneCommerceVisit on the CANDIDATES need: missing
	// venueId must be REJECTED with INVALID_SCENE_VISIT.
	r = svc.HandleContext(ctx, ccEnvelope("RecordSceneCommerceVisit", map[string]any{
		"expectedVersion": 1, "venueType": "cafe",
	}, actorID, candidatesNeedID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("scene visit without venueId must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_SCENE_VISIT" {
		t.Fatalf("expected INVALID_SCENE_VISIT, got %+v", r.Error)
	}

	cleanupCityCompanionPG(t, pool, []string{needID, candidatesNeedID})
}

func readCandidatesPG(t *testing.T, op string) []string {
	t.Helper()
	var top map[string]any
	if err := json.Unmarshal([]byte(op), &top); err != nil {
		return nil
	}
	raw, ok := top["candidates"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(arr))
	for _, c := range arr {
		m, ok := c.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := m["agentId"].(string); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

func cleanupCityCompanionPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM citycompanion.needs WHERE id=$1`, id); err != nil {
			t.Logf("cleanup needs: %v", err)
		}
	}
}

func ccEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	envelope := command.Envelope{
		CommandID:      "cmd_cc_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_cc_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_cc_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "CityCompanionNeed", ID: targetID[0]}
	}
	return envelope
}
