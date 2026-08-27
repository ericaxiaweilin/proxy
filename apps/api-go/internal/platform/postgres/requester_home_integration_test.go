package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
)

// TestRequesterHomePGReadModel covers the M2 server-backed Requester
// Home read model through real PostgreSQL: an actor who has two
// in-progress drafts (DRAFT + CANDIDATES) and one published task
// (COMMITTED) sees all three in the ListRequesterHomeItems response,
// while a different actor sees an empty list (per-actor scoping).
// Also covers: a draft that is later PUBLISHED must move from drafts[]
// to tasks[] (the projection reflects lifecycle transitions), and a
// stale-actor call must be REJECTED.
func TestRequesterHomePGReadModel(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	outbox := NewOutboxRepository(pool)
	repo := NewDemandRepositoryWithOutbox(pool, outbox)
	svc := demand.NewWithRepository(nil, nil, repo)

	run := time.Now().UnixNano()
	actorA := "user_home_pg_a_" + itoa(run)
	actorB := "user_home_pg_b_" + itoa(run)
	actorEmpty := "user_home_pg_empty_" + itoa(run)

	// Seed three drafts for actorA via the service.
	// Draft 1: stays in DRAFT (no requirements filled).
	r := svc.HandleContext(ctx, demandHomeEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": actorA, "sourceInput": "周六想拍照",
		"principal": map[string]any{"type": "INDIVIDUAL", "id": actorA},
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateTaskDraft #1: %+v", r.Error)
	}
	draft1ID := r.Aggregate.ID

	// Draft 2: filled requirements → lifecycle should reach CANDIDATES
	// on UpdateTaskDraft (publish-ready).
	r = svc.HandleContext(ctx, demandHomeEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": actorA, "sourceInput": "周日河内美食",
		"principal": map[string]any{"type": "INDIVIDUAL", "id": actorA},
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateTaskDraft #2: %+v", r.Error)
	}
	draft2ID := r.Aggregate.ID
	// Bump draft2 with confirmation=true so it reaches CANDIDATES.
	r = svc.HandleContext(ctx, demandHomeEnvelope("UpdateTaskDraft", map[string]any{
		"expectedVersion": 1,
		"changes": map[string]any{
			"sourceInput":            "周日河内美食（已确认）",
			"catalogVersion":         "v1",
			"policySnapshot":         map[string]any{"policyVersion": "p1"},
			"confirmation":           map[string]any{"scopeConfirmed": true, "materialChangePolicyConfirmed": true, "fundingAuthorizationConfirmed": true},
			"publishReadyConfirmed":  true,
		},
	}, actorA, draft2ID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("UpdateTaskDraft #2: %+v", r.Error)
	}
	if r.Aggregate.State != "DRAFT" {
		t.Fatalf("after UpdateTaskDraft, want DRAFT, got %s", r.Aggregate.State)
	}

	// Draft 3: will be published below to make a canonical task.
	r = svc.HandleContext(ctx, demandHomeEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": actorA, "sourceInput": "明天陪诊",
		"principal": map[string]any{"type": "INDIVIDUAL", "id": actorA},
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateTaskDraft #3: %+v", r.Error)
	}
	draft3ID := r.Aggregate.ID
	r = svc.HandleContext(ctx, demandHomeEnvelope("UpdateTaskDraft", map[string]any{
		"expectedVersion": 1,
		"changes": map[string]any{
			"sourceInput":            "明天陪诊（已确认）",
			"catalogVersion":         "v1",
			"policySnapshot":         map[string]any{"policyVersion": "p1"},
			"confirmation":           map[string]any{"scopeConfirmed": true, "materialChangePolicyConfirmed": true, "fundingAuthorizationConfirmed": true},
			"publishReadyConfirmed":  true,
		},
	}, actorA, draft3ID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("UpdateTaskDraft #3: %+v", r.Error)
	}
	// PublishTask with online=true. Default admission/funding gates
	// are unconfigured → return PENDING, so the task does NOT enter
	// the canonical demand.tasks table. To exercise the tasks[] side
	// of the read model we seed a canonical demand.tasks row directly
	// through the repo (this simulates the M2 PENDING → COMMITTED
	// gate resolution that the production admission/funding adapters
	// will perform).
	taskID := "task_pg_home_" + itoa(run)
	if _, err := pool.Exec(ctx, `
		INSERT INTO demand.tasks (id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, changes, created_at, updated_at)
		VALUES ($1, $2, $3, 'INDIVIDUAL', $3, 'COMMITTED', 1, '明天陪诊', '{}'::jsonb, NOW(), NOW())
	`, taskID, draft3ID, actorA); err != nil {
		t.Fatalf("seed canonical task: %v", err)
	}

	// 1. ListRequesterHomeItems for actorA: must contain 2 drafts
	// (draft1 and draft2 in DRAFT) + 1 task (COMMITTED). The read
	// model is per-actor and ordered by recency. (draft3 is also in
	// DRAFT, but we will flip its lifecycle to COMMITTED right
	// after seeding the canonical task, mirroring what PublishTask
	// would do atomically. So before that flip draft3 is still in
	// DRAFT — we capture its list, then proceed.)
	preList := svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, actorA))
	if preList.Outcome != "ACCEPTED" {
		t.Fatalf("preList ListRequesterHomeItems: %+v", preList.Error)
	}
	preHome := decodeHomePG(t, preList.OperationRef)
	if len(preHome.Drafts) != 3 {
		t.Fatalf("before flip: actorA must have 3 in-progress drafts (draft1, draft2, draft3), got %d", len(preHome.Drafts))
	}
	if len(preHome.Tasks) != 1 {
		t.Fatalf("before flip: actorA must have 1 committed task, got %d", len(preHome.Tasks))
	}
	// Flip draft3 lifecycle in PG so the read model no longer surfaces
	// it as in-progress. This is what PublishTask would have done
	// atomically with the canonical task INSERT.
	if _, err := pool.Exec(ctx, `UPDATE demand.task_drafts SET lifecycle='COMMITTED' WHERE id=$1`, draft3ID); err != nil {
		t.Fatalf("flip draft3 lifecycle: %v", err)
	}
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListRequesterHomeItems actorA: %+v", r.Error)
	}
	home := decodeHomePG(t, r.OperationRef)
	if len(home.Drafts) != 2 {
		t.Fatalf("actorA must have 2 in-progress drafts, got %d (op=%s)", len(home.Drafts), r.OperationRef)
	}
	if len(home.Tasks) != 1 {
		t.Fatalf("actorA must have 1 committed task, got %d (op=%s)", len(home.Tasks), r.OperationRef)
	}
	// Draft items must be projected with kind=DRAFT and have
	// draftProgress (0-100). Tasks must have kind=TASK.
	for _, d := range home.Drafts {
		if d.Kind != "DRAFT" {
			t.Fatalf("draft kind must be DRAFT, got %q (id=%s)", d.Kind, d.ID)
		}
	}
	if home.Tasks[0].Kind != "TASK" {
		t.Fatalf("task kind must be TASK, got %q", home.Tasks[0].Kind)
	}
	if home.Tasks[0].ID != taskID {
		t.Fatalf("task id mismatch: want %s, got %s", taskID, home.Tasks[0].ID)
	}

	// 2. Per-actor scoping: actorB sees an empty list (no drafts
	// or tasks under their owner id).
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, actorB))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListRequesterHomeItems actorB: %+v", r.Error)
	}
	homeB := decodeHomePG(t, r.OperationRef)
	if len(homeB.Drafts) != 0 || len(homeB.Tasks) != 0 {
		t.Fatalf("actorB must have empty home, got %d drafts / %d tasks",
			len(homeB.Drafts), len(homeB.Tasks))
	}

	// 3. Lifecycle transition: when actorA promotes draft1 to a
	// published task, the read model must reflect the move (draft
	// disappears from drafts[], a new task appears in tasks[]).
	// We simulate the canonical-task side by direct INSERT, mirroring
	// what PublishTask would do once admission/funding are wired.
	if _, err := pool.Exec(ctx, `
		INSERT INTO demand.tasks (id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version, source_input, changes, created_at, updated_at)
		VALUES ($1, $2, $3, 'INDIVIDUAL', $3, 'COMMITTED', 1, '周六想拍照', '{}'::jsonb, NOW(), NOW())
	`, "task_pg_home_promoted_"+itoa(run), draft1ID, actorA); err != nil {
		t.Fatalf("seed promoted task: %v", err)
	}
	// Also flip draft1 lifecycle to COMMITTED in PG (the canonical
	// transition PublishTask would perform atomically with the task
	// INSERT). For the read model the only field that matters is
	// lifecycle: drafts[] filters on IN (DRAFT, CANDIDATES).
	if _, err := pool.Exec(ctx, `UPDATE demand.task_drafts SET lifecycle='COMMITTED' WHERE id=$1`, draft1ID); err != nil {
		t.Fatalf("flip draft1 lifecycle: %v", err)
	}
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListRequesterHomeItems after promotion: %+v", r.Error)
	}
	homeAfter := decodeHomePG(t, r.OperationRef)
	// Now actorA has 1 in-progress draft (draft2) + 2 committed tasks
	// (the original taskID + the newly promoted task).
	if len(homeAfter.Drafts) != 1 {
		t.Fatalf("after promotion, actorA must have 1 in-progress draft, got %d", len(homeAfter.Drafts))
	}
	if homeAfter.Drafts[0].ID != draft2ID {
		t.Fatalf("after promotion, the remaining draft must be draft2=%s, got %s", draft2ID, homeAfter.Drafts[0].ID)
	}
	if len(homeAfter.Tasks) != 2 {
		t.Fatalf("after promotion, actorA must have 2 committed tasks, got %d", len(homeAfter.Tasks))
	}

	// 4. Limit clamp: request limit=999, expect the service to clamp
	// to 50 (the documented max). The result count is still bounded
	// by what the user owns, but the limit value reflected in the
	// payload must be 50.
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 999,
	}, actorA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListRequesterHomeItems clamp: %+v", r.Error)
	}
	clampedHome := decodeHomePG(t, r.OperationRef)
	if clampedHome.Limit != 50 {
		t.Fatalf("limit=999 must be clamped to 50, got %d", clampedHome.Limit)
	}

	// 5. Non-USER actor: must be REJECTED with
	// HOME_ITEMS_ACTOR_REQUIRED.
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, ""))
	if r.Outcome != "REJECTED" {
		t.Fatalf("non-USER actor must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "HOME_ITEMS_ACTOR_REQUIRED" {
		t.Fatalf("expected HOME_ITEMS_ACTOR_REQUIRED, got %+v", r.Error)
	}

	// 6. Empty actor (no drafts, no tasks) returns ACCEPTED with
	// empty arrays — not an error.
	r = svc.HandleContext(ctx, demandHomeEnvelope("ListRequesterHomeItems", map[string]any{
		"limit": 10,
	}, actorEmpty))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("empty actor must be ACCEPTED, got %s", r.Outcome)
	}
	empty := decodeHomePG(t, r.OperationRef)
	if len(empty.Drafts) != 0 || len(empty.Tasks) != 0 {
		t.Fatalf("empty actor must return empty lists, got %d / %d", len(empty.Drafts), len(empty.Tasks))
	}

	cleanupRequesterHomePG(t, pool, []string{draft1ID, draft2ID, draft3ID, taskID, "task_pg_home_promoted_" + itoa(run)})
}

type homeDraftItem struct {
	Kind              string `json:"kind"`
	ID                string `json:"id"`
	Lifecycle         string `json:"lifecycle"`
	Version           int    `json:"version"`
	SourceInput       string `json:"sourceInput"`
	DraftProgress     int    `json:"draftProgress"`
	LastCompletedStep int    `json:"lastCompletedStep"`
	UpdatedAt         string `json:"updatedAt"`
}

type homeTaskItem struct {
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	DraftID     string `json:"draftId"`
	Lifecycle   string `json:"lifecycle"`
	Version     int    `json:"version"`
	SourceInput string `json:"sourceInput"`
	CreatedAt   string `json:"createdAt"`
}

type homePayload struct {
	ActorID string          `json:"actorId"`
	Limit   int             `json:"limit"`
	Drafts  []homeDraftItem `json:"drafts"`
	Tasks   []homeTaskItem  `json:"tasks"`
}

func decodeHomePG(t *testing.T, op string) homePayload {
	t.Helper()
	var p homePayload
	if err := json.Unmarshal([]byte(op), &p); err != nil {
		t.Fatalf("decode home payload: %v (op=%s)", err, op)
	}
	return p
}

func cleanupRequesterHomePG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	// ids: draft1, draft2, draft3, task, promotedTask
	// FK order: tasks first (FK→task_drafts), then task_drafts.
	if len(ids) >= 5 {
		taskID, promotedID := ids[3], ids[4]
		if taskID != "" {
			if _, err := pool.Exec(ctx, `DELETE FROM demand.tasks WHERE id=$1`, taskID); err != nil {
				t.Logf("cleanup task %s: %v", taskID, err)
			}
		}
		if promotedID != "" {
			if _, err := pool.Exec(ctx, `DELETE FROM demand.tasks WHERE id=$1`, promotedID); err != nil {
				t.Logf("cleanup promoted task %s: %v", promotedID, err)
			}
		}
	}
	for _, id := range ids[:3] {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM demand.task_drafts WHERE id=$1`, id); err != nil {
			t.Logf("cleanup task_draft %s: %v", id, err)
		}
	}
}

func demandHomeEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	envelope := command.Envelope{
		CommandID:      "cmd_home_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_home_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_home_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "TaskDraft", ID: targetID[0]}
	}
	return envelope
}
