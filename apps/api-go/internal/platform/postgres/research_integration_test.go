package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/research"
)

// OPS-RESEARCH-001：research.experiments / research.shadow_evaluations 的**列名与往返**。
//
// 为什么必须对真库跑（而不是用 internal/research 的 Memory）：Memory 能证明规则
// （阶段机、乐观锁），但证明不了列名写对没有、jsonb 收不收 NULL、CHECK 约束在不在。
// 改掉一个列名，Memory 测试照样全绿 —— 只有运营第一次点「注册实验」时才会 500。
//
// 测试必须精确清理自己造的行：DATABASE_URL 指向共享开发库时，留下的行会被正在跑的
// dev API 读到（见 testdb_test.go 里 2026-09-03 那次教训）。
func TestResearchRepositoryRoundTripsAgainstRealSchema(t *testing.T) {
	ctx := context.Background()
	pool := requireTestPool(t)
	repo := NewResearchRepository(pool)

	suffix := fmt.Sprint(time.Now().UnixNano())
	id := "exp_it_" + suffix
	evalID := "eval_it_" + suffix
	missingID := "exp_it_missing_" + suffix
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM research.shadow_evaluations WHERE evaluation_id = $1`, evalID)
		_, _ = pool.Exec(ctx, `DELETE FROM research.experiments WHERE experiment_id = $1`, id)
	})

	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err := repo.CreateExperiment(ctx, research.Experiment{
		ExperimentID: id, Name: "集成测试实验", Hypothesis: "假设", Surface: "home",
		Stage: research.StageDraft, TrafficPct: 10, CreatedAt: now, UpdatedAt: now, Version: 1,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.GetExperiment(ctx, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "集成测试实验" || got.Hypothesis != "假设" || got.Surface != "home" ||
		got.Stage != research.StageDraft || got.TrafficPct != 10 || got.Version != 1 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}

	// 推阶段：stage 落地，version 前进（乐观锁的基准就是它）。
	upd, err := repo.UpdateStage(ctx, id, research.StageLab, got.Version)
	if err != nil {
		t.Fatalf("update stage: %v", err)
	}
	if upd.Stage != research.StageLab || upd.Version != got.Version+1 {
		t.Fatalf("update stage want LAB/v%d, got %s/v%d", got.Version+1, upd.Stage, upd.Version)
	}

	// 拿**过期的** version 再推一次：必须冲突，不能静默覆盖。
	if _, err := repo.UpdateStage(ctx, id, research.StageShadow, got.Version); !errors.Is(err, research.ErrVersionConflict) {
		t.Fatalf("stale version must be ErrVersionConflict, got %v", err)
	}
	// 不存在的 id：必须说 not found。两种 0 行混成一个报错，会让打错 id 的运营
	// 以为自己只是撞上并发，对着同一个错一直重试。
	if _, err := repo.UpdateStage(ctx, missingID, research.StageLab, 1); err == nil ||
		!strings.Contains(err.Error(), "not found") {
		t.Fatalf("missing id must say not found, got %v", err)
	}
	if _, err := repo.GetExperiment(ctx, missingID); err == nil ||
		!strings.Contains(err.Error(), "not found") {
		t.Fatalf("get missing must say not found, got %v", err)
	}

	// ListExperiments 的列清单一旦写错（改名/少一列）这里就红。
	all, err := repo.ListExperiments(ctx)
	if err != nil {
		t.Fatalf("list experiments: %v", err)
	}
	var seen bool
	for _, e := range all {
		if e.ExperimentID == id {
			seen = true
			if e.Stage != research.StageLab {
				t.Fatalf("list returned a stale stage: %s", e.Stage)
			}
		}
	}
	if !seen {
		t.Fatalf("list experiments did not return the row we just wrote")
	}

	// 影子评估：snapshot 一定有值，intent 是 nil（内核没给意图）——
	// 两者在库里必须是 NULL 与 NOT NULL 的区别，读回来也要保持区别。
	if err := repo.InsertShadowEvaluation(ctx, research.ShadowEvaluation{
		EvaluationID:   evalID,
		ExperimentID:   id,
		Snapshot:       map[string]any{"weather": "heavy_rain", "commute_eta": 40},
		Intent:         nil,
		NoChangeReason: "NO_UI_CHANGE",
		DecidedAt:      time.Now().UTC(),
	}); err != nil {
		t.Fatalf("insert shadow evaluation: %v", err)
	}

	evals, err := repo.ListShadowEvaluations(ctx, 50)
	if err != nil {
		t.Fatalf("list shadow evaluations: %v", err)
	}
	var mine *research.ShadowEvaluation
	for i := range evals {
		if evals[i].EvaluationID == evalID {
			mine = &evals[i]
			break
		}
	}
	if mine == nil {
		t.Fatalf("list shadow evaluations did not return the row we just wrote")
	}
	if mine.ExperimentID != id || mine.NoChangeReason != "NO_UI_CHANGE" {
		t.Fatalf("shadow evaluation round-trip mismatch: %+v", mine)
	}
	// jsonb 往返：字符串还是字符串，数字回来是 float64（JSON 只有一种数字类型）。
	if mine.Snapshot["weather"] != "heavy_rain" {
		t.Fatalf("snapshot.weather lost in round-trip: %#v", mine.Snapshot["weather"])
	}
	if eta, ok := mine.Snapshot["commute_eta"].(float64); !ok || eta != 40 {
		t.Fatalf("snapshot.commute_eta must come back as float64(40), got %#v", mine.Snapshot["commute_eta"])
	}
	// 这一条是 marshalJSON(nil) 的钉子：编成 `{}` 的话这里会拿到一个空 map 而不是 nil，
	// 于是 handler 记审计时会把「内核没给意图」写成「有意图」。
	if mine.Intent != nil {
		t.Fatalf("a NULL intent must read back as nil, got %#v", mine.Intent)
	}

	// 有 intent 的那条：内容原样往返（jsonb 不做字段裁剪）。
	if err := repo.InsertShadowEvaluation(ctx, research.ShadowEvaluation{
		EvaluationID: evalID + "_b",
		ExperimentID: id,
		Snapshot:     map[string]any{"weather": "clear"},
		Intent:       map[string]any{"kind": "PROACTIVE_NUDGE", "surface": "home"},
		DecidedAt:    time.Now().UTC().Add(time.Second),
	}); err != nil {
		t.Fatalf("insert second shadow evaluation: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM research.shadow_evaluations WHERE evaluation_id = $1`, evalID+"_b")
	})
	evals2, err := repo.ListShadowEvaluations(ctx, 50)
	if err != nil {
		t.Fatalf("list shadow evaluations: %v", err)
	}
	if len(evals2) == 0 || evals2[0].EvaluationID != evalID+"_b" {
		t.Fatalf("shadow evaluations must be newest-first, got %+v", evals2)
	}
	if evals2[0].Intent["kind"] != "PROACTIVE_NUDGE" {
		t.Fatalf("intent round-trip mismatch: %#v", evals2[0].Intent)
	}

	// CHECK 约束真的在：stage 只能是那五个词。绕过 service 直接写坏值必须被库拒。
	if _, err := pool.Exec(ctx,
		`UPDATE research.experiments SET stage = 'BOGUS' WHERE experiment_id = $1`, id); err == nil {
		t.Fatalf("the stage CHECK constraint is gone — a bad stage can be written straight to the table")
	}
}
