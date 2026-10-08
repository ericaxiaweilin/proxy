package accountstatus

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) Append(ctx context.Context, c Change) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO moderation.account_restriction_changes (id, user_id, action, level, reason, report_id, actor_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, c.ID, c.UserID, c.Action, c.Level, c.Reason, c.ReportID, c.ActorID, c.CreatedAt.UTC())
	return err
}

func (p *Postgres) Current(ctx context.Context, userID string) (Active, bool, error) {
	var a Active
	var action string
	err := p.pool.QueryRow(ctx, `
		SELECT action, level, reason, report_id, actor_id, created_at FROM moderation.account_restriction_changes
		 WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, userID).Scan(&action, &a.Level, &a.Reason, &a.ReportID, &a.ActorID, &a.Since)
	if err == pgx.ErrNoRows {
		return Active{}, false, nil
	}
	if err != nil {
		return Active{}, false, err
	}
	a.UserID = userID
	return a, action == "SET", nil
}

func (p *Postgres) ListActive(ctx context.Context) ([]Active, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, level, reason, report_id, actor_id, created_at FROM (
			SELECT DISTINCT ON (user_id) user_id, action, level, reason, report_id, actor_id, created_at
			  FROM moderation.account_restriction_changes ORDER BY user_id, created_at DESC, id DESC
		) latest WHERE action = 'SET' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Active{}
	for rows.Next() {
		var a Active
		if err := rows.Scan(&a.UserID, &a.Level, &a.Reason, &a.ReportID, &a.ActorID, &a.Since); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InFlightOrders 数一个人手上还没结束的订单（作为需求方或服务方）——封禁不自动取消它们，
// 运营页把这个数摆出来，提醒人工善后。
func (p *Postgres) InFlightOrders(ctx context.Context, userID string) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM fulfillment.orders o
		 WHERE o.lifecycle NOT IN ('COMPLETED', 'CANCELLED')
		   AND (o.requester_id = $1 OR o.agent_id = $1
		        OR o.agent_id IN (SELECT agent_id FROM supply.agent_profiles WHERE user_account_id = $1))`, userID).Scan(&n)
	return n, err
}
