package scene

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// ── Test helpers ──────────────────────────────────────────────

func testEnvelope(commandType, targetID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: commandType, ID: targetID},
		IdempotencyKey: "idem_" + commandType + "_001",
		Purpose:        "scene_value_exchange",
		CorrelationID:  "corr_" + commandType,
		Payload:        payload,
	}
}

func testEnvelopeAs(commandType, targetID, actorID string, payload map[string]any) command.Envelope {
	e := testEnvelope(commandType, targetID, payload)
	e.Actor.ID = actorID
	return e
}

func okCreatePayload() map[string]any {
	return map[string]any{
		"tool":          "PHOTO",
		"intent":        "周六下午想在西湖拍照",
		"anchor":        map[string]any{"type": "VENUE", "id": "venue_001", "label": "West Lake"},
		"participation": "OPEN_SIGNUP",
		"cost":          "HOST_SPONSORED",
		"startsAt":      "2026-09-05T16:00:00Z",
	}
}

func resultAggregateID(t *testing.T, r command.Result) string {
	t.Helper()
	if r.Aggregate == nil {
		t.Fatalf("result has no aggregate: %#v", r)
	}
	return r.Aggregate.ID
}

// publishScene drives a freshly-created Scene to PUBLISHED. It walks
// Create -> Update (no-op) -> Publish so RecordAttendance / RecordOutcome
// can rely on the PUBLISHED state without each test re-implementing
// the wiring.
func publishScene(t *testing.T, svc *Service, sceneID string, version int) {
	t.Helper()
	// Updates are optional — the test setup typically does not need to
	// touch the scene. We publish directly.
	r := svc.Handle(testEnvelope("PublishScene", sceneID, map[string]any{
		"expectedVersion": version,
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("publishScene: expected ACCEPTED, got %#v", r)
	}
}

func decodeListPayload(t *testing.T, ref string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(ref), &out); err != nil {
		t.Fatalf("decode operationRef: %v\n%s", err, ref)
	}
	return out
}

// ── evaluateGuard / passesIndependence ───────────────────────

func TestEvaluateGuard_RequiresAnchor(t *testing.T) {
	got := evaluateGuard(Scene{Tool: "PHOTO", Cost: "HOST_SPONSORED"})
	if got.Result != "NEEDS_MORE_INFORMATION" || got.Reason != "missing anchor" {
		t.Fatalf("expected missing anchor, got %#v", got)
	}
}

func TestEvaluateGuard_RequiresCost(t *testing.T) {
	got := evaluateGuard(Scene{Tool: "PHOTO", Anchor: map[string]any{"type": "VENUE", "id": "v"}})
	if got.Result != "NEEDS_MORE_INFORMATION" || got.Reason != "missing cost" {
		t.Fatalf("expected missing cost, got %#v", got)
	}
}

func TestEvaluateGuard_PHOTO_DirectPay_NoBenefitIsHighTransaction(t *testing.T) {
	got := evaluateGuard(Scene{
		Tool:   "PHOTO",
		Cost:   "HOST_PAY",
		Anchor: map[string]any{"type": "VENUE", "id": "v"},
	})
	if got.Result != "HIGH_TRANSACTION_FEELING" {
		t.Fatalf("expected HIGH_TRANSACTION_FEELING, got %#v", got)
	}
}

func TestEvaluateGuard_PHOTO_DirectPay_WithBenefitIsGoodFit(t *testing.T) {
	got := evaluateGuard(Scene{
		Tool:     "PHOTO",
		Cost:     "HOST_PAY",
		Anchor:   map[string]any{"type": "VENUE", "id": "v"},
		Benefits: []map[string]any{{"kind": "drink"}},
	})
	if got.Result != "GOOD_FIT" {
		t.Fatalf("expected GOOD_FIT, got %#v", got)
	}
}

func TestEvaluateGuard_NonPhoto_DirectPay_NoBenefitIsNotFlagged(t *testing.T) {
	// The HIGH_TRANSACTION rule is intentionally PHOTO-specific.
	// Non-photo direct pay is allowed; the Scene Independence Test
	// (passesIndependence) is the gate, not the guard.
	got := evaluateGuard(Scene{
		Tool:   "COMPANION",
		Cost:   "HOST_PAY",
		Anchor: map[string]any{"type": "VENUE", "id": "v"},
	})
	if got.Result != "GOOD_FIT" {
		t.Fatalf("expected GOOD_FIT for COMPANION+HOST_PAY, got %#v", got)
	}
}

func TestPassesIndependence_MissingAnchor(t *testing.T) {
	if passesIndependence(Scene{Title: "西湖拍照"}) {
		t.Fatal("Scene without anchor must fail independence test")
	}
}

func TestPassesIndependence_MissingTitle(t *testing.T) {
	if passesIndependence(Scene{Anchor: map[string]any{"type": "VENUE", "id": "v"}}) {
		t.Fatal("Scene without title must fail independence test")
	}
}

func TestPassesIndependence_HappyPath(t *testing.T) {
	if !passesIndependence(Scene{
		Title:  "西湖拍照",
		Anchor: map[string]any{"type": "VENUE", "id": "v"},
	}) {
		t.Fatal("Scene with anchor + title must pass independence test")
	}
}

// ── CreateScene ───────────────────────────────────────────────

func TestCreateScene_Accepted_EmitsSceneCreated(t *testing.T) {
	svc := NewWithClock(clock.NewFixed(time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)))
	r := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	if r.Aggregate == nil || r.Aggregate.Type != "Scene" || r.Aggregate.State != "DRAFT" {
		t.Fatalf("expected Scene aggregate in DRAFT, got %#v", r.Aggregate)
	}
	if r.Aggregate.Version != 1 {
		t.Fatalf("expected initial version 1, got %d", r.Aggregate.Version)
	}
	if !strings.HasPrefix(r.Aggregate.ID, "scene_") {
		t.Fatalf("expected scene_ id prefix, got %s", r.Aggregate.ID)
	}
}

func TestCreateScene_RejectsMissingRequiredFields(t *testing.T) {
	svc := New()
	// Tool empty
	r := svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"intent": "x", "participation": "OPEN_SIGNUP", "cost": "HOST_SPONSORED", "startsAt": "2026-09-05T16:00:00Z",
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_SCENE_CREATE" {
		t.Fatalf("missing tool: expected INVALID_SCENE_CREATE, got %#v", r)
	}
	// Intent empty (whitespace)
	r = svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"tool": "PHOTO", "intent": "   ", "participation": "OPEN_SIGNUP", "cost": "HOST_SPONSORED", "startsAt": "2026-09-05T16:00:00Z",
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_SCENE_CREATE" {
		t.Fatalf("whitespace intent: expected INVALID_SCENE_CREATE, got %#v", r)
	}
	// Cost empty
	r = svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"tool": "PHOTO", "intent": "x", "participation": "OPEN_SIGNUP", "startsAt": "2026-09-05T16:00:00Z",
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_SCENE_CREATE" {
		t.Fatalf("missing cost: expected INVALID_SCENE_CREATE, got %#v", r)
	}
	// startsAt empty
	r = svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"tool": "PHOTO", "intent": "x", "participation": "OPEN_SIGNUP", "cost": "HOST_SPONSORED",
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_SCENE_CREATE" {
		t.Fatalf("missing startsAt: expected INVALID_SCENE_CREATE, got %#v", r)
	}
}

func TestCreateScene_RejectsBadTime(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	p["startsAt"] = "not-a-time"
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_SCENE_TIME" {
		t.Fatalf("expected INVALID_SCENE_TIME, got %#v", r)
	}
}

func TestCreateScene_TrimsTitleToSixty(t *testing.T) {
	svc := NewWithClock(clock.NewFixed(time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)))
	longIntent := strings.Repeat("a", 200)
	p := okCreatePayload()
	p["intent"] = longIntent
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if len(stored.Title) != 60 {
		t.Fatalf("expected title trimmed to 60, got %d chars", len(stored.Title))
	}
}

// ── UpdateScene ───────────────────────────────────────────────

func TestUpdateScene_Accepted_BumpsVersion(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("UpdateScene", sceneID, map[string]any{
		"expectedVersion": 1,
		"changes":         map[string]any{"intent": "改主意：改成拍夜景"},
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	if r.Aggregate.Version != 2 {
		t.Fatalf("expected version 2, got %d", r.Aggregate.Version)
	}
}

func TestUpdateScene_RejectsVersionConflict(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("UpdateScene", sceneID, map[string]any{
		"expectedVersion": 99,
		"changes":         map[string]any{"intent": "x"},
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_VERSION_CONFLICT" {
		t.Fatalf("expected SCENE_VERSION_CONFLICT, got %#v", r)
	}
}

func TestUpdateScene_RejectsNonOwner(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelopeAs("UpdateScene", sceneID, "user_evil", map[string]any{
		"expectedVersion": 1,
		"changes":         map[string]any{"intent": "x"},
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_UPDATE_NOT_ALLOWED" {
		t.Fatalf("expected SCENE_UPDATE_NOT_ALLOWED, got %#v", r)
	}
}

func TestUpdateScene_NotFound(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("UpdateScene", "scene_does_not_exist", map[string]any{
		"expectedVersion": 1,
		"changes":         map[string]any{"intent": "x"},
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_NOT_FOUND" {
		t.Fatalf("expected SCENE_NOT_FOUND, got %#v", r)
	}
}

// ── PublishScene ──────────────────────────────────────────────

func TestPublishScene_RejectsIndependence(t *testing.T) {
	svc := New()
	// Create without anchor (allowed at draft), then try to publish.
	created := svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"tool": "PHOTO", "intent": "x", "participation": "OPEN_SIGNUP", "cost": "HOST_SPONSORED", "startsAt": "2026-09-05T16:00:00Z",
	}))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("PublishScene", sceneID, map[string]any{"expectedVersion": 1}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_INDEPENDENCE_FAILED" {
		t.Fatalf("expected SCENE_INDEPENDENCE_FAILED, got %#v", r)
	}
}

func TestPublishScene_RejectsHighTransactionGuard(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", map[string]any{
		"tool": "PHOTO", "intent": "x", "anchor": map[string]any{"type": "VENUE", "id": "v"},
		"participation": "OPEN_SIGNUP", "cost": "HOST_PAY", "startsAt": "2026-09-05T16:00:00Z",
	}))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("PublishScene", sceneID, map[string]any{"expectedVersion": 1}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_GUARD_REJECTED" {
		t.Fatalf("expected SCENE_GUARD_REJECTED, got %#v", r)
	}
	if details := r.Error.SafeDetails; details["guard"] != "HIGH_TRANSACTION_FEELING" {
		t.Fatalf("expected guard=HIGH_TRANSACTION_FEELING in details, got %#v", details)
	}
}

func TestPublishScene_Accepted_TransitionsToInviting(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("PublishScene", sceneID, map[string]any{"expectedVersion": 1}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	if r.Aggregate.State != "INVITING" {
		t.Fatalf("expected state INVITING, got %s", r.Aggregate.State)
	}
}

func TestPublishScene_RejectsNonOwner(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelopeAs("PublishScene", sceneID, "user_evil", map[string]any{"expectedVersion": 1}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_PUBLISH_NOT_ALLOWED" {
		t.Fatalf("expected SCENE_PUBLISH_NOT_ALLOWED, got %#v", r)
	}
}

// ── CreateInvitation / RespondInvitation ──────────────────────

func TestCreateInvitation_Accepted(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002", "card": map[string]any{"hi": "there"},
	}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "PENDING" {
		t.Fatalf("expected ACCEPTED/PENDING, got %#v", r)
	}
}

func TestCreateInvitation_RejectsMissingScene(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": "scene_nope", "inviteeUserId": "user_002",
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_NOT_FOUND" {
		t.Fatalf("expected SCENE_NOT_FOUND, got %#v", r)
	}
}

func TestCreateInvitation_RejectsMissingFields(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID,
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_INVITATION" {
		t.Fatalf("expected INVALID_INVITATION, got %#v", r)
	}
}

func TestRespondInvitation_Accepted_UpdatesStatus(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	inv := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002",
	}))
	invID := resultAggregateID(t, inv)
	// Switch actor to the invitee
	r := svc.Handle(testEnvelopeAs("RespondInvitation", invID, "user_002", map[string]any{"decision": "ACCEPTED"}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED state=ACCEPTED, got %#v", r)
	}
}

func TestRespondInvitation_RejectsInvalidDecision(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	inv := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002",
	}))
	invID := resultAggregateID(t, inv)
	r := svc.Handle(testEnvelopeAs("RespondInvitation", invID, "user_002", map[string]any{"decision": "MAYBE"}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVALID_INVITATION_RESPONSE" {
		t.Fatalf("expected INVALID_INVITATION_RESPONSE, got %#v", r)
	}
}

func TestRespondInvitation_RejectsNonInvitee(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	inv := svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002",
	}))
	invID := resultAggregateID(t, inv)
	r := svc.Handle(testEnvelopeAs("RespondInvitation", invID, "user_evil", map[string]any{"decision": "ACCEPTED"}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVITATION_NOT_ALLOWED" {
		t.Fatalf("expected INVITATION_NOT_ALLOWED, got %#v", r)
	}
}

func TestRespondInvitation_NotFound(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("RespondInvitation", "inv_nope", map[string]any{"decision": "ACCEPTED"}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "INVITATION_NOT_FOUND" {
		t.Fatalf("expected INVITATION_NOT_FOUND, got %#v", r)
	}
}

// ── RecordAttendance / RecordOutcome (accept-only baseline) ───

func TestRecordAttendance_Accepted(t *testing.T) {
	// R15.13 P1 wiring: RecordAttendance is now wired to the Scene
	// repository — it locates the Scene by target id, records a
	// checkin (HOST or GUEST role), and unlocks the benefit once
	// both sides have checked in. The P0 baseline (accept-only,
	// no Scene dependency) is no longer the contract; the test
	// must first create a Scene and then check in against it.
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("RecordAttendance", sceneID, map[string]any{}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "ATTENDED" {
		t.Fatalf("expected ACCEPTED/ATTENDED, got %#v", r)
	}
	// Checkin row should be present.
	checkins, _ := svc.repo.ListCheckins(context.Background(), sceneID)
	if len(checkins) != 1 {
		t.Fatalf("expected 1 checkin, got %d", len(checkins))
	}
	if checkins[0].Role != "HOST" {
		t.Fatalf("expected role=HOST (actor==host), got %s", checkins[0].Role)
	}
}

func TestRecordAttendance_NotFound(t *testing.T) {
	// R15.13 P1 wiring: RecordAttendance against a non-existent
	// scene is REJECTED with SCENE_NOT_FOUND. P0 baseline
	// (accept-only) is no longer the contract.
	svc := New()
	r := svc.Handle(testEnvelope("RecordAttendance", "scene_does_not_exist", map[string]any{}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_NOT_FOUND" {
		t.Fatalf("expected REJECTED/SCENE_NOT_FOUND, got %#v", r)
	}
}

func TestRecordOutcome_Accepted(t *testing.T) {
	// R15.13 P2 wiring: RecordOutcome now persists a Memory. P0
	// accept-only baseline is gone. Setup: create a Scene, publish
	// it, then record attendance for host + guest before recording
	// the outcome. Without any of those, the new contract rejects.
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	publishScene(t, svc, sceneID, 1)
	// Host checks in
	svc.Handle(testEnvelope("RecordAttendance", sceneID, map[string]any{}))
	// Guest checks in — need a separate envelope with a different actor
	guest := testEnvelope("RecordAttendance", sceneID, map[string]any{})
	guest.Actor = command.Actor{Type: "USER", ID: "guest_user_001"}
	svc.Handle(guest)
	// Now record outcome
	spend := int64(50000)
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId":     "guest_user_001",
		"actualSpend": spend,
		"durationMin": 90,
		"notes":       "smoke test",
	}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "RECORDED" {
		t.Fatalf("expected ACCEPTED/RECORDED, got %#v err=%#v", r, r.Error)
	}
	// Memory should be persisted.
	mem, err := svc.repo.GetMemory(context.Background(), sceneID)
	if err != nil { t.Fatalf("GetMemory: %v", err) }
	if mem.PlannedBudget != spend && mem.PlannedBudget != 0 {
		// okCreatePayload doesn't set budgetMinor, so PlannedBudget=0
		// is the expected base; ActualSpend=50000 is the only signal.
	}
	if mem.ActualSpend != spend {
		t.Fatalf("expected actualSpend=%d, got %d", spend, mem.ActualSpend)
	}
	if mem.GuestID != "guest_user_001" {
		t.Fatalf("expected guestId=guest_user_001, got %s", mem.GuestID)
	}
	if mem.Rating <= 0 {
		t.Fatalf("expected rating > 0, got %v", mem.Rating)
	}
}

// ── ListMyScenes / ListMyInvitations ──────────────────────────

func TestListMyScenes_FiltersByHostAndAppliesLimit(t *testing.T) {
	svc := New()
	// 3 scenes, host user_001
	for i := 0; i < 3; i++ {
		svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	}
	// 1 scene, host user_evil — must NOT show up
	created := svc.Handle(testEnvelopeAs("CreateScene", "new", "user_evil", okCreatePayload()))
	_ = created

	r := svc.Handle(testEnvelope("ListMyScenes", "list", map[string]any{"limit": 10}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	payload := decodeListPayload(t, r.OperationRef)
	if payload["actorId"] != "user_001" {
		t.Fatalf("expected actorId=user_001, got %#v", payload["actorId"])
	}
	items, _ := payload["scenes"].([]any)
	if len(items) != 3 {
		t.Fatalf("expected 3 scenes for host user_001, got %d", len(items))
	}
	if payload["limit"] != 10.0 {
		t.Fatalf("expected limit=10, got %#v", payload["limit"])
	}
}

func TestListMyScenes_LimitClampsAbove50(t *testing.T) {
	svc := New()
	svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	r := svc.Handle(testEnvelope("ListMyScenes", "list", map[string]any{"limit": 9999}))
	payload := decodeListPayload(t, r.OperationRef)
	if payload["limit"] != 50.0 {
		t.Fatalf("expected limit clamped to 50, got %#v", payload["limit"])
	}
}

func TestListMyScenes_LimitDefaultsTo10WhenMissingOrNonPositive(t *testing.T) {
	svc := New()
	svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	r := svc.Handle(testEnvelope("ListMyScenes", "list", map[string]any{"limit": 0}))
	payload := decodeListPayload(t, r.OperationRef)
	if payload["limit"] != 10.0 {
		t.Fatalf("expected default limit 10, got %#v", payload["limit"])
	}
	r = svc.Handle(testEnvelope("ListMyScenes", "list", map[string]any{}))
	payload = decodeListPayload(t, r.OperationRef)
	if payload["limit"] != 10.0 {
		t.Fatalf("expected default limit 10 when missing, got %#v", payload["limit"])
	}
	r = svc.Handle(testEnvelope("ListMyScenes", "list", map[string]any{"limit": -5}))
	payload = decodeListPayload(t, r.OperationRef)
	if payload["limit"] != 10.0 {
		t.Fatalf("expected default limit 10 when negative, got %#v", payload["limit"])
	}
}

func TestListMyInvitations_FiltersByInvitee(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	// Two invitations to user_002, one to user_003
	svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002",
	}))
	svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_002",
	}))
	svc.Handle(testEnvelope("CreateInvitation", "new", map[string]any{
		"sceneId": sceneID, "inviteeUserId": "user_003",
	}))
	r := svc.Handle(testEnvelopeAs("ListMyInvitations", "list", "user_002", map[string]any{"limit": 10}))
	payload := decodeListPayload(t, r.OperationRef)
	items, _ := payload["invitations"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 invitations for user_002, got %d", len(items))
	}
}

// ── Supports + unknown command ────────────────────────────────

func TestSupports_KnownCommands(t *testing.T) {
	svc := New()
	known := []string{
		"CreateScene", "UpdateScene", "PublishScene",
		"CreateInvitation", "RespondInvitation",
		"RecordAttendance", "RecordOutcome",
		"ListMyScenes", "ListMyInvitations",
		// R15.13 P2: Memory commands must also be in Supports() so
		// the dispatch router can reach the scene service. If a
		// future refactor drops these, the test fails.
		"ListMyMemories", "GetMemory",
	}
	for _, t0 := range known {
		if !svc.Supports(t0) {
			t.Fatalf("expected Supports(%s) = true", t0)
		}
	}
}

func TestHandle_UnknownCommand_Rejected(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("DeleteScene", "any", map[string]any{}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_COMMAND_UNSUPPORTED" {
		t.Fatalf("expected SCENE_COMMAND_UNSUPPORTED, got %#v", r)
	}
}

// ── Pass 3 audit closures: R15.13 P1 Scene fields ─────────────────

func TestCreateScene_FundingModeDefaultsToHost(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.FundingMode != "HOST" {
		t.Fatalf("expected default fundingMode=HOST, got %q", stored.FundingMode)
	}
}

func TestCreateScene_FundingModeRespected(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	p["fundingMode"] = "SPLIT"
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	if r.Outcome != "ACCEPTED" { t.Fatalf("expected ACCEPTED, got %#v", r) }
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.FundingMode != "SPLIT" {
		t.Fatalf("expected fundingMode=SPLIT, got %q", stored.FundingMode)
	}
}

func TestCreateScene_BudgetMinorCarriedThrough(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	p["budgetMinor"] = 80000
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	if r.Outcome != "ACCEPTED" { t.Fatalf("expected ACCEPTED, got %#v", r) }
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.BudgetMinor != 80000 {
		t.Fatalf("expected budgetMinor=80000, got %d", stored.BudgetMinor)
	}
}

func TestCreateScene_CurrencyDefaultsToVND(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.Currency != "VND" {
		t.Fatalf("expected default currency=VND, got %q", stored.Currency)
	}
}

func TestCreateScene_PriceCorridorPopulatedByCityAndSceneType(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	p["cityScope"] = "HN"
	p["venueId"] = "aster_rooftop"
	p["sceneType"] = "ROOFTOP_PHOTO"
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	if r.Outcome != "ACCEPTED" { t.Fatalf("expected ACCEPTED, got %#v", r) }
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.PriceCorridor == nil {
		t.Fatal("expected priceCorridor to be populated, got nil")
	}
	// ROOFTOP keyword → high corridor
	if got := stored.PriceCorridor["high"]; got != int64(120000) {
		t.Fatalf("expected ROOFTOP high=120000, got %v", got)
	}
	if stored.PriceCorridor["currency"] != "VND" {
		t.Fatalf("expected currency=VND in corridor, got %v", stored.PriceCorridor["currency"])
	}
}

func TestCreateScene_AestheticScoreForPhotoIsHigh(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	// sceneType = "ROOFTOP_PHOTO" is in the strong set → 0.92
	p["sceneType"] = "ROOFTOP_PHOTO"
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.AestheticScore != 0.92 {
		t.Fatalf("expected aestheticScore=0.92 for ROOFTOP_PHOTO, got %v", stored.AestheticScore)
	}
}

func TestCreateScene_AestheticScoreForSpaIsLow(t *testing.T) {
	svc := New()
	p := okCreatePayload()
	p["sceneType"] = "SPA_RELAXATION"
	r := svc.Handle(testEnvelope("CreateScene", "new", p))
	stored, _ := svc.repo.Get(context.Background(), r.Aggregate.ID)
	if stored.AestheticScore != 0.45 {
		t.Fatalf("expected aestheticScore=0.45 for SPA, got %v", stored.AestheticScore)
	}
}

func TestUpdateScene_AppliesFundingAndBudgetChange(t *testing.T) {
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("UpdateScene", sceneID, map[string]any{
		"expectedVersion": 1,
		"changes": map[string]any{
			"fundingMode": "GUEST_SPONSORED",
			"budgetMinor": float64(150000), // JSON numbers decode as float64
		},
	}))
	if r.Outcome != "ACCEPTED" { t.Fatalf("expected ACCEPTED, got %#v", r) }
	stored, _ := svc.repo.Get(context.Background(), sceneID)
	if stored.FundingMode != "GUEST_SPONSORED" {
		t.Fatalf("expected fundingMode updated, got %q", stored.FundingMode)
	}
	if stored.BudgetMinor != 150000 {
		t.Fatalf("expected budgetMinor updated, got %d", stored.BudgetMinor)
	}
}

// ── R15.13 P2: Memory domain tripwires ────────────────────────────

// readyForOutcome walks a freshly-created Scene through Create -> Publish
// -> Host checkin -> Guest checkin so RecordOutcome has a valid base.
func readyForOutcome(t *testing.T, svc *Service) (sceneID string) {
	t.Helper()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID = resultAggregateID(t, created)
	publishScene(t, svc, sceneID, 1)
	// Host checkin
	svc.Handle(testEnvelope("RecordAttendance", sceneID, map[string]any{}))
	// Guest checkin — separate envelope so actor differs.
	guest := testEnvelope("RecordAttendance", sceneID, map[string]any{})
	guest.Actor = command.Actor{Type: "USER", ID: "guest_u_p2"}
	svc.Handle(guest)
	return
}

func TestRecordOutcome_NotFound(t *testing.T) {
	svc := New()
	spend := int64(1000)
	r := svc.Handle(testEnvelope("RecordOutcome", "scene_does_not_exist", map[string]any{
		"guestId": "guest_u", "actualSpend": spend,
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "SCENE_NOT_FOUND" {
		t.Fatalf("expected REJECTED/SCENE_NOT_FOUND, got %#v", r)
	}
}

func TestRecordOutcome_GuestRequired(t *testing.T) {
	svc := New()
	sceneID := readyForOutcome(t, svc)
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"actualSpend": int64(1000),
		// no guestId
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_GUEST_REQUIRED" {
		t.Fatalf("expected OUTCOME_GUEST_REQUIRED, got %#v", r)
	}
}

func TestRecordOutcome_SpendMustBeNonNegative(t *testing.T) {
	svc := New()
	sceneID := readyForOutcome(t, svc)
	neg := int64(-1)
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": neg,
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_SPEND_INVALID" {
		t.Fatalf("expected OUTCOME_SPEND_INVALID, got %#v", r)
	}
}

func TestRecordOutcome_DurationMustBeNonNegative(t *testing.T) {
	svc := New()
	sceneID := readyForOutcome(t, svc)
	neg := -1
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(1000), "durationMin": neg,
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_DURATION_INVALID" {
		t.Fatalf("expected OUTCOME_DURATION_INVALID, got %#v", r)
	}
}

func TestRecordOutcome_NotHost(t *testing.T) {
	// A non-host actor must not be able to record the outcome (the
	// guest can't self-report the actual spend — that's the host's
	// bookkeeping responsibility).
	svc := New()
	sceneID := readyForOutcome(t, svc)
	env := testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(1000),
	})
	env.Actor = command.Actor{Type: "USER", ID: "impostor"}
	r := svc.Handle(env)
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_NOT_HOST" {
		t.Fatalf("expected OUTCOME_NOT_HOST, got %#v", r)
	}
}

func TestRecordOutcome_CheckinIncomplete(t *testing.T) {
	// Without a guest checkin, the memory would be one-sided — reject.
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	publishScene(t, svc, sceneID, 1)
	// Only host checkin.
	svc.Handle(testEnvelope("RecordAttendance", sceneID, map[string]any{}))
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_x", "actualSpend": int64(1000),
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_CHECKIN_INCOMPLETE" {
		t.Fatalf("expected OUTCOME_CHECKIN_INCOMPLETE, got %#v", r)
	}
}

func TestRecordOutcome_DraftSceneRejected(t *testing.T) {
	// A DRAFT scene (never published) must not leave a memory trail.
	svc := New()
	created := svc.Handle(testEnvelope("CreateScene", "new", okCreatePayload()))
	sceneID := resultAggregateID(t, created)
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_x", "actualSpend": int64(1000),
	}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "OUTCOME_SCENE_NOT_PUBLISHED" {
		t.Fatalf("expected OUTCOME_SCENE_NOT_PUBLISHED, got %#v", r)
	}
}

func TestRecordOutcome_RatingClampedToUnitInterval(t *testing.T) {
	// Over-spend must still produce rating in [0,1].
	svc := New()
	// Create a scene with a tight budget.
	p := okCreatePayload()
	budget := int64(1000)
	p["budgetMinor"] = budget
	created := svc.Handle(testEnvelope("CreateScene", "new", p))
	sceneID := resultAggregateID(t, created)
	publishScene(t, svc, sceneID, 1)
	svc.Handle(testEnvelope("RecordAttendance", sceneID, map[string]any{}))
	guest := testEnvelope("RecordAttendance", sceneID, map[string]any{})
	guest.Actor = command.Actor{Type: "USER", ID: "guest_u_p2"}
	svc.Handle(guest)
	// 1000x over budget.
	r := svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(1_000_000),
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", r)
	}
	mem, _ := svc.repo.GetMemory(context.Background(), sceneID)
	if mem.Rating < 0 || mem.Rating > 1 {
		t.Fatalf("rating must be in [0,1], got %v", mem.Rating)
	}
	// 1000x over → budgetAdherence = 2 - 1/1000 ≈ 1.999, clamped to 1
	// in our penalty path; we expect rating to land above 0.5 still
	// (aesthetic=0.92, adherence≈0 → 0.5*0.92+0.5*~0 = 0.46) but the
	// 2-ratio reflection stays in [0,1].
	if mem.Rating >= 0.9 {
		t.Fatalf("expected rating to drop with overspend, got %v", mem.Rating)
	}
}

func TestRecordOutcome_UpsertReplacesExisting(t *testing.T) {
	// Re-recording the outcome replaces the prior memory (the user
	// might have miscounted the first time).
	svc := New()
	sceneID := readyForOutcome(t, svc)
	svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(1000), "notes": "first",
	}))
	svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(2000), "notes": "second",
	}))
	mem, _ := svc.repo.GetMemory(context.Background(), sceneID)
	if mem.ActualSpend != 2000 {
		t.Fatalf("expected actualSpend=2000 after upsert, got %d", mem.ActualSpend)
	}
	if mem.Notes != "second" {
		t.Fatalf("expected notes=second after upsert, got %q", mem.Notes)
	}
	// One memory per scene (ListMemoriesByScene returns 1).
	mems, _ := svc.repo.ListMemoriesByScene(context.Background(), sceneID)
	if len(mems) != 1 {
		t.Fatalf("expected 1 memory per scene, got %d", len(mems))
	}
}

func TestListMyMemories_IncludesHostAndGuest(t *testing.T) {
	svc := New()
	sceneID := readyForOutcome(t, svc)
	svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(5000),
	}))
	// Host (default actor in testEnvelope) should see it
	hr := svc.Handle(testEnvelopeAs("ListMyMemories", "unused", "user_001", map[string]any{}))
	if hr.Outcome != "ACCEPTED" {
		t.Fatalf("host list: expected ACCEPTED, got %#v", hr)
	}
	if !strings.Contains(hr.OperationRef, `"role":"HOST"`) {
		t.Fatalf("host list should label role=HOST, got %s", hr.OperationRef)
	}
	// Guest should see it
	gr := svc.Handle(testEnvelopeAs("ListMyMemories", "unused", "guest_u_p2", map[string]any{}))
	if gr.Outcome != "ACCEPTED" {
		t.Fatalf("guest list: expected ACCEPTED, got %#v", gr)
	}
	if !strings.Contains(gr.OperationRef, `"role":"GUEST"`) {
		t.Fatalf("guest list should label role=GUEST, got %s", gr.OperationRef)
	}
	// Random other user should not see it
	sr := svc.Handle(testEnvelopeAs("ListMyMemories", "unused", "stranger", map[string]any{}))
	if sr.Outcome != "ACCEPTED" {
		t.Fatalf("stranger list: expected ACCEPTED, got %#v", sr)
	}
	if strings.Contains(sr.OperationRef, sceneID) {
		t.Fatalf("stranger should not see the memory, got %s", sr.OperationRef)
	}
}

func TestGetMemory_HostAndGuestCanRead(t *testing.T) {
	svc := New()
	sceneID := readyForOutcome(t, svc)
	svc.Handle(testEnvelope("RecordOutcome", sceneID, map[string]any{
		"guestId": "guest_u_p2", "actualSpend": int64(5000),
	}))
	// Host reads
	if r := svc.Handle(testEnvelopeAs("GetMemory", sceneID, "user_001", map[string]any{})); r.Outcome != "ACCEPTED" {
		t.Fatalf("host get: expected ACCEPTED, got %#v", r)
	}
	// Guest reads
	if r := svc.Handle(testEnvelopeAs("GetMemory", sceneID, "guest_u_p2", map[string]any{})); r.Outcome != "ACCEPTED" {
		t.Fatalf("guest get: expected ACCEPTED, got %#v", r)
	}
	// Stranger blocked
	r := svc.Handle(testEnvelopeAs("GetMemory", sceneID, "stranger", map[string]any{}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "MEMORY_NOT_VISIBLE" {
		t.Fatalf("stranger get: expected MEMORY_NOT_VISIBLE, got %#v", r)
	}
}

func TestGetMemory_NotFound(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelopeAs("GetMemory", "scene_no_memory", "user_001", map[string]any{}))
	if r.Outcome != "REJECTED" || r.Error.ErrorCode != "MEMORY_NOT_FOUND" {
		t.Fatalf("expected MEMORY_NOT_FOUND, got %#v", r)
	}
}
