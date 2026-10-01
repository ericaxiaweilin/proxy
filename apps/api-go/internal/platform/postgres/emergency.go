package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/emergency"
)

// EmergencyRepository is the Postgres implementation of
// emergency.Repository. It satisfies the same contract as the in-memory
// implementation in internal/emergency; the command layer does not care
// which one is wired.
//
// Two things it must NOT do, because the DB is the last line of defence:
//   - it must not write a precise coordinate (the caller has already
//     coarsened; this layer stores what it is given),
//   - it must not hard-delete a contact (soft delete only).
type EmergencyRepository struct {
	pool *pgxpool.Pool
}

// NewEmergencyRepository returns a repository backed by the shared pool.
func NewEmergencyRepository(pool *pgxpool.Pool) *EmergencyRepository {
	return &EmergencyRepository{pool: pool}
}

// Compile-time proof that this type satisfies the domain contract. If
// the interface grows a method and this file is not updated, the build
// breaks here rather than at the call site in main.go.
var _ emergency.Repository = (*EmergencyRepository)(nil)

func (r *EmergencyRepository) newID(prefix string) string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return prefix + hex.EncodeToString(b[:])
}

const contactColumns = `id, user_id, display_name, phone, COALESCE(relation, ''), priority,
	permission_attested_at, created_at, updated_at`

func scanContact(s scanner) (*emergency.Contact, error) {
	var c emergency.Contact
	if err := s.Scan(
		&c.ID, &c.UserID, &c.DisplayName, &c.Phone, &c.Relation, &c.Priority,
		&c.PermissionAttestedAt, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

// ListContacts returns the caller's live contacts in priority order.
func (r *EmergencyRepository) ListContacts(ctx context.Context, userID string) ([]*emergency.Contact, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+contactColumns+`
		FROM safety.emergency_contacts
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY priority ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*emergency.Contact, 0)
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpsertContact inserts when c.ID is empty, otherwise updates the
// caller's own row.
//
// The cap is checked inside the same transaction as the insert so two
// concurrent adds cannot both observe "2 contacts" and both proceed.
// The partial unique index on (user_id, priority) is the backstop.
func (r *EmergencyRepository) UpsertContact(ctx context.Context, c *emergency.Contact, now time.Time) (*emergency.Contact, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if c.ID == "" {
		var live int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM safety.emergency_contacts
			WHERE user_id = $1 AND deleted_at IS NULL`, c.UserID).Scan(&live); err != nil {
			return nil, err
		}
		if live >= emergency.MaxContacts {
			return nil, emergency.ErrTooManyContacts
		}
		id := r.newID("ec_")
		row := tx.QueryRow(ctx, `
			INSERT INTO safety.emergency_contacts
			    (id, user_id, display_name, phone, relation, priority, permission_attested_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING `+contactColumns,
			id, c.UserID, c.DisplayName, c.Phone, nullable(c.Relation), c.Priority, c.PermissionAttestedAt)
		stored, err := scanContact(row)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return stored, nil
	}

	row := tx.QueryRow(ctx, `
		UPDATE safety.emergency_contacts
		SET display_name = $3, phone = $4, relation = $5, priority = $6,
		    permission_attested_at = $7, updated_at = $8
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING `+contactColumns,
		c.ID, c.UserID, c.DisplayName, c.Phone, nullable(c.Relation), c.Priority, c.PermissionAttestedAt, now)
	stored, err := scanContact(row)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either the id belongs to someone else, or it was already
		// deleted. Both are "not yours to edit" from the caller's side.
		return nil, emergency.ErrContactNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return stored, nil
}

// DeleteContact soft-deletes the caller's own row. Returns false when
// nothing was live under that id (already gone, or not theirs).
func (r *EmergencyRepository) DeleteContact(ctx context.Context, userID, contactID string, now time.Time) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE safety.emergency_contacts
		SET deleted_at = $3, updated_at = $3
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		contactID, userID, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

const eventColumns = `id, user_id, kind, occurred_at, coarse_lat, coarse_lng,
	coarse_precision_m, contact_ids, dialer_opened, COALESCE(dialed_number, ''),
	sms_handoff_count, COALESCE(note, ''), created_at`

func scanEvent(s scanner) (*emergency.Event, error) {
	var (
		e          emergency.Event
		kind       string
		contactIDs []byte
	)
	if err := s.Scan(
		&e.ID, &e.UserID, &kind, &e.OccurredAt, &e.CoarseLat, &e.CoarseLng,
		&e.CoarsePrecisionM, &contactIDs, &e.DialerOpened, &e.DialedNumber,
		&e.SMSHandoffCount, &e.Note, &e.CreatedAt,
	); err != nil {
		return nil, err
	}
	e.Kind = emergency.EventKind(kind)
	e.ContactIDs = []string{}
	if len(contactIDs) > 0 {
		_ = json.Unmarshal(contactIDs, &e.ContactIDs)
	}
	return &e, nil
}

// AppendEvent writes one event. There is deliberately no update or
// delete counterpart: the table is append-only and the DB enforces it
// with a BEFORE UPDATE OR DELETE trigger.
func (r *EmergencyRepository) AppendEvent(ctx context.Context, e *emergency.Event) (*emergency.Event, error) {
	ids := e.ContactIDs
	if ids == nil {
		ids = []string{}
	}
	raw, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO safety.emergency_events
		    (id, user_id, kind, occurred_at, coarse_lat, coarse_lng, coarse_precision_m,
		     contact_ids, dialer_opened, dialed_number, sms_handoff_count, note)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING `+eventColumns,
		r.newID("ee_"), e.UserID, string(e.Kind), e.OccurredAt, e.CoarseLat, e.CoarseLng,
		e.CoarsePrecisionM, raw, e.DialerOpened, nullable(e.DialedNumber), e.SMSHandoffCount,
		nullable(e.Note))
	return scanEvent(row)
}

// ListEvents returns the caller's own events, newest first.
func (r *EmergencyRepository) ListEvents(ctx context.Context, userID string, limit int) ([]*emergency.Event, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+eventColumns+`
		FROM safety.emergency_events
		WHERE user_id = $1
		ORDER BY occurred_at DESC, id DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*emergency.Event, 0)
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// nullable turns "" into SQL NULL so optional text columns stay NULL
// rather than storing an empty string that reads as "present but blank".
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
