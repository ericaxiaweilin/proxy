package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/research"
)

// OPS-RESEARCH-001：research.experiments / research.shadow_evaluations 的存取（迁移 181）。
//
// 列名一改就红的口令在**本包**的 research_integration_test.go 里钉（对真库跑）。
// 原来这句写的是「internal/research 的集成测试」—— 那是写不出来的：本包 import
// research，research 再 import 本包就成环。所以钉只能在有真库的这边。

type ResearchRepository struct {
	pool *pgxpool.Pool
}

// NewResearchRepository：research.experiments / shadow_evaluations 的存取（迁移 181）。
func NewResearchRepository(pool *pgxpool.Pool) *ResearchRepository {
	return &ResearchRepository{pool: pool}
}

const experimentColumns = `experiment_id, name, hypothesis, surface, stage, traffic_pct, created_at, updated_at, version`

func scanExperiment(row pgx.Row) (research.Experiment, error) {
	var e research.Experiment
	err := row.Scan(&e.ExperimentID, &e.Name, &e.Hypothesis, &e.Surface, &e.Stage,
		&e.TrafficPct, &e.CreatedAt, &e.UpdatedAt, &e.Version)
	return e, err
}

// CreateExperiment 插入一条 DRAFT 实验。ID 冲突原样上抛（调用方给 409）。
func (r *ResearchRepository) CreateExperiment(ctx context.Context, e research.Experiment) (research.Experiment, error) {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO research.experiments (experiment_id, name, hypothesis, surface, stage, traffic_pct, created_at, updated_at, version)
		VALUES ($1, $2, $3, $4, $5::text, $6, $7, $8, $9)`,
		e.ExperimentID, e.Name, e.Hypothesis, e.Surface, string(e.Stage), e.TrafficPct,
		e.CreatedAt, e.UpdatedAt, e.Version)
	if err != nil {
		return research.Experiment{}, err
	}
	return e, nil
}

func (r *ResearchRepository) GetExperiment(ctx context.Context, id string) (research.Experiment, error) {
	e, err := scanExperiment(r.pool.QueryRow(ctx,
		`SELECT `+experimentColumns+` FROM research.experiments WHERE experiment_id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return research.Experiment{}, errors.New("research: experiment not found")
	}
	return e, err
}

// UpdateStage 带乐观锁：WHERE 里带 expectedVersion，对不上就回 ErrVersionConflict
// （运营双人同时推阶段，后到的**看见冲突**，而不是把先到的那次悄悄覆盖掉 ——
// 那种丢更新没有任何地方会报出来）。
//
// 0 行有两种原因，必须分开报：实验不存在 vs version 被别人改过。混成一个「冲突」
// 会让打错 id 的运营以为只是并发，对着同一个错一直重试。
func (r *ResearchRepository) UpdateStage(ctx context.Context, id string, to research.Stage, expectedVersion int) (research.Experiment, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE research.experiments
		SET stage = $2::text, version = version + 1, updated_at = now()
		WHERE experiment_id = $1 AND version = $3`, id, string(to), expectedVersion)
	if err != nil {
		return research.Experiment{}, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := r.GetExperiment(ctx, id); err != nil {
			return research.Experiment{}, err
		}
		return research.Experiment{}, research.ErrVersionConflict
	}
	return r.GetExperiment(ctx, id)
}

func (r *ResearchRepository) ListExperiments(ctx context.Context) ([]research.Experiment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+experimentColumns+` FROM research.experiments ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []research.Experiment
	for rows.Next() {
		e, err := scanExperiment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *ResearchRepository) InsertShadowEvaluation(ctx context.Context, ev research.ShadowEvaluation) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO research.shadow_evaluations (evaluation_id, experiment_id, snapshot, intent, no_change_reason, decided_at)
		VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
		ev.EvaluationID, ev.ExperimentID, marshalJSON(ev.Snapshot), marshalJSON(ev.Intent),
		ev.NoChangeReason, ev.DecidedAt)
	return err
}

func (r *ResearchRepository) ListShadowEvaluations(ctx context.Context, limit int) ([]research.ShadowEvaluation, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT evaluation_id, experiment_id, snapshot, intent, no_change_reason, decided_at
		FROM research.shadow_evaluations ORDER BY decided_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []research.ShadowEvaluation
	for rows.Next() {
		var ev research.ShadowEvaluation
		var snap, intent []byte
		if err := rows.Scan(&ev.EvaluationID, &ev.ExperimentID, &snap, &intent, &ev.NoChangeReason, &ev.DecidedAt); err != nil {
			return nil, err
		}
		ev.Snapshot = unmarshalJSONMap(snap)
		if intent != nil {
			ev.Intent = unmarshalJSONMap(intent)
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// marshalJSON / unmarshalJSONMap：jsonb 列 ↔ map 的两个小助手。
//
// nil map 编成 SQL NULL（不是 `{}`）：`intent` 列可空，而「内核没给意图」和
// 「内核给了一个空意图」是两件事 —— 前者读回来必须是 nil，否则 handler 记审计时
// `ev.Intent != nil` 会把它报成"有意图"。这里不编造默认值。
//
// 注意 `snapshot` 列是 NOT NULL：真传 nil 会被库拒。那是调用方的 bug，应该炸出来。
func marshalJSON(m map[string]any) []byte {
	if m == nil {
		return []byte(`null`)
	}
	b, err := json.Marshal(m)
	if err != nil {
		return []byte(`null`)
	}
	return b
}

func unmarshalJSONMap(b []byte) map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	return m
}
