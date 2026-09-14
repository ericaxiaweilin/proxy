package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/storeonboarding"
)

// STORE-REC-001 — 店铺推荐的生产落库实现（append-only，只有 INSERT）。
type StoreOnboardingRepository struct {
	pool *pgxpool.Pool
}

func NewStoreOnboardingRepository(pool *pgxpool.Pool) *StoreOnboardingRepository {
	return &StoreOnboardingRepository{pool: pool}
}

const insertStoreRecommendationSQL = `
INSERT INTO business.store_recommendations
    (id, store_name, city, category, reason, recommended_by, origin, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

func (r *StoreOnboardingRepository) AddRecommendation(ctx context.Context, rec storeonboarding.StoreRecommendation) error {
	if r == nil || r.pool == nil {
		return storeonboarding.ErrRecommendationRepositoryDown
	}
	if strings.TrimSpace(rec.StoreName) == "" {
		return storeonboarding.ErrRecommendationStoreRequired
	}
	if strings.TrimSpace(rec.City) == "" {
		return storeonboarding.ErrRecommendationCityRequired
	}
	if strings.TrimSpace(rec.Reason) == "" {
		return storeonboarding.ErrRecommendationReasonRequired
	}
	category := rec.Category
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertStoreRecommendationSQL,
		rec.ID, rec.StoreName, rec.City, category, rec.Reason,
		rec.RecommendedBy, rec.Origin, rec.CreatedAt.UTC())
	return err
}

// 签名漂移就在这里编译失败，而不是运行期静默写不进去。
var _ storeonboarding.Repository = (*StoreOnboardingRepository)(nil)
