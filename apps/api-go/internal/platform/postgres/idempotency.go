package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
)

type IdempotencyStore struct {
	pool *pgxpool.Pool
}

const idempotencyLease = "5 minutes"

func NewIdempotencyStore(pool *pgxpool.Pool) *IdempotencyStore {
	return &IdempotencyStore{pool: pool}
}

func (s *IdempotencyStore) Begin(ctx context.Context, scope, key, fingerprint string) (command.IdempotencyDecision, *command.IdempotencyRecord, error) {
	queryer := queryerForContext(ctx, s.pool)
	var inserted string
	err := queryer.QueryRow(ctx, `
		INSERT INTO integration.idempotency_records (scope, idempotency_key, fingerprint, status, lease_until)
		VALUES ($1, $2, $3, 'IN_PROGRESS', now() + $4::interval)
		ON CONFLICT (scope, idempotency_key) DO NOTHING
		RETURNING status`, scope, key, fingerprint, idempotencyLease).Scan(&inserted)
	if err == nil {
		return command.IdempotencyClaimed, nil, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, err
	}

	var storedFingerprint, status string
	var resultJSON []byte
	var leaseUntil pgtype.Timestamptz
	err = queryer.QueryRow(ctx, `
		SELECT fingerprint, status, result_json, lease_until
		FROM integration.idempotency_records
		WHERE scope = $1 AND idempotency_key = $2`, scope, key).Scan(&storedFingerprint, &status, &resultJSON, &leaseUntil)
	if err != nil {
		return "", nil, err
	}
	if storedFingerprint != fingerprint {
		return command.IdempotencyConflict, nil, nil
	}
	if status == "IN_PROGRESS" {
		if leaseUntil.Valid && !leaseUntil.Time.After(time.Now().UTC()) {
			commandTag, updateErr := queryer.Exec(ctx, `
				UPDATE integration.idempotency_records
				SET lease_until = now() + $3::interval
				WHERE scope = $1 AND idempotency_key = $2 AND fingerprint = $4
				  AND status = 'IN_PROGRESS' AND lease_until <= now()`, scope, key, idempotencyLease, fingerprint)
			if updateErr != nil {
				return "", nil, updateErr
			}
			if commandTag.RowsAffected() == 1 {
				return command.IdempotencyClaimed, nil, nil
			}
		}
		return command.IdempotencyInProgress, nil, nil
	}
	if status != "COMPLETED" || len(resultJSON) == 0 {
		return "", nil, fmt.Errorf("unknown idempotency status %q", status)
	}
	var result command.Result
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		return "", nil, fmt.Errorf("decode idempotency result: %w", err)
	}
	return command.IdempotencyReplay, &command.IdempotencyRecord{Fingerprint: storedFingerprint, Result: result}, nil
}

func (s *IdempotencyStore) Complete(ctx context.Context, scope, key string, record command.IdempotencyRecord) error {
	resultJSON, err := json.Marshal(record.Result)
	if err != nil {
		return fmt.Errorf("encode idempotency result: %w", err)
	}
	commandTag, err := execerForContext(ctx, s.pool).Exec(ctx, `
		UPDATE integration.idempotency_records
		SET status = 'COMPLETED', result_json = $3, lease_until = NULL, completed_at = now()
		WHERE scope = $1 AND idempotency_key = $2 AND fingerprint = $4 AND status = 'IN_PROGRESS'`, scope, key, resultJSON, record.Fingerprint)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return command.ErrIdempotencyNotOwned
	}
	return nil
}

// Release removes an inflight claim after a failed dispatch so the key can be
// retried. Best effort: only touches rows this request owns (fingerprint match).
func (s *IdempotencyStore) Release(ctx context.Context, scope, key, fingerprint string) error {
	_, err := execerForContext(ctx, s.pool).Exec(ctx, `
		DELETE FROM integration.idempotency_records
		WHERE scope = $1 AND idempotency_key = $2 AND fingerprint = $3 AND status = 'IN_PROGRESS'`, scope, key, fingerprint)
	return err
}
