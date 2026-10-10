package research

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// OPS-RESEARCH-001：阶段机 + 影子评估的规则测试（对 Memory，不连库）。
//
// 这里钉的是**规则**：什么迁移合法、影子只能在 SHADOW 阶段投、乐观锁会不会丢更新。
// 列名 / jsonb / CHECK 约束不在这一层 —— 那些只有真库能证明，见
// internal/platform/postgres/research_integration_test.go。

// stepClock：每次调用往前走一分钟，好让 Inventory 的「按更新时间倒序」有东西可排。
type stepClock struct{ t time.Time }

func (c *stepClock) now() time.Time { c.t = c.t.Add(time.Minute); return c.t }

func newSvc() (*Service, *Memory, *stepClock) {
	mem := NewMemory()
	clk := &stepClock{t: time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)}
	svc := NewService(mem)
	svc.Now = clk.now
	return svc, mem, clk
}

func mustCreate(t *testing.T, svc *Service, id string) Experiment {
	t.Helper()
	e, err := svc.Create(context.Background(), Experiment{ExperimentID: id, Name: "n_" + id})
	if err != nil {
		t.Fatalf("create %s: %v", id, err)
	}
	return e
}

func TestCreateValidatesAndDefaultsToDraft(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newSvc()

	for _, tc := range []struct {
		name string
		in   Experiment
		want string
	}{
		{"no id", Experiment{Name: "x"}, "required"},
		{"no name", Experiment{ExperimentID: "e1"}, "required"},
		{"starts above DRAFT", Experiment{ExperimentID: "e2", Name: "x", Stage: StageLab}, "DRAFT"},
		{"traffic over 100", Experiment{ExperimentID: "e3", Name: "x", TrafficPct: 101}, "range"},
		{"negative traffic", Experiment{ExperimentID: "e4", Name: "x", TrafficPct: -1}, "range"},
	} {
		if _, err := svc.Create(ctx, tc.in); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: want error containing %q, got %v", tc.name, tc.want, err)
		}
	}

	// 默认值：stage=DRAFT、surface=home、version=1，且 CreatedAt == UpdatedAt。
	e, err := svc.Create(ctx, Experiment{ExperimentID: "e_ok", Name: "ok"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if e.Stage != StageDraft || e.Surface != "home" || e.Version != 1 {
		t.Fatalf("defaults wrong: %+v", e)
	}
	if !e.CreatedAt.Equal(e.UpdatedAt) {
		t.Fatalf("created_at != updated_at on create: %v vs %v", e.CreatedAt, e.UpdatedAt)
	}

	// 同一个 id 再建一次：文案必须带 "duplicate key"（api 层靠这个子串翻 409）。
	if _, err := svc.Create(ctx, Experiment{ExperimentID: "e_ok", Name: "ok"}); err == nil ||
		!strings.Contains(err.Error(), "duplicate key") {
		t.Fatalf("duplicate create must say duplicate key, got %v", err)
	}
}

func TestCanTransitionIsStrictlyForwardAndEndedIsTerminal(t *testing.T) {
	legal := [][2]Stage{
		{StageDraft, StageLab},
		{StageLab, StageShadow},
		{StageShadow, StageProd},
		{StageDraft, StageEnded},
		{StageLab, StageEnded},
		{StageShadow, StageEnded},
		{StageProd, StageEnded},
	}
	for _, p := range legal {
		if !CanTransition(p[0], p[1]) {
			t.Fatalf("%s -> %s must be legal", p[0], p[1])
		}
	}

	illegal := [][2]Stage{
		{StageDraft, StageShadow}, // 跨级
		{StageDraft, StageProd},   // 跨两级
		{StageLab, StageProd},     // 跨级
		{StageLab, StageDraft},    // 回退
		{StageShadow, StageLab},   // 回退
		{StageProd, StageShadow},  // 回退
		{StageEnded, StageDraft},  // ENDED 是终点
		{StageEnded, StageEnded},  // 终点不能原地再迁
		{StageProd, StageProd},    // 原地不动不算迁移
	}
	for _, p := range illegal {
		if CanTransition(p[0], p[1]) {
			t.Fatalf("%s -> %s must be illegal", p[0], p[1])
		}
	}
}

func TestTransitionRejectsUnknownNotFoundAndBackward(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newSvc()
	mustCreate(t, svc, "e1")

	if _, err := svc.Transition(ctx, "e1", Stage("NOPE")); err == nil ||
		!strings.Contains(err.Error(), "unknown stage") {
		t.Fatalf("unknown stage must be rejected, got %v", err)
	}
	if _, err := svc.Transition(ctx, "missing", StageLab); err == nil ||
		!strings.Contains(err.Error(), "not found") {
		t.Fatalf("missing experiment must say not found, got %v", err)
	}
	if _, err := svc.Transition(ctx, "e1", StageShadow); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("DRAFT -> SHADOW must be ErrIllegalTransition, got %v", err)
	}

	e, err := svc.Transition(ctx, "e1", StageLab)
	if err != nil {
		t.Fatalf("DRAFT -> LAB: %v", err)
	}
	if e.Stage != StageLab || e.Version != 2 {
		t.Fatalf("after transition want LAB/v2, got %s/v%d", e.Stage, e.Version)
	}
}

// staleGetRepo 模拟「我读到实验之后，别人又推了一次阶段」——
// 这是乐观锁唯一要防的那件事，用真并发跑会 flaky，所以直接把「读到旧 version」做出来。
type staleGetRepo struct {
	*Memory
	staleFor string
}

func (r *staleGetRepo) GetExperiment(ctx context.Context, id string) (Experiment, error) {
	e, err := r.Memory.GetExperiment(ctx, id)
	if err != nil {
		return e, err
	}
	if id == r.staleFor {
		e.Version-- // 交出去的是过期的 version
	}
	return e, nil
}

func TestTransitionRefusesToOverwriteSomeoneElsesChange(t *testing.T) {
	ctx := context.Background()
	mem := NewMemory()
	svc := NewService(&staleGetRepo{Memory: mem, staleFor: "e1"})
	svc.Now = time.Now
	if _, err := svc.Create(ctx, Experiment{ExperimentID: "e1", Name: "n"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	// 别人把 DRAFT 推成了 LAB（version 1 -> 2）。
	if _, err := mem.UpdateStage(ctx, "e1", StageLab, 1); err != nil {
		t.Fatalf("other writer: %v", err)
	}
	// 我手上还是 v1 / DRAFT 的认知，推 LAB->SHADOW：必须冲突，而不是覆盖。
	if _, err := svc.Transition(ctx, "e1", StageShadow); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("want ErrVersionConflict, got %v", err)
	}
	// 库里仍然是别人写下的 LAB，没被我的过期认知改掉。
	cur, err := mem.GetExperiment(ctx, "e1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if cur.Stage != StageLab {
		t.Fatalf("stale write must not land, stage is %s", cur.Stage)
	}
}

func TestShadowEvaluationOnlyInShadowStage(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := newSvc()
	svc.Evaluate = func(map[string]any) (map[string]any, string) { return nil, "NO_UI_CHANGE" }
	mustCreate(t, svc, "e1")

	// DRAFT：影子评估必须被拒 —— 「影子」只存在于 SHADOW 阶段。
	if _, err := svc.RecordShadowEvaluation(ctx, "e1", "", map[string]any{"weather": "clear"}); !errors.Is(err, ErrWrongStageForShadow) {
		t.Fatalf("DRAFT must reject shadow eval, got %v", err)
	}
	if _, err := svc.Transition(ctx, "e1", StageLab); err != nil {
		t.Fatalf("to LAB: %v", err)
	}
	if _, err := svc.RecordShadowEvaluation(ctx, "e1", "", map[string]any{"weather": "clear"}); !errors.Is(err, ErrWrongStageForShadow) {
		t.Fatalf("LAB must reject shadow eval, got %v", err)
	}
	if _, err := svc.Transition(ctx, "e1", StageShadow); err != nil {
		t.Fatalf("to SHADOW: %v", err)
	}

	// SHADOW：判定真的跑，结果原样进库（intent + no_change_reason 都留着）。
	svc.Evaluate = func(snap map[string]any) (map[string]any, string) {
		if snap["weather"] != "heavy_rain" {
			t.Errorf("kernel got the wrong snapshot: %v", snap)
		}
		return map[string]any{"kind": "PROACTIVE_NUDGE"}, ""
	}
	ev, err := svc.RecordShadowEvaluation(ctx, "e1", "", map[string]any{"weather": "heavy_rain"})
	if err != nil {
		t.Fatalf("shadow eval in SHADOW: %v", err)
	}
	if ev.EvaluationID == "" || !strings.HasPrefix(ev.EvaluationID, "eval_e1_") {
		t.Fatalf("evaluation id must be derived from the experiment, got %q", ev.EvaluationID)
	}
	if ev.Intent["kind"] != "PROACTIVE_NUDGE" || ev.NoChangeReason != "" {
		t.Fatalf("kernel output not stored as-is: %+v", ev)
	}

	// 没接内核就是没接：不能悄悄存一条空判定当"跑过了"。
	svc.Evaluate = nil
	if _, err := svc.RecordShadowEvaluation(ctx, "e1", "", map[string]any{"weather": "clear"}); err == nil ||
		!strings.Contains(err.Error(), "evaluate not wired") {
		t.Fatalf("unwired kernel must be loud, got %v", err)
	}
}

func TestInventoryCountsEveryStageAndSortsByRecency(t *testing.T) {
	ctx := context.Background()
	mem := NewMemory()
	clk := &stepClock{t: time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)}
	// 服务层与仓储用同一个步进钟：否则 UpdateStage 写下的 UpdatedAt 是真实时间，
	// 同一毫秒内的两次更新会并列，排序断言就变成掷骰子。
	mem.Now = clk.now
	svc := NewService(mem)
	svc.Now = clk.now
	svc.Evaluate = func(map[string]any) (map[string]any, string) { return nil, "NO_UI_CHANGE" }

	mustCreate(t, svc, "a") // 留在 DRAFT
	mustCreate(t, svc, "b")
	mustCreate(t, svc, "c")
	if _, err := svc.Transition(ctx, "b", StageLab); err != nil {
		t.Fatalf("b -> LAB: %v", err)
	}
	if _, err := svc.Transition(ctx, "c", StageEnded); err != nil {
		t.Fatalf("c -> ENDED: %v", err)
	}

	inv, err := svc.Inventory(ctx, 10)
	if err != nil {
		t.Fatalf("inventory: %v", err)
	}
	want := map[string]int{"DRAFT": 1, "LAB": 1, "SHADOW": 0, "PROD": 0, "ENDED": 1}
	for k, v := range want {
		if inv.StageCounts[k] != v {
			t.Fatalf("stage %s: want %d got %d (%v)", k, v, inv.StageCounts[k], inv.StageCounts)
		}
	}
	// 收尾的实验还在盘里 —— ENDED 不是「消失」，是「做完了」。
	if len(inv.Experiments) != 3 {
		t.Fatalf("ended experiments must stay in the inventory, got %d rows", len(inv.Experiments))
	}
	// 最近动过的排最前（c 被推过 ENDED，b 被推过 LAB，a 没动过）。
	if inv.Experiments[0].ExperimentID != "c" {
		t.Fatalf("inventory must be sorted by recency, first is %s", inv.Experiments[0].ExperimentID)
	}

	// shadowLimit<=0 走默认 10：不该把「没传」变成「一条都不给」。
	if err := mem.InsertShadowEvaluation(ctx, ShadowEvaluation{EvaluationID: "x"}); err != nil {
		t.Fatalf("insert eval: %v", err)
	}
	inv2, err := svc.Inventory(ctx, 0)
	if err != nil {
		t.Fatalf("inventory: %v", err)
	}
	if len(inv2.RecentShadowEvals) != 1 {
		t.Fatalf("zero limit must fall back to the default, got %d", len(inv2.RecentShadowEvals))
	}
}
