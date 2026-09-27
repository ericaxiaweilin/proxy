package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/scenereview"
)

// SceneReviewRepository persists SCENE-REVIEW-001 checkin-gated venue
// reviews. Schema source of truth: migrations/132_scene_reviews.sql.
// UNIQUE(scene_id, rater_id) on the table is what actually enforces "one
// review per person per scene, re-reviewing overwrites" — the ON CONFLICT
// below just gives that constraint a resolution instead of erroring.
type SceneReviewRepository struct {
	pool *pgxpool.Pool
}

func NewSceneReviewRepository(pool *pgxpool.Pool) *SceneReviewRepository {
	return &SceneReviewRepository{pool: pool}
}

func (r *SceneReviewRepository) Upsert(ctx context.Context, rec scenereview.Review) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO reality.scene_reviews (
			id, scene_id, rater_id, stars, comment, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (scene_id, rater_id) DO UPDATE SET
			stars = excluded.stars,
			comment = excluded.comment,
			updated_at = excluded.updated_at`,
		rec.ID, rec.SceneID, rec.RaterID, rec.Stars, rec.Comment, rec.CreatedAt, rec.UpdatedAt)
	return err
}

func (r *SceneReviewRepository) Aggregate(ctx context.Context, sceneID string) (float64, int, error) {
	var avg *float64
	var count int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT AVG(stars), COUNT(*) FROM reality.scene_reviews WHERE scene_id = $1`,
		sceneID).Scan(&avg, &count)
	if err != nil {
		return 0, 0, err
	}
	if avg == nil {
		return 0, count, nil
	}
	return *avg, count, nil
}
