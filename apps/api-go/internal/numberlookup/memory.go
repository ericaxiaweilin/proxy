package numberlookup

import (
	"context"
	"sync"
)

// MemoryRecorder 是进程内的审计记录（无库的开发服务 / 单测）。生产用 Postgres 的
// operator.number_lookups（platform/postgres/number_lookups.go）。
type MemoryRecorder struct {
	mu      sync.Mutex
	entries []Entry
	// Fail 让下一次 Record 失败，测 fail-closed 用。
	Fail error
}

func NewMemoryRecorder() *MemoryRecorder { return &MemoryRecorder{} }

func (r *MemoryRecorder) Record(_ context.Context, entry Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Fail != nil {
		return r.Fail
	}
	r.entries = append(r.entries, entry)
	return nil
}

func (r *MemoryRecorder) Entries() []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Entry(nil), r.entries...)
}
