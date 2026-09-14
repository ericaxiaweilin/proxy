package storeonboarding

import (
	"context"
	"strings"
	"sync"
)

// MemoryRepository 是进程内实现，供单测与未接数据库的开发模式使用。
type MemoryRepository struct {
	mu             sync.Mutex
	recommendations []StoreRecommendation
	fail           bool
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{} }

// SetFail 让写入恒定失败，用于验证「写不进去时不能静默吞掉」。
func (r *MemoryRepository) SetFail(fail bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fail = fail
}

func (r *MemoryRepository) AddRecommendation(_ context.Context, rec StoreRecommendation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrRecommendationRepositoryDown
	}
	if strings.TrimSpace(rec.StoreName) == "" {
		return ErrRecommendationStoreRequired
	}
	if strings.TrimSpace(rec.City) == "" {
		return ErrRecommendationCityRequired
	}
	if strings.TrimSpace(rec.Reason) == "" {
		return ErrRecommendationReasonRequired
	}
	r.recommendations = append(r.recommendations, rec)
	return nil
}

// Recommendations 返回已受理的全部推荐（测试用），按写入顺序。
func (r *MemoryRepository) Recommendations() []StoreRecommendation {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]StoreRecommendation, len(r.recommendations))
	copy(out, r.recommendations)
	return out
}
