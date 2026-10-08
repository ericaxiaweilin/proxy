// Package storeboard 是运营控制台「门店预约与承载」那一页的读模型
// （STORE-ATTRIBUTION-P1，见 docs/audits/2026-10-06-store-attribution.md）。
//
// 这一页回答两件此前没人能回答的事：
//
//  1. **哪一家店**拿到了承载预约。承载预约最大的用户流是 For You 活动报名
//     （activity.participants 一行 = 一单）。自迁移 191 起，这一行在报名那一刻就
//     记下了它属于哪家门店（participants.store_id）。老行**不回填、也不会回填**：
//     事后按金额档 / 活动文案 / 店名相似度猜一个门店就是造事实（158 已因同类理由
//     拒绝过一次）。所以这一页必须同时报覆盖率，否则运营会把「归因率 12%」读成
//     「88% 的客人跑了」。
//
//  2. 那家店**现在**有多满。承载来自门店自己在 business.scene_supply_snapshots
//     发布的实时快照（多行，取最新一条）；一条快照都没有的店，这一页显示「—」，
//     不是 0%。
//
// 口径纪律与 opsmetrics 一样：**能算的才算，算不出来的是 null**。空分母返回 0 会
// 让运营读成「这家的店没人下单 / 没人接流量」，而真相常常是「这段时间没有单跑到
// 这一家店」「这家店还没接负载上报」。
package storeboard

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Coverage 是「窗口内一共多少单 / 其中多少单能归属到某家门店」。
//
// Bookings **不过滤状态**：已取消的单也是一单，它只是不算进那家店的 bookings。
// 把状态过滤掉会让「取消率」的分母只剩活着的那部分，比例变得永远好看。
type Coverage struct {
	Bookings   int      `json:"bookings"`
	Attributed int      `json:"attributed"`
	Rate       *float64 `json:"rate"`
}

// StoreRow 是 ACTIVE 门店（business.stores.status='ACTIVE'）这一行的全部真数。
//
// CapacityPct / ForecastPct / AcceptingTraffic / SnapshotAt / SnapshotAgeMinutes
// 来自该店**最新一条**快照（LEFT JOIN LATERAL ... ORDER BY recorded_at DESC
// LIMIT 1）。一家快照都没有的店这五个字段全是 null —— 显示「—」。写成 0% 是说
// 「这家店明确报告了它空着」，事实是「这家店从来没上报过」，两句话完全不同。
type StoreRow struct {
	StoreID    string `json:"storeId"`
	Name       string `json:"name"`
	BusinessID string `json:"businessId"`
	// Bookings：窗口内、状态 CONFIRMED（占座态里唯一的「这一单还活着」的口径）。
	Bookings int `json:"bookings"`
	// Cancelled：窗口内、状态 <> 'CONFIRMED'（取消 / 爽约 / 候补 / 待确认）。
	Cancelled   int      `json:"cancelled"`
	CancelRate  *float64 `json:"cancelRate"`
	CapacityPct *int     `json:"capacityPct"`
	ForecastPct *int     `json:"forecastPct"`
	// AcceptingTraffic：门店自己报的「还接不接流量」。nil = 没有快照。
	AcceptingTraffic   *bool      `json:"acceptingTraffic"`
	SnapshotAt         *time.Time `json:"snapshotAt"`
	SnapshotAgeMinutes *int       `json:"snapshotAgeMinutes"`
}

// Board 是这一页一次读出来的全部内容（三组各一条参数化查询）。
type Board struct {
	Coverage Coverage `json:"coverage"`
	// AttributedSince 是**库里最早**一条带门店的报名的 joined_at。
	//
	// 这个日期之前发生的预约**永远**不可能被归属到门店（迁移 191 只对新写入的报名
	// 记 store_id）。它非 nil 时，页面上必须说清楚这一点，否则运营会把整段历史的
	// 「未归属」当成今天才冒出来的数据问题去查。
	AttributedSince *time.Time `json:"attributedSince"`
	// Stores 恒为 []，不是 null：页面直接遍历它，不该为此写一层判空。
	Stores []StoreRow `json:"stores"`
	// UnclaimedScenes：窗口内有报名、而**没有任何 ACTIVE 门店认领**其场景的
	// 活动场景数（去重）。这是「预约流向了没有门店账号的地方」的信号。
	UnclaimedScenes int `json:"unclaimedScenes"`
}

// Source 读真实库。nil = 没配数据库（内存模式），api 层按 NOT_CONNECTED 处理。
type Source interface {
	Board(ctx context.Context, since time.Time) (Board, error)
}

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Board 一次读三组，每组一条参数化查询（不拼字符串，见 sql 注释里各组的口径）。
func (p *Postgres) Board(ctx context.Context, since time.Time) (Board, error) {
	out := Board{Stores: []StoreRow{}}
	now := time.Now().UTC()

	// 组 1：覆盖率 + 归属起点。
	//
	// AttributedSince 的子查询**不带窗口**：它是「库里的历史起点」，是一个事实，
	// 不是窗口内的度量 —— 加上 $1 会让「第一个带门店的报名」永远落在窗口里，
	// 于是页面上的「只统计这之后的预约」就成了一句每次都为真的废话。
	if err := p.pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE p.store_id IS NOT NULL),
			(SELECT MIN(p2.joined_at) FROM activity.participants p2 WHERE p2.store_id IS NOT NULL)
		FROM activity.participants p
		WHERE p.joined_at >= $1`, since).
		Scan(&out.Coverage.Bookings, &out.Coverage.Attributed, &out.AttributedSince); err != nil {
		return Board{}, err
	}
	if out.Coverage.Bookings > 0 {
		rate := float64(out.Coverage.Attributed) / float64(out.Coverage.Bookings)
		out.Coverage.Rate = &rate
	}

	// 组 2：逐店预约数 + 最新一条快照。
	//
	// 门店侧是主表 LEFT JOIN LATERAL 快照，每家的两个计数走**相关子查询**而不是
	// participants ⋈ snapshots 并排 join：一家 3 行快照会把它自己的单数乘 3，而
	// 那个数字看起来完全正常（不是 0，也不是 null，只有对撞才看得出来）。
	// 排序 bookings DESC、name：预约最多的店在第一行。
	rows, err := p.pool.Query(ctx, `
		SELECT
			b.store_id, b.name, b.business_id, b.bookings, b.cancelled,
			b.capacity_pct, b.forecast_pct, b.accepting_traffic, b.snapshot_at
		FROM (
			SELECT
				s.id AS store_id, s.name, s.business_id,
				(SELECT COUNT(*) FROM activity.participants p
				  WHERE p.store_id = s.id AND p.joined_at >= $1 AND p.state = 'CONFIRMED'),
				(SELECT COUNT(*) FROM activity.participants p
				  WHERE p.store_id = s.id AND p.joined_at >= $1 AND p.state <> 'CONFIRMED'),
				snap.current_capacity_pct AS capacity_pct,
				snap.forecast_capacity_pct AS forecast_pct,
				snap.accepting_traffic AS accepting_traffic,
				snap.recorded_at AS snapshot_at
			FROM business.stores s
			LEFT JOIN LATERAL (
				SELECT ss.current_capacity_pct, ss.forecast_capacity_pct,
				       ss.accepting_traffic, ss.recorded_at
				FROM business.scene_supply_snapshots ss
				WHERE ss.store_id = s.id
				ORDER BY ss.recorded_at DESC
				LIMIT 1
			) snap ON TRUE
			WHERE s.status = 'ACTIVE'
		) b
		ORDER BY b.bookings DESC, b.name`, since)
	if err != nil {
		return Board{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var row StoreRow
		if err := rows.Scan(&row.StoreID, &row.Name, &row.BusinessID, &row.Bookings, &row.Cancelled,
			&row.CapacityPct, &row.ForecastPct, &row.AcceptingTraffic, &row.SnapshotAt); err != nil {
			return Board{}, err
		}
		if total := row.Bookings + row.Cancelled; total > 0 {
			rate := float64(row.Cancelled) / float64(total)
			row.CancelRate = &rate
		}
		if row.SnapshotAt != nil {
			age := int(now.Sub(*row.SnapshotAt).Minutes())
			row.SnapshotAgeMinutes = &age
		}
		out.Stores = append(out.Stores, row)
	}
	if err := rows.Err(); err != nil {
		return Board{}, err
	}

	// 组 3：无人认领的场景数。
	//
	// 活动的场景 id 存在 activities 的 payload JSONB 里（037 建表时 activities
	// 就没有场景专列；191 的注释、156 回填、FilterKnownParticipants 用的都是同一个
	// `payload->>'realitySceneId'` 键），所以这里也走同一个键。取的是**不同**场景的
	// 个数，不是活动数：同一个没人认领的场景里发了多少单，运营要采取的动作只有
	// 一个（去认领或去接这家店），数成单数会让人以为有很多个地方要修。
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT a.payload->>'realitySceneId')
		FROM activity.participants p
		JOIN activity.activities a ON a.id = p.activity_id
		WHERE p.joined_at >= $1
		  AND COALESCE(a.payload->>'realitySceneId', '') <> ''
		  AND NOT EXISTS (
			SELECT 1 FROM business.stores s
			WHERE s.status = 'ACTIVE' AND s.reality_scene_id = a.payload->>'realitySceneId'
		  )`, since).Scan(&out.UnclaimedScenes); err != nil {
		return Board{}, err
	}
	return out, nil
}

var _ Source = (*Postgres)(nil)
