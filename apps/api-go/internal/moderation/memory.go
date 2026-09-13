package moderation

import (
	"context"
	"errors"
	"sync"
)

// MemoryRepository 是进程内实现，供单测与未接数据库的开发模式使用。
type MemoryRepository struct {
	mu           sync.Mutex
	rows         []Report
	dispositions []Disposition
	fail         bool
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

func (r *MemoryRepository) AddDisposition(_ context.Context, disposition Disposition) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return ErrReportRepositoryDown
	}
	if disposition.ReportID == "" || disposition.Action == "" {
		return ErrDispositionActionRequired
	}
	if disposition.ActorID == "" {
		return ErrDispositionActorRequired
	}
	r.dispositions = append(r.dispositions, disposition)
	return nil
}

func (r *MemoryRepository) FindReport(_ context.Context, reportID string) (Report, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range r.rows {
		if row.ID == reportID {
			return row, true
		}
	}
	return Report{}, false
}

// Reports 返回已受理的全部举报（测试用）。
func (r *MemoryRepository) Reports() []Report {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Report, len(r.rows))
	copy(out, r.rows)
	return out
}

// Dispositions 返回已记录的处置（测试用），按写入顺序。
func (r *MemoryRepository) Dispositions() []Disposition {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Disposition, len(r.dispositions))
	copy(out, r.dispositions)
	return out
}

// 仓储层兜底错误。Service 已经在命令层校验过一遍，这里是防止有人绕过
// Service 直接调仓储写进一条说不清是谁处置了什么的记录。
var (
	ErrDispositionActionRequired = errors.New("moderation disposition requires an action and report id")
	ErrDispositionActorRequired  = errors.New("moderation disposition requires an actor")
)
