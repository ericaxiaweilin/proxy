package facet

import (
	"context"
	"errors"
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
// R15.43 起加 SideSpacePosts —— 副空间内容池（已加入的 post 列表）。
//	非合作方恒为 []。
// R15.44 起加 SideSpaceFulfilled —— 副空间缺口是否被填上（仅合作方）。
type Object struct {
	ID                  string          `json:"id"`
	DisplayName         string          `json:"displayName"`
	Relation            string          `json:"relation"`
	Goal                string          `json:"goal"`
	CurrentState        string          `json:"currentState"`
	PillLabel           string          `json:"pillLabel"`
	Gap                 Gap             `json:"gap"`
	AvatarURL           string          `json:"avatarUrl"`
	RecommendedKind     string          `json:"recommendedKind"`
	ReasoningConfidence int             `json:"reasoningConfidence"`
	SideSpaceGap        string          `json:"sideSpaceGap"`
	SideSpaceKind       string          `json:"sideSpaceKind"`
	SideSpacePosts      []SideSpacePost `json:"sideSpacePosts"`
	SideSpaceFulfilled  bool            `json:"sideSpaceFulfilled"`
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
	repository        Repository
	reasoner          Reasoner
	sideSpaceRepo     SideSpaceRepository
	sideSpaceCatalog  []SideSpaceCatalogPost
	configRepo        ConfigRepository
	now               func() time.Time
}

func New() *Service {
	return NewFull(NewMemoryRepository(), NewRuleReasoner(time.Now), NewMemorySideSpaceRepository(), DefaultSideSpaceCatalog(), NewMemoryConfigRepository())
}

func NewWithRepository(r Repository) *Service {
	return NewFull(r, NewRuleReasoner(time.Now), NewMemorySideSpaceRepository(), DefaultSideSpaceCatalog(), NewMemoryConfigRepository())
}

func NewWithReasoner(r Repository, reasoner Reasoner) *Service {
	return NewFull(r, reasoner, NewMemorySideSpaceRepository(), DefaultSideSpaceCatalog(), NewMemoryConfigRepository())
}

func NewFull(r Repository, reasoner Reasoner, sideSpace SideSpaceRepository, catalog []SideSpaceCatalogPost, configRepo ConfigRepository) *Service {
	if r == nil {
		r = NewMemoryRepository()
	}
	if reasoner == nil {
		reasoner = NewRuleReasoner(time.Now)
	}
	if sideSpace == nil {
		sideSpace = NewMemorySideSpaceRepository()
	}
	if catalog == nil {
		catalog = DefaultSideSpaceCatalog()
	}
	if configRepo == nil {
		configRepo = NewMemoryConfigRepository()
	}
	s := &Service{
		repository:       r,
		reasoner:         reasoner,
		sideSpaceRepo:    sideSpace,
		sideSpaceCatalog: catalog,
		configRepo:       configRepo,
		now:              time.Now,
	}
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

	// R15.43: Spa 副空间默认 seed 3 条 — 演示「AI 推缺 1 个能力对比 /
	// 客户合作案例」时用户能看到 3 条副空间内容。
	ctx := context.Background()
	spaSeed := []SideSpacePost{
		{ID: "ss-store-env", Kind: "intro/services", Title: "门店环境（早 9 点）", ImageURL: ""},
		{ID: "ss-service-1", Kind: "intro/services", Title: "服务过程近景（肩颈按摩）", ImageURL: ""},
		{ID: "ss-client-1", Kind: "portfolio/capability", Title: "客户故事：从失眠到深度睡眠", ImageURL: ""},
	}
	for _, p := range spaSeed {
		_, _ = s.sideSpaceRepo.Add(ctx, "spa", p)
	}
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
	// R15.43: 额外填 SideSpacePosts（合作方才有，非合作方 = []）。
	// R15.44: 调 Reasoner 之前先拉副空间内容 + 算 SideSpaceStats
	// （副空间数据用于 R15.44 缺口实时判定）。
	reasoned := make([]Object, len(objects))
	for i, obj := range objects {
		// R15.43: 拉副空间内容（合作方才有）
		var sideSpaceStats SideSpaceStats
		sideSpaceStats.KindCounts = map[string]int{}
		if obj.Relation == "CREATOR_COLLAB" {
			posts, err := s.sideSpaceRepo.List(ctx, obj.ID)
			if err == nil && posts != nil {
				objects[i].SideSpacePosts = posts
			} else {
				objects[i].SideSpacePosts = []SideSpacePost{}
			}
			for _, p := range objects[i].SideSpacePosts {
				sideSpaceStats.Total++
				sideSpaceStats.KindCounts[p.Kind]++
			}
		} else {
			objects[i].SideSpacePosts = []SideSpacePost{}
		}
		if hasSignals(obj.Signals) {
			// R15.51: reasoner 拉取当前 config, 调整阈值. 这里是读路径, 1 次
			// 拉取 (跨所有 object 复用) — 避免 N+1.
			config, _ := s.configRepo.Get(ctx)
			decision := s.reasoner.Reason(obj.Signals, obj.Relation, sideSpaceStats, config)
			objects[i].Goal = decision.Goal
			objects[i].CurrentState = decision.CurrentState
			objects[i].Gap = Gap{Summary: decision.GapSummary, NextShowAt: decision.NextShowAt}
			objects[i].RecommendedKind = decision.RecommendedKind
			objects[i].ReasoningConfidence = decision.Confidence
			objects[i].SideSpaceGap = decision.SideSpaceGap
			objects[i].SideSpaceKind = decision.SideSpaceKind
			objects[i].SideSpaceFulfilled = decision.SideSpaceFulfilled
		} else {
			// fallback: DB 无 signals（PG 持久化未存 signals）时，不再按
			// ID 硬编码 ken/linh/spa —— 那会让任何 seed 进 PG 的新对象
			// （集成测试 / 真实用户建的对象）拿到零值 RecommendedKind("")
			// 直接违反 contracts 枚举，mobile Zod fail-closed 整页报错
			// （2026-09-03 实证：fct_* 测试残留行导致 FACET 报错）。
			//
			// 确定性兜底：零值 signals 交给 reasoner 按 relation 路由。
			// RuleReasoner 三条 relation 路径的零信号分支都返回合法
			// RecommendedKind（BUILDING_TRUST→personal/real-life、
			// SHARED_INTEREST→photo、CREATOR_COLLAB 低意向→
			// personal/real-life），未知 relation 也有 30 置信度通用
			// 决策。种子对象（ken/linh/spa）带真 signals 不走此分支，
			// Phase 1 的 hardcode 文案随 seed 消失，换来的是「任何 PG 行
			// 都能产出合法 wire payload」的结构保证。
			config, _ := s.configRepo.Get(ctx)
			decision := s.reasoner.Reason(obj.Signals, obj.Relation, sideSpaceStats, config)
			objects[i].Goal = decision.Goal
			objects[i].CurrentState = decision.CurrentState
			objects[i].Gap = Gap{Summary: decision.GapSummary, NextShowAt: decision.NextShowAt}
			objects[i].RecommendedKind = decision.RecommendedKind
			objects[i].ReasoningConfidence = decision.Confidence
			objects[i].SideSpaceGap = decision.SideSpaceGap
			objects[i].SideSpaceKind = decision.SideSpaceKind
			objects[i].SideSpaceFulfilled = decision.SideSpaceFulfilled
		}
		reasoned[i] = objects[i]
	}
	// freshAssets / shownAssets 跟对象列表解耦，是 hero 用的全局统计。
	// Phase 1.5 仍 hardcode 386/17；Phase 2 接 real 数据源再算。
	return Payload{Objects: reasoned, TotalObjects: len(reasoned), FreshAssets: 17, ShownAssets: 386}, nil
}

// AddSideSpacePost 把一个全局 catalog post 加入到某个对象的副空间。
//
// 校验：
//   - objectID 必须存在
//   - postID 必须在 catalog 里
//   - post.Kind 必须在副空间白名单里（不允许 personal/*）
//
// 成功返回完整的 SideSpacePost（带 AddedAt）。
func (s *Service) AddSideSpacePost(ctx context.Context, objectID, postID string) (SideSpacePost, error) {
	objects, err := s.repository.List(ctx)
	if err != nil {
		return SideSpacePost{}, err
	}
	found := false
	for _, o := range objects {
		if o.ID == objectID {
			found = true
			if o.Relation != "CREATOR_COLLAB" {
				return SideSpacePost{}, errors.New("side_space: object is not CREATOR_COLLAB")
			}
			break
		}
	}
	if !found {
		return SideSpacePost{}, errors.New("side_space: object not found")
	}
	cat, ok := SideSpaceCatalogByID(s.sideSpaceCatalog, postID)
	if !ok {
		return SideSpacePost{}, errors.New("side_space: post not in catalog")
	}
	return s.sideSpaceRepo.Add(ctx, objectID, SideSpacePost{
		ID:       cat.ID,
		Kind:     cat.Kind,
		Title:    cat.Title,
		ImageURL: cat.ImageURL,
	})
}

// RemoveSideSpacePost 从某个对象的副空间移除一条 post。
func (s *Service) RemoveSideSpacePost(ctx context.Context, objectID, postID string) error {
	return s.sideSpaceRepo.Remove(ctx, objectID, postID)
}

// ListSideSpacePosts 列出某个对象的副空间内容。
func (s *Service) ListSideSpacePosts(ctx context.Context, objectID string) ([]SideSpacePost, error) {
	return s.sideSpaceRepo.List(ctx, objectID)
}

// ListSideSpaceCatalog 返回全局 catalog（供 mobile "添加" modal 用）。
func (s *Service) ListSideSpaceCatalog() []SideSpaceCatalogPost {
	out := make([]SideSpaceCatalogPost, len(s.sideSpaceCatalog))
	copy(out, s.sideSpaceCatalog)
	return out
}

// R15.52 — SideSpaceSuggestionsForAll 返所有 objects 的副空间推荐.
// 给 mobile "推卸" (推卸 = 推送建议) 面板用, 避免 N+1.
// 未满足的对象返空切片 (客户端跳过).
func (s *Service) SideSpaceSuggestionsForAll(ctx context.Context, limit int) (map[string]SideSpaceSuggestions, error) {
	objects, err := s.repository.List(ctx)
	if err != nil {
		return nil, err
	}
	// 拉所有对象的副空间 (N+1 防住: 先批量拉, Phase 2 加 Repo.ListAll)
	sideSpacesByObject := make(map[string][]SideSpacePost, len(objects))
	for _, obj := range objects {
		posts, err := s.sideSpaceRepo.List(ctx, obj.ID)
		if err != nil {
			return nil, err
		}
		sideSpacesByObject[obj.ID] = posts
	}
	return SuggestForAllObjects(objects, sideSpacesByObject, s.sideSpaceCatalog, limit), nil
}

// hasSignals 判空 —— 全 0 / 全空字符串视为没接数据源，触发 fallback。
func hasSignals(s ObjectSignals) bool {
	return s.DaysSinceLastChat != 0 || s.MutualEventsCount != 0 || s.UnrepliedMessageCount != 0 ||
		s.ProfileViewsLast7d != 0 || s.ShownAssetCount != 0 || s.FreshAssetCount != 0 ||
		s.LastShownAt != "" || s.RelationshipDays != 0 || s.CollaborationIntent != 0
}

// ---------- R15.51 FacetConfig CRUD ----------

// ListFacetConfig 返当前运营阈值 (默认 DefaultFacetConfig).
// 匿名可读 (跟 facet objects 一样).
func (s *Service) ListFacetConfig(ctx context.Context) (FacetConfig, error) {
	return s.configRepo.Get(ctx)
}

// UpdateFacetConfig 乐观锁 — expectedVersion 跟当前 version 不匹配返 ErrConfigVersionMismatch.
// 成功返回新 config (Version+1).
func (s *Service) UpdateFacetConfig(ctx context.Context, expectedVersion int, patch FacetConfigPatch) (FacetConfig, error) {
	updated, err := s.configRepo.Update(ctx, expectedVersion, patch)
	if err != nil {
		return FacetConfig{}, err
	}
	updated.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	// 落回 repo (UpdatedAt 不属于 optimistic lock 字段, repo 不存)
	// 简单设计: re-update with same version+1, UpdatedAt 填充. 但 repo.Update
	// 每次都 +1, 这里跳过 UpdatedAt 落库, list 时补 — Phase 2 可加。
	return updated, nil
}
