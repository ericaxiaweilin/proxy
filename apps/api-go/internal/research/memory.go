package research

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

// Memory 是 Repo 的内存实现。
//
// 它服务两类测试：api 层的 handler 测试（证明门 / 校验 / 状态码），以及 research
// 自身的单元测试（证明阶段机与影子的规则）。**它不模拟 Postgres 的行为** ——
// 列名、jsonb 往返、CHECK 约束、真乐观锁都由
// internal/platform/postgres 的集成测试对真库钉（见 research_integration_test.go）。
//
// 唯一键冲突的文案里必须带 "duplicate key"：api 层靠这个子串把冲突翻成 409，
// 与真库 pgx 的报错形状对齐。
type Memory struct {
	mu    sync.Mutex
	exps  map[string]Experiment
	evals []ShadowEvaluation
	// Now 可注入（默认 time.Now）。UpdateStage 要写 UpdatedAt，而「按更新时间倒序」
	// 这条排序断言在同一毫秒内的两次更新上会并列 —— 那排序就变成掷骰子。
	// 想断言顺序的测试接一个步进的假钟。
	Now func() time.Time
}

func NewMemory() *Memory {
	return &Memory{exps: map[string]Experiment{}}
}

func (m *Memory) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now().UTC()
}

func (m *Memory) CreateExperiment(_ context.Context, e Experiment) (Experiment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.exps[e.ExperimentID]; ok {
		return Experiment{}, errors.New("research: duplicate key (experiment_id)")
	}
	m.exps[e.ExperimentID] = e
	return e, nil
}

func (m *Memory) GetExperiment(_ context.Context, id string) (Experiment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.exps[id]
	if !ok {
		return Experiment{}, errors.New("research: experiment not found")
	}
	return e, nil
}

// UpdateStage 与 Postgres 版同语义：version 对不上就是 ErrVersionConflict。
func (m *Memory) UpdateStage(_ context.Context, id string, to Stage, expectedVersion int) (Experiment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.exps[id]
	if !ok {
		return Experiment{}, errors.New("research: experiment not found")
	}
	if e.Version != expectedVersion {
		return Experiment{}, ErrVersionConflict
	}
	e.Stage, e.Version, e.UpdatedAt = to, e.Version+1, m.now()
	m.exps[id] = e
	return e, nil
}

func (m *Memory) ListExperiments(_ context.Context) ([]Experiment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Experiment, 0, len(m.exps))
	for _, e := range m.exps {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExperimentID < out[j].ExperimentID })
	return out, nil
}

func (m *Memory) InsertShadowEvaluation(_ context.Context, ev ShadowEvaluation) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.evals = append(m.evals, ev)
	return nil
}

// ListShadowEvaluations 返回最近 limit 条（新的在前）—— 与 Postgres 的
// `ORDER BY decided_at DESC LIMIT $1` 同方向，handler 的排序断言才有意义。
func (m *Memory) ListShadowEvaluations(_ context.Context, limit int) ([]ShadowEvaluation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ShadowEvaluation, 0, len(m.evals))
	for i := len(m.evals) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.evals[i])
	}
	return out, nil
}
