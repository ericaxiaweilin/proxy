package moderation

import (
	"context"
	"sync"
)

// MemoryRepository 是进程内实现，供单测与未接数据库的开发模式使用。
type MemoryRepository struct {
	mu   sync.Mutex
	rows []Report
	fail bool
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{} }

// SetFail 让写入恒定失败，用于验证「写不进去时不能静默吞掉」。
func (r *MemoryRepository) SetFail(fail bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fail = fail
}

func (r *MemoryRepository) AddReport(_ context.Context, report Report) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if report.TargetType == "" || report.TargetID == "" {
		return ErrReportTargetRequired
	}
	if report.Reason == "" {
		return ErrReportReasonRequired
	}
	r.rows = append(r.rows, report)
	return nil
}

// Reports 返回已受理的全部举报（测试用）。
func (r *MemoryRepository) Reports() []Report {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Report, len(r.rows))
	copy(out, r.rows)
	return out
}
