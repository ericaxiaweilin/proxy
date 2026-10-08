package matchengine

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Record 一批一次写入（一个事务）。
func (p *Postgres) Record(ctx context.Context, ds []Decision) error {
	if len(ds) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, d := range ds {
		batch.Queue(`INSERT INTO matching.decisions (snapshot_id, subject_kind, subject_id, agent_id, eligible, gate, reason, organic_rank, in_set, exploration, rank_version, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			d.SnapshotID, string(d.SubjectKind), d.SubjectID, d.AgentID, d.Eligible, d.Gate, d.Reason, d.OrganicRank, d.InSet, d.Exploration, d.RankVersion, d.CreatedAt.UTC())
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	res := tx.SendBatch(ctx, batch)
	for range ds {
		if _, err := res.Exec(); err != nil {
			_ = res.Close()
			return err
		}
	}
	if err := res.Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Row 是运营看到的一行。
type Row struct {
	SnapshotID  string    `json:"snapshotId"`
	AgentID     string    `json:"agentId"`
	Eligible    bool      `json:"eligible"`
	Gate        string    `json:"gate,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	OrganicRank int       `json:"organicRank,omitempty"`
	InSet       bool      `json:"inSet"`
	Exploration bool      `json:"exploration,omitempty"`
	RankVersion string    `json:"rankVersion"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Explain 返回一个对象（单 / 档位）的撮合运行：最新的 snapshot 全部行；agentID 非空时只看她在各次运行里的结论。
func (p *Postgres) Explain(ctx context.Context, kind SubjectKind, subjectID, agentID string, limit int) ([]Row, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var rows pgx.Rows
	var err error
	if agentID != "" {
		rows, err = p.pool.Query(ctx, `SELECT snapshot_id, agent_id, eligible, gate, reason, organic_rank, in_set, exploration, rank_version, created_at
			FROM matching.decisions WHERE subject_kind = $1 AND subject_id = $2 AND agent_id = $3 ORDER BY created_at DESC LIMIT $4`, string(kind), subjectID, agentID, limit)
	} else {
		rows, err = p.pool.Query(ctx, `SELECT snapshot_id, agent_id, eligible, gate, reason, organic_rank, in_set, exploration, rank_version, created_at
			FROM matching.decisions WHERE subject_kind = $1 AND subject_id = $2
			  AND snapshot_id = (SELECT snapshot_id FROM matching.decisions WHERE subject_kind = $1 AND subject_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1)
			ORDER BY eligible DESC, organic_rank, agent_id LIMIT $3`, string(kind), subjectID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Row{}
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.SnapshotID, &r.AgentID, &r.Eligible, &r.Gate, &r.Reason, &r.OrganicRank, &r.InSet, &r.Exploration, &r.RankVersion, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SafetyBlocked：被安全运营封了账号（safety.blocks，ACCOUNT 类、未过期）。
func (p *Postgres) SafetyBlocked(ctx context.Context, userID string) (bool, error) {
	var n int
	err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM safety.blocks WHERE target_id = $1 AND block_type = 'ACCOUNT' AND (expires_at IS NULL OR expires_at > now())`, userID).Scan(&n)
	return n > 0, err
}

// UserBlocked：两人之间有一方拉黑了另一方（relationship.friendships.state = BLOCKED，user_a < user_b 有序存储）。
func (p *Postgres) UserBlocked(ctx context.Context, a, b string) (bool, error) {
	if a > b {
		a, b = b, a
	}
	var n int
	err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM relationship.friendships WHERE user_a = $1 AND user_b = $2 AND state = 'BLOCKED'`, a, b).Scan(&n)
	return n > 0, err
}
