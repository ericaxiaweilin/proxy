package decisionengine

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NudgeTypePrefix：收件箱里算作「主动打扰」的通知类型。今天只有引导推送（NUDGE_*）是平台
// 主动发的；邀约 / 被选中 / 订单这类是用户自己发起的流程里的回执，不占干预预算。
const NudgeTypePrefix = "NUDGE_"

// AccountLevels 是 accountstatus.Service 的最小接口（组合根注入）。
type AccountLevels interface {
	LevelOf(ctx context.Context, userID string) (string, error)
}

type Postgres struct {
	pool     *pgxpool.Pool
	accounts AccountLevels
}

func NewPostgres(pool *pgxpool.Pool, accounts AccountLevels) *Postgres {
	return &Postgres{pool: pool, accounts: accounts}
}

func (p *Postgres) RestrictionLevel(ctx context.Context, userID string) (string, error) {
	if p.accounts == nil {
		return "", errors.New("account status source not configured")
	}
	return p.accounts.LevelOf(ctx, userID)
}

func (p *Postgres) NudgesOptedOut(ctx context.Context, userID string) (bool, error) {
	var n int
	err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM notification.nudge_optouts WHERE user_account_id = $1`, userID).Scan(&n)
	return n > 0, err
}

func (p *Postgres) InterventionsSince(ctx context.Context, userID string, since time.Time) (int, error) {
	var n int
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notification.inbox_items
		 WHERE recipient_id = $1 AND starts_with(type, $2) AND created_at >= $3`,
		userID, NudgeTypePrefix, since).Scan(&n)
	return n, err
}

func (p *Postgres) GravityState(ctx context.Context, userID, eventType string) (*GravityState, error) {
	var g GravityState
	err := p.pool.QueryRow(ctx, `
		SELECT action_state, p60, evidence_coverage, confidence, computed_at
		  FROM decision.user_event_states
		 WHERE user_id = $1 AND event_type = $2 AND context_key = ''`,
		userID, eventType).Scan(&g.ActionState, &g.P60, &g.Coverage, &g.Confidence, &g.ComputedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (p *Postgres) Record(ctx context.Context, d Decision) error {
	steps, err := json.Marshal(d.Steps)
	if err != nil {
		return err
	}
	_, err = p.pool.Exec(ctx, `
		INSERT INTO decision.evaluations
		  (id, user_id, event_type, action, caller, subject, allowed, state, blocked_step, reason, steps, policy_version, latency_us, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		d.ID, d.Request.UserID, d.Request.EventType, d.Request.Action, d.Request.Caller, d.Request.Subject,
		d.Allowed, d.State, d.BlockedStep, d.Reason, steps, d.PolicyVersion, d.LatencyMicros, d.At)
	return err
}

// ---------------------------------------------------------------- 控制台读模型

type ReasonCount struct {
	Step   string `json:"step"`
	Reason string `json:"reason"`
	Count  int64  `json:"count"`
}

type CallerCount struct {
	Caller  string `json:"caller"`
	Action  string `json:"action"`
	Calls   int64  `json:"calls"`
	Allowed int64  `json:"allowed"`
}

type Stats struct {
	WindowDays    int           `json:"windowDays"`
	Calls         int64         `json:"calls"`
	Calls24h      int64         `json:"calls24h"`
	Allowed       int64         `json:"allowed"`
	P50Micros     *float64      `json:"p50Micros"`
	P95Micros     *float64      `json:"p95Micros"`
	LastCallAt    *time.Time    `json:"lastCallAt"`
	Blocks        []ReasonCount `json:"blocks"`
	ByCaller      []CallerCount `json:"byCaller"`
	ByState       []ReasonCount `json:"byState"` // step 字段放状态名，reason 为空
	PolicyVersion string        `json:"policyVersion"`
}

const statsWindowDays = 30

func (p *Postgres) Stats(ctx context.Context, now time.Time) (Stats, error) {
	since := now.Add(-statsWindowDays * 24 * time.Hour)
	s := Stats{WindowDays: statsWindowDays, Blocks: []ReasonCount{}, ByCaller: []CallerCount{}, ByState: []ReasonCount{}, PolicyVersion: PolicyVersion}
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE created_at >= $2),
		       COUNT(*) FILTER (WHERE allowed),
		       percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_us),
		       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_us),
		       MAX(created_at)
		  FROM decision.evaluations WHERE created_at >= $1`,
		since, now.Add(-24*time.Hour)).Scan(&s.Calls, &s.Calls24h, &s.Allowed, &s.P50Micros, &s.P95Micros, &s.LastCallAt)
	if err != nil {
		return s, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT blocked_step, reason, COUNT(*) FROM decision.evaluations
		 WHERE created_at >= $1 AND NOT allowed
		 GROUP BY 1, 2 ORDER BY 3 DESC`, since)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var r ReasonCount
		if err := rows.Scan(&r.Step, &r.Reason, &r.Count); err != nil {
			rows.Close()
			return s, err
		}
		s.Blocks = append(s.Blocks, r)
	}
	rows.Close()
	rows, err = p.pool.Query(ctx, `
		SELECT caller, action, COUNT(*), COUNT(*) FILTER (WHERE allowed) FROM decision.evaluations
		 WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 3 DESC`, since)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var c CallerCount
		if err := rows.Scan(&c.Caller, &c.Action, &c.Calls, &c.Allowed); err != nil {
			rows.Close()
			return s, err
		}
		s.ByCaller = append(s.ByCaller, c)
	}
	rows.Close()
	rows, err = p.pool.Query(ctx, `
		SELECT state, COUNT(*) FROM decision.evaluations WHERE created_at >= $1 GROUP BY 1 ORDER BY 2 DESC`, since)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var r ReasonCount
		if err := rows.Scan(&r.Step, &r.Count); err != nil {
			return s, err
		}
		s.ByState = append(s.ByState, r)
	}
	return s, rows.Err()
}
