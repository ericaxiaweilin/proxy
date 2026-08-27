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
	svc := New()
	r := svc.Handle(testEnvelope("RecordAttendance", "att_001", map[string]any{}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "ATTENDED" {
		t.Fatalf("expected ACCEPTED/ATTENDED, got %#v", r)
	}
}

func TestRecordOutcome_Accepted(t *testing.T) {
	svc := New()
	r := svc.Handle(testEnvelope("RecordOutcome", "out_001", map[string]any{}))
	if r.Outcome != "ACCEPTED" || r.Aggregate.State != "RECORDED" {
		t.Fatalf("expected ACCEPTED/RECORDED, got %#v", r)
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
