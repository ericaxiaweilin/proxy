package matching

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SignalSource 读服务者的真实履约信号。nil = 没配库，调用方按「没有记录」排序（全员先验分 + 价格）。
type SignalSource interface {
	Signals(ctx context.Context, agentIDs []string) (map[string]Signals, error)
}

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Signals：
//   - 完成 / 准时 / 满意 来自 fulfillment.orders（满意度存在 outcome.satisfaction，见 MATCH-RANK-001）；
//   - 取消只算**服务者自己取消**的（谁取消的只记在 OrderCancelled 事件里：integration.outbox_messages.payload.role），
//     需求方取消不扣她的可靠分；
//   - 响应来自引力状态 decision.user_event_states（CHAT_ACTIVE，按 supply.agent_profiles.user_account_id 对上人）。
func (p *Postgres) Signals(ctx context.Context, agentIDs []string) (map[string]Signals, error) {
	out, err := p.trackRecord(ctx, agentIDs)
	if err != nil || len(agentIDs) == 0 {
		return out, err
	}
	return p.locationLoadAndGravity(ctx, agentIDs, out)
}

// trackRecord 是履约 / 满意那部分：按 fulfillment.orders.agent_id 读。市场单确认时 agent_id 写的就是
// 报名人的用户账号（ConfirmMarketApplication），所以这一段对供给档案 id 和用户账号 id 都成立。
func (p *Postgres) trackRecord(ctx context.Context, agentIDs []string) (map[string]Signals, error) {
	out := make(map[string]Signals, len(agentIDs))
	if len(agentIDs) == 0 {
		return out, nil
	}
	rows, err := p.pool.Query(ctx, `
		SELECT o.agent_id,
			COUNT(*) FILTER (WHERE o.lifecycle = 'COMPLETED'),
			COUNT(*) FILTER (WHERE o.lifecycle = 'CANCELLED' AND EXISTS (
				SELECT 1 FROM integration.outbox_messages m
				WHERE m.aggregate_id = o.id AND m.event_type = 'OrderCancelled' AND m.payload->>'role' = 'AGENT')),
			COUNT(*) FILTER (WHERE o.lifecycle = 'COMPLETED' AND COALESCE((o.outcome->>'onTime')::boolean, false)),
			COUNT(*) FILTER (WHERE o.outcome->'satisfaction' IS NOT NULL),
			COALESCE(SUM(CASE o.outcome->'satisfaction'->>'resolved' WHEN 'FULL' THEN 1.0 WHEN 'PARTIAL' THEN 0.5 ELSE 0 END)
				FILTER (WHERE o.outcome->'satisfaction' IS NOT NULL), 0),
			COUNT(*) FILTER (WHERE o.outcome->'satisfaction'->>'repeatIntent' = 'REUSE')
		FROM fulfillment.orders o
		WHERE o.agent_id = ANY($1)
		GROUP BY o.agent_id`, agentIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var s Signals
		if err := rows.Scan(&id, &s.Completed, &s.Cancelled, &s.OnTime, &s.Rated, &s.SatisfactionSum, &s.WouldReuse); err != nil {
			rows.Close()
			return nil, err
		}
		out[id] = s
	}
	rows.Close()
	return out, rows.Err()
}

func (p *Postgres) locationLoadAndGravity(ctx context.Context, agentIDs []string, out map[string]Signals) (map[string]Signals, error) {
	// DISPATCH-RANK-002：位置（算距离用）与手上还没结束的活（负载）。
	loadRows, err := p.pool.Query(ctx, `
		SELECT a.agent_id, a.lat, a.lng,
			(SELECT COUNT(*) FROM fulfillment.offers f
				WHERE f.agent_id = a.agent_id AND f.status = 'OFFERED' AND f.expires_at > now())
			+ (SELECT COUNT(*) FROM fulfillment.orders o
				WHERE o.agent_id = a.agent_id AND o.lifecycle NOT IN ('COMPLETED', 'CANCELLED'))
		FROM supply.agent_profiles a
		WHERE a.agent_id = ANY($1)`, agentIDs)
	if err != nil {
		return nil, err
	}
	for loadRows.Next() {
		var id string
		var lat, lng *float64
		var load int
		if err := loadRows.Scan(&id, &lat, &lng, &load); err != nil {
			loadRows.Close()
			return nil, err
		}
		s := out[id]
		s.Lat, s.Lng, s.ActiveLoad = lat, lng, load
		out[id] = s
	}
	loadRows.Close()
	if err := loadRows.Err(); err != nil {
		return nil, err
	}
	gravityRows, err := p.pool.Query(ctx, `
		SELECT a.agent_id, s.p60
		FROM supply.agent_profiles a
		JOIN decision.user_event_states s
			ON s.user_id = a.user_account_id AND s.event_type = 'CHAT_ACTIVE' AND s.context_key = ''
		WHERE a.agent_id = ANY($1)`, agentIDs)
	if err != nil {
		return nil, err
	}
	defer gravityRows.Close()
	for gravityRows.Next() {
		var id string
		var p60 float64
		if err := gravityRows.Scan(&id, &p60); err != nil {
			return nil, err
		}
		s := out[id]
		v := p60
		s.ChatP60 = &v
		out[id] = s
	}
	return out, gravityRows.Err()
}

// UserSignals 是按**用户账号 id** 读的同一份信号 —— 市场报名人就是用户账号（不是供给档案 id）。
// 位置与 App「附近」同一个优先级：本人上报的实时位置（identity.profiles），没有再退到接单资料坐标。
// MARKET-RANK-001。
func (p *Postgres) UserSignals(ctx context.Context, userIDs []string) (map[string]Signals, error) {
	out, err := p.trackRecord(ctx, userIDs)
	if err != nil || len(userIDs) == 0 {
		return out, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT u.id, COALESCE(ip.lat, ag.lat), COALESCE(ip.lng, ag.lng),
			(SELECT COUNT(*) FROM fulfillment.offers f
				WHERE f.agent_id = u.id AND f.status = 'OFFERED' AND f.expires_at > now())
			+ (SELECT COUNT(*) FROM fulfillment.orders o
				WHERE o.agent_id = u.id AND o.lifecycle NOT IN ('COMPLETED', 'CANCELLED')),
			gs.p60
		FROM unnest($1::text[]) AS u(id)
		LEFT JOIN identity.profiles ip ON ip.user_account_id = u.id
		LEFT JOIN LATERAL (SELECT a.lat, a.lng FROM supply.agent_profiles a WHERE a.user_account_id = u.id LIMIT 1) ag ON true
		LEFT JOIN decision.user_event_states gs ON gs.user_id = u.id AND gs.event_type = 'CHAT_ACTIVE' AND gs.context_key = ''`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var lat, lng, p60 *float64
		var load int
		if err := rows.Scan(&id, &lat, &lng, &load, &p60); err != nil {
			return nil, err
		}
		s := out[id]
		s.Lat, s.Lng, s.ActiveLoad, s.ChatP60 = lat, lng, load, p60
		out[id] = s
	}
	return out, rows.Err()
}
