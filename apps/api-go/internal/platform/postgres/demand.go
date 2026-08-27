package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/demand"
	"github.com/proxy-app/proxy-api/internal/event"
)

type DemandRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewDemandRepository(pool *pgxpool.Pool) *DemandRepository {
	return &DemandRepository{pool: pool}
}

func NewDemandRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *DemandRepository {
	return &DemandRepository{pool: pool, outbox: outboxRepository}
}

func (r *DemandRepository) CreateDraft(ctx context.Context, draft demand.TaskDraft) error {
	return insertDraft(ctx, execerForContext(ctx, r.pool), draft)
}

func insertDraft(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, draft demand.TaskDraft) error {
	changes, slots, err := encodeDraftJSON(draft)
	if err != nil {
		return err
	}
	_, err = execer.Exec(ctx, `
		INSERT INTO demand.task_drafts (
			id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
			source_input, draft_progress, last_completed_step, changes, slots, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		draft.ID,
		draft.OwnerUserAccountID,
		draft.Principal.Type,
		draft.Principal.ID,
		draft.Lifecycle,
		draft.Version,
		draft.SourceInput,
		draft.DraftProgress,
		draft.LastCompletedStep,
		changes,
		slots,
		draft.UpdatedAt,
	)
	return err
}

func (r *DemandRepository) CreateDraftAndPublish(ctx context.Context, draft demand.TaskDraft, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("demand transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := insertDraft(transactionContext, transaction, draft); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *DemandRepository) GetDraft(ctx context.Context, id string) (demand.TaskDraft, error) {
	var draft demand.TaskDraft
	var principalType, principalID string
	var changes, slots []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
		       source_input, draft_progress, last_completed_step, changes, slots, updated_at
		FROM demand.task_drafts
		WHERE id = $1`, id).Scan(
		&draft.ID,
		&draft.OwnerUserAccountID,
		&principalType,
		&principalID,
		&draft.Lifecycle,
		&draft.Version,
		&draft.SourceInput,
		&draft.DraftProgress,
		&draft.LastCompletedStep,
		&changes,
		&slots,
		&draft.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return demand.TaskDraft{}, demand.ErrDraftNotFound
	}
	if err != nil {
		return demand.TaskDraft{}, err
	}
	draft.Principal = command.Principal{Type: principalType, ID: principalID}
	if err := json.Unmarshal(changes, &draft.Changes); err != nil {
		return demand.TaskDraft{}, fmt.Errorf("decode task draft changes: %w", err)
	}
	if err := json.Unmarshal(slots, &draft.Slots); err != nil {
		return demand.TaskDraft{}, fmt.Errorf("decode task draft slots: %w", err)
	}
	return draft, nil
}

func (r *DemandRepository) UpdateDraft(ctx context.Context, draft demand.TaskDraft, expectedVersion int) error {
	return updateDraft(ctx, execerForContext(ctx, r.pool), draft, expectedVersion)
}

func updateDraft(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, draft demand.TaskDraft, expectedVersion int) error {
	changes, slots, err := encodeDraftJSON(draft)
	if err != nil {
		return err
	}
	commandTag, err := execer.Exec(ctx, `
		UPDATE demand.task_drafts
		SET lifecycle = $1,
		    version = $2,
		    source_input = $3,
		    draft_progress = $4,
		    last_completed_step = $5,
		    changes = $6,
		    slots = $7,
		    updated_at = $8
		WHERE id = $9 AND version = $10`,
		draft.Lifecycle,
		draft.Version,
		draft.SourceInput,
		draft.DraftProgress,
		draft.LastCompletedStep,
		changes,
		slots,
		draft.UpdatedAt,
		draft.ID,
		expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return demand.ErrVersionConflict
	}
	return nil
}

func (r *DemandRepository) UpdateDraftAndPublish(ctx context.Context, draft demand.TaskDraft, expectedVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("demand transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := updateDraft(transactionContext, transaction, draft, expectedVersion); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *DemandRepository) GetTask(ctx context.Context, id string) (demand.Task, error) {
	var task demand.Task
	var principalType, principalID string
	var changes []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
		       source_input, changes, created_at, updated_at
		FROM demand.tasks
		WHERE id = $1`, id).Scan(
		&task.ID, &task.DraftID, &task.OwnerUserAccountID, &principalType, &principalID,
		&task.Lifecycle, &task.Version, &task.SourceInput, &changes, &task.CreatedAt, &task.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return demand.Task{}, demand.ErrDraftNotFound
	}
	if err != nil {
		return demand.Task{}, err
	}
	task.Principal = command.Principal{Type: principalType, ID: principalID}
	if err := json.Unmarshal(changes, &task.Changes); err != nil {
		return demand.Task{}, fmt.Errorf("decode task changes: %w", err)
	}
	slots, err := r.ListTaskSlots(ctx, task.ID)
	if err != nil {
		return demand.Task{}, err
	}
	task.Slots = slots
	return task, nil
}

func (r *DemandRepository) ListTaskSlots(ctx context.Context, taskID string) ([]demand.TaskSlot, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, task_id, role_id, state, version, created_at, updated_at
		FROM demand.task_slots
		WHERE task_id = $1
		ORDER BY id`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []demand.TaskSlot{}
	for rows.Next() {
		var slot demand.TaskSlot
		var taskIDScan string
		var createdAt, updatedAt time.Time
		var version int
		if err := rows.Scan(&slot.ID, &taskIDScan, &slot.RoleID, &slot.State, &version, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		result = append(result, slot)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *DemandRepository) PublishTaskAndCreateCanonical(ctx context.Context, draft demand.TaskDraft, expectedVersion int, slots []demand.TaskSlot, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("demand transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := updateDraft(transactionContext, transaction, draft, expectedVersion); err != nil {
			return err
		}
		changesJSON, err := json.Marshal(draft.Changes)
		if err != nil {
			return fmt.Errorf("encode task changes: %w", err)
		}
		if _, err := transaction.Exec(transactionContext, `
			INSERT INTO demand.tasks (
				id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
				source_input, changes, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			draft.ID, draft.ID, draft.OwnerUserAccountID, draft.Principal.Type, draft.Principal.ID,
			draft.Lifecycle, draft.Version, draft.SourceInput, changesJSON, draft.UpdatedAt, draft.UpdatedAt); err != nil {
			return err
		}
		for _, slot := range slots {
			if _, err := transaction.Exec(transactionContext, `
				INSERT INTO demand.task_slots (id, task_id, role_id, state, version, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				slot.ID, draft.ID, slot.RoleID, slot.State, 1, draft.UpdatedAt, draft.UpdatedAt); err != nil {
				return err
			}
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *DemandRepository) Snapshot(ctx context.Context) ([]demand.TaskDraft, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
		       source_input, draft_progress, last_completed_step, changes, slots, updated_at
		FROM demand.task_drafts
		ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []demand.TaskDraft{}
	for rows.Next() {
		var draft demand.TaskDraft
		var principalType, principalID string
		var changes, slots []byte
		if err := rows.Scan(
			&draft.ID,
			&draft.OwnerUserAccountID,
			&principalType,
			&principalID,
			&draft.Lifecycle,
			&draft.Version,
			&draft.SourceInput,
			&draft.DraftProgress,
			&draft.LastCompletedStep,
			&changes,
			&slots,
			&draft.UpdatedAt,
		); err != nil {
			return nil, err
		}
		draft.Principal = command.Principal{Type: principalType, ID: principalID}
		if err := json.Unmarshal(changes, &draft.Changes); err != nil {
			return nil, fmt.Errorf("decode task draft changes: %w", err)
		}
		if err := json.Unmarshal(slots, &draft.Slots); err != nil {
			return nil, fmt.Errorf("decode task draft slots: %w", err)
		}
		result = append(result, draft)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// ListDraftsByOwner returns in-progress task drafts owned by the given
// user, ordered by updated_at DESC. Used by the server-backed
// Requester Home read model to surface drafts that the user has
// started but not yet published — a draft's lifecycle stays non-terminal
// until PublishTask promotes it to a canonical demand.tasks row.
func (r *DemandRepository) ListDraftsByOwner(ctx context.Context, ownerUserID string, limit int) ([]demand.TaskDraft, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
		       source_input, draft_progress, last_completed_step, changes, slots, updated_at
		FROM demand.task_drafts
		WHERE owner_user_account_id = $1
		  AND lifecycle IN ('DRAFT', 'CANDIDATES')
		ORDER BY updated_at DESC
		LIMIT $2`, ownerUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDraftsPG(rows)
}

// ListTasksByOwner returns canonical (published) tasks owned by the
// given user, ordered by created_at DESC. Used by the Requester Home
// read model to surface tasks that the user has already published but
// not yet completed/cancelled.
func (r *DemandRepository) ListTasksByOwner(ctx context.Context, ownerUserID string, limit int) ([]demand.Task, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, draft_id, owner_user_account_id, principal_type, principal_id, lifecycle, version,
		       source_input, changes, created_at, updated_at
		FROM demand.tasks
		WHERE owner_user_account_id = $1
		  AND lifecycle = 'COMMITTED'
		ORDER BY created_at DESC
		LIMIT $2`, ownerUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []demand.Task{}
	for rows.Next() {
		var task demand.Task
		var principalType, principalID string
		var changes []byte
		if err := rows.Scan(
			&task.ID,
			&task.DraftID,
			&task.OwnerUserAccountID,
			&principalType,
			&principalID,
			&task.Lifecycle,
			&task.Version,
			&task.SourceInput,
			&changes,
			&task.CreatedAt,
			&task.UpdatedAt,
		); err != nil {
			return nil, err
		}
		task.Principal = command.Principal{Type: principalType, ID: principalID}
		if err := json.Unmarshal(changes, &task.Changes); err != nil {
			return nil, fmt.Errorf("decode task changes: %w", err)
		}
		result = append(result, task)
	}
	return result, rows.Err()
}

func scanDraftsPG(rows pgx.Rows) ([]demand.TaskDraft, error) {
	result := []demand.TaskDraft{}
	for rows.Next() {
		var draft demand.TaskDraft
		var principalType, principalID string
		var changes, slots []byte
		if err := rows.Scan(
			&draft.ID,
			&draft.OwnerUserAccountID,
			&principalType,
			&principalID,
			&draft.Lifecycle,
			&draft.Version,
			&draft.SourceInput,
			&draft.DraftProgress,
			&draft.LastCompletedStep,
			&changes,
			&slots,
			&draft.UpdatedAt,
		); err != nil {
			return nil, err
		}
		draft.Principal = command.Principal{Type: principalType, ID: principalID}
		if err := json.Unmarshal(changes, &draft.Changes); err != nil {
			return nil, fmt.Errorf("decode task draft changes: %w", err)
		}
		if err := json.Unmarshal(slots, &draft.Slots); err != nil {
			return nil, fmt.Errorf("decode task draft slots: %w", err)
		}
		result = append(result, draft)
	}
	return result, rows.Err()
}

func encodeDraftJSON(draft demand.TaskDraft) ([]byte, []byte, error) {
	changes, err := json.Marshal(draft.Changes)
	if err != nil {
		return nil, nil, fmt.Errorf("encode task draft changes: %w", err)
	}
	slots, err := json.Marshal(draft.Slots)
	if err != nil {
		return nil, nil, fmt.Errorf("encode task draft slots: %w", err)
	}
	return changes, slots, nil
}

var _ demand.Repository = (*DemandRepository)(nil)
var _ demand.TransactionalRepository = (*DemandRepository)(nil)
