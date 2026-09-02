package facet

import (
	"strings"
	"testing"
	"time"
)

// frozenTime 给 RuleReasoner 注入固定 now，便于断言 NextShowAt 是未来时间。
func frozenTime() time.Time {
	return time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
}

// TestReasoner_BuildingTrust_LongSilence —— 重点关系 × 7 天没聊 + 未回 → honest 破冰
func TestReasoner_BuildingTrust_LongSilence(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat:     8,
		UnrepliedMessageCount: 2,
		ProfileViewsLast7d:    3,
		ShownAssetCount:       16,
	}, "BUILDING_TRUST")
	if d.RecommendedKind != "personal/honest" {
		t.Errorf("expected personal/honest, got %q", d.RecommendedKind)
	}
	if d.Confidence < 80 {
		t.Errorf("expected high confidence for clear signal, got %d", d.Confidence)
	}
	if !strings.Contains(d.GapSummary, "破冰") {
		t.Errorf("gap summary should mention 破冰, got %q", d.GapSummary)
	}
	if !strings.Contains(d.CurrentState, "8") {
		t.Errorf("current state should include the 8 day count, got %q", d.CurrentState)
	}
}

// TestReasoner_BuildingTrust_HighProfileViews —— 重点关系 × 高浏览 + 久未聊 → real-life
func TestReasoner_BuildingTrust_HighProfileViews(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat:  10,
		ProfileViewsLast7d: 4,
		ShownAssetCount:    10,
	}, "BUILDING_TRUST")
	if d.RecommendedKind != "personal/real-life" {
		t.Errorf("expected personal/real-life, got %q", d.RecommendedKind)
	}
	if d.Confidence < 75 {
		t.Errorf("expected reasonable confidence, got %d", d.Confidence)
	}
}

// TestReasoner_BuildingTrust_Stable —— 重点关系 × 稳定 → 默认 real-life
func TestReasoner_BuildingTrust_Stable(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat:  2,
		ProfileViewsLast7d: 1,
		ShownAssetCount:    30,
		RelationshipDays:   60,
	}, "BUILDING_TRUST")
	if d.RecommendedKind != "personal/real-life" {
		t.Errorf("expected personal/real-life, got %q", d.RecommendedKind)
	}
	if d.Confidence >= 80 {
		t.Errorf("stable case should be lower confidence, got %d", d.Confidence)
	}
}

// TestReasoner_SharedInterest_FreshAsset —— 朋友 × 有 fresh + 近期互动 → city/travel
func TestReasoner_SharedInterest_FreshAsset(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat: 1,
		FreshAssetCount:   2,
		ShownAssetCount:   22,
	}, "SHARED_INTEREST")
	if d.RecommendedKind != "city/travel" {
		t.Errorf("expected city/travel, got %q", d.RecommendedKind)
	}
	if !strings.Contains(d.GapSummary, "城市") {
		t.Errorf("gap should mention city, got %q", d.GapSummary)
	}
}

// TestReasoner_SharedInterest_MutualEvents —— 朋友 × 共同活动 → shared-experience
func TestReasoner_SharedInterest_MutualEvents(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat: 5,
		MutualEventsCount: 4,
		ShownAssetCount:   15,
		RelationshipDays:  120,
	}, "SHARED_INTEREST")
	if d.RecommendedKind != "shared-experience" {
		t.Errorf("expected shared-experience, got %q", d.RecommendedKind)
	}
}

// TestReasoner_SharedInterest_Default —— 朋友 × 默认 → photo
func TestReasoner_SharedInterest_Default(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		DaysSinceLastChat: 7,
		ShownAssetCount:   10,
	}, "SHARED_INTEREST")
	if d.RecommendedKind != "photo" {
		t.Errorf("expected photo, got %q", d.RecommendedKind)
	}
}

// TestReasoner_CreatorCollab_HighIntent —— 合作 × 高意向 → portfolio/capability
func TestReasoner_CreatorCollab_HighIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 75,
		ProfileViewsLast7d:  5,
		RelationshipDays:    30,
		ShownAssetCount:     8,
	}, "CREATOR_COLLAB")
	if d.RecommendedKind != "portfolio/capability" {
		t.Errorf("expected portfolio/capability, got %q", d.RecommendedKind)
	}
	if d.Confidence < 85 {
		t.Errorf("high intent should yield very high confidence, got %d", d.Confidence)
	}
	if !strings.Contains(d.Goal, "成交") {
		t.Errorf("goal should mention 成交, got %q", d.Goal)
	}
}

// TestReasoner_CreatorCollab_MidIntent —— 合作 × 中等意向 → intro/services
func TestReasoner_CreatorCollab_MidIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 45,
		DaysSinceLastChat:   5,
		ShownAssetCount:     5,
	}, "CREATOR_COLLAB")
	if d.RecommendedKind != "intro/services" {
		t.Errorf("expected intro/services, got %q", d.RecommendedKind)
	}
}

// TestReasoner_CreatorCollab_LowIntent —— 合作 × 低意向 → real-life 先建立关系
func TestReasoner_CreatorCollab_LowIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 15,
		RelationshipDays:    5,
	}, "CREATOR_COLLAB")
	if d.RecommendedKind != "personal/real-life" {
		t.Errorf("expected personal/real-life (build trust first), got %q", d.RecommendedKind)
	}
}

// TestReasoner_UnknownRelation —— 未知 relation 不静默失败，给低置信度默认
func TestReasoner_UnknownRelation(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		ShownAssetCount: 10,
		FreshAssetCount: 1,
	}, "UNKNOWN_RELATION")
	if d.RecommendedKind == "" {
		t.Error("unknown relation should still produce a recommendedKind")
	}
	if d.Confidence > 50 {
		t.Errorf("unknown relation should have low confidence, got %d", d.Confidence)
	}
}

// TestReasoner_NextShowAtIsFuture —— 任何决策的 NextShowAt 都必须是未来时间
func TestReasoner_NextShowAtIsFuture(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	cases := []struct {
		relation string
		signals  ObjectSignals
	}{
		{"BUILDING_TRUST", ObjectSignals{DaysSinceLastChat: 8, UnrepliedMessageCount: 2, ProfileViewsLast7d: 3}},
		{"SHARED_INTEREST", ObjectSignals{FreshAssetCount: 2, DaysSinceLastChat: 1}},
		{"CREATOR_COLLAB", ObjectSignals{CollaborationIntent: 75}},
		{"UNKNOWN", ObjectSignals{}},
	}
	for _, c := range cases {
		d := r.Reason(c.signals, c.relation)
		next, err := time.Parse(time.RFC3339, d.NextShowAt)
		if err != nil {
			t.Errorf("[%s] NextShowAt not RFC3339: %q err=%v", c.relation, d.NextShowAt, err)
			continue
		}
		if !next.After(frozenTime()) {
			t.Errorf("[%s] NextShowAt %v must be after now %v", c.relation, next, frozenTime())
		}
	}
}

// TestReasoner_RecommendedKindAlwaysAllowed —— 推荐类型必须从白名单里
func TestReasoner_RecommendedKindAlwaysAllowed(t *testing.T) {
	allowed := map[string]bool{
		"personal/real-life":   true,
		"personal/honest":      true,
		"city/travel":          true,
		"photo":                true,
		"shared-experience":    true,
		"portfolio/capability": true,
		"intro/services":       true,
	}
	r := NewRuleReasoner(frozenTime)
	for _, relation := range []string{"BUILDING_TRUST", "SHARED_INTEREST", "CREATOR_COLLAB"} {
		// 跑 10 个不同的 signal 组合
		for i := 0; i < 10; i++ {
			s := ObjectSignals{
				DaysSinceLastChat:     i,
				MutualEventsCount:     i % 5,
				UnrepliedMessageCount: i % 4,
				ProfileViewsLast7d:    i % 6,
				ShownAssetCount:       i * 2,
				FreshAssetCount:       i % 3,
				RelationshipDays:      i * 7,
				CollaborationIntent:   i * 10,
			}
			d := r.Reason(s, relation)
			if !allowed[d.RecommendedKind] {
				t.Errorf("[%s] recommendedKind %q not in whitelist", relation, d.RecommendedKind)
			}
		}
	}
}

// TestReasoner_Determinism —— 同 inputs 必产同 outputs（可缓存前提）
func TestReasoner_Determinism(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	s := ObjectSignals{
		DaysSinceLastChat: 8, UnrepliedMessageCount: 2, ProfileViewsLast7d: 3,
		ShownAssetCount: 16, RelationshipDays: 45,
	}
	d1 := r.Reason(s, "BUILDING_TRUST")
	d2 := r.Reason(s, "BUILDING_TRUST")
	if d1 != d2 {
		t.Errorf("non-deterministic: %+v vs %+v", d1, d2)
	}
}

// TestReasoner_SideSpace_HighIntent —— R15.42 副空间：合作方高意向
func TestReasoner_SideSpace_HighIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 75, ProfileViewsLast7d: 5, RelationshipDays: 30,
		ShownAssetCount: 8,
	}, "CREATOR_COLLAB")
	if d.SideSpaceGap == "" {
		t.Error("high intent should produce sideSpaceGap")
	}
	if d.SideSpaceKind != "portfolio/capability" {
		t.Errorf("high intent should recommend portfolio/capability, got %q", d.SideSpaceKind)
	}
	if !strings.Contains(d.SideSpaceGap, "8") {
		t.Errorf("sideSpaceGap should mention ShownAssetCount=8, got %q", d.SideSpaceGap)
	}
}

// TestReasoner_SideSpace_MidIntent —— R15.42 副空间：合作方中等意向
func TestReasoner_SideSpace_MidIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 45, ShownAssetCount: 3,
	}, "CREATOR_COLLAB")
	if d.SideSpaceGap == "" {
		t.Error("mid intent should produce sideSpaceGap")
	}
	if d.SideSpaceKind != "intro/services" {
		t.Errorf("mid intent should recommend intro/services, got %q", d.SideSpaceKind)
	}
}

// TestReasoner_SideSpace_LowIntent —— R15.42 副空间：合作方低意向不需副空间
func TestReasoner_SideSpace_LowIntent(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	d := r.Reason(ObjectSignals{
		CollaborationIntent: 15, RelationshipDays: 5,
	}, "CREATOR_COLLAB")
	if d.SideSpaceGap != "" {
		t.Errorf("low intent should NOT produce sideSpaceGap, got %q", d.SideSpaceGap)
	}
	if d.SideSpaceKind != "" {
		t.Errorf("low intent sideSpaceKind should be empty, got %q", d.SideSpaceKind)
	}
}

// TestReasoner_SideSpace_NonCollabEmpty —— R15.42 副空间：非合作方恒空
func TestReasoner_SideSpace_NonCollabEmpty(t *testing.T) {
	r := NewRuleReasoner(frozenTime)
	for _, relation := range []string{"BUILDING_TRUST", "SHARED_INTEREST"} {
		d := r.Reason(ObjectSignals{
			DaysSinceLastChat: 1, FreshAssetCount: 5, MutualEventsCount: 3,
			ShownAssetCount: 20, RelationshipDays: 100, ProfileViewsLast7d: 10,
		}, relation)
		if d.SideSpaceGap != "" {
			t.Errorf("[%s] non-collab should have empty sideSpaceGap, got %q", relation, d.SideSpaceGap)
		}
		if d.SideSpaceKind != "" {
			t.Errorf("[%s] non-collab should have empty sideSpaceKind, got %q", relation, d.SideSpaceKind)
		}
	}
}
