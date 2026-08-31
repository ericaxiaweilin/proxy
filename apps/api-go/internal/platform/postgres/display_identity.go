package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/identity"
)

type DisplayIdentityRepository struct {
	pool *pgxpool.Pool
}

func NewDisplayIdentityRepository(pool *pgxpool.Pool) *DisplayIdentityRepository {
	return &DisplayIdentityRepository{pool: pool}
}

func (r *DisplayIdentityRepository) Create(ctx context.Context, d identity.DisplayIdentity) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO identity.display_identities (id, owner_id, type, alias, display_name, avatar_ref, created_at, expires_at, burned_at, version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		d.ID, d.OwnerID, string(d.Type), d.Alias, d.DisplayName, d.AvatarRef, d.CreatedAt, d.ExpiresAt, d.BurnedAt, d.Version,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return identity.ErrDisplayIdentityConflict
		}
		return err
	}
	return nil
}

func (r *DisplayIdentityRepository) Get(ctx context.Context, id string) (identity.DisplayIdentity, error) {
	var d identity.DisplayIdentity
	var typ string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_id, type, alias, display_name, avatar_ref, created_at, expires_at, burned_at, version
		FROM identity.display_identities WHERE id = $1`, id).Scan(
		&d.ID, &d.OwnerID, &typ, &d.Alias, &d.DisplayName, &d.AvatarRef, &d.CreatedAt, &d.ExpiresAt, &d.BurnedAt, &d.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.DisplayIdentity{}, identity.ErrDisplayIdentityNotFound
	}
	if err != nil {
		return identity.DisplayIdentity{}, err
	}
	d.Type = identity.DisplayIdentityType(typ)
	return d, nil
}

func (r *DisplayIdentityRepository) GetByOwnerAndAlias(ctx context.Context, ownerID, alias string) (identity.DisplayIdentity, error) {
	var d identity.DisplayIdentity
	var typ string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_id, type, alias, display_name, avatar_ref, created_at, expires_at, burned_at, version
		FROM identity.display_identities WHERE owner_id = $1 AND lower(alias) = lower($2)`, ownerID, alias).Scan(
		&d.ID, &d.OwnerID, &typ, &d.Alias, &d.DisplayName, &d.AvatarRef, &d.CreatedAt, &d.ExpiresAt, &d.BurnedAt, &d.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity.DisplayIdentity{}, identity.ErrDisplayIdentityNotFound
	}
	if err != nil {
		return identity.DisplayIdentity{}, err
	}
	d.Type = identity.DisplayIdentityType(typ)
	return d, nil
}

func (r *DisplayIdentityRepository) ListByOwner(ctx context.Context, ownerID string) ([]identity.DisplayIdentity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, owner_id, type, alias, display_name, avatar_ref, created_at, expires_at, burned_at, version
		FROM identity.display_identities WHERE owner_id = $1 ORDER BY created_at`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []identity.DisplayIdentity{}
	for rows.Next() {
		var d identity.DisplayIdentity
		var typ string
		if err := rows.Scan(&d.ID, &d.OwnerID, &typ, &d.Alias, &d.DisplayName, &d.AvatarRef, &d.CreatedAt, &d.ExpiresAt, &d.BurnedAt, &d.Version); err != nil {
			return nil, err
		}
		d.Type = identity.DisplayIdentityType(typ)
		result = append(result, d)
	}
	return result, rows.Err()
}

func (r *DisplayIdentityRepository) Update(ctx context.Context, d identity.DisplayIdentity, expectedVersion int) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE identity.display_identities
		SET alias=$1, display_name=$2, avatar_ref=$3, expires_at=$4, burned_at=$5, version=$6
		WHERE id=$7 AND version=$8`,
		d.Alias, d.DisplayName, d.AvatarRef, d.ExpiresAt, d.BurnedAt, expectedVersion+1, d.ID, expectedVersion,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// distinguish not-found vs conflict: check existence
		var exists bool
		_ = queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT true FROM identity.display_identities WHERE id=$1`, d.ID).Scan(&exists)
		if !exists {
			return identity.ErrDisplayIdentityNotFound
		}
		return identity.ErrDisplayIdentityConflict
	}
	return nil
}

var _ identity.DisplayIdentityRepository = (*DisplayIdentityRepository)(nil)

// SweepExpiredBurners marks all BURNER identities past expires_at as burned (Lotus §1, 7d).
// Returns count burned. Used by worker hourly sweeper.
func (r *DisplayIdentityRepository) SweepExpiredBurners(ctx context.Context, now time.Time) (int64, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE identity.display_identities
		SET burned_at = $1, version = version + 1
		WHERE type = 'BURNER' AND burned_at IS NULL AND expires_at IS NOT NULL AND expires_at <= $1`, now.UTC())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
