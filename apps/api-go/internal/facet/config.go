package facet

import (
	"context"
	"sync"
)

// R15.51 — FacetConfig (运营可调)
//
// 设计: FacetConfig 是运营 (R15.51 OPS 页面) 实时调整的 reasoner 阈值。
// RuleReasoner.Reason 之前 hardcode:
//   - sideSpaceGapForKind("portfolio/capability", 2)  // 高意向
//   - sideSpaceGapForKind("intro/services", 2)         // 中意向
//   - 缺口判定 priority=0.5/0.7/0.9
//
// R15.51 把这些常量提到 FacetConfig, 通过 UpdateFacetConfig 命令改;
// Reasoner.Reason 接收 config, 单测 + LLM 替换都更容易。
//
// Phase 1 内存实现 (MemoryConfigRepository) — 没 PG 表 (config 通常 1 行,
// 暂没 seed 价值); Phase 2 接入 PG 或独立 config service (e.g. 跟
// operator-engine.go 同模块).
//
// 不可变字段: Version (每次 Update 递增). 乐观锁: 客户端传 expectedVersion,
// 不匹配则 UpdateFacetConfig REJECTED (跟 R15.44 sideSpace 幂等思路相反
// — config 是要冲突检测, sideSpace 是要幂等).
type FacetConfig struct {
	// SideSpaceHighThreshold: 高意向 (priority >= 60) 的副空间 portfolio/capability 满足阈值.
	// 默认 2 — "够 2 个就算足够".
	SideSpaceHighThreshold int `json:"sideSpaceHighThreshold"`
	// SideSpaceMidThreshold: 中意向 (priority 30-59) 的副空间 intro/services 满足阈值.
	// 默认 2.
	SideSpaceMidThreshold int `json:"sideSpaceMidThreshold"`
	// PriorityLow/Mid/High 边界 — reasoner 用来切档 (intensity 0/30/60).
	// 默认 30, 60 (跟 R15.42 intent 拆分一致).
	PriorityMidBoundary int `json:"priorityMidBoundary"`
	PriorityHighBoundary int `json:"priorityHighBoundary"`
	// ConfidenceFloor: 低于此 confidence 的 ReasonedDecision 不展示 recommendedKind.
	// 默认 50 — 太不确定的推荐宁可不显示, 避免推荐错误.
	ConfidenceFloor int `json:"confidenceFloor"`
	// UpdatedAt / UpdatedBy / Version: 审计 + 乐观锁.
	UpdatedAt string `json:"updatedAt"`
	UpdatedBy string `json:"updatedBy"`
	Version   int    `json:"version"`
}

// DefaultFacetConfig — 跟 R15.41-R15.44 hardcode 阈值一致 (向后兼容).
// 老 reasoner 测试不需要改; 新增路径 (ListFacetConfig) 返这个值.
func DefaultFacetConfig() FacetConfig {
	return FacetConfig{
		SideSpaceHighThreshold: 2,
		SideSpaceMidThreshold:  2,
		PriorityMidBoundary:    30,
		PriorityHighBoundary:   60,
		ConfidenceFloor:        50,
		Version:                1,
	}
}

// ConfigRepository — FacetConfig 持久化抽象.
type ConfigRepository interface {
	// Get 返当前 config; 不存在时返 DefaultFacetConfig (nil error).
	Get(ctx context.Context) (FacetConfig, error)
	// Update 乐观锁: expectedVersion 不匹配 → ErrConfigVersionMismatch.
	// 成功 → 新 config (Version+1).
	Update(ctx context.Context, expectedVersion int, patch FacetConfigPatch) (FacetConfig, error)
}

// FacetConfigPatch — 客户端传的 patch (只更非零字段).
type FacetConfigPatch struct {
	SideSpaceHighThreshold *int `json:"sideSpaceHighThreshold,omitempty"`
	SideSpaceMidThreshold  *int `json:"sideSpaceMidThreshold,omitempty"`
	PriorityMidBoundary    *int `json:"priorityMidBoundary,omitempty"`
	PriorityHighBoundary   *int `json:"priorityHighBoundary,omitempty"`
	ConfidenceFloor        *int `json:"confidenceFloor,omitempty"`
	UpdatedBy              string `json:"updatedBy"`
}

// ConfigError — 乐观锁 / 校验失败.
type ConfigError struct {
	Code    string
	Message string
}

func (e *ConfigError) Error() string { return e.Message }

// ErrConfigVersionMismatch — 客户端 expectedVersion 跟 server 当前 version 不一致.
var ErrConfigVersionMismatch = &ConfigError{Code: "CONFIG_VERSION_MISMATCH", Message: "facet config version mismatch (concurrent update?)"}

// ErrConfigInvalidValue — 字段值越界 (<0, >100 等).
var ErrConfigInvalidValue = &ConfigError{Code: "CONFIG_INVALID_VALUE", Message: "facet config value out of range"}

// MemoryConfigRepository — InMemory 实现, 进程内单例.
type MemoryConfigRepository struct {
	mu     sync.Mutex
	config FacetConfig
}

func NewMemoryConfigRepository() *MemoryConfigRepository {
	return &MemoryConfigRepository{config: DefaultFacetConfig()}
}

func NewMemoryConfigRepositoryWithSeed(seed FacetConfig) *MemoryConfigRepository {
	return &MemoryConfigRepository{config: seed}
}

func (r *MemoryConfigRepository) Get(_ context.Context) (FacetConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.config, nil
}

func (r *MemoryConfigRepository) Update(_ context.Context, expectedVersion int, patch FacetConfigPatch) (FacetConfig, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if expectedVersion != r.config.Version {
		return FacetConfig{}, ErrConfigVersionMismatch
	}
	updated := r.config
	if patch.SideSpaceHighThreshold != nil {
		v := *patch.SideSpaceHighThreshold
		if v < 0 || v > 20 {
			return FacetConfig{}, ErrConfigInvalidValue
		}
		updated.SideSpaceHighThreshold = v
	}
	if patch.SideSpaceMidThreshold != nil {
		v := *patch.SideSpaceMidThreshold
		if v < 0 || v > 20 {
			return FacetConfig{}, ErrConfigInvalidValue
		}
		updated.SideSpaceMidThreshold = v
	}
	if patch.PriorityMidBoundary != nil {
		v := *patch.PriorityMidBoundary
		if v < 0 || v > 100 {
			return FacetConfig{}, ErrConfigInvalidValue
		}
		updated.PriorityMidBoundary = v
	}
	if patch.PriorityHighBoundary != nil {
		v := *patch.PriorityHighBoundary
		if v < 0 || v > 100 {
			return FacetConfig{}, ErrConfigInvalidValue
		}
		updated.PriorityHighBoundary = v
	}
	if patch.ConfidenceFloor != nil {
		v := *patch.ConfidenceFloor
		if v < 0 || v > 100 {
			return FacetConfig{}, ErrConfigInvalidValue
		}
		updated.ConfidenceFloor = v
	}
	if patch.UpdatedBy == "" {
		return FacetConfig{}, &ConfigError{Code: "CONFIG_INVALID_VALUE", Message: "updatedBy is required"}
	}
	updated.UpdatedBy = patch.UpdatedBy
	updated.Version = r.config.Version + 1
	// UpdatedAt 由 caller (Service) 注入, 保持 repo pure
	r.config = updated
	return updated, nil
}
