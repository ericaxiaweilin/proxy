package facet

import (
	"context"
	"errors"
	"sync"
	"time"
)

// SideSpacePost 是 R15.43 引入的「副空间内容条目」。
//
// 设计：副空间 = Creator 精心挑选的、只对特定合作方可见的内容
// 池。每个 SideSpacePost 关联一个 FacetObject（合作方）— 不是
// 关联「用户发布的内容」，而是副空间自己的条目。
//
// Phase 1.5 mock：
//   - 5 个全局 post 池（"门店环境" / "服务过程" / "客户故事" /
//     "能力对比" / "合作案例"），用稳定 id 标识
//   - 用户 addSideSpacePost 只是「把全局池里的某个 post 加到
//     某个合作方的副空间」— 不真上传图片
//   - removeSideSpacePost 反向
//
// Phase 2 计划：
//   - 全局 post 池 → 用户真实发布的内容（image / video / caption）
//   - addSideSpacePost 时校验 postId 属于当前用户
//   - 副空间 push 端点（POST /side-space/posts/:id/push）
type SideSpacePost struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	ImageURL string `json:"imageUrl"`
	AddedAt  string `json:"addedAt"`
}

// SideSpaceEntry 是 SideSpaceRepository 的存储粒度：
// objectID + post 的复合记录，带 AddedAt。
type SideSpaceEntry struct {
	ObjectID string
	Post     SideSpacePost
}

// SideSpaceRepository 抽象。
//
// Phase 1.5 实现：MemorySideSpaceRepository（process 内 sync.Map）。
// Phase 2 计划：PG facet_side_space_entries 表，复合主键 (object_id, post_id)。
type SideSpaceRepository interface {
	// List 返回某个对象的所有副空间 post（按 AddedAt 倒序）。
	List(ctx context.Context, objectID string) ([]SideSpacePost, error)
	// Add 加入一条副空间 entry；返回完整 SideSpacePost。
	// 重复 add 同一 (objectID, postID) 返回 ErrAlreadyAdded。
	Add(ctx context.Context, objectID string, post SideSpacePost) (SideSpacePost, error)
	// Remove 移除一条 entry；找不到返回 ErrNotFound。
	Remove(ctx context.Context, objectID, postID string) error
}

// 错误码 —— mobile 端用 string 匹配，contract 不声明（service-local）
var (
	ErrSideSpaceAlreadyAdded = errors.New("side_space: post already in object side space")
	ErrSideSpaceNotFound     = errors.New("side_space: post not in object side space")
	ErrSideSpaceInvalidKind  = errors.New("side_space: invalid kind for side space")
)

// MemorySideSpaceRepository 是 Phase 1.5 的 in-memory 实现。
//
// 内部用 sync.Map 存 entries，key = objectID + "|" + postID。
// 进程重启清空（mock 行为）。
type MemorySideSpaceRepository struct {
	mu      sync.Mutex
	entries map[string]SideSpaceEntry // key = objectID + "|" + postID
	now     func() time.Time
}

func NewMemorySideSpaceRepository() *MemorySideSpaceRepository {
	return &MemorySideSpaceRepository{
		entries: make(map[string]SideSpaceEntry),
		now:     time.Now,
	}
}

func (r *MemorySideSpaceRepository) List(_ context.Context, objectID string) ([]SideSpacePost, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]SideSpacePost, 0)
	for _, e := range r.entries {
		if e.ObjectID == objectID {
			out = append(out, e.Post)
		}
	}
	// 简单倒序：按 AddedAt 字符串降序（RFC3339 字典序 = 时间序）
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].AddedAt > out[i].AddedAt {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

func (r *MemorySideSpaceRepository) Add(_ context.Context, objectID string, post SideSpacePost) (SideSpacePost, error) {
	if !isAllowedSideSpaceKind(post.Kind) {
		return SideSpacePost{}, ErrSideSpaceInvalidKind
	}
	if post.AddedAt == "" {
		post.AddedAt = r.now().UTC().Format(time.RFC3339)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := objectID + "|" + post.ID
	if _, exists := r.entries[key]; exists {
		return SideSpacePost{}, ErrSideSpaceAlreadyAdded
	}
	r.entries[key] = SideSpaceEntry{ObjectID: objectID, Post: post}
	return post, nil
}

func (r *MemorySideSpaceRepository) Remove(_ context.Context, objectID, postID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := objectID + "|" + postID
	if _, exists := r.entries[key]; !exists {
		return ErrSideSpaceNotFound
	}
	delete(r.entries, key)
	return nil
}

// isAllowedSideSpaceKind 校验 post.Kind 在白名单。
//
// 副空间只允许「能力 / 服务 / 作品」相关类型，不允许 personal/*
// （personal 类内容应该进主空间，不应该进副空间）。
//
// 允许值：
//   - portfolio/capability
//   - intro/services
//   - photo（中性图，可放副空间）
//   - city/travel（如果合作方是旅游相关）
var allowedSideSpaceKinds = map[string]bool{
	"portfolio/capability": true,
	"intro/services":       true,
	"photo":                true,
	"city/travel":          true,
}

func isAllowedSideSpaceKind(kind string) bool {
	return allowedSideSpaceKinds[kind]
}

// SideSpaceCatalog 是 Phase 1.5 的全局 post 池（mock）。
//
// 设计：用户「添加副空间内容」时，从这个池选一个 post 加到某个
// 合作方的副空间。池子 5 条，每条 kind 不同，方便演示。
type SideSpaceCatalogPost struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	ImageURL string `json:"imageUrl"`
}

// DefaultSideSpaceCatalog 返回 5 个 mock 全局 post。
func DefaultSideSpaceCatalog() []SideSpaceCatalogPost {
	return []SideSpaceCatalogPost{
		{ID: "ss-store-env", Kind: "intro/services", Title: "门店环境（早 9 点）", ImageURL: ""},
		{ID: "ss-service-1", Kind: "intro/services", Title: "服务过程近景（肩颈按摩）", ImageURL: ""},
		{ID: "ss-client-1", Kind: "portfolio/capability", Title: "客户故事：从失眠到深度睡眠", ImageURL: ""},
		{ID: "ss-capability-compare", Kind: "portfolio/capability", Title: "能力对比：普通 vs 深层筋膜", ImageURL: ""},
		{ID: "ss-collab-1", Kind: "portfolio/capability", Title: "合作案例：与 KOL 周末跟拍 12 张", ImageURL: ""},
	}
}

// SideSpaceCatalogByID 按 ID 查 catalog post；找不到返回 ok=false。
func SideSpaceCatalogByID(catalog []SideSpaceCatalogPost, id string) (SideSpaceCatalogPost, bool) {
	for _, p := range catalog {
		if p.ID == id {
			return p, true
		}
	}
	return SideSpaceCatalogPost{}, false
}
