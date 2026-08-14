package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/outbox"
)

type OutboxRepository struct {
	pool *pgxpool.Pool
}

func NewOutboxRepository(pool *pgxpool.Pool) *OutboxRepository {
	return &OutboxRepository{pool: pool}
}

func (r *OutboxRepository) Publish(ctx context.Context, e event.DomainEvent) error {
	return r.publishWithExec(ctx, r.pool, e)
}

func (r *OutboxRepository) publishWithExec(ctx context.Context, execer sqlExecer, e event.DomainEvent) error {
	payload, err := e.MarshalPayload()
	if err != nil {
		return err
	}
	_, err = execer.Exec(ctx, `
		INSERT INTO integration.outbox_messages (
			event_id, event_type, event_version, aggregate_type, aggregate_id,
			aggregate_version, principal_id, occurred_at, correlation_id, causation_id, payload
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (event_id) DO NOTHING`,
		e.EventID,
		e.EventType,
		e.EventVersion,
		e.AggregateType,
		e.AggregateID,
		e.AggregateVersion,
		e.PrincipalID,
		e.OccurredAt,
		e.CorrelationID,
		nullableText(e.CausationID),
		payload,
	)
	return err
}

func (r *OutboxRepository) Claim(ctx context.Context, workerID string, limit int, now time.Time) ([]outbox.Message, error) {
	if limit <= 0 {
		return []outbox.Message{}, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE integration.outbox_messages
		SET status = 'PENDING', worker_id = NULL, processing_at = NULL, available_at = $1
		WHERE status = 'PROCESSING' AND processing_at < $1 - interval '5 minutes'`, now.UTC()); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		WITH claimed AS (
			SELECT outbox_id
			FROM integration.outbox_messages
			WHERE status IN ('PENDING', 'FAILED') AND available_at <= $1
			ORDER BY available_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE integration.outbox_messages AS messages
		SET status = 'PROCESSING', attempts = messages.attempts + 1,
			worker_id = $3, processing_at = $1
		FROM claimed
		WHERE messages.outbox_id = claimed.outbox_id
		RETURNING messages.event_id, messages.event_type, messages.event_version,
			messages.aggregate_type, messages.aggregate_id, messages.aggregate_version,
			messages.principal_id, messages.occurred_at, messages.correlation_id,
			messages.causation_id, messages.payload, messages.status, messages.attempts,
			messages.available_at, COALESCE(messages.last_error, '')`,
		now.UTC(), limit, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []outbox.Message{}
	for rows.Next() {
		var e event.DomainEvent
		var payload []byte
		var causationID *string
		var message outbox.Message
		if err := rows.Scan(
			&e.EventID, &e.EventType, &e.EventVersion, &e.AggregateType, &e.AggregateID,
			&e.AggregateVersion, &e.PrincipalID, &e.OccurredAt, &e.CorrelationID,
			&causationID, &payload, &message.Status, &message.Attempts,
			&message.AvailableAt, &message.LastError,
		); err != nil {
			return nil, err
		}
		if causationID != nil {
			e.CausationID = *causationID
		}
		if err := json.Unmarshal(payload, &e.Payload); err != nil {
			return nil, err
		}
		message.Event = e
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *OutboxRepository) MarkSent(ctx context.Context, workerID, eventID string, sentAt time.Time) error {
	commandTag, err := r.pool.Exec(ctx, `
		UPDATE integration.outbox_messages
		SET status = 'SENT', sent_at = $1, worker_id = NULL, processing_at = NULL
		WHERE event_id = $2 AND status = 'PROCESSING' AND worker_id = $3`, sentAt.UTC(), eventID, workerID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return outbox.ErrMessageNotClaimed
	}
	return nil
}

func (r *OutboxRepository) MarkFailed(ctx context.Context, workerID, eventID, reason string, nextAttemptAt time.Time, deadLetter bool) error {
	status := "FAILED"
	if deadLetter {
		status = "DEAD_LETTER"
	}
	commandTag, err := r.pool.Exec(ctx, `
		UPDATE integration.outbox_messages
		SET status = $1, available_at = $2, last_error = $3,
			worker_id = NULL, processing_at = NULL
		WHERE event_id = $4 AND status = 'PROCESSING' AND worker_id = $5`,
		status, nextAttemptAt.UTC(), reason, eventID, workerID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return outbox.ErrMessageNotClaimed
	}
	return nil
}

var _ outbox.Repository = (*OutboxRepository)(nil)
