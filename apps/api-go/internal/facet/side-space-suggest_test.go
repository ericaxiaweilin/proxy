package facet

import (
	"strings"
	"testing"
)

// ---------- R15.52 SideSpaceSuggestions ----------

func TestSuggestSideSpacePosts_HappyPath(t *testing.T) {
	obj := Object{
		ID:                 "spa",
		Relation:           "CREATOR_COLLAB",
		SideSpaceKind:      "portfolio/capability",
		SideSpaceFulfilled: false,
		SideSpaceGap:       "副空间还没有, 加第一个 portfolio/capability 类型的作品",
	}
	sideSpace := []SideSpacePost{} // 一个没加
	catalog := []SideSpaceCatalogPost{
		{ID: "ss-capability-compare", Kind: "portfolio/capability", Title: "能力对比", ImageURL: ""},
		{ID: "ss-collab-1", Kind: "portfolio/capability", Title: "合作案例", ImageURL: ""},
		{ID: "ss-store-env", Kind: "intro/services", Title: "门店环境", ImageURL: ""}, // 不同 kind, 应被过滤
	}
	got := SuggestSideSpacePosts(obj, sideSpace, catalog, 3)
	if got.ObjectID != "spa" {
		t.Errorf("expected ObjectID=spa, got %q", got.ObjectID)
	}
	if got.SideSpaceKind != "portfolio/capability" {
		t.Errorf("expected SideSpaceKind=portfolio/capability, got %q", got.SideSpaceKind)
	}
	if len(got.Posts) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(got.Posts))
	}
	// 验证 kind 过滤
	for _, s := range got.Posts {
		if s.Post.Kind != "portfolio/capability" {
			t.Errorf("expected kind=portfolio/capability, got %q", s.Post.Kind)
		}
	}
	// Rank 1-2
	if got.Posts[0].Rank != 1 || got.Posts[1].Rank != 2 {
		t.Errorf("expected Rank 1,2, got %d,%d", got.Posts[0].Rank, got.Posts[1].Rank)
	}
}

func TestSuggestSideSpacePosts_ExcludesAlreadyAdded(t *testing.T) {
	obj := Object{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "portfolio/capability", SideSpaceFulfilled: false}
	sideSpace := []SideSpacePost{{ID: "ss-capability-compare"}} // 已加
	catalog := []SideSpaceCatalogPost{
		{ID: "ss-capability-compare", Kind: "portfolio/capability", Title: "A", ImageURL: ""},
		{ID: "ss-collab-1", Kind: "portfolio/capability", Title: "B", ImageURL: ""},
	}
	got := SuggestSideSpacePosts(obj, sideSpace, catalog, 3)
	if len(got.Posts) != 1 {
		t.Fatalf("expected 1 (excluding added), got %d", len(got.Posts))
	}
	if got.Posts[0].Post.ID != "ss-collab-1" {
		t.Errorf("expected ss-collab-1, got %q", got.Posts[0].Post.ID)
	}
}

func TestSuggestSideSpacePosts_EmptyWhenFulfilled(t *testing.T) {
	obj := Object{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "portfolio/capability", SideSpaceFulfilled: true}
	catalog := []SideSpaceCatalogPost{{ID: "x", Kind: "portfolio/capability", Title: "X", ImageURL: ""}}
	got := SuggestSideSpacePosts(obj, nil, catalog, 3)
	if len(got.Posts) != 0 {
		t.Errorf("expected empty when fulfilled, got %d", len(got.Posts))
	}
}

func TestSuggestSideSpacePosts_EmptyWhenNotCreatorCollab(t *testing.T) {
	obj := Object{ID: "alice", Relation: "BUILDING_TRUST", SideSpaceKind: "portfolio/capability", SideSpaceFulfilled: false}
	catalog := []SideSpaceCatalogPost{{ID: "x", Kind: "portfolio/capability", Title: "X", ImageURL: ""}}
	got := SuggestSideSpacePosts(obj, nil, catalog, 3)
	if len(got.Posts) != 0 {
		t.Errorf("expected empty for non-CREATOR_COLLAB, got %d", len(got.Posts))
	}
}

func TestSuggestSideSpacePosts_EmptyWhenNoKind(t *testing.T) {
	obj := Object{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "", SideSpaceFulfilled: false}
	catalog := []SideSpaceCatalogPost{{ID: "x", Kind: "portfolio/capability", Title: "X", ImageURL: ""}}
	got := SuggestSideSpacePosts(obj, nil, catalog, 3)
	if len(got.Posts) != 0 {
		t.Errorf("expected empty when SideSpaceKind='', got %d", len(got.Posts))
	}
}

func TestSuggestSideSpacePosts_RespectsLimit(t *testing.T) {
	obj := Object{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "portfolio/capability", SideSpaceFulfilled: false}
	catalog := []SideSpaceCatalogPost{
		{ID: "a", Kind: "portfolio/capability", Title: "AAAA", ImageURL: ""},
		{ID: "b", Kind: "portfolio/capability", Title: "BBBB", ImageURL: ""},
		{ID: "c", Kind: "portfolio/capability", Title: "CCCC", ImageURL: ""},
		{ID: "d", Kind: "portfolio/capability", Title: "DDDD", ImageURL: ""},
	}
	got := SuggestSideSpacePosts(obj, nil, catalog, 2)
	if len(got.Posts) != 2 {
		t.Errorf("expected 2 (limit), got %d", len(got.Posts))
	}
}

func TestSuggestForAllObjects_MultipleObjects(t *testing.T) {
	objects := []Object{
		{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "portfolio/capability", SideSpaceFulfilled: false},
		{ID: "alice", Relation: "BUILDING_TRUST"}, // 非合作方
		{ID: "bob", Relation: "CREATOR_COLLAB", SideSpaceKind: "intro/services", SideSpaceFulfilled: false},
	}
	sideSpacesByObject := map[string][]SideSpacePost{
		"spa": nil,
		"bob": {{ID: "ss-store-env"}}, // 已加 ss-store-env
	}
	catalog := []SideSpaceCatalogPost{
		{ID: "ss-store-env", Kind: "intro/services", Title: "门店", ImageURL: ""},
		{ID: "ss-service-1", Kind: "intro/services", Title: "服务流程", ImageURL: ""},
		{ID: "ss-collab-1", Kind: "portfolio/capability", Title: "合作案例", ImageURL: ""},
	}
	got := SuggestForAllObjects(objects, sideSpacesByObject, catalog, 3)
	// spa 应有 1 个 (ss-collab-1)
	if len(got["spa"].Posts) != 1 {
		t.Errorf("spa: expected 1, got %d", len(got["spa"].Posts))
	}
	// alice 应是空
	if len(got["alice"].Posts) != 0 {
		t.Errorf("alice: expected 0, got %d", len(got["alice"].Posts))
	}
	// bob 应有 1 个 (ss-service-1, 排除已加的 ss-store-env)
	if len(got["bob"].Posts) != 1 {
		t.Errorf("bob: expected 1, got %d", len(got["bob"].Posts))
	}
	if got["bob"].Posts[0].Post.ID != "ss-service-1" {
		t.Errorf("bob: expected ss-service-1, got %q", got["bob"].Posts[0].Post.ID)
	}
}

func TestTruncateForReason(t *testing.T) {
	if truncateForReason("short", 10) != "short" {
		t.Error("short should be unchanged")
	}
	long := "副空间已经有 5 个, 还差 2 个 portfolio/capability 类型的作品"
	got := truncateForReason(long, 20)
	runeCount := len([]rune(got))
	if runeCount > 21 { // 20 + …
		t.Errorf("expected ≤21 runes, got %d (%q)", runeCount, got)
	}
}

func TestSuggestSideSpacePosts_ReasonContainsKind(t *testing.T) {
	obj := Object{ID: "spa", Relation: "CREATOR_COLLAB", SideSpaceKind: "intro/services", SideSpaceFulfilled: false, SideSpaceGap: "还差 2 个"}
	catalog := []SideSpaceCatalogPost{{ID: "x", Kind: "intro/services", Title: "服务", ImageURL: ""}}
	got := SuggestSideSpacePosts(obj, nil, catalog, 3)
	if len(got.Posts) != 1 {
		t.Fatalf("expected 1, got %d", len(got.Posts))
	}
	if !strings.Contains(got.Posts[0].Reason, "intro/services") {
		t.Errorf("reason should contain kind, got %q", got.Posts[0].Reason)
	}
}
