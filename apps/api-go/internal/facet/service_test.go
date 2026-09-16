package facet

import (
	"context"
	"testing"
)

func TestFacetService_ListReturnsObjects(t *testing.T) {
	repo := NewMemoryRepository()
	repo.Seed(nil, []Object{
		{ID: "f1", DisplayName: "Alice", Relation: "CREATOR_COLLAB", Goal: "photo"},
	})
	s := NewWithRepository(repo)
	list, err := s.List(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list.Objects) == 0 {
		t.Fatal("expected at least one object")
	}
}

func TestFacetService_ReasonerAppliesSignals(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	_ = s
}

// ---------- FACET-HERO-FABRICATED-001 ----------
//
// hero 的 freshAssets / shownAssets 曾经是 hardcode 常量（17 / 386）。用户
// 看到「已展示 386 条 · 新鲜素材 17 个」，而这两个数字跟库里任何数据都无关，
// 还跟同一屏每个对象的 currentState（「已展示 16 条」）矛盾。现在必须按对象
// signals 累加。

// heroStubRepository 只返回测试自己给的 objects；Seed 是 no-op，避免
// NewFull 内部的 SeedDefaults 把种子对象混进来干扰计数。
type heroStubRepository struct{ objects []Object }

func (r *heroStubRepository) List(context.Context) ([]Object, error) { return r.objects, nil }
func (r *heroStubRepository) Seed(context.Context, []Object) error   { return nil }

func listWithSignals(t *testing.T, objects []Object) Payload {
	t.Helper()
	s := NewFull(&heroStubRepository{objects: objects}, nil, nil, nil, nil)
	p, err := s.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	return p
}

// hero 的两个计数必须等于各对象 signals 之和。
func TestFacetService_HeroStatsAreSumOfObjectSignals(t *testing.T) {
	p := listWithSignals(t, []Object{
		{ID: "a", Relation: "BUILDING_TRUST", Signals: ObjectSignals{ShownAssetCount: 4, FreshAssetCount: 1}},
		{ID: "b", Relation: "SHARED_INTEREST", Signals: ObjectSignals{ShownAssetCount: 6, FreshAssetCount: 2}},
		{ID: "c", Relation: "CREATOR_COLLAB", Signals: ObjectSignals{ShownAssetCount: 10, FreshAssetCount: 3}},
	})
	if p.ShownAssets != 20 {
		t.Errorf("expected shownAssets=20 (4+6+10), got %d", p.ShownAssets)
	}
	if p.FreshAssets != 6 {
		t.Errorf("expected freshAssets=6 (1+2+3), got %d", p.FreshAssets)
	}
}

// 换 signals 必须换 hero。这一条是反常量的核心钉子：写死的实现会让两次
// 调用返回同一个数。（注释刻意不复述函数名，否则守门的 grep 会被注释骗绿。）
func TestFacetService_HeroStatsTrackSignals(t *testing.T) {
	low := listWithSignals(t, []Object{
		{ID: "a", Relation: "BUILDING_TRUST", Signals: ObjectSignals{ShownAssetCount: 2, FreshAssetCount: 1}},
	})
	high := listWithSignals(t, []Object{
		{ID: "a", Relation: "BUILDING_TRUST", Signals: ObjectSignals{ShownAssetCount: 9, FreshAssetCount: 7}},
	})
	if low.ShownAssets == high.ShownAssets {
		t.Errorf("shownAssets did not track signals (both %d) — hero is a constant, not a sum", low.ShownAssets)
	}
	if low.FreshAssets == high.FreshAssets {
		t.Errorf("freshAssets did not track signals (both %d) — hero is a constant, not a sum", low.FreshAssets)
	}
	if low.ShownAssets != 2 || high.ShownAssets != 9 {
		t.Errorf("expected shownAssets 2 then 9, got %d then %d", low.ShownAssets, high.ShownAssets)
	}
	if low.FreshAssets != 1 || high.FreshAssets != 7 {
		t.Errorf("expected freshAssets 1 then 7, got %d then %d", low.FreshAssets, high.FreshAssets)
	}
}

// 没有数据源时 hero 是 0，而不是「凭空给一个好看的数」。
// 0 在这里的含义是「没有可累加的 signals」。
func TestFacetService_HeroStatsZeroWhenNoSignals(t *testing.T) {
	p := listWithSignals(t, []Object{
		{ID: "a", Relation: "BUILDING_TRUST"},
		{ID: "b", Relation: "CREATOR_COLLAB"},
	})
	if p.ShownAssets != 0 || p.FreshAssets != 0 {
		t.Errorf("expected hero 0/0 with no signals, got shown=%d fresh=%d", p.ShownAssets, p.FreshAssets)
	}
}
