package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
		SET status = 'PENDING', worker_id = NULL, claimed_until = NULL
		WHERE status = 'PROCESSING' AND claimed_until <= $1`, now.UTC()); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		WITH claimed AS (
			SELECT event_id
			FROM integration.outbox_messages
			WHERE status IN ('PENDING', 'FAILED')
				AND (claimed_until IS NULL OR claimed_until <= $1)
			ORDER BY COALESCE(claimed_until, occurred_at), created_at
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE integration.outbox_messages AS messages
		SET status = 'PROCESSING', attempts = messages.attempts + 1,
			worker_id = $3, claimed_until = $1 + interval '5 minutes'
		FROM claimed
		WHERE messages.event_id = claimed.event_id
		RETURNING messages.event_id, messages.event_type, messages.event_version,
			messages.aggregate_type, messages.aggregate_id, messages.aggregate_version,
			messages.principal_id, messages.occurred_at, messages.correlation_id,
			messages.causation_id, messages.payload, messages.status, messages.attempts,
			COALESCE(messages.claimed_until, $1), COALESCE(messages.last_error, '')`,
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

// scanOutboxMessage 读一行 outbox 消息。Claim 与 ListDeadLetters 共用 ——
// 两个地方扫同一张表，扫法必须一样（漏一列就是「有的死信看起来没有 last_error」）。
func scanOutboxMessage(rows pgx.Rows) (outbox.Message, error) {
	var e event.DomainEvent
	var message outbox.Message
	var causationID *string
	var payload []byte
	if err := rows.Scan(
		&e.EventID, &e.EventType, &e.EventVersion, &e.AggregateType, &e.AggregateID,
		&e.AggregateVersion, &e.PrincipalID, &e.OccurredAt, &e.CorrelationID,
		&causationID, &payload, &message.Status, &message.Attempts,
		&message.AvailableAt, &message.LastError,
	); err != nil {
		return outbox.Message{}, err
	}
	if causationID != nil {
		e.CausationID = *causationID
	}
	if err := json.Unmarshal(payload, &e.Payload); err != nil {
		return outbox.Message{}, err
	}
	message.Event = e
	return message, nil
}

func (r *OutboxRepository) MarkSent(ctx context.Context, workerID, eventID string, sentAt time.Time) error {
	commandTag, err := r.pool.Exec(ctx, `
		UPDATE integration.outbox_messages
		SET status = 'SENT', delivered_at = $1, worker_id = NULL, claimed_until = NULL
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
		SET status = $1, claimed_until = $2, last_error = $3,
			worker_id = NULL
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

// ListDeadLetters 列出死信。freshSince 零值 = 不限时间（用于「有多少条太旧的」）。
//
// 按 occurred_at 排而不是 created_at：occurred_at 是**事件自己发生的时间**，也就是
// 「这条通知说的是什么时候的事」。用 created_at 会把一条积压很久的旧事件算成新
// 的，从而被自动重放 —— 那正是「把 6 周前的需求已发布补发到今天」这个蠢错。
func (r *OutboxRepository) ListDeadLetters(ctx context.Context, freshSince time.Time, limit int) ([]outbox.Message, error) {
	if limit <= 0 {
		limit = outbox.MaxDeadLetterReplayBatch
	}
	sqlStr := `
		SELECT event_id, event_type, event_version, aggregate_type, aggregate_id,
		       aggregate_version, principal_id, occurred_at, correlation_id,
		       causation_id, payload, status, attempts,
		       COALESCE(claimed_until, occurred_at), COALESCE(last_error, '')
		FROM integration.outbox_messages
		WHERE status = 'DEAD_LETTER'`
	args := []any{}
	if !freshSince.IsZero() {
		sqlStr += ` AND occurred_at >= $1`
		args = append(args, freshSince.UTC())
	}
	sqlStr += fmt.Sprintf(` ORDER BY occurred_at ASC LIMIT $%d`, len(args)+1)
	args = append(args, limit)

	rows, err := r.pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []outbox.Message{}
	for rows.Next() {
		message, err := scanOutboxMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	return result, rows.Err()
}

// Replay 把死信放回 PENDING。
//
// attempts 必须清零：Claim 之后 RunOnce 会用「attempts >= MaxAttempts」直接再判
// DEAD_LETTER，不清零的话重放出来的那一次跑完立刻又变死信 —— 变成无限循环。
//
// last_error **不覆盖**：那是失败原因的证据，重放是「再试一次」而不是抹掉。
func (r *OutboxRepository) Replay(ctx context.Context, eventIDs []string, now time.Time) (int, error) {
	if len(eventIDs) == 0 {
		return 0, nil
	}
	commandTag, err := r.pool.Exec(ctx, `
		UPDATE integration.outbox_messages
		SET status = 'PENDING', attempts = 0,
		    worker_id = NULL, claimed_until = NULL,
		    replayed_at = $1, replay_count = replay_count + 1
		WHERE event_id = ANY($2) AND status = 'DEAD_LETTER'`,
		now.UTC(), eventIDs)
	if err != nil {
		return 0, err
	}
	return int(commandTag.RowsAffected()), nil
}

var _ outbox.Repository = (*OutboxRepository)(nil)
