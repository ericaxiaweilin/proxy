package twininsight

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MemoryRepository 是进程内实现（测试与无库环境用）。
//
// 它存在的意义跟 localnet.MemoryRepository 一样：Repository 是**必需**接口，
// 两个实现都得接上，否则"有 UI 没后端"的静默降级又会回来。这里的实现不
// 生成任何数据 —— 你塞进去什么就读出什么，空就是空。
type MemoryRepository struct {
	mu    sync.Mutex
	facts map[string]Facts // ownerID -> facts
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{facts: map[string]Facts{}}
}

// Seed 写入某个 owner 的原料（测试夹具用）。
func (r *MemoryRepository) Seed(ownerID string, facts Facts) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.facts[ownerID] = facts
}

func (r *MemoryRepository) ListFacts(_ context.Context, ownerID string, since time.Time) (Facts, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	stored, ok := r.facts[ownerID]
	if !ok {
		return Facts{Signals: []SignalFact{}, Events: []RecentEvent{}}, nil
	}
	// 窗口过滤放在这里，跟 postgres 实现的 `created_at >= $2` 语义一致 ——
	// 否则两个实现在同一个测试里会给出不同的数字。
	out := Facts{Signals: []SignalFact{}, Events: []RecentEvent{}}
	for _, fact := range stored.Signals {
		if fact.LastSignalAt.IsZero() || !fact.LastSignalAt.Before(since) {
			out.Signals = append(out.Signals, fact)
		}
	}
	for _, event := range stored.Events {
		if !event.At.Before(since) {
			out.Events = append(out.Events, event)
		}
	}
	sort.SliceStable(out.Events, func(i, j int) bool { return out.Events[i].At.After(out.Events[j].At) })
	return out, nil
}

// MemoryFriendSource 是 FriendSource 的进程内实现。
type MemoryFriendSource struct {
	mu      sync.Mutex
	byOwner map[string][]Friend
}

func NewMemoryFriendSource() *MemoryFriendSource {
	return &MemoryFriendSource{byOwner: map[string][]Friend{}}
}

func (s *MemoryFriendSource) Set(ownerID string, friends []Friend) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byOwner[ownerID] = friends
}

func (s *MemoryFriendSource) ListActiveFriends(_ context.Context, userID string) ([]Friend, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	friends := s.byOwner[userID]
	if friends == nil {
		return []Friend{}, nil
	}
	return friends, nil
}

// MemoryActionLog 是 ActionLog 的进程内实现（测试与无库环境用）。
// 只追加 —— 跟生产表上的触发器同语义，测试里也改不掉历史行。
type MemoryActionLog struct {
	mu      sync.Mutex
	actions []RecordedAction
}

func NewMemoryActionLog() *MemoryActionLog { return &MemoryActionLog{} }

func (l *MemoryActionLog) RecordAction(_ context.Context, action RecordedAction) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.actions = append(l.actions, action)
	return nil
}

func (l *MemoryActionLog) All() []RecordedAction {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]RecordedAction, len(l.actions))
	copy(out, l.actions)
	return out
}
