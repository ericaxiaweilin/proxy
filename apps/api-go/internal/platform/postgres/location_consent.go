package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/location"
)

// LocationConsentRepository is the Postgres implementation of
// location.Repository. It satisfies the same contract as the
// in-memory implementation in internal/location/memory.go; the
// HTTP and command layers do not care which one is wired.
type LocationConsentRepository struct {
	pool *pgxpool.Pool
}

// NewLocationConsentRepository returns a repository backed by
// the shared connection pool.
func NewLocationConsentRepository(pool *pgxpool.Pool) *LocationConsentRepository {
	return &LocationConsentRepository{pool: pool}
}

func (r *LocationConsentRepository) newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "lconsent_" + hex.EncodeToString(b[:])
}

// GetActive returns the GRANTED consent for (userID, kind) or
// location.ErrConsentNotFound. Expired rows are NOT auto-flipped
// here — the caller must run ExpireOverdue first.
func (r *LocationConsentRepository) GetActive(ctx context.Context, userID string, kind location.Kind) (*location.Consent, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, user_id, kind, status, granted_at, expires_at,
		       last_used_at, revoked_at, duration_seconds,
		       COALESCE(client_ip::text, ''), COALESCE(user_agent, '')
		FROM location.location_consents
		WHERE user_id = $1 AND kind = $2 AND status = 'GRANTED'
		ORDER BY granted_at DESC
		LIMIT 1`, userID, string(kind))
	c, err := scanConsent(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, location.ErrConsentNotFound
	}
	return c, err
}

// Grant creates a new consent row. If the user already has an
// active grant, the previous row is flipped to REVOKED in the same
// transaction so the audit trail captures the supersession.
func (r *LocationConsentRepository) Grant(ctx context.Context, userID string, kind location.Kind, duration time.Duration, clientIP, userAgent string, now time.Time) (*location.Consent, error) {
	if err := location.ValidateDuration(duration); err != nil {
		return nil, err
	}
	if duration == 0 {
		duration = location.DefaultDuration
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE location.location_consents
		SET status = 'REVOKED', revoked_at = $3, updated_at = $3
		WHERE user_id = $1 AND kind = $2 AND status = 'GRANTED'`,
		userID, string(kind), now); err != nil {
		return nil, err
	}
	id := r.newID()
	var clientIPArg interface{}
	if clientIP != "" {
		clientIPArg = clientIP
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO location.location_consents
		    (id, user_id, kind, status, granted_at, expires_at,
		     duration_seconds, client_ip, user_agent)
		VALUES ($1, $2, $3, 'GRANTED', $4, $5, $6, $7, $8)`,
		id, userID, string(kind), now, now.Add(duration),
		int(duration.Seconds()), clientIPArg, userAgent); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &location.Consent{
		ID:              id,
		UserID:          userID,
		Kind:            kind,
		Status:          location.StatusGranted,
		GrantedAt:       now,
		ExpiresAt:       now.Add(duration),
		DurationSeconds: int(duration.Seconds()),
		ClientIP:        clientIP,
		UserAgent:       userAgent,
	}, nil
}

// Revoke immediately flips the active grant to REVOKED. Returns
// true if a row was actually flipped, false if no active grant
// existed.
func (r *LocationConsentRepository) Revoke(ctx context.Context, userID string, kind location.Kind, now time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE location.location_consents
		SET status = 'REVOKED', revoked_at = $3, updated_at = $3
		WHERE user_id = $1 AND kind = $2 AND status = 'GRANTED'`,
		userID, string(kind), now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Touch updates last_used_at on the given consent row, throttled
// to once per 60 seconds by the application layer (the SQL is a
// simple UPDATE; the throttle is in the in-memory repo).
func (r *LocationConsentRepository) Touch(ctx context.Context, consentID string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE location.location_consents
		SET last_used_at = $2, updated_at = $2
		WHERE id = $1`, consentID, now)
	return err
}

// ExpireOverdue flips every GRANTED row whose expires_at has
// passed to EXPIRED. Returns the count of rows flipped.
func (r *LocationConsentRepository) ExpireOverdue(ctx context.Context, now time.Time) (int, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE location.location_consents
		SET status = 'EXPIRED', revoked_at = $2, updated_at = $2
		WHERE status = 'GRANTED' AND expires_at <= $1`, now, now)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// ListByUser returns the user's full consent history, newest
// first. Used by the privacy center's "my consents" view.
func (r *LocationConsentRepository) ListByUser(ctx context.Context, userID string) ([]*location.Consent, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, user_id, kind, status, granted_at, expires_at,
		       last_used_at, revoked_at, duration_seconds,
		       COALESCE(client_ip::text, ''), COALESCE(user_agent, '')
		FROM location.location_consents
		WHERE user_id = $1
		ORDER BY granted_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*location.Consent, 0)
	for rows.Next() {
		c, err := scanConsent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// scanConsent works on either pgx.Row (single-row) or pgx.Rows.
// pgx exposes Scan in both shapes, so the helper accepts a small
// interface to keep the call sites uniform.
type scanner interface {
	Scan(dest ...any) error
}

func scanConsent(s scanner) (*location.Consent, error) {
	var (
		c            location.Consent
		kind         string
		status       string
		lastUsedAt   *time.Time
		revokedAt    *time.Time
	)
	if err := s.Scan(
		&c.ID, &c.UserID, &kind, &status, &c.GrantedAt, &c.ExpiresAt,
		&lastUsedAt, &revokedAt, &c.DurationSeconds,
		&c.ClientIP, &c.UserAgent,
	); err != nil {
		return nil, err
	}
	c.Kind = location.Kind(kind)
	c.Status = location.Status(status)
	c.LastUsedAt = lastUsedAt
	c.RevokedAt = revokedAt
	return &c, nil
}
