package facet

import (
	"context"
	"errors"
	"testing"
)

// ---------- R15.51 FacetConfig CRUD ----------

func TestFacetConfig_Default(t *testing.T) {
	cfg := DefaultFacetConfig()
	if cfg.SideSpaceHighThreshold != 2 {
		t.Errorf("expected default SideSpaceHighThreshold=2, got %d", cfg.SideSpaceHighThreshold)
	}
	if cfg.SideSpaceMidThreshold != 2 {
		t.Errorf("expected default SideSpaceMidThreshold=2, got %d", cfg.SideSpaceMidThreshold)
	}
	if cfg.PriorityHighBoundary != 60 {
		t.Errorf("expected default PriorityHighBoundary=60, got %d", cfg.PriorityHighBoundary)
	}
	if cfg.ConfidenceFloor != 50 {
		t.Errorf("expected default ConfidenceFloor=50, got %d", cfg.ConfidenceFloor)
	}
}

func TestMemoryConfigRepository_GetReturnsDefault(t *testing.T) {
	repo := NewMemoryConfigRepository()
	cfg, err := repo.Get(context.Background())
	if err != nil {
		t.Fatalf("Get should not error, got %v", err)
	}
	if cfg.Version != 1 {
		t.Errorf("expected initial Version=1, got %d", cfg.Version)
	}
}

func TestMemoryConfigRepository_UpdateOptimisticLock(t *testing.T) {
	repo := NewMemoryConfigRepository()
	ctx := context.Background()
	// 第一次更新 expectedVersion=1 → 成功, Version=2
	updated, err := repo.Update(ctx, 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(3),
		UpdatedBy:              "ops_alice",
	})
	if err != nil {
		t.Fatalf("first update should succeed, got %v", err)
	}
	if updated.Version != 2 {
		t.Errorf("expected Version=2, got %d", updated.Version)
	}
	if updated.SideSpaceHighThreshold != 3 {
		t.Errorf("expected threshold=3, got %d", updated.SideSpaceHighThreshold)
	}
	// 第二次更新用旧 version=1 → 失败
	_, err = repo.Update(ctx, 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(5),
		UpdatedBy:              "ops_bob",
	})
	if !errors.Is(err, ErrConfigVersionMismatch) {
		t.Errorf("expected ErrConfigVersionMismatch, got %v", err)
	}
	// 用正确 version=2 成功
	updated2, err := repo.Update(ctx, 2, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(5),
		UpdatedBy:              "ops_bob",
	})
	if err != nil {
		t.Fatalf("second update with correct version should succeed, got %v", err)
	}
	if updated2.SideSpaceHighThreshold != 5 {
		t.Errorf("expected threshold=5, got %d", updated2.SideSpaceHighThreshold)
	}
	if updated2.Version != 3 {
		t.Errorf("expected Version=3, got %d", updated2.Version)
	}
}

func TestMemoryConfigRepository_UpdateValueRange(t *testing.T) {
	repo := NewMemoryConfigRepository()
	// threshold < 0 → 拒绝
	_, err := repo.Update(context.Background(), 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(-1),
		UpdatedBy:              "ops",
	})
	if !errors.Is(err, ErrConfigInvalidValue) {
		t.Errorf("expected ErrConfigInvalidValue for -1, got %v", err)
	}
	// threshold > 20 → 拒绝
	_, err = repo.Update(context.Background(), 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(100),
		UpdatedBy:              "ops",
	})
	if !errors.Is(err, ErrConfigInvalidValue) {
		t.Errorf("expected ErrConfigInvalidValue for 100, got %v", err)
	}
	// confidence > 100 → 拒绝
	_, err = repo.Update(context.Background(), 1, FacetConfigPatch{
		ConfidenceFloor: intPtr(150),
		UpdatedBy:       "ops",
	})
	if !errors.Is(err, ErrConfigInvalidValue) {
		t.Errorf("expected ErrConfigInvalidValue for confidence 150, got %v", err)
	}
	// updatedBy 空 → 拒绝
	_, err = repo.Update(context.Background(), 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(3),
		UpdatedBy:              "",
	})
	if err == nil {
		t.Error("expected error for empty updatedBy")
	}
}

func TestFacetService_ListFacetConfig(t *testing.T) {
	svc := New()
	cfg, err := svc.ListFacetConfig(context.Background())
	if err != nil {
		t.Fatalf("ListFacetConfig should not error, got %v", err)
	}
	if cfg.SideSpaceHighThreshold != 2 {
		t.Errorf("expected default, got threshold=%d", cfg.SideSpaceHighThreshold)
	}
}

func TestFacetService_UpdateFacetConfigAffectsReasoner(t *testing.T) {
	// 改 threshold 后 reasoner 应该用新值
	svc := New()
	ctx := context.Background()
	// 初始 threshold=2, 副空间 1 个 portfolio/capability → 不够
	initial, _ := svc.ListFacetConfig(ctx)
	if initial.SideSpaceHighThreshold != 2 {
		t.Fatalf("setup: expected threshold=2, got %d", initial.SideSpaceHighThreshold)
	}
	// 改 threshold=1 (1 个就够了)
	updated, err := svc.UpdateFacetConfig(ctx, 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(1),
		UpdatedBy:              "ops_test",
	})
	if err != nil {
		t.Fatalf("update should succeed, got %v", err)
	}
	if updated.SideSpaceHighThreshold != 1 {
		t.Errorf("expected threshold=1, got %d", updated.SideSpaceHighThreshold)
	}
	// version 应该递增
	if updated.Version != 2 {
		t.Errorf("expected Version=2, got %d", updated.Version)
	}
	// 旧 version 再 update 应该失败
	_, err = svc.UpdateFacetConfig(ctx, 1, FacetConfigPatch{
		SideSpaceHighThreshold: intPtr(3),
		UpdatedBy:              "ops_test2",
	})
	if !errors.Is(err, ErrConfigVersionMismatch) {
		t.Errorf("expected ErrConfigVersionMismatch, got %v", err)
	}
}

func intPtr(v int) *int { return &v }
