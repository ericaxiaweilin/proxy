package localnet

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
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

func cursorHMACKey() []byte {
	if key := strings.TrimSpace(os.Getenv("PROXY_CURSOR_HMAC_KEY")); key != "" {
		return []byte(key)
	}
	if dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); dbURL != "" {
		sum := sha256.Sum256([]byte(dbURL))
		return sum[:16]
	}
	return []byte("proxy-dev-cursor-hmac-key")
}

func signCursor(payload []byte) string {
	mac := hmac.New(sha256.New, cursorHMACKey())
	mac.Write(payload)
	sig := hex.EncodeToString(mac.Sum(nil)[:8])
	return base64.RawURLEncoding.EncodeToString(payload) + "." + sig
}

func verifyCursor(cursor string) ([]byte, bool) {
	parts := strings.Split(cursor, ".")
	if len(parts) != 2 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	mac := hmac.New(sha256.New, cursorHMACKey())
	mac.Write(raw)
	expected := hex.EncodeToString(mac.Sum(nil)[:8])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return nil, false
	}
	return raw, true
}

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
	Animated          bool    `json:"animated,omitempty"`
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
	Animated          bool
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

type FeedPageRepository interface {
	ListFeedPage(ctx context.Context, actorID string, before time.Time, beforeID string, limit int) ([]Post, error)
}

// MentionRepository is the optional narrow read used by the profile TAGGED tab.
//
// Why this exists: TAGGED used to be derived on the client by scanning a single
// feed page (25 posts) for "@handle". Anything older than that page silently
// vanished, so a user could be mentioned fifty times and see two. The match has
// to run over every published post, which only the store can do — hence a
// repository method rather than another client-side filter.
//
// handle is passed WITHOUT the leading "@". The implementation is responsible
// for matching whole-handle occurrences only (so "@thanh" never matches
// "@thanh2") and for applying the same visibility and mute rules as the feed.
type MentionRepository interface {
	ListPostsMentioning(ctx context.Context, actorID string, handle string, limit int) ([]Post, error)
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
			ContextRefs: []ContextRef{{ContextType: "REALITY_SCENE", ContextID: "westlake", RelationType: "FEATURED_AT"}, {ContextType: "SERVICE", ContextID: "城市同行"}, {ContextType: "ROUTE", ContextID: "轻松拍照路线"}, {ContextType: "VENUE", ContextID: "木光咖啡"}},
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
			ContextRefs:       []ContextRef{{ContextType: "REALITY_SCENE", ContextID: "westlake", RelationType: "FEATURED_AT"}, {ContextType: "SERVICE", ContextID: "城市同行"}, {ContextType: "AVAILABILITY", ContextID: "明天下午可接"}},
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
			ContextRefs:       []ContextRef{{ContextType: "REALITY_SCENE", ContextID: "bonsaidon", RelationType: "FEATURED_AT"}, {ContextType: "ACTIVITY", ContextID: "用户活动"}, {ContextType: "QUOTE_POST", ContextID: "post_seed_linh_01"}},
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
			ContextRefs:       []ContextRef{{ContextType: "REALITY_SCENE", ContextID: "bonsaidon", RelationType: "FEATURED_AT"}, {ContextType: "VENUE", ContextID: "门店场景"}, {ContextType: "ACTIVITY", ContextID: "周六新店开业"}},
			CreatedAt:         now.Add(-30 * time.Minute),
		},
		// R15.22 增量 seed — 未登录访客应能看到丰富 feed. 增补 18 帖覆盖
		// 河内 / 胡志明市 / 岘港 三城 × 多种 scene × 带/不带 city scope.
		// CityScope 故意保留原始中文, 验证 canonicalCityKey() 能否跨别名匹配.
		{
			ID: "post_seed_hn_cafe_01", AuthorType: "AGENT", AuthorID: "agent_phuong", AuthorDisplayName: "Phương",
			Body:       "老街区 Bún Chả 店推荐, 坐在门口吃能看到街边老人们下棋, 烟火气很足。",
			Visibility: "PUBLIC", CityScope: "hn", SceneType: "FOOD", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "老街小吃"}, {ContextType: "SERVICE", ContextID: "本地推荐"}},
			CreatedAt:   now.Add(-4 * time.Hour),
		},
		{
			ID: "post_seed_hn_cafe_02", AuthorType: "USER", AuthorID: "user_khoa", AuthorDisplayName: "Khoa",
			Body:       "想找一个有 co-working 区的咖啡店过周末, 有网络 + 安静 + 饮品好喝三要素. 推荐一下吧。",
			Visibility: "PUBLIC", CityScope: "Hanoi", SceneType: "COFFEE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "找咖啡店"}},
			CreatedAt:   now.Add(-5 * time.Hour),
		},
		{
			ID: "post_seed_hn_photo_01", AuthorType: "AGENT", AuthorID: "agent_nam", AuthorDisplayName: "Nam",
			Body:       "今天下午我会在火车街拍老式火车, 预计 15:30 经过。有摄影兴趣的朋友可以同在。",
			MediaRefs:  []PostMediaRef{{MediaAssetID: "seed_media_train_street", SortOrder: 0}},
			Visibility: "PUBLIC", CityScope: "河内", SceneType: "PHOTO", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "街头摄影"}},
			CreatedAt:   now.Add(-6 * time.Hour),
		},
		{
			ID: "post_seed_hn_walk_01", AuthorType: "AGENT", AuthorID: "agent_trang", AuthorDisplayName: "Trang",
			Body:       "晚上 18:00 想找 1-2 个人一起走老城区, 边走边聊. 不太拍照, 主要散步 + 试试路边小饭馆。",
			Visibility: "PUBLIC", CityScope: "河内", SceneType: "WALK", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "SERVICE", ContextID: "城市同行"}, {ContextType: "AVAILABILITY", ContextID: "今晚可接"}},
			CreatedAt:   now.Add(-7 * time.Hour),
		},
		{
			ID: "post_seed_hn_market_01", AuthorType: "MERCHANT", AuthorID: "merchant_dongxuan", AuthorDisplayName: "Đồng Xuân Market",
			Body:       "周末 8:00-18:00 老市场开市, 手工编织包和本地艺术品都上新. 不接受退换, 但价格是最实在的。",
			Visibility: "PUBLIC", CityScope: "河内", SceneType: "MARKET", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "传统市场"}},
			CreatedAt:   now.Add(-8 * time.Hour),
		},
		{
			ID: "post_seed_hn_bike_01", AuthorType: "USER", AuthorID: "user_long", AuthorDisplayName: "Long",
			Body:       "周日早上 6:30 想在还剑湖跑圈 5km, 配速 6'30, 走 4 走快 1 间隔. 一起越冷越起劲。",
			Visibility: "PUBLIC", CityScope: "河内", SceneType: "BIKE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "晨跑"}},
			CreatedAt:   now.Add(-9 * time.Hour),
		},
		{
			ID: "post_seed_hcm_cafe_01", AuthorType: "AGENT", AuthorID: "agent_hcm_minh", AuthorDisplayName: "Minh (HCM)",
			Body:       "Bitexco 金融塔附近一栋老宅改的咖啡馆, 安静不商业, 适合午后边坐边看老照片。",
			MediaRefs:  []PostMediaRef{{MediaAssetID: "seed_media_bitexco", SortOrder: 0}},
			Visibility: "PUBLIC", CityScope: "胡志明市", SceneType: "COFFEE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "老宅咖啡"}},
			CreatedAt:   now.Add(-3 * time.Hour),
		},
		{
			ID: "post_seed_hcm_food_01", AuthorType: "USER", AuthorID: "user_hcm_anh", AuthorDisplayName: "Anh",
			Body:       "晚上在 Bến Thành 夜市吃 Bánh Xèo 推荐一家, 加香草 + 豆芽卷着吃, 传统是这家的味道。",
			Visibility: "PUBLIC", CityScope: "HCM", SceneType: "FOOD", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "夜市"}, {ContextType: "SERVICE", ContextID: "本地推荐"}},
			CreatedAt:   now.Add(-4 * time.Hour),
		},
		{
			ID: "post_seed_hcm_photo_01", AuthorType: "AGENT", AuthorID: "agent_hcm_hoa", AuthorDisplayName: "Hoa",
			Body:       "明天 17:00 准备在阮惠步行街拍夜景, 带个小三脚架就行. 有兴趣同拍的欢迎拼拼。",
			Visibility: "PUBLIC", CityScope: "胡志明市", SceneType: "PHOTO", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "夜景拍"}},
			CreatedAt:   now.Add(-5 * time.Hour),
		},
		{
			ID: "post_seed_hcm_walk_01", AuthorType: "USER", AuthorID: "user_hcm_bao", AuthorDisplayName: "Bảo",
			Body:       "后天早上想走一遍西贡历史博物馆 + 圣母院 + 邮局老建筑, 主要看法殖时期建筑, 进度看感觉。",
			Visibility: "PUBLIC", CityScope: "胡志明市", SceneType: "WALK", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ROUTE", ContextID: "法殖建筑路线"}},
			CreatedAt:   now.Add(-6 * time.Hour),
		},
		{
			ID: "post_seed_hcm_river_01", AuthorType: "AGENT", AuthorID: "agent_hcm_truc", AuthorDisplayName: "Trúc",
			Body:       "今晚 19:00 西贡河游船晚餐, 4 人一桌, 每人 580k. 有 1 个位置. 想拼桌的可以谈。",
			Visibility: "PUBLIC", CityScope: "胡志明市", SceneType: "DINNER", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "游船拼桌"}},
			CreatedAt:   now.Add(-7 * time.Hour),
		},
		{
			ID: "post_seed_dn_beach_01", AuthorType: "AGENT", AuthorID: "agent_dn_anh", AuthorDisplayName: "Anh (Đà Nẵng)",
			Body:       "明天 6:00 美溪海滩跑步 6km, 越人越少. 想跑的小伙伴不挑配速, 一起说说话就好。",
			Visibility: "PUBLIC", CityScope: "岘港", SceneType: "BIKE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "海跑"}},
			CreatedAt:   now.Add(-8 * time.Hour),
		},
		{
			ID: "post_seed_dn_market_01", AuthorType: "MERCHANT", AuthorID: "merchant_dn_han", AuthorDisplayName: "Hàn Market",
			Body:       "今晚 18:00-22:00 韩市场夜市开市, 现场烤海鱼 + 手工饰品. 本地人和游客都欢迎。",
			Visibility: "PUBLIC", CityScope: "danang", SceneType: "MARKET", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "夜市"}},
			CreatedAt:   now.Add(-9 * time.Hour),
		},
		{
			ID: "post_seed_dn_photo_01", AuthorType: "AGENT", AuthorID: "agent_dn_vy", AuthorDisplayName: "Vy",
			Body:       "明天中午 12:30 准备过海云岭拍迷雾, 高原云海最不稳. 我一个人去, 有摄影身体力的可以同。",
			Visibility: "PUBLIC", CityScope: "岘港", SceneType: "PHOTO", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ROUTE", ContextID: "海云岭摄路线"}},
			CreatedAt:   now.Add(-10 * time.Hour),
		},
		{
			ID: "post_seed_hn_general_01", AuthorType: "USER", AuthorID: "user_thuy", AuthorDisplayName: "Thưy",
			Body:       "刚到河内第一天, 有住在还剑湖附近的朋友明天中午一起吃粉吗? 蒙面不见不散。",
			Visibility: "PUBLIC", CityScope: "", SceneType: "FOOD", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "拼饭"}},
			CreatedAt:   now.Add(-11 * time.Hour),
		},
		{
			ID: "post_seed_hcm_general_01", AuthorType: "USER", AuthorID: "user_hcm_lan", AuthorDisplayName: "Lan",
			Body:       "周末想学越南春卷手工课, 有那位本地朋友有教程或想一起报名? 都在西贡区。",
			Visibility: "PUBLIC", CityScope: "", SceneType: "ACTIVITY", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "ACTIVITY", ContextID: "手工课"}},
			CreatedAt:   now.Add(-12 * time.Hour),
		},
		{
			ID: "post_seed_hn_cafe_03", AuthorType: "MERCHANT", AuthorID: "merchant_hn_giang", AuthorDisplayName: "Cafe Giảng",
			Body:       "鸡蛋咖啡本店 1946 年开始, 现在还是那个味道. 每天都开, 8:00-22:00. 欢迎来坐。",
			MediaRefs:  []PostMediaRef{{MediaAssetID: "seed_media_egg_coffee", SortOrder: 0}},
			Visibility: "PUBLIC", CityScope: "河内", SceneType: "COFFEE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "老字号"}},
			CreatedAt:   now.Add(-13 * time.Hour),
		},
		{
			ID: "post_seed_hcm_cafe_02", AuthorType: "MERCHANT", AuthorID: "merchant_hcm_la", AuthorDisplayName: "La Café",
			Body:       "新到 2 袋肯尼亚 AA, 颗颗手选, 炙热轻火. 限本周店内限量。",
			Visibility: "PUBLIC", CityScope: "hcmc", SceneType: "COFFEE", Status: "PUBLISHED",
			ContextRefs: []ContextRef{{ContextType: "VENUE", ContextID: "精品咖啡店"}},
			CreatedAt:   now.Add(-14 * time.Hour),
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
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID < result[j].ID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
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
	// authorNames resolves USER post display names from the verified
	// account profile (PROFILE-READ-001). Nil = legacy unwired behaviour
	// (client-supplied echo); production wiring always sets it.
	authorNames authorNameResolver
}

// authorNameResolver is the narrow consumer-side contract so localnet does
// not import the identity package.
type authorNameResolver interface {
	ResolveAuthorDisplayName(ctx context.Context, userAccountID string) (string, bool)
}

// SetAuthorNameResolver wires profile-backed author resolution.
func (s *Service) SetAuthorNameResolver(resolver authorNameResolver) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorNames = resolver
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
	case "CreatePost", "ListFeedPosts", "ListPostsByIds", "ListPostsMentioning", "CreateNeedFromPost", "RecordAttribution",
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
	case "ListPostsByIds":
		return s.listPostsByIds(ctx, e)
	case "ListPostsMentioning":
		return s.listPostsMentioning(ctx, e)
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

// resolvePostAuthorName implements PROFILE-READ-001 for USER posts: the
// display name always comes from the verified account profile, never from
// the client payload (which used to carry a hardcoded viewer-relative
// label). Other author types keep their caller-supplied names (agents,
// merchants and platform specials are server-driven). Without a wired
// resolver the legacy payload echo applies.
func resolvePostAuthorName(resolver authorNameResolver, ctx context.Context, authorType, actorID, payloadName string) string {
	if authorType != "USER" {
		return payloadName
	}
	if resolver == nil {
		return payloadName
	}
	if name, ok := resolver.ResolveAuthorDisplayName(ctx, actorID); ok {
		return name
	}
	return ""
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
		AuthorDisplayName: resolvePostAuthorName(s.authorNames, ctx, p.AuthorType, e.Actor.ID, p.AuthorDisplayName),
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
// PRD §8 Feed 管道。ALL 是全部可见公开帖文，默认 createdAt DESC、
// postId ASC；LocationContext 只作为元数据和显式“附近”筛选依据。

// ---------- ListPostsByIds ----------

// ListPostsByIds 按 ID 批量取帖子。
//
// 收藏夹、回复的父帖这类场景手里只有 postId。之前只能从时间流里「捞」——
// 于是收藏一条老帖，只要它不在动态流前 25 条里就永远不出现，用户会以为
// 收藏丢了。这里给一个按 ID 直取的读法。
//
// 可见性口径与 listFeed 完全一致，并且 fail-closed：
//   - 只取 PUBLISHED；
//   - PUBLIC 人人可见；FOLLOWERS 只有作者本人可见（关注图谱授权还没做，
//     不能因为「被谁收藏了」就把别人的 followers-only 帖子漏出来）；
//   - 取不到的 ID 直接跳过（帖子可能已删），不报错、不补假数据；
//   - 保持请求顺序、去重、最多 100 个。
func (s *Service) listPostsByIds(ctx context.Context, e command.Envelope) command.Result {
	var request struct {
		PostIDs []string `json:"postIds"`
	}
	if !decode(e.Payload, &request) {
		return command.Rejected(e, "INVALID_LIST_POSTS_BY_IDS", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_list_posts_by_ids", nil)
	}
	const maxPostIDs = 100
	posts := make([]Post, 0, len(request.PostIDs))
	seen := make(map[string]struct{}, len(request.PostIDs))
	for _, rawID := range request.PostIDs {
		if len(posts) >= maxPostIDs {
			break
		}
		id := strings.TrimSpace(rawID)
		if id == "" {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		post, err := s.repository.GetPost(ctx, id)
		if err != nil {
			continue
		}
		if post.Status != "PUBLISHED" {
			continue
		}
		if post.Visibility != "PUBLIC" && post.Visibility != "FOLLOWERS" {
			continue
		}
		if post.Visibility == "FOLLOWERS" && post.AuthorID != e.Actor.ID {
			continue
		}
		// 归一 nil 切片 → 空数组，保证读模型 JSON 永远输出 [] 而非 null
		if post.MediaRefs == nil {
			post.MediaRefs = []PostMediaRef{}
		}
		if post.ContextRefs == nil {
			post.ContextRefs = []ContextRef{}
		}
		posts = append(posts, post)
	}
	return acceptedWithPayload(e, "Post", "", 0, "POSTS_BY_IDS", map[string]any{
		"posts": posts,
		"media": s.hydratePostMedia(ctx, posts),
	}, nil)
}

// normalizeMentionHandle 归一化一个 @handle：去掉前后空白与所有前导 "@"，返回
// 小写形式与是否可用。空 handle 不可用 —— 调用方必须据此拒绝，而不是退化成
// 「匹配所有帖子」（那会让 TAGGED 变成整个动态流）。
func normalizeMentionHandle(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimLeft(trimmed, "@")
	trimmed = strings.ToLower(trimmed)
	if trimmed == "" || len(trimmed) > 60 {
		return "", false
	}
	return trimmed, true
}

// isHandleByte 报告 body[index] 是否属于 handle 字符集；越界视为「不是」。
func isHandleByte(body string, index int) bool {
	if index < 0 || index >= len(body) {
		return false
	}
	c := body[index]
	return c == '_' || c == '.' ||
		(c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
}

// containsMentionHandle 判断 body 里是否出现了完整的 @handle。
//
// 为什么要边界判断：客户端原来是 strings.Contains(body, "@thanh")，于是
// "@thanh2" 会被当成提到了 @thanh —— 用户会在自己的 TAGGED 里看到跟自己
// 毫无关系的帖子。handle 的字符集按 profile 的约定是 [a-z0-9_.]（大小写不敏感），
// 因此前后只要不是这些字符就算一次完整提及。
func containsMentionHandle(body, handle string) bool {
	if handle == "" {
		return false
	}
	lowered := strings.ToLower(body)
	needle := "@" + handle
	offset := 0
	for offset <= len(lowered) {
		index := strings.Index(lowered[offset:], needle)
		if index < 0 {
			return false
		}
		start := offset + index
		end := start + len(needle)
		if !isHandleByte(lowered, start-1) && !isHandleByte(lowered, end) {
			return true
		}
		offset = start + 1
	}
	return false
}

// mentionHandleCharset 是 handle 的合法字符类（profile 约定：小写字母、数字、
// 下划线、点）。containsMentionHandle 和 MentionRegex 必须共用它 —— 两边一旦
// 不一致，就会出现「SQL 捞出来了 Go 又滤掉」或者反过来的静默不一致。
const mentionHandleCharset = "a-z0-9_."

// MentionRegex 返回「完整提及 @handle」的 POSIX 正则，配合 Postgres 的 `~*`
// 使用（大小写不敏感）。handle 必须已经过 normalizeMentionHandle。
//
// 用正则而不是 LIKE '%@handle%'，是因为 LIKE 会把 "@thanh2" 也算成提到了
// "@thanh"，这正是客户端旧实现的老毛病。
func MentionRegex(handle string) string {
	var escaped strings.Builder
	for _, r := range handle {
		switch r {
		// POSIX ERE 元字符，逐个转义成字面量。**只**转义这些：给普通字母加
		// 反斜杠会造出 \A / \b 之类的锚点或转义序列，把正则整个改意。
		case '.', '+', '*', '?', '(', ')', '[', ']', '{', '}', '^', '$', '|', '\\':
			escaped.WriteByte('\\')
		}
		escaped.WriteRune(r)
	}
	return "(^|[^" + mentionHandleCharset + "])@" + escaped.String() + "([^" + mentionHandleCharset + "]|$)"
}

// listPostsMentioning 支撑个人主页的 TAGGED tab：「提到我的帖子」。
//
// 为什么要有这个命令：TAGGED 原来是客户端拿**一页**动态（25 条）做
// strings.Contains 筛出来的 —— 比你这一页更早的提及直接消失，用户会以为
// 没人提到过自己。要完整就必须在服务端扫全量已发布帖子。
//
// 可见性口径与动态流完全一致且 fail-closed：
//   - 只取 PUBLISHED；PUBLIC 人人可见，FOLLOWERS 只有作者本人可见；
//   - 排除被自己静音的作者的帖子（与动态流一致，否则静音形同虚设）；
//   - 排除自己发的帖子（「自己提到自己」不是 TAGGED 的语义）；
//   - 匹配是整 handle 的，不是子串（@thanh 不匹配 @thanh2）。
func (s *Service) listPostsMentioning(ctx context.Context, e command.Envelope) command.Result {
	var request struct {
		Handle string `json:"handle"`
		Limit  int    `json:"limit"`
	}
	if !decode(e.Payload, &request) {
		return command.Rejected(e, "INVALID_LIST_POSTS_MENTIONING", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_list_posts_mentioning", nil)
	}
	handle, ok := normalizeMentionHandle(request.Handle)
	if !ok {
		// fail-closed：没有可用的 handle 就返回空，绝不退化成「返回全部帖子」。
		return acceptedWithPayload(e, "Post", "", 0, "POSTS_MENTIONING", map[string]any{
			"posts": []Post{}, "media": map[string][]PostMediaItem{}, "hasMore": false,
		}, nil)
	}
	if request.Limit <= 0 {
		request.Limit = 30
	}
	if request.Limit > 50 {
		request.Limit = 50
	}
	var (
		posts []Post
		err   error
	)
	if mentions, ok := s.repository.(MentionRepository); ok {
		posts, err = mentions.ListPostsMentioning(ctx, e.Actor.ID, handle, request.Limit+1)
	} else {
		// 内存仓（无 DATABASE_URL 的 smoke 路径）没有索引可查，退回全量快照后在
		// Go 侧过滤；语义与 SQL 路径一致。
		var snapshot []Post
		snapshot, err = s.repository.Snapshot(ctx)
		if err == nil {
			for _, p := range snapshot {
				if containsMentionHandle(p.Body, handle) {
					posts = append(posts, p)
				}
			}
			sort.Slice(posts, func(i, j int) bool {
				if posts[i].CreatedAt.Equal(posts[j].CreatedAt) {
					return posts[i].ID < posts[j].ID
				}
				return posts[i].CreatedAt.After(posts[j].CreatedAt)
			})
		}
	}
	if err != nil {
		return command.Rejected(e, "MENTION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.mention_read_failed", nil)
	}
	matched := make([]Post, 0, len(posts))
	for _, p := range posts {
		// SQL 路径已经在 WHERE 里过了一遍，这里再判一次是纵深防御：只要有一处
		// 实现漏掉可见性，TAGGED 就会漏出别人的 followers-only 帖子。
		if p.Status != "PUBLISHED" {
			continue
		}
		if p.Visibility != "PUBLIC" && p.Visibility != "FOLLOWERS" {
			continue
		}
		if p.Visibility == "FOLLOWERS" && p.AuthorID != e.Actor.ID {
			continue
		}
		if p.AuthorID == e.Actor.ID {
			continue
		}
		if !containsMentionHandle(p.Body, handle) {
			continue
		}
		if p.MediaRefs == nil {
			p.MediaRefs = []PostMediaRef{}
		}
		if p.ContextRefs == nil {
			p.ContextRefs = []ContextRef{}
		}
		matched = append(matched, p)
	}
	hasMore := len(matched) > request.Limit
	if hasMore {
		matched = matched[:request.Limit]
	}
	return acceptedWithPayload(e, "Post", "", 0, "POSTS_MENTIONING", map[string]any{
		"posts":   matched,
		"media":   s.hydratePostMedia(ctx, matched),
		"hasMore": hasMore,
	}, nil)
}

// hydratePostMedia 把一批 Post 的媒体引用 hydrate 成读模型：只呈现 READY 且
// APPROVED、可见性与帖子一致的媒体，并按 (CityScope, SceneType) 补场景背景色。
//
// 从 listFeed 里抽出来，让「按 ID 取帖子」（ListPostsByIds）走同一套媒体口径 ——
// 否则同一个帖子在动态流里和在收藏网格里会长得不一样。
func (s *Service) hydratePostMedia(ctx context.Context, feed []Post) map[string][]PostMediaItem {
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
		// One page-wide hydration call. The durable media repository implements
		// this as two bounded SQL queries (assets + variants), eliminating the
		// previous posts × media N+1 pattern.
		mediaIDs := make([]string, 0)
		seenMediaIDs := make(map[string]struct{})
		for _, p := range feed {
			for _, ref := range p.MediaRefs {
				if _, seen := seenMediaIDs[ref.MediaAssetID]; !seen {
					seenMediaIDs[ref.MediaAssetID] = struct{}{}
					mediaIDs = append(mediaIDs, ref.MediaAssetID)
				}
			}
		}
		assets, lookupErr := s.mediaLookup.LookupMediaAssets(ctx, mediaIDs)
		if lookupErr != nil {
			assets = map[string]MediaAssetInfo{}
		}
		for _, p := range feed {
			if len(p.MediaRefs) == 0 {
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
					Animated:          info.Animated,
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
	return feedMedia
}

// postMatchesSearch 是 feed 搜索的唯一判定点（SEARCH-CORPUS-001）。
//
// 之前只匹配 Body，但搜索框自己写的是「搜索人、机会、活动、情报…」，
// 客户端两处 filter 也都宣称能按作者名/城市搜 —— 于是出现「代码看起来支持、
// 实际搜不到」：server 先把正文不含关键词的帖子全部丢掉，客户端那两段
// 再怎么 OR authorDisplayName 都永远匹配不到东西。
//
// 现在匹配「用户能看见的东西」：正文、作者展示名、城市。
// 刻意**不含** ContextRefs —— 它是 classifyPostFallback 从正文派生的
// （见 createPost），让搜索命中派生标签会返回用户根本没写过的词，
// 那是噪音不是功能。
//
// 语义与 apps/mobile/src/localnet-client.ts 的 searchFieldsOf 保持一致：
// 两边不一致时，客户端 filter 只会把 server 已认可的帖子再丢掉一遍，
// 表现为「服务端明明匹配了，列表里却没有」。
func postMatchesSearch(p Post, loweredQuery string) bool {
	if loweredQuery == "" {
		return true
	}
	if strings.Contains(strings.ToLower(p.Body), loweredQuery) {
		return true
	}
	if p.AuthorDisplayName != "" && strings.Contains(strings.ToLower(p.AuthorDisplayName), loweredQuery) {
		return true
	}
	if p.CityScope != "" && strings.Contains(strings.ToLower(p.CityScope), loweredQuery) {
		return true
	}
	return false
}

func (s *Service) listFeed(ctx context.Context, e command.Envelope) command.Result {
	var request struct {
		Cursor string `json:"cursor"`
		Limit  int    `json:"limit"`
		// R15.94: search query — server 侧 filter (body 包含 search, case-insensitive).
		Search string `json:"search"`
	}
	_ = decode(e.Payload, &request) // legacy malformed payloads keep first-page behavior
	search := strings.ToLower(strings.TrimSpace(request.Search))
	if request.Limit <= 0 {
		request.Limit = 25
	}
	if request.Limit > 50 {
		request.Limit = 50
	}
	var cursor struct {
		CreatedAt time.Time `json:"createdAt"`
		PostID    string    `json:"postId"`
	}
	if request.Cursor != "" {
		if raw, ok := verifyCursor(request.Cursor); ok {
			_ = json.Unmarshal(raw, &cursor)
		} else if strings.Contains(request.Cursor, ".") {
			// 带签名的游标验签失败 → 视为篡改，拒绝而非回退首屏（防缓存投毒）
			return command.Rejected(e, "INVALID_CURSOR", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_cursor", nil)
		} else if raw, err := base64.RawURLEncoding.DecodeString(request.Cursor); err == nil {
			// 兼容旧明文游标（滚动升级期），下个版本收紧为仅验签
			_ = json.Unmarshal(raw, &cursor)
		} else {
			return command.Rejected(e, "INVALID_CURSOR", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_cursor", nil)
		}
	}
	var posts []Post
	var err error
	if pageRepository, ok := s.repository.(FeedPageRepository); ok {
		posts, err = pageRepository.ListFeedPage(ctx, e.Actor.ID, cursor.CreatedAt, cursor.PostID, request.Limit+1)
	} else {
		posts, err = s.repository.Snapshot(ctx)
	}
	if err != nil {
		return command.Rejected(e, "FEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.feed_read_failed", nil)
	}
	// ALL 是全局公开时间流；LocationContext 不参与 eligibility。
	feed := make([]Post, 0, len(posts))
	for _, p := range posts {
		if p.Status != "PUBLISHED" {
			continue
		}
		if p.Visibility != "PUBLIC" && p.Visibility != "FOLLOWERS" {
			continue
		}
		// SEARCH-CORPUS-001: 匹配字段见 postMatchesSearch（正文 / 作者展示名 / 城市）。
		if !postMatchesSearch(p, search) {
			continue
		}
		// Follow-graph authorization is not implemented yet. Fail closed instead
		// of treating FOLLOWERS as public; authors may still see their own post.
		if p.Visibility == "FOLLOWERS" && p.AuthorID != e.Actor.ID {
			continue
		}
		if !cursor.CreatedAt.IsZero() && (p.CreatedAt.After(cursor.CreatedAt) || (p.CreatedAt.Equal(cursor.CreatedAt) && p.ID <= cursor.PostID)) {
			continue
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
		if feed[i].CreatedAt.Equal(feed[j].CreatedAt) {
			return feed[i].ID < feed[j].ID
		}
		return feed[i].CreatedAt.After(feed[j].CreatedAt)
	})
	hasMore := len(feed) > request.Limit
	if hasMore {
		feed = feed[:request.Limit]
	}
	nextCursor := ""
	if hasMore && len(feed) > 0 {
		last := feed[len(feed)-1]
		raw, _ := json.Marshal(map[string]any{"createdAt": last.CreatedAt, "postId": last.ID})
		nextCursor = signCursor(raw)
	}
	feedMedia := s.hydratePostMedia(ctx, feed)
	return acceptedWithPayload(e, "Post", "", 0, "FEED", map[string]any{
		"posts": feed,
		"media": feedMedia, // postId → []PostMediaItem（R14 Adaptive Media Rail Read Model）
		"note":  "实时交易事实（价格/可用性/商家状态）由读取时 Hydration 获得，Post 不是 Source of Truth；媒体只呈现 READY",
		// R15.14：回显过滤状态，顶 chip 与实际过滤同源
		"unfiltered": true,
		"nextCursor": nextCursor,
		"hasMore":    hasMore,
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

// xiaomeiSeedPosts 是 5 小美的开屏帖（AI-POSTS-001）：一人一条，带写真。
// AuthorType AI_NATIVE（feed 卡有 AI 生成标注）；Upsert 幂等，可重跑。
func xiaomeiSeedPosts(now time.Time) []Post {
	seed := func(id, authorID, displayName, body, assetID string) Post {
		return Post{
			ID:                id,
			AuthorType:        "AI_NATIVE",
			AuthorID:          authorID,
			AuthorDisplayName: displayName,
			Body:              body,
			MediaRefs:         []PostMediaRef{{MediaAssetID: assetID, SortOrder: 0}},
			Visibility:        "PUBLIC",
			CityScope:         "Hanoi",
			Status:            "PUBLISHED",
			SceneType:         "PHOTO",
			CreatedAt:         now,
		}
	}
	return []Post{
		seed("post_xiaomei_001", "ai_001", "小美 · 周末企划", "本周六下午，西湖边那家能看日落的咖啡馆我替你们踩过点了，座位图在照片里。想去的举手，我来组局。", "seed_media_xiaomei_001"),
		seed("post_xiaomei_002", "ai_002", "小美 · 拍照季", "同款机位分享：在西湖拍晚霞，18:10 的光最好。这是我上周拍的，参数和站位都在照片里。", "seed_media_xiaomei_002"),
		seed("post_xiaomei_003", "ai_003", "小美 · 拍照搭子", "周六 15:00 还剑湖缺一位互拍搭子，我带反光板，你带笑就行。", "seed_media_xiaomei_003"),
		seed("post_xiaomei_004", "ai_004", "小美 · 餐厅尝鲜", "岚庭出了新菜，我昨晚替你们尝了第一轮。周五尝鲜局开 6 个名额，报名的私我。", "seed_media_xiaomei_004"),
		seed("post_xiaomei_005", "ai_005", "小美 · 饭局推荐", "周五晚饭局还差 2 位，西湖边上那家，有人一起吗？", "seed_media_xiaomei_005"),
	}
}

// SeedXiaomeiPosts 幂等写入 5 小美帖（AI-POSTS-001）。
// Upsert 语义：已存在覆盖同 id 行，不存在插入；绝不删任何行。
func (s *Service) SeedXiaomeiPosts(ctx context.Context) error {
	if s.repository == nil {
		return nil
	}
	now := s.clock.Now().UTC()
	for _, p := range xiaomeiSeedPosts(now) {
		if err := s.repository.UpsertPost(ctx, p); err != nil {
			return err
		}
	}
	return nil
}
