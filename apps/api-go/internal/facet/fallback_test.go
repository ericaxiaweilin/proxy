package facet

import (
	"context"
	"testing"
)

// 2026-09-03 实证 bug：PG 持久化层没有 signals 列，repository.List 返回
// 的对象全带零值 signals。旧 fallback 按 ID 硬编码 ken/linh/spa，任何
// 其他 ID（集成测试 seed 的 fct_* / 未来真实用户建的对象）的
// RecommendedKind 保持零值 ""，直接违反 contracts 的 7 值枚举，mobile
// Zod fail-closed 让整个 FACET 页面报「服务暂时不可用」。
//
// 这组测试钉死结构保证：任何 relation 的无 signals 对象，Service.List
// 都必须输出合法 recommendedKind（fallback 走 reasoner 按 relation 路由）。

// allowedRecommendedKinds 与 contracts facet.ts FacetRecommendedKindSchema
// 的枚举集严格同步（加值必须两侧一起改，否则 mobile fail-closed）。
var allowedRecommendedKinds = map[string]bool{
	"personal/real-life":   true,
	"personal/honest":      true,
	"city/travel":          true,
	"photo":                true,
	"shared-experience":    true,
	"portfolio/capability": true,
	"intro/services":       true,
}

// TestList_FallbackKindAlwaysInEnum — 无 signals 对象（模拟 PG 行）逐
// relation 断言：recommendedKind ∈ contracts 枚举、confidence 落在
// [confidenceFloor, 100]、gap 非空。
func TestList_FallbackKindAlwaysInEnum(t *testing.T) {
	relations := []string{"BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB", "UNKNOWN_RELATION"}
	for _, rel := range relations {
		svc := NewWithRepository(&MemoryRepository{})
		if err := svc.repository.Seed(context.Background(), []Object{{
			ID: "fct_pg_row_" + rel, DisplayName: "PG row", Relation: rel,
			PillLabel: "pill", AvatarURL: "",
		}}); err != nil {
			t.Fatalf("seed %s: %v", rel, err)
		}
		payload, err := svc.List(context.Background())
		if err != nil {
			t.Fatalf("list %s: %v", rel, err)
		}
		if len(payload.Objects) != 1 {
			t.Fatalf("%s: expected 1 object, got %d", rel, len(payload.Objects))
		}
		o := payload.Objects[0]
		if !allowedRecommendedKinds[o.RecommendedKind] {
			t.Errorf("%s: recommendedKind %q not in contracts enum (Zod would fail-closed)", rel, o.RecommendedKind)
		}
		if o.ReasoningConfidence < 0 || o.ReasoningConfidence > 100 {
			t.Errorf("%s: confidence %d out of [0,100]", rel, o.ReasoningConfidence)
		}
		if o.Goal == "" || o.CurrentState == "" || o.Gap.Summary == "" || o.Gap.NextShowAt == "" {
			t.Errorf("%s: empty goal/currentState/gap from fallback: %+v", rel, o)
		}
	}
}

// TestList_FallbackOnMixedRows — 真 signals 行 + 无 signals 行混排时，
// 无 signals 行同样得到合法枚举（真实事故现场：ken/linh/spa + fct_*）。
func TestList_FallbackOnMixedRows(t *testing.T) {
	svc := NewWithRepository(&MemoryRepository{})
	seed := []Object{
		{ID: "ken", DisplayName: "Ken", Relation: "BUILDING_TRUST", PillLabel: "重点关系"},
		{ID: "fct_a_1", DisplayName: "Proxy Buddy", Relation: "BUILDING_TRUST", PillLabel: "pill"},
		{ID: "fct_b_1", DisplayName: "Proxy Mentor", Relation: "SHARED_INTEREST", PillLabel: "pill"},
	}
	if err := svc.repository.Seed(context.Background(), seed); err != nil {
		t.Fatalf("seed: %v", err)
	}
	payload, err := svc.List(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(payload.Objects) != 3 {
		t.Fatalf("expected 3 objects, got %d", len(payload.Objects))
	}
	for _, o := range payload.Objects {
		if !allowedRecommendedKinds[o.RecommendedKind] {
			t.Errorf("id=%s recommendedKind %q not in contracts enum (Zod fail-closed)", o.ID, o.RecommendedKind)
		}
	}
}
