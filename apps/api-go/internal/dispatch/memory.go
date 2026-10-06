package dispatch

import (
	"context"
	"sort"
	"sync"
)

// Memory 是无库模式与单元测试用的存储。
type Memory struct {
	mu    sync.Mutex
	runs  map[string]Run
	steps map[string][]Step
}

func NewMemory() *Memory { return &Memory{runs: map[string]Run{}, steps: map[string][]Step{}} }

func (m *Memory) Create(_ context.Context, runs []Run, steps []Step) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	inserted := map[string]bool{}
	for _, r := range runs {
		exists := false
		for _, o := range m.runs {
			if o.TaskID == r.TaskID && o.SlotID == r.SlotID {
				exists = true
				break
			}
		}
		if !exists {
			m.runs[r.ID] = r
		}
		inserted[r.ID] = !exists
	}
	for _, s := range keepSteps(steps, inserted) {
		m.steps[s.RunID] = append(m.steps[s.RunID], s)
	}
	return nil
}

// keepSteps 只留属于真正新建的那些 run 的流水（两种存储同一个口径：(task, slot) 唯一）。
func keepSteps(steps []Step, inserted map[string]bool) []Step {
	out := make([]Step, 0, len(steps))
	for _, s := range steps {
		if inserted[s.RunID] {
			out = append(out, s)
		}
	}
	return out
}

func (m *Memory) ProcessDue(_ context.Context, limit int, fn func(Run) (Run, []Step, error)) (int, error) {
	m.mu.Lock()
	ids := []string{}
	for id, r := range m.runs {
		if r.Status == StatusRunning {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	m.mu.Unlock()
	n := 0
	for _, id := range ids {
		if n >= limit {
			break
		}
		m.mu.Lock()
		r := m.runs[id]
		m.mu.Unlock()
		next, steps, err := fn(r)
		if err != nil {
			return n, err
		}
		m.mu.Lock()
		m.runs[id] = next
		m.steps[id] = append(m.steps[id], steps...)
		m.mu.Unlock()
		n++
	}
	return n, nil
}

func (m *Memory) Get(_ context.Context, id string) (Run, []Step, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok {
		return Run{}, nil, ErrNotFound
	}
	return r, append([]Step(nil), m.steps[id]...), nil
}

func (m *Memory) List(_ context.Context, statuses []string, limit int) ([]Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	want := map[string]bool{}
	for _, s := range statuses {
		want[s] = true
	}
	out := []Run{}
	for _, r := range m.runs {
		if len(want) == 0 || want[r.Status] {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) TaskRuns(_ context.Context, taskID string) ([]Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Run{}
	for _, r := range m.runs {
		if r.TaskID == taskID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *Memory) Save(_ context.Context, run Run, expectedVersion int, steps []Step) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.runs[run.ID]
	if !ok {
		return ErrNotFound
	}
	if cur.Version != expectedVersion {
		return ErrVersionConflict
	}
	m.runs[run.ID] = run
	m.steps[run.ID] = append(m.steps[run.ID], steps...)
	return nil
}
