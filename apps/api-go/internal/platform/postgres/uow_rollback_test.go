package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/event"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://proxy:proxy@localhost:5432/proxy"
	}
	pool, err := Open(context.Background(), url)
	if err != nil {
		t.Skipf("postgres not available: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("postgres ping failed: %v", err)
	}
	return pool
}

func TestTransactionRunnerRollbackOnError(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	runner := NewTransactionRunner(pool)
	outbox := NewOutboxRepository(pool)
	demandRepo := NewDemandRepositoryWithOutbox(pool, outbox)
	ctx := context.Background()
	draftID := "draft_uow_rb_" + time.Now().Format("150405.000")
	draft := demand.TaskDraft{
		ID: draftID, OwnerUserAccountID: "user_001",
		Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Lifecycle: "DRAFT", Version: 1, SourceInput: "rollback test",
		Changes: map[string]any{}, Slots: []demand.TaskSlot{}, UpdatedAt: time.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("TaskDraftCreated", "TaskDraft", draftID, 1, "business_001", "corr_rb", "cmd_rb", time.Now().UTC(), nil)}
	err := runner.WithinTransaction(ctx, func(txCtx context.Context) error {
		if err := demandRepo.CreateDraftAndPublish(txCtx, draft, domainEvents); err != nil {
			return err
		}
		return context.Canceled // force rollback
	})
	if err == nil {
		t.Fatal("expected rollback error")
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM demand.task_drafts WHERE id=$1`, draftID).Scan(&count); err != nil {
		t.Fatalf("count query: %v", err)
	}
	if count != 0 {
		t.Fatalf("rollback failed: draft still visible count=%d", count)
	}
	var outboxCount int
	pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE event_id=$1`, domainEvents[0].EventID).Scan(&outboxCount)
	if outboxCount != 0 {
		t.Fatalf("rollback failed: outbox still visible count=%d", outboxCount)
	}
	// cleanup in case leaked
	pool.Exec(ctx, `DELETE FROM demand.task_drafts WHERE id=$1`, draftID)
	pool.Exec(ctx, `DELETE FROM integration.outbox_messages WHERE event_id=$1`, domainEvents[0].EventID)
}

func TestIdempotencyAndAggregateAtomic(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	runner := NewTransactionRunner(pool)
	idem := NewIdempotencyStore(pool)
	outbox := NewOutboxRepository(pool)
	demandRepo := NewDemandRepositoryWithOutbox(pool, outbox)
	ctx := context.Background()
	scope := "test:uow_atomic"
	key := "idem_atomic_" + time.Now().Format("150405.000000")
	fingerprint := `{"test":"atomic"}`
	// Successful UoW: idempotency claim + draft insert + outbox event in one tx -> commit
	draftID := "draft_atomic_" + time.Now().Format("150405.000000")
	draft := demand.TaskDraft{
		ID: "draft_atomic_holder", OwnerUserAccountID: "user_001",
		Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Lifecycle: "DRAFT", Version: 1, SourceInput: "atomic test",
		Changes: map[string]any{}, Slots: []demand.TaskSlot{}, UpdatedAt: time.Now().UTC(),
	}
	draft.ID = draftID
	domainEvents := []event.DomainEvent{event.New("TaskDraftCreated", "TaskDraft", draftID, 1, "business_001", "corr_atomic", "cmd_atomic", time.Now().UTC(), map[string]any{"owner": "user_001"})}
	err := runner.WithinTransaction(ctx, func(txCtx context.Context) error {
		decision, _, err := idem.Begin(txCtx, scope, key, fingerprint)
		if err != nil {
			return err
		}
		if decision != command.IdempotencyClaimed {
			t.Fatalf("expected claimed got %v", decision)
		}
		if err := demandRepo.CreateDraftAndPublish(txCtx, draft, domainEvents); err != nil {
			return err
		}
		return idem.Complete(txCtx, scope, key, command.IdempotencyRecord{Fingerprint: fingerprint, Result: command.Result{CommandID: "cmd_atomic", Outcome: "ACCEPTED", CorrelationID: "corr_atomic"}})
	})
	if err != nil {
		t.Fatalf("atomic commit failed: %v", err)
	}
	// Verify all three persisted
	var draftCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM demand.task_drafts WHERE id=$1`, draftID).Scan(&draftCount); err != nil {
		t.Fatalf("draft count: %v", err)
	}
	if draftCount != 1 {
		t.Fatalf("expected draft committed, count=%d", draftCount)
	}
	var idemStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM integration.idempotency_records WHERE scope=$1 AND idempotency_key=$2`, scope, key).Scan(&idemStatus); err != nil {
		t.Fatalf("idem status: %v", err)
	}
	if idemStatus != "COMPLETED" {
		t.Fatalf("expected COMPLETED got %q", idemStatus)
	}
	var outboxCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE event_id=$1`, domainEvents[0].EventID).Scan(&outboxCount); err != nil {
		t.Fatalf("outbox count: %v", err)
	}
	if outboxCount != 1 {
		t.Fatalf("expected outbox 1 got %d", outboxCount)
	}
	// Cleanup
	pool.Exec(ctx, `DELETE FROM integration.outbox_messages WHERE event_id=$1`, domainEvents[0].EventID)
	pool.Exec(ctx, `DELETE FROM integration.idempotency_records WHERE scope=$1 AND idempotency_key=$2`, scope, key)
	pool.Exec(ctx, `DELETE FROM demand.task_drafts WHERE id=$1`, draftID)

	// Failure UoW: claim + draft insert then forced error -> all rolled back
	scope2 := scope + "_rollback"
	key2 := key + "_rb"
	draftID2 := draftID + "_rb2"
	draft2 := draft
	draft2.ID = draftID2
	domainEvents2 := []event.DomainEvent{event.New("TaskDraftCreated", "TaskDraft", draftID2, 1, "business_001", "corr_rb", "cmd_rb", time.Now().UTC(), nil)}
	err = runner.WithinTransaction(ctx, func(txCtx context.Context) error {
		if _, _, err := idem.Begin(txCtx, scope2, key2, fingerprint); err != nil {
			return err
		}
		if err := demandRepo.CreateDraftAndPublish(txCtx, draft2, domainEvents2); err != nil {
			return err
		}
		return context.Canceled // force rollback
	})
	if err == nil {
		t.Fatal("expected forced rollback")
	}
	var cnt2 int
	pool.QueryRow(ctx, `SELECT count(*) FROM demand.task_drafts WHERE id=$1`, draftID2).Scan(&cnt2)
	if cnt2 != 0 {
		t.Fatalf("rollback failed: draft2 visible %d", cnt2)
	}
	var idemCnt int
	pool.QueryRow(ctx, `SELECT count(*) FROM integration.idempotency_records WHERE scope=$1 AND idempotency_key=$2`, scope2, key2).Scan(&idemCnt)
	if idemCnt != 0 {
		t.Fatalf("rollback failed: idempotency record persisted %d", idemCnt)
	}
	var outboxCnt2 int
	pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE event_id=$1`, domainEvents2[0].EventID).Scan(&outboxCnt2)
	if outboxCnt2 != 0 {
		t.Fatalf("rollback failed: outbox persisted %d", outboxCnt2)
	}
}

func TestPublishTaskCanonicalAtomic(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	outbox := NewOutboxRepository(pool)
	repo := NewDemandRepositoryWithOutbox(pool, outbox)
	ctx := context.Background()
	draftID := "draft_canonical_" + time.Now().Format("150405.000000000")
	now := time.Now().UTC()
	draft := demand.TaskDraft{
		ID: draftID, OwnerUserAccountID: "user_001",
		Principal: command.Principal{Type: "BUSINESS", ID: "business_001"},
		Lifecycle: "DRAFT", Version: 1, SourceInput: "canonical test",
		Changes: map[string]any{
			"industry": "events", "scenario": "opening",
			"slotGroups": []any{map[string]any{"roleId": "GREETER", "quantity": float64(2)}},
		},
		Slots: []demand.TaskSlot{}, UpdatedAt: now,
	}
	// create draft
	if err := repo.CreateDraft(ctx, draft); err != nil {
		t.Fatalf("create draft: %v", err)
	}
	defer pool.Exec(ctx, `DELETE FROM demand.task_slots WHERE task_id=$1`, draftID)
	defer pool.Exec(ctx, `DELETE FROM demand.tasks WHERE id=$1`, draftID)
	defer pool.Exec(ctx, `DELETE FROM demand.task_drafts WHERE id=$1`, draftID)
	// update to version 2 with required fields for publish
	draft.Version = 2
	draft.Changes = map[string]any{
		"industry": "events", "scenario": "opening", "startAt": "2026-08-20T09:00:00Z", "endAt": "2026-08-20T12:00:00Z",
		"location": map[string]any{"mode": "PLACE_ONLY", "label": "District 1"},
		"slotGroups": []any{map[string]any{"roleId": "GREETER", "quantity": float64(2)}},
		"mustRequirements": []any{"arrive_on_time"}, "deliverables": []any{"attendance_report"},
		"budget": map[string]any{"currency": "USD", "amountMinor": 5000, "pricingMode": "PER_SLOT_FIXED"},
		"matchingMode": "CURATED", "catalogVersion": "CATALOG_V1",
		"policySnapshot": map[string]any{"policySetId": "PSET", "policySetVersion": "1"},
		"confirmation":  map[string]any{"scopeConfirmed": true, "materialChangePolicyConfirmed": true, "fundingAuthorizationConfirmed": true},
	}
	draft.UpdatedAt = time.Now().UTC()
	if err := repo.UpdateDraft(ctx, draft, 1); err != nil {
		t.Fatalf("update draft: %v", err)
	}
	// publish with canonical
	slots := []demand.TaskSlot{{ID: "slot_can_" + draftID + "_1", RoleID: "GREETER", State: "OPEN"}, {ID: "slot_can_" + draftID + "_2", RoleID: "GREETER", State: "OPEN"}}
	draft.Lifecycle = "COMMITTED"
	draft.Version = 3
	draft.Slots = slots
	draft.UpdatedAt = time.Now().UTC()
	domainEvents := []event.DomainEvent{
		event.New("TaskPublished", "Task", draftID, 3, "business_001", "corr_can", "cmd_can", draft.UpdatedAt, map[string]any{"slotCount": 2}),
		event.New("TaskSlotsCreated", "Task", draftID, 3, "business_001", "corr_can", "cmd_can", draft.UpdatedAt, map[string]any{"slotCount": 2}),
	}
	if err := repo.PublishTaskAndCreateCanonical(ctx, draft, 2, slots, domainEvents); err != nil {
		t.Fatalf("publish canonical: %v", err)
	}
	// verify canonical rows
	task, err := repo.GetTask(ctx, draftID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Lifecycle != "COMMITTED" || len(task.Slots) != 2 {
		t.Fatalf("task mismatch: %#v", task)
	}
	listed, err := repo.ListTaskSlots(ctx, draftID)
	if err != nil || len(listed) != 2 {
		t.Fatalf("list slots: %v len=%d", err, len(listed))
	}
	// verify outbox events
	var cnt int
	pool.QueryRow(ctx, `SELECT count(*) FROM integration.outbox_messages WHERE aggregate_id=$1`, draftID).Scan(&cnt)
	if cnt < 2 {
		t.Fatalf("expected outbox >=2 got %d", cnt)
	}
	// rollback check: duplicate task PK should fail and rollback draft update
	draft2 := draft
	draft2.Version = 4
	draft2.UpdatedAt = time.Now().UTC()
	// attempt to publish again with same task id without version bump on draft (expectedVersion 3 but task already exists) -> should fail due to PK duplicate and rolled back
	err = repo.PublishTaskAndCreateCanonical(ctx, draft2, 3, slots, domainEvents)
	if err == nil {
		t.Fatalf("expected duplicate PK failure")
	}
	// draft should still be version 3, not 4
	after, _ := repo.GetDraft(ctx, draftID)
	if after.Version != 3 {
		t.Fatalf("rollback failed: draft version mutated to %d", after.Version)
	}
}
