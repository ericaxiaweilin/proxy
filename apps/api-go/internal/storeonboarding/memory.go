package storeonboarding

import (
	"context"
	"sort"
	"strings"
	"sync"
)

// MemoryRepository 是进程内实现，供单测与未接数据库的开发模式使用。
type MemoryRepository struct {
	mu              sync.Mutex
	recommendations []StoreRecommendation
	dispositions    []Disposition
	fail            bool
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

// ListRecommendations 是运营队列的读路径（STORE-REC-002）：最新的在前，
// 支持城市 / origin 过滤。空结果返回空切片而不是 nil —— 调用方（命令层）
// 依赖这一点把 `[]` 而不是 `null` 发给客户端。
func (r *MemoryRepository) ListRecommendations(_ context.Context, filter RecommendationFilter) ([]StoreRecommendation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// 读写同用一个 fail 开关：仓储「不可用」时读也该失败，
	// 否则运维看到的是空队列，会误判成「没人推荐」而不是「读不出来」。
	if r.fail {
		return nil, ErrRecommendationRepositoryDown
	}
	matched := make([]StoreRecommendation, 0, len(r.recommendations))
	for _, rec := range r.recommendations {
		if filter.City != "" && rec.City != filter.City {
			continue
		}
		if filter.Origin != "" && rec.Origin != filter.Origin {
			continue
		}
		rec.attachLatestDisposition(r.dispositions)
		// Status：默认（待评估）只留还没出结论的，评估完一条它就得从默认队列里
		// 消失，否则队列越用越长，运营要在里面翻旧账。但采纳 / 不采纳必须能单独
		// 查出来 —— 否则采纳完这条推荐就凭空消失了，运营看不到自己批过什么。
		if !matchesStatus(filter.Status, rec.Decision) {
			continue
		}
		matched = append(matched, rec)
	}
	sort.SliceStable(matched, func(i, j int) bool {
		return matched[i].CreatedAt.After(matched[j].CreatedAt)
	})
	limit := filter.Limit
	if limit <= 0 {
		limit = ListLimitDefault
	}
	if limit > ListLimitMax {
		limit = ListLimitMax
	}
	if limit > len(matched) {
		limit = len(matched)
	}
	return matched[:limit], nil
}

// AddDisposition 追加一条评估结论（STORE-REC-004）。append-only：只增不改，
// 改主意由调用方再追加一条，读的时候取时间最新的一条。
func (r *MemoryRepository) AddDisposition(_ context.Context, d Disposition) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrRecommendationRepositoryDown
	}
	if strings.TrimSpace(d.RecommendationID) == "" {
		return ErrDispositionRecommendationRequired
	}
	if d.Decision != AcceptDecision && d.Decision != RejectDecision {
		return ErrDispositionDecisionInvalid
	}
	if strings.TrimSpace(d.DecidedBy) == "" {
		return ErrDispositionDeciderRequired
	}
	r.dispositions = append(r.dispositions, d)
	return nil
}

// Dispositions 返回全部结论（测试用），按写入顺序。
func (r *MemoryRepository) Dispositions() []Disposition {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Disposition, len(r.dispositions))
	copy(out, r.dispositions)
	return out
}

// attachLatestDisposition 把最新一条结论挂到推荐上（没有就保持空）。
// 「最新」按 CreatedAt 判定 —— 因为改主意是追加，不是修改。
func (rec *StoreRecommendation) attachLatestDisposition(all []Disposition) {
	var latest *Disposition
	for i := range all {
		d := &all[i]
		if d.RecommendationID != rec.ID {
			continue
		}
		if latest == nil || d.CreatedAt.After(latest.CreatedAt) {
			latest = d
		}
	}
	if latest == nil {
		return
	}
	decidedAt := latest.CreatedAt
	rec.Decision = latest.Decision
	rec.DecisionReason = latest.Reason
	rec.DecidedBy = latest.DecidedBy
	rec.DecidedAt = &decidedAt
}

// Recommendations 返回已受理的全部推荐（测试用），按写入顺序。
func (r *MemoryRepository) Recommendations() []StoreRecommendation {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]StoreRecommendation, len(r.recommendations))
	copy(out, r.recommendations)
	return out
}
