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


// STORE-REC-002 — 运营评估队列的读路径。
//
// 上限用 storeonboarding 导出的常量，避免「服务层 clamp 到 200、仓储层却敢
// 拉全表」这种两处各写各的漂移。
const listStoreRecommendationsSQL = `
SELECT id, store_name, city, category, reason, recommended_by, origin, created_at
FROM business.store_recommendations
WHERE ($1 = '' OR city = $1)
  AND ($2 = '' OR origin = $2)
ORDER BY created_at DESC
LIMIT $3`

func (r *StoreOnboardingRepository) ListRecommendations(ctx context.Context, filter storeonboarding.RecommendationFilter) ([]storeonboarding.StoreRecommendation, error) {
	if r == nil || r.pool == nil {
		return nil, storeonboarding.ErrRecommendationRepositoryDown
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = storeonboarding.ListLimitDefault
	}
	if limit > storeonboarding.ListLimitMax {
		limit = storeonboarding.ListLimitMax
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, listStoreRecommendationsSQL, filter.City, filter.Origin, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 空结果也必须是 [] 而不是 nil：命令层依赖它给客户端发 `[]`。
	out := []storeonboarding.StoreRecommendation{}
	for rows.Next() {
		var rec storeonboarding.StoreRecommendation
		if err := rows.Scan(&rec.ID, &rec.StoreName, &rec.City, &rec.Category, &rec.Reason,
			&rec.RecommendedBy, &rec.Origin, &rec.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// 签名漂移就在这里编译失败，而不是运行期静默写不进去。
var _ storeonboarding.Repository = (*StoreOnboardingRepository)(nil)
