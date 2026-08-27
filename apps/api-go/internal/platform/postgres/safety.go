package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/safety"
)

// SafetyRepository 持久化 M8 Safety/Operator/Privacy — Incident / Block /
// OperatorCase / JITGrant / Consent / LegalHold。schema 见
// 022_safety_operator.sql。表跨三个 schema (safety / operator / privacy)
// 因为 PRD 把它们按职责切分；repo 仍是单一类型便于依赖注入。
type SafetyRepository struct {
	pool *pgxpool.Pool
}

func NewSafetyRepository(pool *pgxpool.Pool) *SafetyRepository {
	return &SafetyRepository{pool: pool}
}

var ErrSafetyJITNotFound = errors.New("safety: jit grant not found")
var ErrSafetyNoActiveHold = errors.New("safety: no active legal hold")
var ErrSafetyHoldNotFound = errors.New("safety: legal hold not found")

func (r *SafetyRepository) CreateIncident(ctx context.Context, inc safety.Incident) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO safety.incidents
			(id, reporter_id, target_id, target_type, reason, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		inc.ID, inc.ReporterID, inc.TargetID, inc.TargetType, inc.Reason, inc.Status, inc.CreatedAt,
	)
	return err
}

func (r *SafetyRepository) CreateBlock(ctx context.Context, b safety.Block) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO safety.blocks
			(id, incident_id, target_id, block_type, reason, created_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		b.ID, nullableString(b.IncidentID), b.TargetID, b.BlockType, b.Reason, b.CreatedAt, b.ExpiresAt,
	)
	return err
}

func (r *SafetyRepository) CreateCase(ctx context.Context, c safety.OperatorCase) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO operator.cases
			(id, incident_id, title, status, assignee, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		c.ID, nullableString(c.IncidentID), c.Title, c.Status, nil, c.CreatedAt,
	)
	return err
}

func (r *SafetyRepository) CreateJIT(ctx context.Context, g safety.JITGrant) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO operator.jit_grants
			(id, grantee_id, scope, purpose, expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		g.ID, g.GranteeID, g.Scope, g.Purpose, g.ExpiresAt, g.CreatedAt,
	)
	return err
}

func (r *SafetyRepository) GetJIT(ctx context.Context, id string) (safety.JITGrant, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, grantee_id, scope, purpose, expires_at, created_at
		FROM operator.jit_grants WHERE id=$1`, id)
	var g safety.JITGrant
	if err := row.Scan(&g.ID, &g.GranteeID, &g.Scope, &g.Purpose, &g.ExpiresAt, &g.CreatedAt); err != nil {
		return safety.JITGrant{}, fmt.Errorf("%w: %v", ErrSafetyJITNotFound, err)
	}
	return g, nil
}

func (r *SafetyRepository) UpsertConsent(ctx context.Context, c safety.Consent) error {
	// UNIQUE (user_id, purpose) lets us overwrite the granted flag
	// idempotently without churning the row id.
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO privacy.consents (id, user_id, purpose, granted, created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, purpose) DO UPDATE SET
			granted = EXCLUDED.granted,
			created_at = EXCLUDED.created_at`,
		c.ID, c.UserID, c.Purpose, c.Granted, c.CreatedAt,
	)
	return err
}

func (r *SafetyRepository) CreateLegalHold(ctx context.Context, h safety.LegalHold) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO privacy.legal_holds (id, target_id, reason, created_at, released_at)
		VALUES ($1,$2,$3,$4,$5)`,
		h.ID, h.TargetID, h.Reason, h.CreatedAt, h.ReleasedAt,
	)
	return err
}

func (r *SafetyRepository) GetActiveLegalHold(ctx context.Context, targetID string) (safety.LegalHold, error) {
	// "Active" = released_at IS NULL. The schema's index
	// (target_id, released_at) makes this a single-row lookup.
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, target_id, reason, created_at, released_at
		FROM privacy.legal_holds
		WHERE target_id=$1 AND released_at IS NULL
		ORDER BY created_at DESC LIMIT 1`, targetID)
	var h safety.LegalHold
	var released *time.Time
	if err := row.Scan(&h.ID, &h.TargetID, &h.Reason, &h.CreatedAt, &released); err != nil {
		return safety.LegalHold{}, fmt.Errorf("%w: target=%s", ErrSafetyNoActiveHold, targetID)
	}
	h.ReleasedAt = released
	return h, nil
}

func (r *SafetyRepository) ReleaseLegalHold(ctx context.Context, id string) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE privacy.legal_holds SET released_at = NOW()
		WHERE id=$1 AND released_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: id=%s", ErrSafetyHoldNotFound, id)
	}
	return nil
}

var _ safety.Repository = (*SafetyRepository)(nil)
