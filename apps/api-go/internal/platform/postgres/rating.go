package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/rating"
)

// RatingRepository persists CLIENT-RATING-001 provider-rates-client
// records. Schema source of truth: migrations/131_client_ratings.sql.
// UNIQUE(order_id) on the table is what actually enforces "one rating per
// order, re-rating overwrites" — the ON CONFLICT below just gives that
// constraint a resolution instead of erroring.
type RatingRepository struct {
	pool *pgxpool.Pool
}

func NewRatingRepository(pool *pgxpool.Pool) *RatingRepository {
	return &RatingRepository{pool: pool}
}

func (r *RatingRepository) Upsert(ctx context.Context, rec rating.Rating) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO fulfillment.client_ratings (
			id, order_id, rater_id, rated_user_id, stars, comment, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (order_id) DO UPDATE SET
			stars = excluded.stars,
			comment = excluded.comment,
			updated_at = excluded.updated_at`,
		rec.ID, rec.OrderID, rec.RaterID, rec.RatedUserID, rec.Stars, rec.Comment, rec.CreatedAt, rec.UpdatedAt)
	return err
}

func (r *RatingRepository) Aggregate(ctx context.Context, ratedUserID string) (float64, int, error) {
	var avg *float64
	var count int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT AVG(stars), COUNT(*) FROM fulfillment.client_ratings WHERE rated_user_id = $1`,
		ratedUserID).Scan(&avg, &count)
	if err != nil {
		return 0, 0, err
	}
	if avg == nil {
		return 0, count, nil
	}
	return *avg, count, nil
}
