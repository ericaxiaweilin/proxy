package facet

import (
	"context"
	"sync"
	"time"
)

// Gap 是 FACET 列表里每个对象的"当前缺口 / 下次展示"字段。
type Gap struct {
	Summary    string `json:"summary"`
	NextShowAt string `json:"nextShowAt"`
}

// ObjectSignals 是 R15.41 引入的 server-internal 字段 ——
//
// 设计：Object 是 Mobile wire format（response shape），signals 是
// 推理引擎的输入特征。两个领域解耦：signals 由真实数据源（聊天
// 频度 / 共同活动 / profile views）填，list 时不暴露给 mobile
// （mobile 拿到的是 ReasonedDecision 包装后的 goal / currentState
// / gap / recommendedKind）。
//
// R15.41 Phase 1.5 范围：signals 字段保留在 Object（server-side）但
// 不写进 wire JSON（`json:"-"`）。后续 Phase 2 接真实数据源时，
// Repository 返回带真 signals 的 Object，List 时塞进 ReasoningEngine。
type ObjectSignals struct {
	DaysSinceLastChat     int    `json:"-"`
	MutualEventsCount     int    `json:"-"`
	UnrepliedMessageCount int    `json:"-"`
	ProfileViewsLast7d    int    `json:"-"`
	ShownAssetCount       int    `json:"-"`
	FreshAssetCount       int    `json:"-"`
	LastShownAt           string `json:"-"`
	RelationshipDays      int    `json:"-"`
	CollaborationIntent   int    `json:"-"`
}

// Object 是 Mobile wire format。
//
// Goal / CurrentState / Gap / PillLabel / RecommendedKind 在 R15.41
// 之前是 hardcode 字符串；R15.41 之后由 ReasoningEngine 基于
// ObjectSignals 动态生成。如果 signals 为零值（空 Object{}），
// Service.List 走 fallback 路径返回 Phase 1 的 hardcode 字符串
// —— 保留向后兼容，避免改动炸开所有现有 mock。
//
// R15.42 起加 SideSpaceGap + SideSpaceKind —— 只对合作方（CREATOR_COLLAB）
// 关系有意义，其他关系恒为 ""。
type Object struct {
	ID                string        `json:"id"`
	DisplayName       string        `json:"displayName"`
	Relation          string        `json:"relation"`
	Goal              string        `json:"goal"`
	CurrentState      string        `json:"currentState"`
	PillLabel         string        `json:"pillLabel"`
	Gap               Gap           `json:"gap"`
	AvatarURL         string        `json:"avatarUrl"`
	RecommendedKind   string        `json:"recommendedKind"`
	ReasoningConfidence int          `json:"reasoningConfidence"`
	SideSpaceGap      string        `json:"sideSpaceGap"`
	SideSpaceKind     string        `json:"sideSpaceKind"`
	// Signals 是 server-internal，不写进 wire JSON。ReasoningEngine
	// 在 Service.List 内部消费它。
	Signals ObjectSignals `json:"-"`
}

type Payload struct {
	Objects      []Object `json:"objects"`
	TotalObjects int      `json:"totalObjects"`
	FreshAssets  int      `json:"freshAssets"`
	ShownAssets  int      `json:"shownAssets"`
}

type Repository interface {
	List(ctx context.Context) ([]Object, error)
	Seed(ctx context.Context, objects []Object) error
}

type MemoryRepository struct {
	mu      sync.Mutex
	objects []Object
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{} }

func (r *MemoryRepository) List(_ context.Context) ([]Object, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Object, len(r.objects))
	copy(out, r.objects)
	return out, nil
}

func (r *MemoryRepository) Seed(_ context.Context, objects []Object) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.objects = append([]Object(nil), objects...)
	return nil
}

type Service struct {
	repository Repository
	reasoner   Reasoner
	now        func() time.Time
}

func New() *Service {
	return NewWithReasoner(NewMemoryRepository(), NewRuleReasoner(time.Now))
}

func NewWithRepository(r Repository) *Service {
	return NewWithReasoner(r, NewRuleReasoner(time.Now))
}

func NewWithReasoner(r Repository, reasoner Reasoner) *Service {
	if r == nil {
		r = NewMemoryRepository()
	}
	if reasoner == nil {
		reasoner = NewRuleReasoner(time.Now)
	}
	s := &Service{repository: r, reasoner: reasoner, now: time.Now}
	s.SeedDefaults()
	return s
}

func (s *Service) SeedDefaults() {
	// R15.41: 每个对象带 mock signals —— 模拟"用户跟这个对象的真实
	// 互动状态"，让 ReasoningEngine 跑出差异化的 goal / gap / nextShowAt。
	// Phase 1.5 演示用；Phase 2 接真实数据源（聊天服务 / 共同活动）。
	_ = s.repository.Seed(context.Background(), []Object{
		// Ken: 重点关系, 7 天没聊, 对方 3 次浏览主页
		{
			ID: "ken", DisplayName: "小帅 Ken", Relation: "BUILDING_TRUST", PillLabel: "重点关系",
			AvatarURL: "",
			Signals: ObjectSignals{
				DaysSinceLastChat: 8, UnrepliedMessageCount: 2, ProfileViewsLast7d: 3,
				ShownAssetCount: 16, FreshAssetCount: 3, LastShownAt: s.now().Add(-48 * time.Hour).UTC().Format(time.RFC3339),
				RelationshipDays: 45,
			},
		},
		// Linh: 朋友, 共同兴趣, 本周新增 2 个 city 素材
		{
			ID: "linh", DisplayName: "Linh", Relation: "SHARED_INTEREST", PillLabel: "朋友",
			AvatarURL: "",
			Signals: ObjectSignals{
				DaysSinceLastChat: 1, MutualEventsCount: 4, UnrepliedMessageCount: 0, ProfileViewsLast7d: 1,
				ShownAssetCount: 22, FreshAssetCount: 2, LastShownAt: s.now().Add(-12 * time.Hour).UTC().Format(time.RFC3339),
				RelationshipDays: 180,
			},
		},
		// Spa: 合作, 对方 70% 合作意向, 已展示 8 次
		{
			ID: "spa", DisplayName: "ABC Spa", Relation: "CREATOR_COLLAB", PillLabel: "合作",
			AvatarURL: "",
			Signals: ObjectSignals{
				DaysSinceLastChat: 3, UnrepliedMessageCount: 1, ProfileViewsLast7d: 5,
				ShownAssetCount: 8, FreshAssetCount: 1, LastShownAt: s.now().Add(-72 * time.Hour).UTC().Format(time.RFC3339),
				RelationshipDays: 30, CollaborationIntent: 70,
			},
		},
	})
}

func (s *Service) List(ctx context.Context) (Payload, error) {
	objects, err := s.repository.List(ctx)
	if err != nil {
		return Payload{}, err
	}
	if objects == nil {
		objects = []Object{}
	}
	// R15.41: 对每个对象调 ReasoningEngine，把 Signals 翻译成 Goal /
	// CurrentState / Gap / RecommendedKind / Confidence。signals 为零
	// 值的对象（fallback）保留 Phase 1 的 hardcode 字段。
	// R15.42: 额外填 SideSpaceGap + SideSpaceKind（仅合作方有意义）。
	reasoned := make([]Object, len(objects))
	for i, obj := range objects {
		if hasSignals(obj.Signals) {
			decision := s.reasoner.Reason(obj.Signals, obj.Relation)
			objects[i].Goal = decision.Goal
			objects[i].CurrentState = decision.CurrentState
			objects[i].Gap = Gap{Summary: decision.GapSummary, NextShowAt: decision.NextShowAt}
			objects[i].RecommendedKind = decision.RecommendedKind
			objects[i].ReasoningConfidence = decision.Confidence
			objects[i].SideSpaceGap = decision.SideSpaceGap
			objects[i].SideSpaceKind = decision.SideSpaceKind
		}
		reasoned[i] = objects[i]
	}
	// freshAssets / shownAssets 跟对象列表解耦，是 hero 用的全局统计。
	// Phase 1.5 仍 hardcode 386/17；Phase 2 接 real 数据源再算。
	return Payload{Objects: reasoned, TotalObjects: len(reasoned), FreshAssets: 17, ShownAssets: 386}, nil
}

// hasSignals 判空 —— 全 0 / 全空字符串视为没接数据源，触发 fallback。
func hasSignals(s ObjectSignals) bool {
	return s.DaysSinceLastChat != 0 || s.MutualEventsCount != 0 || s.UnrepliedMessageCount != 0 ||
		s.ProfileViewsLast7d != 0 || s.ShownAssetCount != 0 || s.FreshAssetCount != 0 ||
		s.LastShownAt != "" || s.RelationshipDays != 0 || s.CollaborationIntent != 0
}
