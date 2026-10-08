package tagging

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Window 是证据窗口。比最长的 TTL（28 天）一致，窗口外的事实不参与（也就不会续命标签）。
const Window = 28 * 24 * time.Hour

// Store 是标签层的存储。LoadEvidence 返回的证据必须已经过同意过滤——
// 本包的 Derive 不再判断同意，判定规则全平台只有 consent.ValidAtSQL 那一份。
type Store interface {
	LoadEvidence(ctx context.Context, since time.Time) (map[string]Evidence, error)
	// UsersWithTags：现有标签的人。重算要覆盖他们——同意撤回后他们不再有证据，
	// 只有走过一遍 Derive（得到空集）才会把旧标签清掉。
	UsersWithTags(ctx context.Context) ([]string, error)
	// ReplaceUserTags 在一个事务里换掉这个人的全部标签；空集 = 清空。
	ReplaceUserTags(ctx context.Context, userID string, tags []Tag) error
	TagsOf(ctx context.Context, userID string) ([]Tag, error)
}

// Recompute 重算所有人的标签，返回有标签的人数。失败只返回 error，由调用方记日志——派生数据，下一轮再来。
func Recompute(ctx context.Context, store Store, now time.Time) (int, error) {
	now = now.UTC()
	evidence, err := store.LoadEvidence(ctx, now.Add(-Window))
	if err != nil {
		return 0, err
	}
	existing, err := store.UsersWithTags(ctx)
	if err != nil {
		return 0, err
	}
	users := map[string]struct{}{}
	for id := range evidence {
		users[id] = struct{}{}
	}
	for _, id := range existing {
		users[id] = struct{}{}
	}
	ids := make([]string, 0, len(users))
	for id := range users {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	withTags := 0
	for _, id := range ids {
		ev := evidence[id] // 没有证据的人是零值：Derive 得到空集，旧标签被清掉
		ev.UserID = id
		tags := Derive(ev, now)
		if err := store.ReplaceUserTags(ctx, id, tags); err != nil {
			return withTags, err
		}
		if len(tags) > 0 {
			withTags++
		}
	}
	return withTags, nil
}

// Memory 是测试 / 没配库时的内存实现。
type Memory struct {
	mu       sync.Mutex
	Evidence map[string]Evidence
	tags     map[string][]Tag
}

func NewMemory() *Memory {
	return &Memory{Evidence: map[string]Evidence{}, tags: map[string][]Tag{}}
}

func (m *Memory) LoadEvidence(context.Context, time.Time) (map[string]Evidence, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]Evidence, len(m.Evidence))
	for k, v := range m.Evidence {
		out[k] = v
	}
	return out, nil
}

func (m *Memory) UsersWithTags(context.Context) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []string{}
	for id, tags := range m.tags {
		if len(tags) > 0 {
			out = append(out, id)
		}
	}
	return out, nil
}

func (m *Memory) ReplaceUserTags(_ context.Context, userID string, tags []Tag) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(tags) == 0 {
		delete(m.tags, userID)
		return nil
	}
	m.tags[userID] = append([]Tag(nil), tags...)
	return nil
}

func (m *Memory) TagsOf(_ context.Context, userID string) ([]Tag, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Tag(nil), m.tags[userID]...), nil
}

// Service 把 Store 包成 Reader：每次读都报用途、过滤过期。
type Service struct {
	Store Store
	Now   func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// TagsFor 读一个人的标签。读不出来返回空——撮合不能因为标签层挂了就不工作（标签是加分项，不是闸门）。
func (s *Service) TagsFor(ctx context.Context, userID string, use Use) []Tag {
	if s == nil || s.Store == nil || userID == "" {
		return nil
	}
	tags, err := s.Store.TagsOf(ctx, userID)
	if err != nil {
		return nil
	}
	return FilterForUse(tags, use, s.now())
}

// AxisStat 是一个轴上的真实覆盖：多少人有、多少条、取值分布。给运营看「标签层有没有在工作」。
type AxisStat struct {
	Axis          string       `json:"axis"`
	Label         string       `json:"label"`
	Polarity      string       `json:"polarity"`
	Users         int          `json:"users"`
	Tags          int          `json:"tags"`
	AvgConfidence float64      `json:"avgConfidence"`
	Top           []ValueCount `json:"top"`
}

type ValueCount struct {
	Value string `json:"value"`
	Users int    `json:"users"`
}

// Stats 是标签层的整体状态。LastComputedAt 为空 = 从没算过（worker 没跑 / 没证据）。
type Stats struct {
	UsersWithTags  int        `json:"usersWithTags"`
	TotalTags      int        `json:"totalTags"`
	LastComputedAt *time.Time `json:"lastComputedAt,omitempty"`
	RuleVersion    string     `json:"ruleVersion"`
	Axes           []AxisStat `json:"axes"`
}

// StatsSource 是可选能力：能出统计的存储才实现它。
type StatsSource interface {
	Stats(ctx context.Context, now time.Time) (Stats, error)
}

// ComputeStats 在内存里算统计（Memory 与测试用）。
func ComputeStats(byUser map[string][]Tag, now time.Time) Stats {
	st := Stats{RuleVersion: RuleVersion}
	perAxis := map[string]*AxisStat{}
	values := map[string]map[string]int{}
	users := map[string]map[string]bool{}
	var last time.Time
	for user, tags := range byUser {
		live := 0
		for _, t := range tags {
			if !t.ExpiresAt.After(now) {
				continue
			}
			live++
			a := perAxis[t.Axis]
			if a == nil {
				axis, _ := LookupAxis(t.Axis)
				a = &AxisStat{Axis: t.Axis, Label: axis.Label, Polarity: axis.Polarity}
				perAxis[t.Axis] = a
				values[t.Axis] = map[string]int{}
				users[t.Axis] = map[string]bool{}
			}
			a.Tags++
			a.AvgConfidence += t.Confidence
			values[t.Axis][t.Value]++
			users[t.Axis][user] = true
			if t.ComputedAt.After(last) {
				last = t.ComputedAt
			}
		}
		if live > 0 {
			st.UsersWithTags++
			st.TotalTags += live
		}
	}
	for _, axis := range Axes() {
		a := perAxis[axis.Axis]
		if a == nil {
			st.Axes = append(st.Axes, AxisStat{Axis: axis.Axis, Label: axis.Label, Polarity: axis.Polarity, Top: []ValueCount{}})
			continue
		}
		a.Users = len(users[axis.Axis])
		a.AvgConfidence = round3(a.AvgConfidence / float64(a.Tags))
		a.Top = topValues(values[axis.Axis], 8)
		st.Axes = append(st.Axes, *a)
	}
	if !last.IsZero() {
		st.LastComputedAt = &last
	}
	return st
}

func topValues(counts map[string]int, limit int) []ValueCount {
	out := make([]ValueCount, 0, len(counts))
	for v, n := range counts {
		out = append(out, ValueCount{Value: v, Users: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Users != out[j].Users {
			return out[i].Users > out[j].Users
		}
		return out[i].Value < out[j].Value
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (m *Memory) Stats(_ context.Context, now time.Time) (Stats, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return ComputeStats(m.tags, now), nil
}
