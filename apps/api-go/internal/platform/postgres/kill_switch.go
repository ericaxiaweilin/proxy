package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/compliance"
)

// KillSwitchRepository is the Postgres implementation of
// compliance.Repository. It satisfies the same contract as
// the in-memory implementation in
// apps/api-go/internal/compliance/memory.go.
type KillSwitchRepository struct {
	pool *pgxpool.Pool
}

func NewKillSwitchRepository(pool *pgxpool.Pool) *KillSwitchRepository {
	return &KillSwitchRepository{pool: pool}
}

func (r *KillSwitchRepository) newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "ks_" + hex.EncodeToString(b[:])
}

// GetActive returns the KILLED row for the category or
// compliance.ErrNotFound. Does NOT run the expiry sweep; the
// service layer does that on every public read.
func (r *KillSwitchRepository) GetActive(ctx context.Context, category compliance.Category) (*compliance.KillSwitch, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, category, status, reason, set_by, set_at,
		       expires_at, rearmed_by, rearmed_at
		FROM compliance.legal_kill_switches
		WHERE category = $1 AND status = 'KILLED'
		ORDER BY set_at DESC
		LIMIT 1`, string(category))
	k, err := scanKillSwitch(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, compliance.ErrNotFound
	}
	return k, err
}

// Kill inserts a new KILLED row, flipping any existing KILLED
// row for the same category to REARMED in the same tx.
func (r *KillSwitchRepository) Kill(ctx context.Context, category compliance.Category, reason, setBy string, expiresAt *time.Time, now time.Time) (*compliance.KillSwitch, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE compliance.legal_kill_switches
		SET status = 'REARMED', rearmed_by = $3, rearmed_at = $2, updated_at = $2
		WHERE category = $1 AND status = 'KILLED'`,
		string(category), now, setBy); err != nil {
		return nil, err
	}
	id := r.newID()
	var expiresArg interface{}
	if expiresAt != nil {
		expiresArg = *expiresAt
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO compliance.legal_kill_switches
		    (id, category, status, reason, set_by, set_at, expires_at)
		VALUES ($1, $2, 'KILLED', $3, $4, $5, $6)`,
		id, string(category), reason, setBy, now, expiresArg); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &compliance.KillSwitch{
		ID:        id,
		Category:  category,
		Status:    compliance.StatusKilled,
		Reason:    reason,
		SetBy:     setBy,
		SetAt:     now,
		ExpiresAt: expiresAt,
	}, nil
}

// Rearm flips the KILLED row to REARMED. Returns ErrNotFound
// if no active row exists.
func (r *KillSwitchRepository) Rearm(ctx context.Context, category compliance.Category, rearmedBy string, now time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE compliance.legal_kill_switches
		SET status = 'REARMED', rearmed_by = $3, rearmed_at = $2, updated_at = $2
		WHERE category = $1 AND status = 'KILLED'`,
		string(category), now, rearmedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return compliance.ErrNotFound
	}
	return nil
}

// ExpireOverdue flips every KILLED row whose expires_at has
// passed to REARMED. Returns the count.
func (r *KillSwitchRepository) ExpireOverdue(ctx context.Context, now time.Time) (int, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE compliance.legal_kill_switches
		SET status = 'REARMED', rearmed_at = $2, updated_at = $2
		WHERE status = 'KILLED' AND expires_at IS NOT NULL AND expires_at <= $1`, now, now)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// ListAll returns every row (KILLED + REARMED), newest first.
func (r *KillSwitchRepository) ListAll(ctx context.Context) ([]*compliance.KillSwitch, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, category, status, reason, set_by, set_at,
		       expires_at, rearmed_by, rearmed_at
		FROM compliance.legal_kill_switches
		ORDER BY set_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*compliance.KillSwitch, 0)
	for rows.Next() {
		k, err := scanKillSwitch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

type ksScanner interface {
	Scan(dest ...any) error
}

func scanKillSwitch(s ksScanner) (*compliance.KillSwitch, error) {
	var (
		k          compliance.KillSwitch
		category   string
		status     string
		expiresAt  *time.Time
		rearmedBy  *string
		rearmedAt  *time.Time
	)
	if err := s.Scan(
		&k.ID, &category, &status, &k.Reason, &k.SetBy, &k.SetAt,
		&expiresAt, &rearmedBy, &rearmedAt,
	); err != nil {
		return nil, err
	}
	k.Category = compliance.Category(category)
	k.Status = compliance.Status(status)
	k.ExpiresAt = expiresAt
	k.RearmedBy = rearmedBy
	k.RearmedAt = rearmedAt
	return &k, nil
}
