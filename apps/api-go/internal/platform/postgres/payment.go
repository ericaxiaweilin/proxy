package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/payment"
)

// PaymentRepository is the durable money-state adapter. Every method honors
// the request transaction context so command idempotency, ledger mutation and
// outbox publication can commit or roll back together.
type PaymentRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

func NewPaymentRepository(pool *pgxpool.Pool, outbox *OutboxRepository) *PaymentRepository {
	return &PaymentRepository{pool: pool, outbox: outbox}
}

func (r *PaymentRepository) CreateIntent(ctx context.Context, intent payment.PaymentIntent) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO payment.payment_intents
		(id, order_id, requester_id, agent_id, amount_minor, currency, status, provider_ref, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, intent.ID, intent.OrderID, intent.RequesterID,
		intent.AgentID, intent.AmountMinor, intent.Currency, intent.Status, intent.ProviderRef, intent.CreatedAt, intent.UpdatedAt)
	return err
}

func (r *PaymentRepository) GetIntent(ctx context.Context, id string) (payment.PaymentIntent, error) {
	var intent payment.PaymentIntent
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, order_id, requester_id, agent_id, amount_minor, currency, status,
		       COALESCE(provider_ref,''), created_at, updated_at
		FROM payment.payment_intents WHERE id=$1`, id).Scan(
		&intent.ID, &intent.OrderID, &intent.RequesterID, &intent.AgentID, &intent.AmountMinor,
		&intent.Currency, &intent.Status, &intent.ProviderRef, &intent.CreatedAt, &intent.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return payment.PaymentIntent{}, payment.ErrIntentNotFound
	}
	return intent, err
}

func (r *PaymentRepository) UpdateIntent(ctx context.Context, intent payment.PaymentIntent, expectedStatus string) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE payment.payment_intents
		SET status=$1, provider_ref=$2, updated_at=$3
		WHERE id=$4 AND status=$5`, intent.Status, intent.ProviderRef, intent.UpdatedAt, intent.ID, expectedStatus)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return payment.ErrIntentConflict
	}
	return nil
}

func (r *PaymentRepository) AddLedger(ctx context.Context, entries []payment.LedgerEntry) error {
	for _, entry := range entries {
		if _, err := queryerForContext(ctx, r.pool).Exec(ctx, `
			INSERT INTO payment.ledger_entries
			(id, payment_intent_id, order_id, entry_type, amount_minor, currency, created_at)
			VALUES ($1,NULLIF($2,''),$3,$4,$5,$6,$7)`, entry.ID, entry.PaymentIntentID, entry.OrderID,
			entry.EntryType, entry.AmountMinor, entry.Currency, entry.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}

func (r *PaymentRepository) ListLedger(ctx context.Context, orderID string) ([]payment.LedgerEntry, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, COALESCE(payment_intent_id,''), order_id, entry_type, amount_minor, currency, created_at
		FROM payment.ledger_entries WHERE order_id=$1 ORDER BY created_at, id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []payment.LedgerEntry{}
	for rows.Next() {
		var entry payment.LedgerEntry
		if err := rows.Scan(&entry.ID, &entry.PaymentIntentID, &entry.OrderID, &entry.EntryType, &entry.AmountMinor, &entry.Currency, &entry.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, entry)
	}
	return result, rows.Err()
}

func (r *PaymentRepository) CreatePayoutHold(ctx context.Context, hold payment.PayoutHold) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO payment.payout_holds
		(id, order_id, agent_id, amount_minor, currency, status, created_at, released_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, hold.ID, hold.OrderID, hold.AgentID, hold.AmountMinor,
		hold.Currency, hold.Status, hold.CreatedAt, hold.ReleasedAt)
	return err
}

func (r *PaymentRepository) GetPayoutHold(ctx context.Context, id string) (payment.PayoutHold, error) {
	var hold payment.PayoutHold
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, order_id, agent_id, amount_minor, currency, status, created_at, released_at
		FROM payment.payout_holds WHERE id=$1`, id).Scan(&hold.ID, &hold.OrderID, &hold.AgentID,
		&hold.AmountMinor, &hold.Currency, &hold.Status, &hold.CreatedAt, &hold.ReleasedAt)
	return hold, err
}

func (r *PaymentRepository) UpdatePayoutHold(ctx context.Context, hold payment.PayoutHold) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE payment.payout_holds SET status=$1, released_at=$2
		WHERE id=$3 AND status='HELD'`, hold.Status, hold.ReleasedAt, hold.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return payment.ErrIntentConflict
	}
	return nil
}

func (r *PaymentRepository) ProviderEventExists(ctx context.Context, providerEventID string) (bool, error) {
	var exists bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM payment.provider_events WHERE provider_event_id=$1)`, providerEventID).Scan(&exists)
	return exists, err
}

func (r *PaymentRepository) SaveProviderEvent(ctx context.Context, providerEventID, paymentIntentID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO payment.provider_events (provider_event_id, payment_intent_id, payload, received_at)
		VALUES ($1,$2,$3,NOW()) ON CONFLICT (provider_event_id) DO NOTHING`, providerEventID, paymentIntentID, raw)
	return err
}

func (r *PaymentRepository) CreateIntentAndLedgerAndPublish(ctx context.Context, intent payment.PaymentIntent, entries []payment.LedgerEntry, events []event.DomainEvent) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		if err := r.CreateIntent(txCtx, intent); err != nil {
			return err
		}
		if err := r.AddLedger(txCtx, entries); err != nil {
			return err
		}
		return r.publish(txCtx, events)
	})
}

func (r *PaymentRepository) UpdateIntentAndLedgerAndPublish(ctx context.Context, intent payment.PaymentIntent, entries []payment.LedgerEntry, expectedStatus string, events []event.DomainEvent) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		if err := r.UpdateIntent(txCtx, intent, expectedStatus); err != nil {
			return err
		}
		if err := r.AddLedger(txCtx, entries); err != nil {
			return err
		}
		return r.publish(txCtx, events)
	})
}

func (r *PaymentRepository) publish(ctx context.Context, events []event.DomainEvent) error {
	if len(events) == 0 {
		return nil
	}
	if r.outbox == nil {
		return errors.New("payment outbox unavailable")
	}
	for _, domainEvent := range events {
		if err := r.outbox.publishWithExec(ctx, queryerForContext(ctx, r.pool), domainEvent); err != nil {
			return err
		}
	}
	return nil
}

var _ payment.TransactionalRepository = (*PaymentRepository)(nil)
