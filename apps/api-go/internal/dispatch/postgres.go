package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres 是 dispatch.runs / dispatch.steps（migration 181）的存储。
type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

const runColumns = `id, task_id, slot_id, requester_id, batch_id, budget_vnd, status, candidates, cursor,
	current_offer_id, current_agent_id, current_expires_at, assigned_agent_id, created_at, updated_at, version`

func scanRun(row pgx.Row) (Run, error) {
	var r Run
	var raw []byte
	var offer, agent, assigned *string
	err := row.Scan(&r.ID, &r.TaskID, &r.SlotID, &r.RequesterID, &r.BatchID, &r.BudgetVND, &r.Status, &raw, &r.Cursor,
		&offer, &agent, &r.CurrentExpiresAt, &assigned, &r.CreatedAt, &r.UpdatedAt, &r.Version)
	if err != nil {
		return Run{}, err
	}
	if err := json.Unmarshal(raw, &r.Candidates); err != nil {
		return Run{}, err
	}
	if offer != nil {
		r.CurrentOfferID = *offer
	}
	if agent != nil {
		r.CurrentAgentID = *agent
	}
	if assigned != nil {
		r.AssignedAgentID = *assigned
	}
	return r, nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func insertSteps(ctx context.Context, tx pgx.Tx, steps []Step) error {
	for _, s := range steps {
		var detail []byte
		if s.Detail != nil {
			var err error
			if detail, err = json.Marshal(s.Detail); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO dispatch.steps (run_id, kind, agent_id, offer_id, actor, detail, at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, s.RunID, s.Kind, nullable(s.AgentID), nullable(s.OfferID), s.Actor, detail, s.At); err != nil {
			return err
		}
	}
	return nil
}

func (p *Postgres) Create(ctx context.Context, runs []Run, steps []Step) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		inserted := map[string]bool{}
		for _, r := range runs {
			raw, err := json.Marshal(r.Candidates)
			if err != nil {
				return err
			}
			if r.Candidates == nil {
				raw = []byte("[]")
			}
			tag, err := tx.Exec(ctx, `INSERT INTO dispatch.runs (`+runColumns+`)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
				ON CONFLICT (task_id, slot_id) DO NOTHING`,
				r.ID, r.TaskID, r.SlotID, r.RequesterID, r.BatchID, r.BudgetVND, r.Status, raw, r.Cursor,
				nullable(r.CurrentOfferID), nullable(r.CurrentAgentID), r.CurrentExpiresAt, nullable(r.AssignedAgentID),
				r.CreatedAt, r.UpdatedAt, r.Version)
			if err != nil {
				return err
			}
			inserted[r.ID] = tag.RowsAffected() == 1
		}
		// 这个档位已经有派单（重复发布 / 重放的事件）：不建第二条，它的「开始」流水也不写。
		return insertSteps(ctx, tx, keepSteps(steps, inserted))
	})
}

func (p *Postgres) update(ctx context.Context, tx pgx.Tx, r Run, expectedVersion int) error {
	raw, err := json.Marshal(r.Candidates)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE dispatch.runs SET status = $2, candidates = $3, cursor = $4, current_offer_id = $5,
		current_agent_id = $6, current_expires_at = $7, assigned_agent_id = $8, updated_at = $9, version = $10
		WHERE id = $1 AND version = $11`,
		r.ID, r.Status, raw, r.Cursor, nullable(r.CurrentOfferID), nullable(r.CurrentAgentID), r.CurrentExpiresAt,
		nullable(r.AssignedAgentID), r.UpdatedAt, r.Version, expectedVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrVersionConflict
	}
	return nil
}

// ProcessDue 先取一批 RUNNING 的 id，再逐条 FOR UPDATE SKIP LOCKED：别的实例正拿着的那条直接跳过，
// 不会两边同时给同一个档位发邀约。fn 里的外部调用（发邀约）发生在这把行锁之内。
func (p *Postgres) ProcessDue(ctx context.Context, limit int, fn func(Run) (Run, []Step, error)) (int, error) {
	rows, err := p.pool.Query(ctx, `SELECT id FROM dispatch.runs WHERE status = 'RUNNING' ORDER BY updated_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
			r, err := scanRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM dispatch.runs
				WHERE id = $1 AND status = 'RUNNING' FOR UPDATE SKIP LOCKED`, id))
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			next, steps, err := fn(r)
			if err != nil {
				return err
			}
			if next.Version != r.Version {
				if err := p.update(ctx, tx, next, r.Version); err != nil {
					return err
				}
			}
			n++
			return insertSteps(ctx, tx, steps)
		})
		if err != nil {
			return n, err
		}
	}
	return n, nil
}

func (p *Postgres) Get(ctx context.Context, id string) (Run, []Step, error) {
	r, err := scanRun(p.pool.QueryRow(ctx, `SELECT `+runColumns+` FROM dispatch.runs WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, nil, ErrNotFound
	}
	if err != nil {
		return Run{}, nil, err
	}
	rows, err := p.pool.Query(ctx, `SELECT run_id, kind, COALESCE(agent_id, ''), COALESCE(offer_id, ''), actor, detail, at
		FROM dispatch.steps WHERE run_id = $1 ORDER BY id`, id)
	if err != nil {
		return Run{}, nil, err
	}
	defer rows.Close()
	steps := []Step{}
	for rows.Next() {
		var s Step
		var detail []byte
		if err := rows.Scan(&s.RunID, &s.Kind, &s.AgentID, &s.OfferID, &s.Actor, &detail, &s.At); err != nil {
			return Run{}, nil, err
		}
		if len(detail) > 0 {
			_ = json.Unmarshal(detail, &s.Detail)
		}
		steps = append(steps, s)
	}
	return r, steps, rows.Err()
}

func (p *Postgres) list(ctx context.Context, query string, args ...any) ([]Run, error) {
	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *Postgres) List(ctx context.Context, statuses []string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if len(statuses) == 0 {
		return p.list(ctx, `SELECT `+runColumns+` FROM dispatch.runs ORDER BY updated_at DESC LIMIT $1`, limit)
	}
	return p.list(ctx, `SELECT `+runColumns+` FROM dispatch.runs WHERE status = ANY($1) ORDER BY updated_at DESC LIMIT $2`, statuses, limit)
}

func (p *Postgres) TaskRuns(ctx context.Context, taskID string) ([]Run, error) {
	return p.list(ctx, `SELECT `+runColumns+` FROM dispatch.runs WHERE task_id = $1`, taskID)
}

func (p *Postgres) Save(ctx context.Context, run Run, expectedVersion int, steps []Step) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if err := p.update(ctx, tx, run, expectedVersion); err != nil {
			return err
		}
		return insertSteps(ctx, tx, steps)
	})
}

// Stats 是工作台顶部那几个数，全部来自 runs / steps，没有一个是估算。
type Stats struct {
	Running, Assigned, Exhausted, Cancelled int
	// 被接的那些从建单到被接的中位分钟数；没有被接的就是 nil（不显示 0）。
	MedianMinutesToAssign *float64
	Since                 time.Time
}

func (p *Postgres) Stats(ctx context.Context, since time.Time) (Stats, error) {
	s := Stats{Since: since}
	err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status = 'RUNNING'), COUNT(*) FILTER (WHERE status = 'ASSIGNED'),
			COUNT(*) FILTER (WHERE status = 'EXHAUSTED'), COUNT(*) FILTER (WHERE status = 'CANCELLED'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.at - r.created_at)) / 60)
				FILTER (WHERE a.at IS NOT NULL)
		FROM dispatch.runs r
		LEFT JOIN LATERAL (SELECT at FROM dispatch.steps st WHERE st.run_id = r.id AND st.kind = 'ACCEPTED' ORDER BY id LIMIT 1) a ON true
		WHERE r.created_at >= $1`, since).Scan(&s.Running, &s.Assigned, &s.Exhausted, &s.Cancelled, &s.MedianMinutesToAssign)
	return s, err
}
