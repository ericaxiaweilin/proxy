package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
)

// FulfillmentRepository 持久化 Order（北极星 Traceable Human Order 的可回放载体）。
type FulfillmentRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewFulfillmentRepository(pool *pgxpool.Pool) *FulfillmentRepository {
	return &FulfillmentRepository{pool: pool}
}

func NewFulfillmentRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *FulfillmentRepository {
	return &FulfillmentRepository{pool: pool, outbox: outboxRepository}
}

func (r *FulfillmentRepository) CreateOrder(ctx context.Context, order fulfillment.Order) error {
	return insertOrder(ctx, execerForContext(ctx, r.pool), order)
}

func insertOrder(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, order fulfillment.Order) error {
	snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
	if err != nil {
		return err
	}
	_, err = execer.Exec(ctx, `
		INSERT INTO fulfillment.orders (
			id, requester_id, agent_id, need_id, lifecycle, version,
			snapshot, amendments, settlement, outcome, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		order.ID, order.RequesterID, order.AgentID, order.NeedID, order.Lifecycle, order.Version,
		snapshot, amendments, settlement, outcome, order.CreatedAt, order.UpdatedAt,
	)
	return err
}

func (r *FulfillmentRepository) CreateOrderAndPublish(ctx context.Context, order fulfillment.Order, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := insertOrder(transactionContext, transaction, order); err != nil {
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

func (r *FulfillmentRepository) GetOrder(ctx context.Context, id string) (fulfillment.Order, error) {
	var order fulfillment.Order
	var snapshot, amendments, settlement, outcome []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, requester_id, agent_id, need_id, lifecycle, version,
		       snapshot, amendments, settlement, outcome, created_at, updated_at
		FROM fulfillment.orders
		WHERE id = $1`, id).Scan(
		&order.ID, &order.RequesterID, &order.AgentID, &order.NeedID, &order.Lifecycle, &order.Version,
		&snapshot, &amendments, &settlement, &outcome, &order.CreatedAt, &order.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return fulfillment.Order{}, fulfillment.ErrOrderNotFound
	}
	if err != nil {
		return fulfillment.Order{}, err
	}
	if err := json.Unmarshal(snapshot, &order.Snapshot); err != nil {
		return fulfillment.Order{}, fmt.Errorf("decode order snapshot: %w", err)
	}
	if err := json.Unmarshal(amendments, &order.Amendments); err != nil {
		return fulfillment.Order{}, fmt.Errorf("decode order amendments: %w", err)
	}
	if len(settlement) > 0 {
		if err := json.Unmarshal(settlement, &order.Settlement); err != nil {
			return fulfillment.Order{}, fmt.Errorf("decode order settlement: %w", err)
		}
	}
	if len(outcome) > 0 {
		if err := json.Unmarshal(outcome, &order.Outcome); err != nil {
			return fulfillment.Order{}, fmt.Errorf("decode order outcome: %w", err)
		}
	}
	return order, nil
}

func (r *FulfillmentRepository) UpdateOrder(ctx context.Context, order fulfillment.Order, expectedVersion int) error {
	return updateOrder(ctx, execerForContext(ctx, r.pool), order, expectedVersion)
}

func updateOrder(ctx context.Context, execer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}, order fulfillment.Order, expectedVersion int) error {
	snapshot, amendments, settlement, outcome, err := encodeOrderJSON(order)
	if err != nil {
		return err
	}
	commandTag, err := execer.Exec(ctx, `
		UPDATE fulfillment.orders
		SET lifecycle = $1, version = $2, snapshot = $3, amendments = $4,
		    settlement = $5, outcome = $6, updated_at = $7
		WHERE id = $8 AND version = $9`,
		order.Lifecycle, order.Version, snapshot, amendments, settlement, outcome, order.UpdatedAt,
		order.ID, expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return fulfillment.ErrVersionConflict
	}
	return nil
}

func (r *FulfillmentRepository) UpdateOrderAndPublish(ctx context.Context, order fulfillment.Order, expectedVersion int, domainEvents []event.DomainEvent) error {
	if r.outbox == nil {
		return errors.New("fulfillment transactional outbox is not configured")
	}
	return runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		if err := updateOrder(transactionContext, transaction, order, expectedVersion); err != nil {
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

func (r *FulfillmentRepository) Snapshot(ctx context.Context) ([]fulfillment.Order, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, requester_id, agent_id, need_id, lifecycle, version,
		       snapshot, amendments, settlement, outcome, created_at, updated_at
		FROM fulfillment.orders
		ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []fulfillment.Order{}
	for rows.Next() {
		var order fulfillment.Order
		var snapshot, amendments, settlement, outcome []byte
		if err := rows.Scan(
			&order.ID, &order.RequesterID, &order.AgentID, &order.NeedID, &order.Lifecycle, &order.Version,
			&snapshot, &amendments, &settlement, &outcome, &order.CreatedAt, &order.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(snapshot, &order.Snapshot); err != nil {
			return nil, fmt.Errorf("decode order snapshot: %w", err)
		}
		if err := json.Unmarshal(amendments, &order.Amendments); err != nil {
			return nil, fmt.Errorf("decode order amendments: %w", err)
		}
		if len(settlement) > 0 {
			if err := json.Unmarshal(settlement, &order.Settlement); err != nil {
				return nil, fmt.Errorf("decode order settlement: %w", err)
			}
		}
		if len(outcome) > 0 {
			if err := json.Unmarshal(outcome, &order.Outcome); err != nil {
				return nil, fmt.Errorf("decode order outcome: %w", err)
			}
		}
		result = append(result, order)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func encodeOrderJSON(order fulfillment.Order) ([]byte, []byte, []byte, []byte, error) {
	snapshot, err := json.Marshal(order.Snapshot)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode order snapshot: %w", err)
	}
	amendments, err := json.Marshal(order.Amendments)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("encode order amendments: %w", err)
	}
	var settlement, outcome []byte
	if order.Settlement != nil {
		settlement, err = json.Marshal(order.Settlement)
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("encode order settlement: %w", err)
		}
	}
	if order.Outcome != nil {
		outcome, err = json.Marshal(order.Outcome)
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("encode order outcome: %w", err)
		}
	}
	return snapshot, amendments, settlement, outcome, nil
}

var _ fulfillment.Repository = (*FulfillmentRepository)(nil)
