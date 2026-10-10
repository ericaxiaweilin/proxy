package research

import (
	"context"
	"errors"
	"sort"
	"time"
)

// OPS-RESEARCH-001（2026-10-08）：实验注册 + 影子评估的最小闭环。
//
// 运营后台 Research 页（Lab / Shadow / Prod）原来是没有后端的纯 mock ——
// 全库 0 张实验表，桩的「§18 §19」引用也是虚的（spec 正文根本没有这两节）。
// 这一版按页面自己的形状建最小真实闭环：
//
//	注册实验 → 沿阶段流水线推（DRAFT→LAB→SHADOW→PROD，任一非 ENDED 可收尾）
//	→ SHADOW 阶段可投真实 ContextSnapshot 跑影子判定（结果进库、不进 App——
//	  这就是「影子」的定义：引擎真的在判，用户看不见）。
//
// 有意不做的（不是没做完，是做了也空转）：
//   - 流量分桶 / 置信区间 / 自动晋级：没有行为样本之前全是机器空转；
//   - arms 的引擎参数差异引擎还不消费（判定内核只有暴雨规则）。

// Stage 是实验的阶段。流水线严格单向（收尾除外）：
// DRAFT → LAB → SHADOW → PROD，任一非 ENDED 可以 ENDED。
type Stage string

const (
	StageDraft  Stage = "DRAFT"
	StageLab    Stage = "LAB"
	StageShadow Stage = "SHADOW"
	StageProd   Stage = "PROD"
	StageEnded  Stage = "ENDED"
)

// stageOrder 决定「只能往前推」。ENDED 是终点，任何迁移都不允许离开它。
var stageOrder = map[Stage]int{StageDraft: 0, StageLab: 1, StageShadow: 2, StageProd: 3, StageEnded: 4}

// AllStages 是受控词表（输入校验 + 页面渲染顺序）。
var AllStages = []Stage{StageDraft, StageLab, StageShadow, StageProd, StageEnded}

// ErrIllegalTransition 表示阶段回退 / 跨级 / 终点再迁移。
var ErrIllegalTransition = errors.New("research: illegal stage transition")

// ErrWrongStageForShadow 表示影子评估投给了非 SHADOW 阶段的实验 ——
// 影子流量只存在于 SHADOW 阶段，PROD 是真流量，LAB 还没上影子。
var ErrWrongStageForShadow = errors.New("research: shadow evaluation requires SHADOW stage")

// ErrVersionConflict 表示推阶段时实验已被别人改过（乐观锁）。
// 两个运营同时推同一个实验：两边读到的都是同一个旧 version，只有先写的那次能落地，
// 后到的必须**看见冲突**而不是悄悄覆盖 —— 否则后一次推阶段会凭空消失。
var ErrVersionConflict = errors.New("research: experiment was modified by someone else")

// Experiment 是一条注册实验。
type Experiment struct {
	ExperimentID string    `json:"experiment_id"`
	Name         string    `json:"name"`
	Hypothesis   string    `json:"hypothesis"`
	Surface      string    `json:"surface"`
	Stage        Stage     `json:"stage"`
	TrafficPct   int       `json:"traffic_pct"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Version      int       `json:"version"`
}

// ShadowEvaluation 是一次影子判定：引擎真的跑了，结果留在库里，App 看不见。
type ShadowEvaluation struct {
	EvaluationID   string         `json:"evaluation_id"`
	ExperimentID   string         `json:"experiment_id"`
	Snapshot       map[string]any `json:"snapshot"`
	Intent         map[string]any `json:"intent"`
	NoChangeReason string         `json:"no_change_reason"`
	DecidedAt      time.Time      `json:"decided_at"`
}

// CanTransition：DRAFT→LAB→SHADOW→PROD 严格前进；非 ENDED 都可以收尾。
func CanTransition(from, to Stage) bool {
	if from == StageEnded || to == StageEnded && from == StageEnded {
		return false
	}
	if to == StageEnded {
		return true
	}
	return stageOrder[to] == stageOrder[from]+1
}

// Inventory 是运营页一屏要看的全部：按阶段汇总 + 明细 + 最近影子评估。
type Inventory struct {
	StageCounts       map[string]int     `json:"stage_counts"`
	Experiments       []Experiment       `json:"experiments"`
	RecentShadowEvals []ShadowEvaluation `json:"recent_shadow_evals"`
}

// Repo 是存储面。Postgres 实现（platform/postgres）为主，测试用 Memory。
//
// UpdateStage 带 expectedVersion：读到的 version 与库里不一致时返回 ErrVersionConflict
// （乐观锁 —— 见 ErrVersionConflict 的注释）。
type Repo interface {
	CreateExperiment(ctx context.Context, e Experiment) (Experiment, error)
	GetExperiment(ctx context.Context, id string) (Experiment, error)
	UpdateStage(ctx context.Context, id string, to Stage, expectedVersion int) (Experiment, error)
	ListExperiments(ctx context.Context) ([]Experiment, error)
	InsertShadowEvaluation(ctx context.Context, ev ShadowEvaluation) error
	ListShadowEvaluations(ctx context.Context, limit int) ([]ShadowEvaluation, error)
}

// Service 是运营页背后的一切写操作。判定内核由 caller 注入
// （Evaluate func：ContextSnapshot 的 map 形态进，intent map / no_change_reason 出 ——
// api 层包 runtime.Decide，research 包不依赖 experience/runtime，方向保持单向）。
type Service struct {
	Repo     Repo
	Now      func() time.Time
	Evaluate func(snapshot map[string]any) (map[string]any, string)
}

// NewService：Repo 必给；Evaluate 由组合根（cmd/api）接 runtime.Decide。
func NewService(repo Repo) *Service {
	return &Service{Repo: repo}
}

// Create 校验并注册实验（默认 DRAFT）。
func (s *Service) Create(ctx context.Context, e Experiment) (Experiment, error) {
	if e.ExperimentID == "" || e.Name == "" {
		return Experiment{}, errors.New("research: experiment_id and name are required")
	}
	if e.Stage == "" {
		e.Stage = StageDraft
	}
	if e.Stage != StageDraft {
		return Experiment{}, errors.New("research: new experiments start in DRAFT")
	}
	if e.Surface == "" {
		e.Surface = "home"
	}
	if e.TrafficPct < 0 || e.TrafficPct > 100 {
		return Experiment{}, errors.New("research: traffic_pct out of range")
	}
	now := s.now()
	e.CreatedAt, e.UpdatedAt, e.Version = now, now, 1
	return s.Repo.CreateExperiment(ctx, e)
}

// Transition 推阶段。读到的 version 一起交给 Repo —— 期间有人改过就回 ErrVersionConflict。
func (s *Service) Transition(ctx context.Context, id string, to Stage) (Experiment, error) {
	if !isKnownStage(to) {
		return Experiment{}, errors.New("research: unknown stage")
	}
	cur, err := s.Repo.GetExperiment(ctx, id)
	if err != nil {
		return Experiment{}, err
	}
	if !CanTransition(cur.Stage, to) {
		return Experiment{}, ErrIllegalTransition
	}
	return s.Repo.UpdateStage(ctx, id, to, cur.Version)
}

// RecordShadowEvaluation：SHADOW 阶段专属 —— 引擎真实判定一次并存档。
// 这就是影子流量的定义：结果进库（运营可对账），不进 App。
func (s *Service) RecordShadowEvaluation(ctx context.Context, experimentID, evaluationID string, snapshot map[string]any) (ShadowEvaluation, error) {
	cur, err := s.Repo.GetExperiment(ctx, experimentID)
	if err != nil {
		return ShadowEvaluation{}, err
	}
	if cur.Stage != StageShadow {
		return ShadowEvaluation{}, ErrWrongStageForShadow
	}
	if s.Evaluate == nil {
		return ShadowEvaluation{}, errors.New("research: evaluate not wired")
	}
	if evaluationID == "" {
		evaluationID = "eval_" + cur.ExperimentID + "_" + s.now().UTC().Format("20060102150405")
	}
	intent, noChange := s.Evaluate(snapshot)
	ev := ShadowEvaluation{
		EvaluationID:   evaluationID,
		ExperimentID:   experimentID,
		Snapshot:       snapshot,
		Intent:         intent,
		NoChangeReason: noChange,
		DecidedAt:      s.now().UTC(),
	}
	if err := s.Repo.InsertShadowEvaluation(ctx, ev); err != nil {
		return ShadowEvaluation{}, err
	}
	return ev, nil
}

// Inventory 汇总：阶段计数（ENDED 也数 —— 收尾的实验不是消失的实验）+ 明细 + 最近影子评估。
func (s *Service) Inventory(ctx context.Context, shadowLimit int) (Inventory, error) {
	exps, err := s.Repo.ListExperiments(ctx)
	if err != nil {
		return Inventory{}, err
	}
	counts := map[string]int{}
	for _, st := range AllStages {
		counts[string(st)] = 0
	}
	for _, e := range exps {
		counts[string(e.Stage)]++
	}
	sort.Slice(exps, func(i, j int) bool { return exps[i].UpdatedAt.After(exps[j].UpdatedAt) })
	if shadowLimit <= 0 {
		shadowLimit = 10
	}
	evals, err := s.Repo.ListShadowEvaluations(ctx, shadowLimit)
	if err != nil {
		return Inventory{}, err
	}
	return Inventory{StageCounts: counts, Experiments: exps, RecentShadowEvals: evals}, nil
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

func isKnownStage(st Stage) bool {
	_, ok := stageOrder[st]
	return ok
}
