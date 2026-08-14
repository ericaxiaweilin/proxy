package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

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
