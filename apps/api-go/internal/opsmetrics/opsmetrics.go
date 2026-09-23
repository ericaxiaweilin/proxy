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
