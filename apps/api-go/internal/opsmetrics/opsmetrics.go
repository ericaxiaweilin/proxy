// Package opsmetrics 是运营控制台（apps/market-intelligence-console）的真实读模型（OPS-REAL-001）。
//
// 背景（2026-09-23 审计）：控制台 17 个 /v1/operator/* 端点全部是写死的数字（「注册 428K」「deep_view 2.75M」
// 「Meal gravity rising」），而且没有任何权限校验。用户：「proxy 还有一个后台运营的问题…引力引擎撮合」。
// 这里只放**能从库里真实算出来**的指标；算不出来的（没有标签体系、没有引力服务…）由 api 层返回
// NOT_CONNECTED，写明缺的是《Personalization & Orchestration Engineering Spec v1》里哪个模块，不编数。
package opsmetrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Window 是运营指标的统计窗口（近 30 天）。
const Window = 30 * 24 * time.Hour

// MerchantRow 是一个经营主体这一页要看的全部真数。
//
// 这里**没有**曝光、成交额、复购率：投放归因没有做（store_recommendations 是 0 行，
// 也没有把曝光落到具体门店的链路），支付没接（成交额没有事实来源）。OPS-REAL-001 的
// 口径是能算的才算，算不出来的在页面上显示「未接入」并写明缺哪个模块 —— 不是填 0，
// 0 会被读成「这家店没人看」，而事实是「我们没在测」。
type MerchantRow struct {
	BusinessID            string    `json:"businessId"`
	Name                  string    `json:"name"`
	Status                string    `json:"status"`
	CreatedAt             time.Time `json:"createdAt"`
	Stores                int64     `json:"stores"`
	ActiveStores          int64     `json:"activeStores"`
	Members               int64     `json:"members"`
	Products              int64     `json:"products"`
	Photos                int64     `json:"photos"`
	Orders30d             int64     `json:"orders30d"`
	StoresWithDescription int64     `json:"storesWithDescription"`
	StoresWithHours       int64     `json:"storesWithHours"`
	StoresWithLogo        int64     `json:"storesWithLogo"`
}

// MerchantTotals 是整盘的真数（不是把上面那列加起来 —— 那样会被 LIMIT 截断）。
type MerchantTotals struct {
	Accounts    int64 `json:"accounts"`
	Stores      int64 `json:"stores"`
	StoreLines  int64 `json:"storeLines"`
	ProductRows int64 `json:"productRows"`
	// Orders30d 是**挂到门店**的订单数；Orders30dAll 是窗口内全部订单数。
	// 两个都要给：实测本机库里 30 天 445 单，挂到门店的是 0 —— 只报 0 会被读成
	// "这些店没生意"，而事实是"订单到门店的归因链路还没建"。差别必须看得见。
	Orders30d              int64 `json:"orders30d"`
	Orders30dAll           int64 `json:"orders30dAll"`
	StoresWithOrders       int64 `json:"storesWithOrders"`
	PendingRecommendations int64 `json:"pendingRecommendations"`
}

type Merchants struct {
	WindowDays int64          `json:"windowDays"`
	Totals     MerchantTotals `json:"totals"`
	Merchants  []MerchantRow  `json:"merchants"`
}

type Population struct {
	Registered   int64 `json:"registered"`
	New30d       int64 `json:"new_30d"`
	Active30d    int64 `json:"active_30d"`
	WithProfile  int64 `json:"with_profile"`
	WithPosts30d int64 `json:"with_posts_30d"`
}

type Behavior struct {
	Exposures      int64 `json:"exposures"`
	DeepViews      int64 `json:"deep_views"`
	Zooms          int64 `json:"zooms"`
	ProfileOpens   int64 `json:"profile_opens"`
	StrongPositive int64 `json:"strong_positive"`
	WeakNegative   int64 `json:"weak_negative"`
	StrongNegative int64 `json:"strong_negative"`
}

// Source 读真实库。nil = 没有数据库（内存模式），api 层按 NOT_CONNECTED 处理。
type Source interface {
	Population(ctx context.Context, now time.Time) (Population, error)
	Behavior(ctx context.Context, now time.Time) (Behavior, error)
	Merchants(ctx context.Context, now time.Time) (Merchants, error)
	Retention(ctx context.Context, now time.Time) (Retention, error)
}

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) Population(ctx context.Context, now time.Time) (Population, error) {
	since := now.Add(-Window)
	var out Population
	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM identity.user_accounts),
			(SELECT COUNT(*) FROM identity.user_accounts WHERE created_at >= $1),
			(SELECT COUNT(*) FROM (
				SELECT actor_id AS id FROM localnet.interaction_events WHERE created_at >= $1
				UNION
				SELECT user_account_id AS id FROM identity.sessions WHERE updated_at >= $1
			) active),
			(SELECT COUNT(*) FROM identity.profiles WHERE COALESCE(name, '') <> ''),
			(SELECT COUNT(DISTINCT author_id) FROM localnet.posts WHERE created_at >= $1)`, since).
		Scan(&out.Registered, &out.New30d, &out.Active30d, &out.WithProfile, &out.WithPosts30d)
	return out, err
}

// Behavior：近 30 天行为信号。深度浏览 = 停留 ≥ 3 秒的曝光（帖子卡片或逐张照片）。
// 强正向 = 点赞 + 收藏 + 转发；弱负向 = 「减少推荐」类反馈；强负向 = 举报 + 屏蔽作者。
func (p *Postgres) Behavior(ctx context.Context, now time.Time) (Behavior, error) {
	since := now.Add(-Window)
	var out Behavior
	err := p.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE event_type IN ('POST_IMPRESSION', 'MEDIA_IMPRESSION')),
			COUNT(*) FILTER (WHERE event_type IN ('POST_IMPRESSION', 'MEDIA_IMPRESSION') AND watch_ms >= 3000),
			COUNT(*) FILTER (WHERE event_type = 'MEDIA_ZOOM'),
			COUNT(*) FILTER (WHERE event_type = 'PROFILE_OPEN')
		FROM localnet.interaction_events WHERE created_at >= $1`, since).
		Scan(&out.Exposures, &out.DeepViews, &out.Zooms, &out.ProfileOpens)
	if err != nil {
		return Behavior{}, err
	}
	err = p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM engagement.reactions WHERE created_at >= $1)
			+ (SELECT COUNT(*) FROM engagement.bookmarks WHERE created_at >= $1)
			+ (SELECT COUNT(*) FROM engagement.reposts WHERE created_at >= $1),
			(SELECT COUNT(*) FROM engagement.feed_preferences WHERE created_at >= $1),
			(SELECT COUNT(*) FROM engagement.post_reports WHERE created_at >= $1)
			+ (SELECT COUNT(*) FROM engagement.muted_authors WHERE created_at >= $1)`, since).
		Scan(&out.StrongPositive, &out.WeakNegative, &out.StrongNegative)
	return out, err
}

// Merchants：商家管理页的真数（OPS-MERCHANT-001）。
//
// 逐主体的计数全部走**相关子查询**，不用多表 LEFT JOIN：accounts × stores ×
// memberships × products × orders 一旦并排 join，行数会互相放大，count 出来是假的
// （一家 3 店 × 20 菜 × 5 单会变成 300）。子查询慢一点，但数是 Honest 的。
// 整盘 KPI 另算一遍，不从这里加 —— 列表截到 100 行，加起来就不是全量。
func (p *Postgres) Merchants(ctx context.Context, now time.Time) (Merchants, error) {
	since := now.Add(-Window)
	var out Merchants
	out.WindowDays = int64(Window / (24 * time.Hour))

	rows, err := p.pool.Query(ctx, `
		SELECT
			a.id, a.name, a.status, a.created_at,
			(SELECT COUNT(*) FROM business.stores s WHERE s.business_id = a.id),
			(SELECT COUNT(*) FROM business.stores s WHERE s.business_id = a.id AND s.status = 'ACTIVE'),
			(SELECT COUNT(*) FROM business.memberships m WHERE m.business_id = a.id),
			(SELECT COUNT(*) FROM business.store_products pr JOIN business.stores s ON s.id = pr.store_id WHERE s.business_id = a.id),
			(SELECT COUNT(*) FROM business.store_photos sp JOIN business.stores s ON s.id = sp.store_id WHERE s.business_id = a.id),
			(SELECT COUNT(*) FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id WHERE s.business_id = a.id AND o.created_at >= $1) AS orders_30d,
			(SELECT COUNT(*) FROM business.store_lines sl JOIN business.stores s ON s.id = sl.store_id WHERE s.business_id = a.id AND COALESCE(sl.description, '') <> ''),
			(SELECT COUNT(*) FROM business.store_lines sl JOIN business.stores s ON s.id = sl.store_id WHERE s.business_id = a.id AND COALESCE(sl.hours_json, '{}') NOT IN ('{}', '')),
			(SELECT COUNT(*) FROM business.store_lines sl JOIN business.stores s ON s.id = sl.store_id WHERE s.business_id = a.id AND COALESCE(sl.logo_asset_path, '') <> '') AS stores_with_logo
		FROM business.accounts a
		ORDER BY orders_30d DESC, a.created_at
		LIMIT 100`, since)
	if err != nil {
		return Merchants{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MerchantRow
		if err := rows.Scan(&m.BusinessID, &m.Name, &m.Status, &m.CreatedAt,
			&m.Stores, &m.ActiveStores, &m.Members, &m.Products, &m.Photos,
			&m.Orders30d, &m.StoresWithDescription, &m.StoresWithHours, &m.StoresWithLogo); err != nil {
			return Merchants{}, err
		}
		out.Merchants = append(out.Merchants, m)
	}
	if err := rows.Err(); err != nil {
		return Merchants{}, err
	}

	// 「待处理」= 还没有处置记录的那些，不是 status='PENDING' —— store_recommendations
	// 从 092 建表起就没有 status 列（处置另存 093），那样写会在解析期就报 column does
	// not exist，表是空的也一样报。这段是一个常量：整盘 KPI 和 PendingRecommendations
	// 共用它，两份口径会漂。
	err = p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM business.accounts),
			(SELECT COUNT(*) FROM business.stores),
			(SELECT COUNT(*) FROM business.store_lines),
			(SELECT COUNT(*) FROM business.store_products),
			(SELECT COUNT(*) FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id WHERE o.created_at >= $1),
			(SELECT COUNT(DISTINCT o.store_id) FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id WHERE o.created_at >= $1),
			(`+pendingRecommendationsCount+`) AS pending_recommendations,
			(SELECT COUNT(*) FROM fulfillment.orders WHERE created_at >= $1)`, since).
		Scan(&out.Totals.Accounts, &out.Totals.Stores, &out.Totals.StoreLines, &out.Totals.ProductRows,
			&out.Totals.Orders30d, &out.Totals.StoresWithOrders, &out.Totals.PendingRecommendations,
			&out.Totals.Orders30dAll)
	return out, err
}

// pendingRecommendationsCount 是「待处理店铺推荐」的唯一口径（见 Merchants 里的注释）。
const pendingRecommendationsCount = `SELECT COUNT(*) FROM business.store_recommendations r
		 WHERE NOT EXISTS (SELECT 1 FROM business.store_recommendation_dispositions d WHERE d.recommendation_id = r.id)`

// PendingRecommendations 单独暴露同一个口径，让集成测试能对撞差值
// （种两条推荐、其中一条已经处置 → 待处理只该多 1）。页面本身走 Merchants 的整盘 KPI。
func (p *Postgres) PendingRecommendations(ctx context.Context) (int64, error) {
	var n int64
	err := p.pool.QueryRow(ctx, pendingRecommendationsCount).Scan(&n)
	return n, err
}
