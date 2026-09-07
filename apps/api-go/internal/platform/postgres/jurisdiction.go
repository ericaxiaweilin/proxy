package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/jurisdiction"
)

type JurisdictionRepository struct{ pool *pgxpool.Pool }

func NewJurisdictionRepository(pool *pgxpool.Pool) *JurisdictionRepository {
	return &JurisdictionRepository{pool: pool}
}

func (r *JurisdictionRepository) Get(ctx context.Context, userID string) (*jurisdiction.UserJurisdiction, error) {
	var row jurisdiction.UserJurisdiction
	var country, region string
	err := r.pool.QueryRow(ctx, `SELECT user_id, country, region, source, updated_at FROM identity.user_jurisdiction WHERE user_id=$1`, userID).
		Scan(&row.UserID, &country, &region, &row.Source, &row.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, jurisdiction.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	row.Jurisdiction = jurisdiction.Jurisdiction{Country: jurisdiction.Country(country), Region: jurisdiction.Region(region)}
	return &row, nil
}

func (r *JurisdictionRepository) Upsert(ctx context.Context, row jurisdiction.UserJurisdiction) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO identity.user_jurisdiction (user_id, country, region, source, updated_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id) DO UPDATE SET country=EXCLUDED.country, region=EXCLUDED.region, source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
		row.UserID, string(row.Jurisdiction.Country), string(row.Jurisdiction.Region), row.Source, row.UpdatedAt)
	return err
}
