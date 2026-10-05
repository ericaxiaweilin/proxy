package supply

import (
	"context"
	"sort"

	"github.com/proxy-app/proxy-api/internal/event"
)

// CONTENT-TASK-001：内存仓的内容任务（懒初始化）。

func (r *MemoryRepository) SaveContentTask(_ context.Context, t ContentTask) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.contentTasks == nil {
		r.contentTasks = map[string]ContentTask{}
	}
	r.contentTasks[t.ID] = t
	return nil
}

func (r *MemoryRepository) UpdateContentTask(_ context.Context, t ContentTask) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.contentTasks[t.ID]; !ok {
		return ErrContentTaskNotFound
	}
	r.contentTasks[t.ID] = t
	return nil
}

func (r *MemoryRepository) GetContentTask(_ context.Context, id string) (ContentTask, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.contentTasks[id]
	if !ok {
		return ContentTask{}, ErrContentTaskNotFound
	}
	return t, nil
}

func (r *MemoryRepository) listContentTasks(match func(ContentTask) bool) []ContentTask {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []ContentTask{}
	for _, t := range r.contentTasks {
		if match(t) {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (r *MemoryRepository) ListContentTasksByMerchant(_ context.Context, merchantID string) ([]ContentTask, error) {
	return r.listContentTasks(func(t ContentTask) bool { return t.MerchantID == merchantID }), nil
}

func (r *MemoryRepository) ListContentTasksByAgent(_ context.Context, agentID string) ([]ContentTask, error) {
	return r.listContentTasks(func(t ContentTask) bool { return t.AgentID == agentID }), nil
}

// UpdateContentTaskAndPublish：和 Postgres 版同一语义（状态 + 事件一起落），测试里能读到事件。
func (r *MemoryRepository) UpdateContentTaskAndPublish(ctx context.Context, t ContentTask, domainEvents []event.DomainEvent) error {
	if err := r.UpdateContentTask(ctx, t); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, domainEvents...)
	return nil
}
