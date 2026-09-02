package facet

import (
	"context"
	"strings"
	"testing"
	"time"
)

// TestSideSpace_AddRemove —— 基本 add / list / remove 流程
func TestSideSpace_AddRemove(t *testing.T) {
	repo := NewMemorySideSpaceRepository()
	ctx := context.Background()

	// 加一条
	post, err := repo.Add(ctx, "spa", SideSpacePost{
		ID: "ss-store-env", Kind: "intro/services", Title: "门店环境",
	})
	if err != nil {
		t.Fatalf("add failed: %v", err)
	}
	if post.AddedAt == "" {
		t.Error("Add should set AddedAt")
	}
	if _, err := time.Parse(time.RFC3339, post.AddedAt); err != nil {
		t.Errorf("AddedAt not RFC3339: %q", post.AddedAt)
	}

	// 重复 add 同 object+post → ErrSideSpaceAlreadyAdded
	_, err = repo.Add(ctx, "spa", SideSpacePost{
		ID: "ss-store-env", Kind: "intro/services", Title: "门店环境",
	})
	if err != ErrSideSpaceAlreadyAdded {
		t.Errorf("expected ErrSideSpaceAlreadyAdded, got %v", err)
	}

	// list
	posts, err := repo.List(ctx, "spa")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(posts) != 1 {
		t.Errorf("expected 1 post, got %d", len(posts))
	}

	// remove
	if err := repo.Remove(ctx, "spa", "ss-store-env"); err != nil {
		t.Fatalf("remove failed: %v", err)
	}
	posts, _ = repo.List(ctx, "spa")
	if len(posts) != 0 {
		t.Errorf("expected 0 posts after remove, got %d", len(posts))
	}

	// remove 不存在的 → ErrSideSpaceNotFound
	if err := repo.Remove(ctx, "spa", "ss-nonexistent"); err != ErrSideSpaceNotFound {
		t.Errorf("expected ErrSideSpaceNotFound, got %v", err)
	}
}

// TestSideSpace_InvalidKind —— personal/* 不允许进副空间
func TestSideSpace_InvalidKind(t *testing.T) {
	repo := NewMemorySideSpaceRepository()
	ctx := context.Background()
	for _, kind := range []string{"personal/real-life", "personal/honest", "BOGUS_KIND"} {
		_, err := repo.Add(ctx, "spa", SideSpacePost{
			ID: "ss-x", Kind: kind, Title: "x",
		})
		if err != ErrSideSpaceInvalidKind {
			t.Errorf("kind %q should be rejected, got err=%v", kind, err)
		}
	}
}

// TestSideSpace_AllowedKinds —— 白名单里的 4 种必须能加
func TestSideSpace_AllowedKinds(t *testing.T) {
	repo := NewMemorySideSpaceRepository()
	ctx := context.Background()
	allowed := []string{"portfolio/capability", "intro/services", "photo", "city/travel"}
	for i, kind := range allowed {
		_, err := repo.Add(ctx, "spa", SideSpacePost{
			ID: "ss-" + kind, Kind: kind, Title: "x",
		})
		if err != nil {
			t.Errorf("kind %q (idx %d) should be allowed, got err=%v", kind, i, err)
		}
	}
	posts, _ := repo.List(ctx, "spa")
	if len(posts) != len(allowed) {
		t.Errorf("expected %d posts, got %d", len(allowed), len(posts))
	}
}

// TestSideSpace_PerObjectIsolation —— object 之间不互相干扰
func TestSideSpace_PerObjectIsolation(t *testing.T) {
	repo := NewMemorySideSpaceRepository()
	ctx := context.Background()
	_, _ = repo.Add(ctx, "spa", SideSpacePost{ID: "ss-a", Kind: "photo", Title: "a"})
	_, _ = repo.Add(ctx, "linh", SideSpacePost{ID: "ss-a", Kind: "photo", Title: "a"})

	spaPosts, _ := repo.List(ctx, "spa")
	linhPosts, _ := repo.List(ctx, "linh")
	if len(spaPosts) != 1 {
		t.Errorf("spa should have 1, got %d", len(spaPosts))
	}
	if len(linhPosts) != 1 {
		t.Errorf("linh should have 1, got %d", len(linhPosts))
	}
}

// TestSideSpace_ListSortedByAddedAtDesc —— List 必须按 AddedAt 倒序
func TestSideSpace_ListSortedByAddedAtDesc(t *testing.T) {
	repo := NewMemorySideSpaceRepository()
	ctx := context.Background()
	_, _ = repo.Add(ctx, "spa", SideSpacePost{ID: "ss-old", Kind: "photo", Title: "old", AddedAt: "2026-01-01T00:00:00Z"})
	_, _ = repo.Add(ctx, "spa", SideSpacePost{ID: "ss-new", Kind: "photo", Title: "new", AddedAt: "2026-09-01T00:00:00Z"})
	_, _ = repo.Add(ctx, "spa", SideSpacePost{ID: "ss-mid", Kind: "photo", Title: "mid", AddedAt: "2026-05-01T00:00:00Z"})

	posts, _ := repo.List(ctx, "spa")
	if len(posts) != 3 {
		t.Fatalf("expected 3, got %d", len(posts))
	}
	if posts[0].ID != "ss-new" || posts[1].ID != "ss-mid" || posts[2].ID != "ss-old" {
		t.Errorf("wrong order: %+v", []string{posts[0].ID, posts[1].ID, posts[2].ID})
	}
}

// TestSideSpace_CatalogHas5 —— DefaultSideSpaceCatalog 必须返回 5 个 post
func TestSideSpace_CatalogHas5(t *testing.T) {
	cat := DefaultSideSpaceCatalog()
	if len(cat) != 5 {
		t.Errorf("expected 5 catalog posts, got %d", len(cat))
	}
	// 至少 1 个 portfolio/capability
	found := false
	for _, p := range cat {
		if p.Kind == "portfolio/capability" {
			found = true
			break
		}
	}
	if !found {
		t.Error("catalog should have at least 1 portfolio/capability")
	}
	// 全部 kind 在白名单
	for _, p := range cat {
		if !isAllowedSideSpaceKind(p.Kind) {
			t.Errorf("catalog post %q has invalid kind %q", p.ID, p.Kind)
		}
	}
}

// TestSideSpace_CatalogByID —— 查存在 + 不存在
func TestSideSpace_CatalogByID(t *testing.T) {
	cat := DefaultSideSpaceCatalog()
	p, ok := SideSpaceCatalogByID(cat, "ss-store-env")
	if !ok {
		t.Fatal("ss-store-env should exist")
	}
	if !strings.Contains(p.Title, "门店") {
		t.Errorf("title should mention 门店, got %q", p.Title)
	}
	if _, ok := SideSpaceCatalogByID(cat, "ss-nonexistent"); ok {
		t.Error("nonexistent should return ok=false")
	}
}

// TestService_AddSideSpacePost —— Service 层 add（带 object 校验）
func TestService_AddSideSpacePost(t *testing.T) {
	svc := New()
	ctx := context.Background()

	// Spa (CREATOR_COLLAB) → OK（用 catalog 里没被 seed 的 ss-capability-compare）
	post, err := svc.AddSideSpacePost(ctx, "spa", "ss-capability-compare")
	if err != nil {
		t.Errorf("spa add should succeed, got err=%v", err)
	}
	if post.Kind != "portfolio/capability" {
		t.Errorf("wrong kind: %q", post.Kind)
	}

	// Ken (BUILDING_TRUST) → 拒绝
	_, err = svc.AddSideSpacePost(ctx, "ken", "ss-store-env")
	if err == nil {
		t.Error("ken (not collab) add should fail")
	}
	if !strings.Contains(err.Error(), "not CREATOR_COLLAB") {
		t.Errorf("err should mention not CREATOR_COLLAB, got %q", err.Error())
	}

	// 不存在的对象
	_, err = svc.AddSideSpacePost(ctx, "unknown", "ss-store-env")
	if err == nil {
		t.Error("unknown object should fail")
	}

	// catalog 里没有的 post
	_, err = svc.AddSideSpacePost(ctx, "spa", "ss-nonexistent")
	if err == nil {
		t.Error("nonexistent post should fail")
	}
	if !strings.Contains(err.Error(), "not in catalog") {
		t.Errorf("err should mention catalog, got %q", err.Error())
	}
}

// TestService_SeedDefaults_HasSpaSideSpace —— R15.43 Spa 必须 seed 3 条
func TestService_SeedDefaults_HasSpaSideSpace(t *testing.T) {
	svc := New()
	ctx := context.Background()
	posts, err := svc.ListSideSpacePosts(ctx, "spa")
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(posts) != 3 {
		t.Errorf("spa should have 3 default posts, got %d", len(posts))
	}
	// Linh (SHARED_INTEREST) 副空间必须为空
	linhPosts, _ := svc.ListSideSpacePosts(ctx, "linh")
	if len(linhPosts) != 0 {
		t.Errorf("linh side space should be empty, got %d", len(linhPosts))
	}
}

// TestService_ListEmbedsSideSpacePosts —— R15.43 wire format
func TestService_ListEmbedsSideSpacePosts(t *testing.T) {
	svc := New()
	ctx := context.Background()
	payload, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	var spa *Object
	for i, o := range payload.Objects {
		if o.ID == "spa" {
			spa = &payload.Objects[i]
		}
		if o.ID == "linh" || o.ID == "ken" {
			// 非合作方副空间必须为 []，不能是 nil（避免 JSON null）
			if o.SideSpacePosts == nil {
				t.Errorf("[%s] SideSpacePosts should be [] not nil", o.ID)
			}
			if len(o.SideSpacePosts) != 0 {
				t.Errorf("[%s] SideSpacePosts should be empty, got %d", o.ID, len(o.SideSpacePosts))
			}
		}
	}
	if spa == nil {
		t.Fatal("spa not found")
	}
	if len(spa.SideSpacePosts) != 3 {
		t.Errorf("spa wire should have 3 side space posts, got %d", len(spa.SideSpacePosts))
	}
}
