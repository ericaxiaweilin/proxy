package localnet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// Local Life Social Demand Network（R13 PRD Chapter21H）。
// 核心规则：
//  1. Post = durable content（body/media/visibility/status/context_refs）
//  2. 实时交易事实（价格/可用性/商家状态）由读取时 Hydration 获得——Post 不是 Source of Truth
//  3. Post 发布永不自动创建 Task；Intent 经 DM / 显式 Need 涌现
//  4. DemandAttributionLineage：订单来源完整链路，不覆盖 Agent 自带来源

// Post 是本地动态的 durable content（PRD §4 Post Canonical Contract）。
type Post struct {
	ID         string `json:"postId"`
	AuthorType string `json:"authorType"` // USER | AGENT | MERCHANT | PLATFORM_SPECIAL
	AuthorID   string `json:"authorId"`
	// AuthorDisplayName 是展示名（P0 演示用；权威作者仍是 AuthorType+AuthorID）。
	AuthorDisplayName string         `json:"authorDisplayName,omitempty"`
	Body              string         `json:"body"`
	MediaRefs         []PostMediaRef `json:"mediaRefs"`  // R14 Adaptive Media Rail：带 sortOrder
	Visibility        string         `json:"visibility"` // PUBLIC | FOLLOWERS | AGENT_ONLY
	CityScope         string         `json:"cityScope,omitempty"`
	Status            string         `json:"status"` // DRAFT | PUBLISHED | HIDDEN | REMOVED
	ContextRefs       []ContextRef   `json:"contextRefs"`
	CreatedAt         time.Time      `json:"createdAt"`
	// R15.15 P1: SceneType 是 Post 与 Scene aggregate 之间的选择
	// 门 (ROOFTOP | BRUNCH | SPA | CINEMA | PHOTO | NIGHTLIFE |
	// OUTDOOR | COFFEE | UNKNOWN). 跟 Scene.SceneType 同样枚举
	// (mirror @proxy/contracts scene.ts SceneTypeSchema). 有了这个
	// 字段, listFeed 可以调 s.sceneAesthetic.GetAestheticBackdrop
	// (ctx, post.CityScope, post.SceneType) 而不只是全局一个色 —
	// 不同场景类型的帖背景都不一样。
	SceneType string `json:"sceneType,omitempty"`
}

// PostMediaRef 是 Post 的媒体引用（R14 §16.5：sort_order = 作者确认的展示顺序）。
type PostMediaRef struct {
	MediaAssetID string `json:"mediaAssetId"`
	SortOrder    int    `json:"sortOrder"`
	AltText      string `json:"altText,omitempty"`
}

// PostMediaItem 是 Feed Read Model 的 Hydrate 媒体项（R14 §16.5 + R10 Gate F）。
type PostMediaItem struct {
	MediaAssetID      string  `json:"mediaAssetId"`
	MediaType         string  `json:"mediaType"` // IMAGE | VIDEO
	ThumbnailURL      string  `json:"thumbnailUrl,omitempty"`
	PlaybackURL       string  `json:"playbackUrl,omitempty"`
	PlaceholderURL    string  `json:"placeholderUrl,omitempty"`
	FeedURL           string  `json:"feedUrl,omitempty"`
	Feed2xURL         string  `json:"feed2xUrl,omitempty"`
	Feed2xHintURL     string  `json:"feed2xHintUrl,omitempty"`
	Feed2xNaturalURL  string  `json:"feed2xNaturalUrl,omitempty"`
	GalleryURL        string  `json:"galleryUrl,omitempty"`
	DominantColorHex  string  `json:"dominantColorHex,omitempty"`
	OriginalAvailable bool    `json:"originalAvailable,omitempty"`
	Width             int     `json:"width"`
	Height            int     `json:"height"`
	AspectRatio       float64 `json:"aspectRatio"`
	DurationMs        int64   `json:"durationMs,omitempty"`
	ProcessingStatus  string  `json:"processingStatus"`
	ModerationStatus  string  `json:"moderationStatus"`
	SortOrder         int     `json:"sortOrder"`
	// CompositionHint：来自 media_assets.composition_hint（见 migration 025 + §5.2.2）。
	// 前端按此决定 cover vs contain；低置信度（<0.4）必须回落 contain。
	CompositionHint *MediaCompositionHintDTO `json:"compositionHint,omitempty"`
	// SceneAestheticBackdrop：R15.13 P4 推荐 frame 背景，源自在
	// 同 (cityScope, sceneType) 已完成场景中 Memory.aestheticAssets
	// dominant 色的众数。为空时前端继续走默认 FRAME_BACKGROUND_HEX。
	SceneAestheticBackdrop string `json:"sceneAestheticBackdrop,omitempty"`
}

// MediaCompositionHintDTO 是给前端的 wire 形状（与 @proxy/contracts 一致）。
// 这里独立定义一次，避免 media 包被 localnet 之外依赖时反向 import contracts。
type MediaCompositionHintDTO struct {
	SubjectType   string        `json:"subjectType"`
	SubjectCount  int           `json:"subjectCount"`
	FaceBoxes     []MediaBoxDTO `json:"faceBoxes"`
	BodyBoxes     []MediaBoxDTO `json:"bodyBoxes"`
	TextSafeArea  *MediaBoxDTO  `json:"textSafeArea,omitempty"`
	FocalPoint    *MediaBoxDTO  `json:"focalPoint,omitempty"`
	SafeCropRect  *MediaBoxDTO  `json:"safeCropRect,omitempty"`
	Confidence    float64       `json:"confidence"`
	RecipeVersion string        `json:"recipeVersion"`
}

// MediaBoxDTO 归一化矩形（与前端一致）。
type MediaBoxDTO struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// MediaLookup 是媒体详情查询接口（由 media 包实现，注入避免循环依赖）。
type MediaLookup interface {
	LookupMediaAssets(ctx context.Context, ids []string) (map[string]MediaAssetInfo, error)
	AuthorizeForPost(ctx context.Context, ids []string, ownerPrincipalID, visibility string) error
}

// SceneAestheticProvider is the R15.13 P4 feedback path: given a
// city + scene type, the feed hydrator asks the scene domain for
// the most-frequent dominant color in past memories so the client
// can use it as the contain-mode frame background. Implemented by
// scene.Service via a thin adapter (cmd/api/main.go) so localnet
// stays free of a direct scene import.
type SceneAestheticProvider interface {
	// GetAestheticBackdrop returns the recommended frame color for
	// the (cityScope, sceneType) tuple, or ("", 0, 0) when no
	// signal exists. The caller is expected to fall back to its
	// default frame background when SampleCount < 2.
	GetAestheticBackdrop(ctx context.Context, cityScope, sceneType string) (SceneAestheticBackdrop, error)
}

// SceneAestheticBackdrop is the wire shape returned by the
// provider. The fields are non-nil zero values; SampleCount==0
// means "no signal, use the default".
type SceneAestheticBackdrop struct {
	Hex         string
	SampleCount int
	Confidence  float64
}

// MediaAssetInfo 是媒体资产的可读视图（READY 过滤在调用方）。
type MediaAssetInfo struct {
	MediaAssetID      string
	MediaType         string
	ThumbnailURL      string
	PlaybackURL       string
	PlaceholderURL    string
	FeedURL           string
	Feed2xURL         string
	Feed2xHintURL     string
	Feed2xNaturalURL  string
	GalleryURL        string
	DominantColorHex  string
	OriginalAvailable bool
	Width             int
	Height            int
	DurationMs        int64
	ProcessingStatus  string
	ModerationStatus  string
	VisibilityClass   string
	// CompositionHint：来自 media_assets.composition_hint。
	CompositionHint *MediaCompositionHintDTO
}

// ContextRef 是 Post 的结构化上下文关联（PRD §4 PostContextRef）。
type ContextRef struct {
	ContextType  string `json:"contextType"` // AGENT_PROFILE | SERVICE_SKU | ROUTE | VENUE | ACTIVITY | TASK_TEMPLATE
	ContextID    string `json:"contextId"`
	RelationType string `json:"relationType,omitempty"`
}

// DemandAttributionLineage 是订单来源完整链路（PRD §10）。
type DemandAttributionLineage struct {
	DemandOrigin       string `json:"demandOrigin"` // PROXY_OWNED | PARTNER | AGENT_OWNED
	SourceType         string `json:"sourceType"`   // POST_TO_DM | PROFILE_LINK | FOLLOW_REPLY | DIRECT | ...
	SourceID           string `json:"sourceId"`
	CreatorPrincipalID string `json:"creatorPrincipalId,omitempty"`
	ConversationID     string `json:"conversationId,omitempty"`
	NeedID             string `json:"needId,omitempty"`
	OrderID            string `json:"orderId,omitempty"`
}

// NeedFromPost 是 Post → Need 的显式转化记录。
type NeedFromPost struct {
	NeedID    string                   `json:"needId"`
	PostID    string                   `json:"postId"`
	Lineage   DemandAttributionLineage `json:"lineage"`
	CreatedAt time.Time                `json:"createdAt"`
}

type Repository interface {
	CreatePost(ctx context.Context, post Post) error
	UpsertPost(ctx context.Context, post Post) error
	GetPost(ctx context.Context, id string) (Post, error)
	UpdatePost(ctx context.Context, post Post, expectedVersion int) error
	Snapshot(ctx context.Context) ([]Post, error)
	SaveNeedFromPost(ctx context.Context, record NeedFromPost) error
	SnapshotNeeds(ctx context.Context) ([]NeedFromPost, error)
	AppendInteractionEvent(ctx context.Context, ie InteractionEvent) error
	ListInteractionEvents(ctx context.Context, actorID string, limit int) ([]InteractionEvent, error)
}

// InteractionEvent 是网络交互事件（C1 Event Stream 最小底座）。
// 读侧事件：PROFILE_OPEN / POST_IMPRESSION / CANDIDATE_VIEWED / AGENT_SHORTLISTED。
type InteractionEvent struct {
	EventID    string    `json:"eventId"`
	EventType  string    `json:"eventType"` // PROFILE_OPEN | POST_IMPRESSION | CANDIDATE_VIEWED | AGENT_SHORTLISTED
	ActorID    string    `json:"actorId"`
	TargetType string    `json:"targetType"` // PROFILE | POST | CANDIDATE | AGENT
	TargetID   string    `json:"targetId"`
	NeedID     string    `json:"needId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

var (
	ErrPostNotFound    = errors.New("post not found")
	ErrVersionConflict = errors.New("post version conflict")
)

type MemoryRepository struct {
	mu                sync.Mutex
	posts             map[string]Post
	needs             []NeedFromPost
	interactionEvents []InteractionEvent
	events            []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{posts: make(map[string]Post)}
}

// SeedDemoPosts idempotently inserts a small set of demo posts so a
// fresh visitor doesn't see an empty feed. The seeds deliberately
// have NO cityScope — per PostsWithoutCityScopePassThrough they
// pass through any viewingCity filter, so the visitor sees content
// no matter which city LocationContext lands on.
//
// Identity (authorType / authorId / authorDisplayName) is the same
// shape as the previous client-side seedDemoPosts (Linh / Mai /
// Huyen / Bonsaidon) so existing screenshots / fixtures stay
// consistent.
func (s *Service) SeedDemoPosts(ctx context.Context) error {
	if s.repository == nil {
		return nil
	}
	now := s.clock.Now().UTC()
	seeds := []Post{
		{
			ID:                "post_seed_linh_01",
			AuthorType:        "AGENT",
			AuthorID:          "agent_linh",
			AuthorDisplayName: "Linh",
			Body:              "今天带第一次来河内的客人走了一条“少景点、多咖啡和拍照”的路线。下午太热，所以把西湖放晚一点，中间多留了一个室内咖啡休息。",
			MediaRefs: []PostMediaRef{
				{MediaAssetID: "seed_media_hoankiem", SortOrder: 0},
				{MediaAssetID: "seed_media_coffee", SortOrder: 1},
				{MediaAssetID: "seed_media_westlake", SortOrder: 2},
			},
			Visibility:  "PUBLIC",
			CityScope:   "", // 无 cityScope 走全 city filter
			SceneType:   "PHOTO",
			Status:      "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "SERVICE", ContextID: "城市同行"}, {ContextType: "ROUTE", ContextID: "轻松拍照路线"}, {ContextType: "VENUE", ContextID: "木光咖啡"}},
			CreatedAt:   now.Add(-2 * time.Hour),
		},
		{
			ID:                "post_seed_mai_01",
			AuthorType:        "AGENT",
			AuthorID:          "agent_mai",
			AuthorDisplayName: "Mai",
			Body:              "明天下午 13:00–18:00 临时空出来。想轻松看西湖、喝咖啡、拍点照片的话可以直接聊，我会先看你想要什么节奏。",
			MediaRefs:         []PostMediaRef{{MediaAssetID: "seed_media_route_video", SortOrder: 0}},
			Visibility:        "PUBLIC",
			CityScope:         "",
			SceneType:         "COFFEE",
			Status:            "PUBLISHED",
			ContextRefs:       []ContextRef{{ContextType: "SERVICE", ContextID: "城市同行"}, {ContextType: "AVAILABILITY", ContextID: "明天下午可接"}},
			CreatedAt:         now.Add(-90 * time.Minute),
		},
		{
			ID:                "post_seed_huyen_01",
			AuthorType:        "USER",
			AuthorID:          "user_huyen",
			AuthorDisplayName: "Huyen",
			Body:              "周六下午有人想一起找家好看的咖啡店互相拍照吗？不收服务费，各自点自己的饮料就行。",
			Visibility:        "PUBLIC",
			CityScope:         "",
			SceneType:         "COFFEE",
			Status:            "PUBLISHED",
			ContextRefs:       []ContextRef{{ContextType: "ACTIVITY", ContextID: "用户活动"}, {ContextType: "QUOTE_POST", ContextID: "post_seed_linh_01"}},
			CreatedAt:         now.Add(-60 * time.Minute),
		},
		{
			ID:                "post_seed_bonsai_01",
			AuthorType:        "MERCHANT",
			AuthorID:          "merchant_bonsai",
			AuthorDisplayName: "Bonsaidon",
			Body:              "周六新店开业，现场准备了小型品鉴环节。欢迎来坐坐，也欢迎认识更多本地朋友。",
			MediaRefs:         []PostMediaRef{{MediaAssetID: "seed_media_opening_video", SortOrder: 0}},
			Visibility:        "PUBLIC",
			CityScope:         "",
			SceneType:         "COFFEE",
			Status:            "PUBLISHED",
			ContextRefs:       []ContextRef{{ContextType: "VENUE", ContextID: "门店场景"}, {ContextType: "ACTIVITY", ContextID: "周六新店开业"}},
			CreatedAt:         now.Add(-30 * time.Minute),
		},
	}
	for _, post := range seeds {
		// idempotent: if id already in store, skip. Repository
		// 里有冪等性要求的 (Postgres 上是 ON CONFLICT DO NOTHING，
		// Memory 是 contains check) — 都话 call CreatePost 能
		// 产生重复 ID, 所以直接 Upsert。
		if err := s.repository.UpsertPost(ctx, post); err != nil {
			return err
		}
	}
	return nil
}

func (r *MemoryRepository) CreatePost(_ context.Context, post Post) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.posts[post.ID]; exists {
		return errors.New("post already exists")
	}
	r.posts[post.ID] = clonePost(post)
	return nil
}

func (r *MemoryRepository) UpsertPost(_ context.Context, post Post) error {
	// 幂等 — 走 seed 时重起不会重复。现有 ID 被覆盖 (本次走同 ID
	// 代表 “二次启动” 而原 post 未变)。
	r.mu.Lock()
	defer r.mu.Unlock()
	r.posts[post.ID] = clonePost(post)
	return nil
}

func (r *MemoryRepository) GetPost(_ context.Context, id string) (Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	post, exists := r.posts[id]
	if !exists {
		return Post{}, ErrPostNotFound
	}
	return clonePost(post), nil
}

func (r *MemoryRepository) UpdatePost(_ context.Context, post Post, _ int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.posts[post.ID]; !exists {
		return ErrPostNotFound
	}
	r.posts[post.ID] = clonePost(post)
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]Post, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Post, 0, len(r.posts))
	for _, p := range r.posts {
		result = append(result, clonePost(p))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryRepository) SaveNeedFromPost(_ context.Context, record NeedFromPost) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.needs = append(r.needs, record)
	return nil
}

func (r *MemoryRepository) SnapshotNeeds(_ context.Context) ([]NeedFromPost, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]NeedFromPost, len(r.needs))
	copy(result, r.needs)
	return result, nil
}

func (r *MemoryRepository) AppendInteractionEvent(_ context.Context, ie InteractionEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.interactionEvents = append(r.interactionEvents, ie)
	return nil
}

func (r *MemoryRepository) ListInteractionEvents(_ context.Context, actorID string, limit int) ([]InteractionEvent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []InteractionEvent{}
	for i := len(r.interactionEvents) - 1; i >= 0; i-- {
		ie := r.interactionEvents[i]
		if actorID == "" || ie.ActorID == actorID {
			result = append(result, ie)
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func clonePost(post Post) Post {
	post.MediaRefs = append([]PostMediaRef(nil), post.MediaRefs...)
	post.ContextRefs = append([]ContextRef(nil), post.ContextRefs...)
	return post
}

type Service struct {
	mu             sync.Mutex
	repository     Repository
	mediaLookup    MediaLookup
	sceneAesthetic SceneAestheticProvider
	modelStack     modelstack.Port
	clock          clock.Clock
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

// NewWithMediaLookup 注入媒体详情查询（R14 Adaptive Media Rail：Feed Hydrate）。
func NewWithMediaLookup(repository Repository, mediaLookup MediaLookup) *Service {
	s := NewWithRepository(repository)
	s.mediaLookup = mediaLookup
	return s
}

func NewWithMediaLookupAndModelStack(repository Repository, mediaLookup MediaLookup, ms modelstack.Port) *Service {
	s := NewWithMediaLookup(repository, mediaLookup)
	if ms != nil {
		s.modelStack = ms
	}
	return s
}

// NewWithMediaLookupAndSceneAesthetic binds both the media lookup
// and the scene-aesthetic provider. Either may be nil — the feed
// hydrator tolerates both (media is required for hydrated URLs;
// aesthetic is a soft hint, the client falls back when missing).
func NewWithMediaLookupAndSceneAesthetic(repository Repository, mediaLookup MediaLookup, aesthetic SceneAestheticProvider) *Service {
	s := NewWithMediaLookup(repository, mediaLookup)
	s.sceneAesthetic = aesthetic
	return s
}

// NewWithAll injects every optional dependency. ms and aesthetic
// may be nil; mediaLookup must be non-nil for production use (the
// caller would otherwise see placeholder URLs only).
func NewWithAll(repository Repository, mediaLookup MediaLookup, ms modelstack.Port, aesthetic SceneAestheticProvider) *Service {
	s := NewWithMediaLookupAndModelStack(repository, mediaLookup, ms)
	s.sceneAesthetic = aesthetic
	return s
}

func NewWithModelStack(repository Repository, ms modelstack.Port) *Service {
	s := NewWithRepository(repository)
	if ms != nil {
		s.modelStack = ms
	}
	return s
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, modelStack: modelstack.Unconfigured{}, clock: clock.System{}}
}

func NewWithRepositoryAndClock(repository Repository, domainClock clock.Clock) *Service {
	s := NewWithRepository(repository)
	if domainClock != nil {
		s.clock = domainClock
	}
	return s
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreatePost", "ListFeedPosts", "CreateNeedFromPost", "RecordAttribution",
		"RecordProfileOpen", "RecordPostImpression", "RecordCandidateViewed",
		"ShortlistAgent", "ListInteractionEvents":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreatePost":
		return s.createPost(ctx, e)
	case "ListFeedPosts":
		return s.listFeed(ctx, e)
	case "CreateNeedFromPost":
		return s.createNeedFromPost(ctx, e)
	case "RecordAttribution":
		return s.recordAttribution(ctx, e)
	case "RecordProfileOpen":
		return s.recordProfileOpen(ctx, e)
	case "RecordPostImpression":
		return s.recordPostImpression(ctx, e)
	case "RecordCandidateViewed":
		return s.recordCandidateViewed(ctx, e)
	case "ShortlistAgent":
		return s.shortlistAgent(ctx, e)
	case "ListInteractionEvents":
		return s.listInteractionEvents(ctx, e)
	default:
		return command.Rejected(e, "LOCAL_NET_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "localnet.unsupported_command", nil)
	}
}

// ---------- CreatePost ----------
// PRD §4/§11：Post = durable content；发布永不自动创建 Task。

type createPostPayload struct {
	AuthorType        string         `json:"authorType"`
	AuthorDisplayName string         `json:"authorDisplayName"`
	Body              string         `json:"body"`
	MediaRefs         []PostMediaRef `json:"mediaRefs"` // R14：{mediaAssetId, sortOrder}，≤6
	Visibility        string         `json:"visibility"`
	CityScope         string         `json:"cityScope"`
	// R15.15 P1：Post 可带 SceneType（ROOFTOP / BRUNCH / SPA /
	// CINEMA / PHOTO / NIGHTLIFE / OUTDOOR / COFFEE / UNKNOWN），
	// 让 listFeed 能调 s.sceneAesthetic.GetAestheticBackdrop(ctx,
	// post.CityScope, post.SceneType) 走 per-(city, sceneType)
	// 记忆轮。不传默认 UNKNOWN（依然能查到，只是样本少）。
	SceneType   string       `json:"sceneType"`
	ContextRefs []ContextRef `json:"contextRefs"`
}

// allowedSceneTypes 是 Post.SceneType 的允许集。需要保持与
// @proxy/contracts scene.ts SceneTypeSchema 同源。这是列表是
// 唯一应该被 listFeed 接叏去 sceneAesthetic provider 的输入。
// 注：scene 包内 Memory.SceneType 是更细的混合标签 (如
// 'ROOFTOP_PHOTO')。Post.SceneType 这里用顶层类别以保持发布者
// 选择负担小，不动起 scene 包类别字典。
var allowedSceneTypes = map[string]struct{}{
	"UNKNOWN":   {},
	"ROOFTOP":   {},
	"BRUNCH":    {},
	"SPA":       {},
	"CINEMA":    {},
	"PHOTO":     {},
	"NIGHTLIFE": {},
	"OUTDOOR":   {},
	"COFFEE":    {},
}

func (s *Service) createPost(ctx context.Context, e command.Envelope) command.Result {
	var p createPostPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_POST", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_post", nil)
	}
	if p.AuthorType == "" {
		p.AuthorType = "USER"
	}
	if p.Body == "" && len(p.MediaRefs) == 0 {
		return command.Rejected(e, "POST_EMPTY_CONTENT", "VALIDATION", "AFTER_USER_ACTION", "localnet.post_empty_content", nil)
	}
	// R15.15 P1: SceneType 可选 — 客户端发布时可填。未知 / 拼错的值
	// 不被静默接受，会 reject 避免下游 sceneAesthetic.GetAestheticBackdrop
	// 拿到垃圾输入。空串=UNKNOWN，计为合规。
	if p.SceneType == "" {
		p.SceneType = "UNKNOWN"
	}
	if _, ok := allowedSceneTypes[p.SceneType]; !ok {
		return command.Rejected(e, "INVALID_POST_SCENE_TYPE", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_post_scene_type", map[string]any{"got": p.SceneType})
	}
	// R14 §16.1：P0 max = 6 Media/Post；超过不静默截断
	if len(p.MediaRefs) > 6 {
		return command.Rejected(e, "POST_MEDIA_LIMIT_EXCEEDED", "VALIDATION", "AFTER_USER_ACTION", "localnet.post_media_limit", map[string]any{"max": 6, "got": len(p.MediaRefs)})
	}
	seenMedia := make(map[string]struct{}, len(p.MediaRefs))
	seenOrder := make(map[int]struct{}, len(p.MediaRefs))
	for _, ref := range p.MediaRefs {
		if ref.MediaAssetID == "" || ref.SortOrder < 0 || ref.SortOrder >= len(p.MediaRefs) || utf8.RuneCountInString(ref.AltText) > 500 {
			return command.Rejected(e, "INVALID_POST_MEDIA_REF", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_media_ref", nil)
		}
		if _, exists := seenMedia[ref.MediaAssetID]; exists {
			return command.Rejected(e, "INVALID_POST_MEDIA_REF", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_media_ref", nil)
		}
		if _, exists := seenOrder[ref.SortOrder]; exists {
			return command.Rejected(e, "INVALID_POST_MEDIA_REF", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_media_ref", nil)
		}
		seenMedia[ref.MediaAssetID] = struct{}{}
		seenOrder[ref.SortOrder] = struct{}{}
	}
	if p.Visibility == "" {
		p.Visibility = "PUBLIC"
	}
	if p.Visibility != "PUBLIC" && p.Visibility != "FOLLOWERS" && p.Visibility != "AGENT_ONLY" {
		return command.Rejected(e, "INVALID_POST_VISIBILITY", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_visibility", nil)
	}
	if p.AuthorType != "USER" && p.AuthorType != "AGENT" && p.AuthorType != "MERCHANT" && p.AuthorType != "PLATFORM_SPECIAL" {
		return command.Rejected(e, "INVALID_AUTHOR_TYPE", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_author_type", nil)
	}
	// 作者身份：actor 必须是已认证会话的用户（server 已用 session 权威覆盖）
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "POST_AUTHOR_MISMATCH", "AUTHORIZATION", "AFTER_USER_ACTION", "localnet.post_author_mismatch", nil)
	}
	post := Post{
		ID:                newID("post_"),
		AuthorType:        p.AuthorType,
		AuthorID:          e.Actor.ID,
		AuthorDisplayName: p.AuthorDisplayName,
		Body:              p.Body,
		MediaRefs:         append([]PostMediaRef(nil), p.MediaRefs...),
		Visibility:        p.Visibility,
		CityScope:         p.CityScope,
		Status:            "PUBLISHED",
		ContextRefs:       mergeClassificationRefs(p.ContextRefs, classifyPostFallback(p.Body)),
		SceneType:         p.SceneType,
		CreatedAt:         s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("PostCreated", "Post", post.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, post.CreatedAt, map[string]any{
		"authorType":  post.AuthorType,
		"body":        post.Body,
		"visibility":  post.Visibility,
		"contextRefs": post.ContextRefs,
		"note":        "Post 发布永不自动创建 Task；Intent 经 DM / 显式 Need 涌现",
	})}
	if len(p.MediaRefs) > 0 && s.mediaLookup != nil {
		ids := make([]string, 0, len(p.MediaRefs))
		for _, ref := range p.MediaRefs {
			ids = append(ids, ref.MediaAssetID)
		}
		if err := s.mediaLookup.AuthorizeForPost(ctx, ids, e.Principal.ID, p.Visibility); err != nil {
			return command.Rejected(e, "POST_MEDIA_NOT_PUBLISHABLE", "BUSINESS_STATE", "SAFE_RETRY", "localnet.media_not_publishable", nil)
		}
	}
	if err := s.repository.CreatePost(ctx, post); err != nil {
		return command.Rejected(e, "POST_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.post_create_failed", nil)
	}
	go s.enrichPostClassification(post)
	return command.Accepted(e, "Post", post.ID, 1, post.Status, eventRefs(domainEvents))
}

// ---------- ListFeedPosts ----------
// PRD §8 Feed 管道：Eligibility → Hydration → Utility Ranking → Diversity/Mixing。
// 排序目标是有用的本地连接，不是最大化纯互动。
//
// R15.14：LocationContext (顶 chip) 真的影响 feed — 客户端在
// payload.viewingCity 传当前 location.city（如 “河内” /
// “胡志明市” / “岘港”）。服务器拿这个与 Post.CityScope
// （发布时手动设置 / 默认为 actor city）逐项做严格匹配；空
// string 或字段未传都走 “不过滤" 路径，保证向后兼容。
// 响应里 echo viewingCity + unfiltered，让客户端顶 chip 与
// 实际过滤状态对得上。

type listFeedPayload struct {
	// R15.14：viewer 当前的本地范围 city. 空 = 不过滤。
	ViewingCity string `json:"viewingCity"`
}

func (s *Service) listFeed(ctx context.Context, e command.Envelope) command.Result {
	posts, err := s.repository.Snapshot(ctx)
	if err != nil {
		return command.Rejected(e, "FEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.feed_read_failed", nil)
	}
	// R15.14：LocationContext 过滤 — 从 payload.viewingCity 读 viewer
	// 当前城市。空 = 不过滤 (legacy 行为)。
	var payload listFeedPayload
	_ = decode(e.Payload, &payload) // payload 可选, decode 失败静默退到全量
	filterCity := strings.TrimSpace(payload.ViewingCity)
	unfiltered := filterCity == ""
	// Utility Ranking：时间衰减 + 上下文关联权重（Eligibility：PUBLIC + 可见）
	feed := make([]Post, 0, len(posts))
	for _, p := range posts {
		if p.Status != "PUBLISHED" {
			continue
		}
		if p.Visibility != "PUBLIC" && p.Visibility != "FOLLOWERS" {
			continue
		}
		// Follow-graph authorization is not implemented yet. Fail closed instead
		// of treating FOLLOWERS as public; authors may still see their own post.
		if p.Visibility == "FOLLOWERS" && p.AuthorID != e.Actor.ID {
			continue
		}
		// R15.14：LocationContext 过滤。
		// 严格匹配 CityScope == viewingCity 是有意为之 — 用户在
		// 河内选了“只显示河内帖子”，在 HCMC 的帖子不会错误地出现。
		// 帖子没设 CityScope 的全量出现，避免误伤。
		if !unfiltered {
			postCity := strings.TrimSpace(p.CityScope)
			if postCity != "" && postCity != filterCity {
				continue
			}
		}
		// 归一 nil 切片 → 空数组，保证读模型 JSON 永远输出 [] 而非 null（客户端 zod fail-closed）
		if p.MediaRefs == nil {
			p.MediaRefs = []PostMediaRef{}
		}
		if p.ContextRefs == nil {
			p.ContextRefs = []ContextRef{}
		}
		feed = append(feed, p)
	}
	// 按 Utility 排序（时间衰减为主，P0 简化）
	sort.Slice(feed, func(i, j int) bool {
		return feed[i].CreatedAt.After(feed[j].CreatedAt)
	})
	// R14 §16.5：Feed Read Model Hydrate 媒体（mediaLookup + READY 过滤）
	feedMedia := make(map[string][]PostMediaItem, len(feed))
	// R15.15 P1: Memory → Feed 反馈重构。R15.13 P4 用了
	// globalBackdrop (CityScope="", SceneType="") 一色走全 Feed —
	// Post aggregate 不携带 SceneType 不得不这么干。本轮 Post
	// 有了 SceneType 字段后, 按 (CityScope, SceneType) 去
	// GetAestheticBackdrop 取，该函数在 SceneService 里
	// ListAllMemories 后 filter 出同 (city, sceneType) 的子集再
	// 算众数。补一个 feed-level cache (N 个 post 调同一份同样
	// (city, sceneType) 背景的只查一次)，避免 N+1 调用。
	type backdropKey struct {
		City  string
		Scene string
	}
	backdropCache := map[backdropKey]string{}
	getBackdrop := func(city, scene string) string {
		if s.sceneAesthetic == nil {
			return ""
		}
		key := backdropKey{City: city, Scene: scene}
		if cached, ok := backdropCache[key]; ok {
			return cached
		}
		bd, err := s.sceneAesthetic.GetAestheticBackdrop(ctx, city, scene)
		if err != nil || bd.SampleCount < 2 || bd.Hex == "" {
			// 与 P4 一致: 不到 2 个 sample 不能推 (黑骀 会误“在一
			// 个老帖”里查到一个颜色推到全 Feed), 返空。
			backdropCache[key] = ""
			return ""
		}
		backdropCache[key] = bd.Hex
		return bd.Hex
	}
	if s.mediaLookup != nil {
		for _, p := range feed {
			if len(p.MediaRefs) == 0 {
				continue
			}
			ids := make([]string, 0, len(p.MediaRefs))
			for _, ref := range p.MediaRefs {
				ids = append(ids, ref.MediaAssetID)
			}
			assets, err := s.mediaLookup.LookupMediaAssets(ctx, ids)
			if err != nil {
				continue
			}
			items := make([]PostMediaItem, 0, len(p.MediaRefs))
			for _, ref := range p.MediaRefs {
				info, ok := assets[ref.MediaAssetID]
				if !ok {
					continue
				}
				// R10 Gate E：只有 READY 媒体可作正式 Feed Media
				if info.ProcessingStatus != "READY" {
					continue
				}
				if info.ModerationStatus != "APPROVED" || info.VisibilityClass != p.Visibility {
					continue
				}
				aspect := 0.0
				if info.Height > 0 {
					aspect = float64(info.Width) / float64(info.Height)
				}
				items = append(items, PostMediaItem{
					MediaAssetID:      info.MediaAssetID,
					MediaType:         info.MediaType,
					ThumbnailURL:      info.ThumbnailURL,
					PlaybackURL:       info.PlaybackURL,
					PlaceholderURL:    info.PlaceholderURL,
					FeedURL:           info.FeedURL,
					Feed2xURL:         info.Feed2xURL,
					Feed2xHintURL:     info.Feed2xHintURL,
					Feed2xNaturalURL:  info.Feed2xNaturalURL,
					GalleryURL:        info.GalleryURL,
					DominantColorHex:  info.DominantColorHex,
					OriginalAvailable: info.OriginalAvailable,
					Width:             info.Width,
					Height:            info.Height,
					AspectRatio:       aspect,
					DurationMs:        info.DurationMs,
					ProcessingStatus:  info.ProcessingStatus,
					ModerationStatus:  info.ModerationStatus,
					SortOrder:         ref.SortOrder,
					CompositionHint:   info.CompositionHint,
				})
				// R15.15 P1: 按 (post.CityScope, post.SceneType) 取
				// 背景 — 不同场景类型的帖背景会不一样。相同 (city,
				// scene) 只调一次场景服务 (见 getBackdrop 内的
				// backdropCache)。
				if len(items) == 1 {
					if bd := getBackdrop(p.CityScope, p.SceneType); bd != "" {
						items[0].SceneAestheticBackdrop = bd
					}
				}
			}
			if len(items) > 0 {
				feedMedia[p.ID] = items
			}
		}
	}
	return acceptedWithPayload(e, "Post", "", 0, "FEED", map[string]any{
		"posts": feed,
		"media": feedMedia, // postId → []PostMediaItem（R14 Adaptive Media Rail Read Model）
		"note":  "实时交易事实（价格/可用性/商家状态）由读取时 Hydration 获得，Post 不是 Source of Truth；媒体只呈现 READY",
		// R15.14：回显过滤状态，顶 chip 与实际过滤同源
		"viewingCity": filterCity,
		"unfiltered":  unfiltered,
	}, nil)
}

// ---------- CreateNeedFromPost ----------
// PRD §10：Post → DM → Need 显式转化；归因保留完整 lineage；不覆盖 Agent 自带来源。

type createNeedFromPostPayload struct {
	PostID             string `json:"postId"`
	DemandOrigin       string `json:"demandOrigin"` // PROXY_OWNED | PARTNER | AGENT_OWNED
	SourceType         string `json:"sourceType"`   // POST_TO_DM | PROFILE_LINK | FOLLOW_REPLY | DIRECT
	ConversationID     string `json:"conversationId"`
	CreatorPrincipalID string `json:"creatorPrincipalId"`
	NeedSummary        string `json:"needSummary"`
}

func (s *Service) createNeedFromPost(ctx context.Context, e command.Envelope) command.Result {
	var p createNeedFromPostPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_NEED_FROM_POST", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_need_from_post", nil)
	}
	if p.DemandOrigin == "" {
		p.DemandOrigin = "PROXY_OWNED"
	}
	if p.SourceType == "" {
		p.SourceType = "POST_TO_DM"
	}
	post, err := s.repository.GetPost(ctx, p.PostID)
	if errors.Is(err, ErrPostNotFound) {
		return command.Rejected(e, "POST_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "localnet.post_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "POST_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.post_read_failed", nil)
	}
	lineage := DemandAttributionLineage{
		DemandOrigin:       p.DemandOrigin,
		SourceType:         p.SourceType,
		SourceID:           p.PostID,
		CreatorPrincipalID: p.CreatorPrincipalID,
		ConversationID:     p.ConversationID,
	}
	record := NeedFromPost{
		NeedID:    newID("need_"),
		PostID:    p.PostID,
		Lineage:   lineage,
		CreatedAt: s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("NeedCreatedFromPost", "Post", post.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, record.CreatedAt, map[string]any{
		"needId":       record.NeedID,
		"postId":       p.PostID,
		"demandOrigin": p.DemandOrigin,
		"sourceType":   p.SourceType,
		"note":         "归因保留完整 lineage；Proxy 不得为抢归因覆盖 Agent 自带客户来源",
	})}
	if err := s.repository.SaveNeedFromPost(ctx, record); err != nil {
		return command.Rejected(e, "NEED_FROM_POST_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.need_from_post_failed", nil)
	}
	return acceptedWithPayload(e, "Post", post.ID, 1, post.Status, map[string]any{
		"needId":  record.NeedID,
		"lineage": lineage,
	}, domainEvents)
}

// ---------- RecordAttribution ----------
// PRD §10：独立记录归因（供 demandnetwork Ops 页的 52/31/17 分布统计）。

type recordAttributionPayload struct {
	DemandOrigin string `json:"demandOrigin"`
	SourceType   string `json:"sourceType"`
	SourceID     string `json:"sourceId"`
	NeedID       string `json:"needId"`
	OrderID      string `json:"orderId"`
}

func (s *Service) recordAttribution(ctx context.Context, e command.Envelope) command.Result {
	var p recordAttributionPayload
	if !decode(e.Payload, &p) || p.DemandOrigin == "" {
		return command.Rejected(e, "INVALID_ATTRIBUTION", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_attribution", nil)
	}
	if p.DemandOrigin != "PROXY_OWNED" && p.DemandOrigin != "PARTNER" && p.DemandOrigin != "AGENT_OWNED" {
		return command.Rejected(e, "INVALID_DEMAND_ORIGIN", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_demand_origin", nil)
	}
	lineage := DemandAttributionLineage{
		DemandOrigin: p.DemandOrigin,
		SourceType:   p.SourceType,
		SourceID:     p.SourceID,
		NeedID:       p.NeedID,
		OrderID:      p.OrderID,
	}
	record := NeedFromPost{
		NeedID:    p.NeedID,
		Lineage:   lineage,
		CreatedAt: s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("AttributionRecorded", "DemandAttribution", newID("attr_"), 1, e.Principal.ID, e.CorrelationID, e.CommandID, record.CreatedAt, map[string]any{
		"demandOrigin": p.DemandOrigin,
		"sourceType":   p.SourceType,
		"needId":       p.NeedID,
	})}
	if err := s.repository.SaveNeedFromPost(ctx, record); err != nil {
		return command.Rejected(e, "ATTRIBUTION_RECORD_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.attribution_failed", nil)
	}
	return command.Accepted(e, "DemandAttribution", newID("attr_"), 1, "RECORDED", eventRefs(domainEvents))
}

// ---------- C1 Event Stream：读侧交互事件 ----------
// 这些事件是 Analytics 不是 Truth（R10 Gate J）：记录但不影响业务状态。

type interactionPayload struct {
	TargetType string `json:"targetType"` // PROFILE | POST | CANDIDATE | AGENT
	TargetID   string `json:"targetId"`
	NeedID     string `json:"needId"`
}

func (s *Service) recordProfileOpen(ctx context.Context, e command.Envelope) command.Result {
	return s.appendInteraction(ctx, e, "PROFILE_OPEN", "PROFILE")
}

func (s *Service) recordPostImpression(ctx context.Context, e command.Envelope) command.Result {
	return s.appendInteraction(ctx, e, "POST_IMPRESSION", "POST")
}

func (s *Service) recordCandidateViewed(ctx context.Context, e command.Envelope) command.Result {
	return s.appendInteraction(ctx, e, "CANDIDATE_VIEWED", "CANDIDATE")
}

func (s *Service) shortlistAgent(ctx context.Context, e command.Envelope) command.Result {
	return s.appendInteraction(ctx, e, "AGENT_SHORTLISTED", "AGENT")
}

func (s *Service) appendInteraction(ctx context.Context, e command.Envelope, eventType, defaultTargetType string) command.Result {
	var p interactionPayload
	if !decode(e.Payload, &p) || p.TargetID == "" {
		return command.Rejected(e, "INVALID_INTERACTION", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_interaction", nil)
	}
	targetType := p.TargetType
	if targetType == "" {
		targetType = defaultTargetType
	}
	now := s.clock.Now().UTC()
	ie := InteractionEvent{
		EventID:    newID("evt_"),
		EventType:  eventType,
		ActorID:    e.Actor.ID,
		TargetType: targetType,
		TargetID:   p.TargetID,
		NeedID:     p.NeedID,
		CreatedAt:  now,
	}
	domainEvents := []event.DomainEvent{event.New(eventType, "InteractionEvent", ie.EventID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"actorId":    ie.ActorID,
		"targetType": ie.TargetType,
		"targetId":   ie.TargetID,
		"note":       "交互事件是 Analytics 不是 Truth（R10 Gate J）",
	})}
	if err := s.repository.AppendInteractionEvent(ctx, ie); err != nil {
		return command.Rejected(e, "INTERACTION_RECORD_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.interaction_failed", nil)
	}
	return command.Accepted(e, "InteractionEvent", ie.EventID, 1, "RECORDED", eventRefs(domainEvents))
}

// ListInteractionEvents：事件流查询（按 actor 过滤 + limit）。
func (s *Service) listInteractionEvents(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		ActorID string `json:"actorId"`
		Limit   int    `json:"limit"`
	}
	_ = decode(e.Payload, &p)
	actorID := p.ActorID
	if actorID == "" {
		actorID = e.Actor.ID
	}
	if p.Limit <= 0 || p.Limit > 100 {
		p.Limit = 50
	}
	events, err := s.repository.ListInteractionEvents(ctx, actorID, p.Limit)
	if err != nil {
		return command.Rejected(e, "INTERACTION_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.interaction_list_failed", nil)
	}
	return acceptedWithPayload(e, "InteractionEvent", "", 0, "LIST", map[string]any{
		"actorId": actorID,
		"events":  events,
		"note":    "事件流：订单是怎么来的，从这里可回放",
	}, nil)
}

// ---------- helpers ----------

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return false
	}
	return true
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
