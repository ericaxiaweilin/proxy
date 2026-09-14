package postgres

import (
	"context"
	"database/sql"
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
// STORE-REC-004: 每条推荐带出**最新**一条评估结论。
// LEFT JOIN LATERAL 而不是 LEFT JOIN 整张结论表 —— 后者会把「改过主意」的
// 推荐复制成多行，运营会在队列里看到同一家店出现两次。
// decided_at 可能为 NULL（还没评估），必须扫进可空类型。
const listStoreRecommendationsSQL = `
SELECT r.id, r.store_name, r.city, r.category, r.reason, r.recommended_by, r.origin, r.created_at,
       COALESCE(d.decision, '')   AS decision,
       COALESCE(d.reason, '')     AS decision_reason,
       COALESCE(d.decided_by, '') AS decided_by,
       d.created_at               AS decided_at
FROM business.store_recommendations r
LEFT JOIN LATERAL (
    SELECT decision, reason, decided_by, created_at
    FROM business.store_recommendation_dispositions
    WHERE recommendation_id = r.id
    ORDER BY created_at DESC
    LIMIT 1
) d ON TRUE
WHERE ($1 = '' OR r.city = $1)
  AND ($2 = '' OR r.origin = $2)
  -- STORE-REC-005: 按最新结论筛选。'' = 不限；PENDING = 还没有结论；
  -- ACCEPTED / REJECTED 对上 disposition 的 ACCEPT / REJECT。
  -- 不写成 OR 链的话，采纳完的推荐就再也查不出来了。
  AND ($4 = ''
       OR ($4 = 'PENDING'  AND d.decision IS NULL)
       OR ($4 = 'ACCEPTED' AND d.decision = 'ACCEPT')
       OR ($4 = 'REJECTED' AND d.decision = 'REJECT'))
  -- STORE-REC-007: 「我推荐的店」按推荐人收敛作用域。
  AND ($5 = '' OR r.recommended_by = $5)
ORDER BY r.created_at DESC
LIMIT $3`

const insertStoreDispositionSQL = `
INSERT INTO business.store_recommendation_dispositions
    (id, recommendation_id, decision, reason, decided_by, created_at)
VALUES ($1, $2, $3, $4, $5, $6)`

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
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, listStoreRecommendationsSQL,
		filter.City, filter.Origin, limit, filter.Status, filter.RecommendedBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 空结果也必须是 [] 而不是 nil：命令层依赖它给客户端发 `[]`。
	out := []storeonboarding.StoreRecommendation{}
	for rows.Next() {
		var rec storeonboarding.StoreRecommendation
		// 结论列可能为 NULL —— 必须扫进 sql.Null*，否则「还没评估」会
		// 变成一次 scan 错误，整个队列直接读不出来。
		var decidedAt sql.NullTime
		if err := rows.Scan(&rec.ID, &rec.StoreName, &rec.City, &rec.Category, &rec.Reason,
			&rec.RecommendedBy, &rec.Origin, &rec.CreatedAt,
			&rec.Decision, &rec.DecisionReason, &rec.DecidedBy, &decidedAt); err != nil {
			return nil, err
		}
		if decidedAt.Valid {
			at := decidedAt.Time
			rec.DecidedAt = &at
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// STORE-REC-006 — 按 id 取一条推荐，用于校验结论落在真实存在的推荐上。
const findStoreRecommendationSQL = `
SELECT id, store_name, city, category, reason, recommended_by, origin, created_at
FROM business.store_recommendations
WHERE id = $1
LIMIT 1`

func (r *StoreOnboardingRepository) FindRecommendation(ctx context.Context, id string) (storeonboarding.StoreRecommendation, bool, error) {
	if r == nil || r.pool == nil {
		return storeonboarding.StoreRecommendation{}, false, storeonboarding.ErrRecommendationRepositoryDown
	}
	if strings.TrimSpace(id) == "" {
		return storeonboarding.StoreRecommendation{}, false, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, findStoreRecommendationSQL, id)
	if err != nil {
		return storeonboarding.StoreRecommendation{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return storeonboarding.StoreRecommendation{}, false, err
		}
		return storeonboarding.StoreRecommendation{}, false, nil
	}
	var rec storeonboarding.StoreRecommendation
	if err := rows.Scan(&rec.ID, &rec.StoreName, &rec.City, &rec.Category, &rec.Reason,
		&rec.RecommendedBy, &rec.Origin, &rec.CreatedAt); err != nil {
		return storeonboarding.StoreRecommendation{}, false, err
	}
	return rec, true, nil
}

// STORE-REC-004 — 追加一条运营评估结论（append-only，只有 INSERT）。
func (r *StoreOnboardingRepository) AddDisposition(ctx context.Context, d storeonboarding.Disposition) error {
	if r == nil || r.pool == nil {
		return storeonboarding.ErrRecommendationRepositoryDown
	}
	if strings.TrimSpace(d.RecommendationID) == "" {
		return storeonboarding.ErrDispositionRecommendationRequired
	}
	if d.Decision != storeonboarding.AcceptDecision && d.Decision != storeonboarding.RejectDecision {
		return storeonboarding.ErrDispositionDecisionInvalid
	}
	if strings.TrimSpace(d.DecidedBy) == "" {
		return storeonboarding.ErrDispositionDeciderRequired
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, insertStoreDispositionSQL,
		d.ID, d.RecommendationID, d.Decision, d.Reason, d.DecidedBy, d.CreatedAt.UTC())
	return err
}

// 签名漂移就在这里编译失败，而不是运行期静默写不进去。
var _ storeonboarding.Repository = (*StoreOnboardingRepository)(nil)
