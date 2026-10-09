package identitytier

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Points：这个人在这个身份下的积分（账本求和）。
func (p *Postgres) Points(ctx context.Context, k Kind, id string) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx, `SELECT COALESCE(SUM(delta), 0) FROM growth.point_ledger WHERE subject_kind = $1 AND subject_id = $2`, string(k), id).Scan(&n)
	return n, err
}

// Credit：记一笔积分（幂等：同一 (身份, 人, 原因, ref) 只记一次）。返回是否真的新增。
func (p *Postgres) Credit(ctx context.Context, k Kind, id string, delta int, reason, ref string, now time.Time) (bool, error) {
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
		VALUES ('pl_' || md5($1 || '|' || $2 || '|' || $4 || '|' || $5), $1, $2, $3, $4, $5, $6)
		ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`, string(k), id, delta, reason, ref, now.UTC())
	return tag.RowsAffected() == 1, err
}

const collectWindow = 35 * 24 * time.Hour

// CollectUser：把用户已经做成的事折成积分（固定规则，见 EarnRules）。幂等，可以每轮重跑；只看最近 35 天。
// 只给 ACTIVE 账号加分。返回新增的笔数。
func (p *Postgres) CollectUser(ctx context.Context, now time.Time) (int, error) {
	return p.collectUser(ctx, now, "")
}

// CollectUserFor：只给一个人收（读自己的成长值时立刻补算，不依赖后台任务刚好跑过）。
func (p *Postgres) CollectUserFor(ctx context.Context, userID string, now time.Time) (int, error) {
	return p.collectUser(ctx, now, userID)
}

func (p *Postgres) collectUser(ctx context.Context, now time.Time, only string) (int, error) {
	rules := map[string]int{}
	for _, r := range EarnRules(User) {
		rules[r.Reason] = r.Points
	}
	since := now.Add(-collectWindow).UTC()
	total := 0
	run := func(sql string, args ...any) error {
		tag, err := p.pool.Exec(ctx, sql, args...)
		total += int(tag.RowsAffected())
		return err
	}
	const ins = `INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
		SELECT 'pl_' || md5('USER|' || uid || '|' || $1 || '|' || ref), 'USER', uid, $2, $1, ref, $3 FROM (`
	// $4 = 时间下限，$5 = 只收这个人（空 = 所有人）；两个参数每条语句都要引用。
	const tail = `) x WHERE ($5::text = '' OR x.uid = $5) AND $4::timestamptz IS NOT NULL ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`
	// 完善资料。
	if err := run(ins+`SELECT u.id AS uid, ''::text AS ref FROM identity.user_accounts u
		JOIN identity.profiles pr ON pr.user_account_id = u.id AND btrim(pr.name) <> '' AND pr.avatar_path <> ''
		WHERE u.status = 'ACTIVE'`+tail, "PROFILE_COMPLETE", rules["PROFILE_COMPLETE"], now.UTC(), since, only); err != nil {
		return total, err
	}
	// 发帖：每人每天最多算 3 条（越南时区的自然日）。
	if err := run(ins+`SELECT author_id AS uid, id AS ref FROM (
			SELECT po.author_id, po.id, row_number() OVER (PARTITION BY po.author_id, (po.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date ORDER BY po.created_at, po.id) AS rn
			  FROM localnet.posts po JOIN identity.user_accounts u ON u.id = po.author_id AND u.status = 'ACTIVE'
			 WHERE po.author_type = 'USER' AND po.status = 'PUBLISHED' AND po.created_at >= $4) ranked WHERE rn <= 3`+tail, "POST_PUBLISHED", rules["POST_PUBLISHED"], now.UTC(), since, only); err != nil {
		return total, err
	}
	// 参加活动。
	if err := run(ins+`SELECT pt.actor_id AS uid, pt.activity_id AS ref FROM activity.participants pt
		JOIN identity.user_accounts u ON u.id = pt.actor_id AND u.status = 'ACTIVE' WHERE pt.joined_at >= $4`+tail, "ACTIVITY_JOINED", rules["ACTIVITY_JOINED"], now.UTC(), since, only); err != nil {
		return total, err
	}
	// 完成订单（作为下单方）。
	if err := run(ins+`SELECT o.requester_id AS uid, o.id AS ref FROM fulfillment.orders o
		JOIN identity.user_accounts u ON u.id = o.requester_id AND u.status = 'ACTIVE' WHERE o.lifecycle = 'COMPLETED' AND o.updated_at >= $4`+tail, "ORDER_COMPLETED", rules["ORDER_COMPLETED"], now.UTC(), since, only); err != nil {
		return total, err
	}
	return total, nil
}

type Bucket struct {
	Kind  Kind   `json:"kind"`
	Tier  string `json:"tier"`
	Stars int    `json:"stars"`
	Users int    `json:"users"`
}

// Distribution：各身份下各等级有多少人（只数账本里有积分的人；没记过分的人不在这里，也不编成 0 分的铜 1）。
func (p *Postgres) Distribution(ctx context.Context) ([]Bucket, error) {
	rows, err := p.pool.Query(ctx, `SELECT subject_kind, subject_id, SUM(delta)::int FROM growth.point_ledger GROUP BY 1, 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	count := map[[3]string]int{}
	for rows.Next() {
		var k, id string
		var pts int
		if err := rows.Scan(&k, &id, &pts); err != nil {
			return nil, err
		}
		l := Resolve(Kind(k), pts)
		count[[3]string{k, l.Tier, itoa(l.Stars)}]++
	}
	out := []Bucket{}
	for _, k := range Kinds() {
		for _, s := range Ladder(k) {
			out = append(out, Bucket{Kind: k, Tier: s.Tier, Stars: s.Stars, Users: count[[3]string{string(k), s.Tier, itoa(s.Stars)}]})
		}
	}
	return out, rows.Err()
}

func itoa(n int) string { return string(rune('0' + n)) }

type Entry struct {
	Reason    string    `json:"reason"`
	Delta     int       `json:"delta"`
	CreatedAt time.Time `json:"createdAt"`
}

// Recent：最近的几笔积分（给用户自己看「分是怎么来的」）。
func (p *Postgres) Recent(ctx context.Context, k Kind, id string, limit int) ([]Entry, error) {
	rows, err := p.pool.Query(ctx, `SELECT reason, delta, created_at FROM growth.point_ledger WHERE subject_kind = $1 AND subject_id = $2 ORDER BY created_at DESC, id LIMIT $3`, string(k), id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.Reason, &e.Delta, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CollectMerchant：商家每接待一单 +1 分（订单已履约完成，且被指认到这家商家名下的店 —— fulfillment.orders.store_id）。
// 幂等，可每轮重跑；老订单没有 store_id 不回填（没人能诚实补上）。返回新增笔数。
func (p *Postgres) CollectMerchant(ctx context.Context, now time.Time) (int, error) {
	points := 1
	for _, r := range EarnRules(Merchant) {
		points = r.Points
	}
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
		SELECT 'pl_' || md5('MERCHANT|' || s.business_id || '|ORDER_HOSTED|' || o.id), 'MERCHANT', s.business_id, $1, 'ORDER_HOSTED', o.id, $2
		  FROM fulfillment.orders o JOIN business.stores s ON s.id = o.store_id
		 WHERE o.store_id <> '' AND o.lifecycle = 'COMPLETED'
		ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`, points, now.UTC())
	return int(tag.RowsAffected()), err
}

// CollectProvider：小美的订单积分写进账本（口径与「我的权益」原来的实时算法一致）：
//   - 完成一笔订单 +50（ORDER_SERVED，每单一次）；
//   - 该订单得到完全满意 +30（SATISFACTION_FULL，每单一次）；
//   - 一位客户在她这里完成过 2 单以上 +100（REPEAT_CLIENT，每位客户一次）。
//
// 幂等，可每轮重跑；不设时间窗（要把历史订单一次折进来），subject 是订单上的 agent_id（= 她的账号 id）。
func (p *Postgres) CollectProvider(ctx context.Context, now time.Time) (int, error) {
	return p.collectProvider(ctx, now, "")
}

// CollectProviderFor：只给一个人收。
func (p *Postgres) CollectProviderFor(ctx context.Context, userID string, now time.Time) (int, error) {
	return p.collectProvider(ctx, now, userID)
}

func (p *Postgres) collectProvider(ctx context.Context, now time.Time, only string) (int, error) {
	pts := map[string]int{}
	for _, r := range EarnRules(Provider) {
		pts[r.Reason] = r.Points
	}
	total := 0
	run := func(sql string, args ...any) error {
		tag, err := p.pool.Exec(ctx, sql, args...)
		total += int(tag.RowsAffected())
		return err
	}
	const ins = `INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
		SELECT 'pl_' || md5('PROVIDER|' || uid || '|' || $1 || '|' || ref), 'PROVIDER', uid, $2, $1, ref, $3 FROM (`
	const tail = `) x WHERE ($4::text = '' OR x.uid = $4) ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`
	if err := run(ins+`SELECT o.agent_id AS uid, o.id AS ref FROM fulfillment.orders o WHERE o.lifecycle = 'COMPLETED'`+tail, "ORDER_SERVED", pts["ORDER_SERVED"], now.UTC(), only); err != nil {
		return total, err
	}
	if err := run(ins+`SELECT o.agent_id AS uid, o.id AS ref FROM fulfillment.orders o
		WHERE o.lifecycle = 'COMPLETED' AND o.outcome->'satisfaction'->>'resolved' = 'FULL'`+tail, "SATISFACTION_FULL", pts["SATISFACTION_FULL"], now.UTC(), only); err != nil {
		return total, err
	}
	if err := run(ins+`SELECT o.agent_id AS uid, o.requester_id AS ref FROM fulfillment.orders o
		WHERE o.lifecycle = 'COMPLETED' GROUP BY o.agent_id, o.requester_id HAVING COUNT(*) >= 2`+tail, "REPEAT_CLIENT", pts["REPEAT_CLIENT"], now.UTC(), only); err != nil {
		return total, err
	}
	return total, nil
}
