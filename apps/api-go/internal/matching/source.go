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
	if err := rows.Err(); err != nil {
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
