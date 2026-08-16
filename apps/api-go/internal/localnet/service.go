package localnet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// Local Life Social Demand Network（R13 PRD Chapter21H）。
// 核心规则：
//  1. Post = durable content（body/media/visibility/status/context_refs）
//  2. 实时交易事实（价格/可用性/商家状态）由读取时 Hydration 获得——Post 不是 Source of Truth
//  3. Post 发布永不自动创建 Task；Intent 经 DM / 显式 Need 涌现
//  4. DemandAttributionLineage：订单来源完整链路，不覆盖 Agent 自带来源

// Post 是本地动态的 durable content（PRD §4 Post Canonical Contract）。
type Post struct {
	ID            string        `json:"postId"`
	AuthorType    string        `json:"authorType"` // USER | AGENT | MERCHANT | PLATFORM_SPECIAL
	AuthorID      string        `json:"authorId"`
	Body          string        `json:"body"`
	MediaRefs     []PostMediaRef `json:"mediaRefs"` // R14 Adaptive Media Rail：带 sortOrder
	Visibility    string        `json:"visibility"` // PUBLIC | FOLLOWERS | AGENT_ONLY
	CityScope     string        `json:"cityScope,omitempty"`
	Status        string        `json:"status"` // DRAFT | PUBLISHED | HIDDEN | REMOVED
	ContextRefs   []ContextRef  `json:"contextRefs"`
	CreatedAt     time.Time     `json:"createdAt"`
}

// PostMediaRef 是 Post 的媒体引用（R14 §16.5：sort_order = 作者确认的展示顺序）。
type PostMediaRef struct {
	MediaAssetID string `json:"mediaAssetId"`
	SortOrder    int    `json:"sortOrder"`
}

// PostMediaItem 是 Feed Read Model 的 Hydrate 媒体项（R14 §16.5 + R10 Gate F）。
type PostMediaItem struct {
	MediaAssetID     string `json:"mediaAssetId"`
	MediaType        string `json:"mediaType"` // IMAGE | VIDEO
	ThumbnailURL     string `json:"thumbnailUrl,omitempty"`
	PlaybackURL      string `json:"playbackUrl,omitempty"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	AspectRatio      float64 `json:"aspectRatio"`
	DurationMs       int64  `json:"durationMs,omitempty"`
	ProcessingStatus string `json:"processingStatus"`
	SortOrder        int    `json:"sortOrder"`
}

// MediaLookup 是媒体详情查询接口（由 media 包实现，注入避免循环依赖）。
type MediaLookup interface {
	LookupMediaAssets(ctx context.Context, ids []string) (map[string]MediaAssetInfo, error)
}

// MediaAssetInfo 是媒体资产的可读视图（READY 过滤在调用方）。
type MediaAssetInfo struct {
	MediaAssetID     string
	MediaType        string
	ThumbnailURL     string
	PlaybackURL      string
	Width            int
	Height           int
	DurationMs       int64
	ProcessingStatus string
}

// ContextRef 是 Post 的结构化上下文关联（PRD §4 PostContextRef）。
type ContextRef struct {
	ContextType  string `json:"contextType"` // AGENT_PROFILE | SERVICE_SKU | ROUTE | VENUE | ACTIVITY | TASK_TEMPLATE
	ContextID    string `json:"contextId"`
	RelationType string `json:"relationType,omitempty"`
}

// DemandAttributionLineage 是订单来源完整链路（PRD §10）。
type DemandAttributionLineage struct {
	DemandOrigin      string `json:"demandOrigin"`      // PROXY_OWNED | PARTNER | AGENT_OWNED
	SourceType        string `json:"sourceType"`        // POST_TO_DM | PROFILE_LINK | FOLLOW_REPLY | DIRECT | ...
	SourceID          string `json:"sourceId"`
	CreatorPrincipalID string `json:"creatorPrincipalId,omitempty"`
	ConversationID    string `json:"conversationId,omitempty"`
	NeedID            string `json:"needId,omitempty"`
	OrderID           string `json:"orderId,omitempty"`
}

// NeedFromPost 是 Post → Need 的显式转化记录。
type NeedFromPost struct {
	NeedID     string `json:"needId"`
	PostID     string `json:"postId"`
	Lineage    DemandAttributionLineage `json:"lineage"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Repository interface {
	CreatePost(ctx context.Context, post Post) error
	GetPost(ctx context.Context, id string) (Post, error)
	UpdatePost(ctx context.Context, post Post, expectedVersion int) error
	Snapshot(ctx context.Context) ([]Post, error)
	SaveNeedFromPost(ctx context.Context, record NeedFromPost) error
	SnapshotNeeds(ctx context.Context) ([]NeedFromPost, error)
}

var (
	ErrPostNotFound   = errors.New("post not found")
	ErrVersionConflict = errors.New("post version conflict")
)

type MemoryRepository struct {
	mu    sync.Mutex
	posts map[string]Post
	needs []NeedFromPost
	events []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{posts: make(map[string]Post)}
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

func clonePost(post Post) Post {
	post.MediaRefs = append([]PostMediaRef(nil), post.MediaRefs...)
	post.ContextRefs = append([]ContextRef(nil), post.ContextRefs...)
	return post
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	mediaLookup MediaLookup
	clock      clock.Clock
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

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
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
	case "CreatePost", "ListFeedPosts", "CreateNeedFromPost", "RecordAttribution":
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
	default:
		return command.Rejected(e, "LOCAL_NET_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "localnet.unsupported_command", nil)
	}
}

// ---------- CreatePost ----------
// PRD §4/§11：Post = durable content；发布永不自动创建 Task。

type createPostPayload struct {
	AuthorType  string        `json:"authorType"`
	Body        string        `json:"body"`
	MediaRefs   []PostMediaRef `json:"mediaRefs"` // R14：{mediaAssetId, sortOrder}，≤6
	Visibility  string        `json:"visibility"`
	CityScope   string        `json:"cityScope"`
	ContextRefs []ContextRef  `json:"contextRefs"`
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
	// R14 §16.1：P0 max = 6 Media/Post；超过不静默截断
	if len(p.MediaRefs) > 6 {
		return command.Rejected(e, "POST_MEDIA_LIMIT_EXCEEDED", "VALIDATION", "AFTER_USER_ACTION", "localnet.post_media_limit", map[string]any{"max": 6, "got": len(p.MediaRefs)})
	}
	if p.Visibility == "" {
		p.Visibility = "PUBLIC"
	}
	if p.AuthorType != "USER" && p.AuthorType != "AGENT" && p.AuthorType != "MERCHANT" && p.AuthorType != "PLATFORM_SPECIAL" {
		return command.Rejected(e, "INVALID_AUTHOR_TYPE", "VALIDATION", "AFTER_USER_ACTION", "localnet.invalid_author_type", nil)
	}
	// 作者身份：actor 必须是已认证会话的用户（server 已用 session 权威覆盖）
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "POST_AUTHOR_MISMATCH", "AUTHORIZATION", "AFTER_USER_ACTION", "localnet.post_author_mismatch", nil)
	}
	post := Post{
		ID:          newID("post_"),
		AuthorType:  p.AuthorType,
		AuthorID:    e.Actor.ID,
		Body:        p.Body,
		MediaRefs:   append([]PostMediaRef(nil), p.MediaRefs...),
		Visibility:  p.Visibility,
		CityScope:   p.CityScope,
		Status:      "PUBLISHED",
		ContextRefs: append([]ContextRef(nil), p.ContextRefs...),
		CreatedAt:   s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("PostCreated", "Post", post.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, post.CreatedAt, map[string]any{
		"authorType": post.AuthorType,
		"body":       post.Body,
		"visibility": post.Visibility,
		"contextRefs": post.ContextRefs,
		"note":       "Post 发布永不自动创建 Task；Intent 经 DM / 显式 Need 涌现",
	})}
	if err := s.repository.CreatePost(ctx, post); err != nil {
		return command.Rejected(e, "POST_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.post_create_failed", nil)
	}
	return command.Accepted(e, "Post", post.ID, 1, post.Status, eventRefs(domainEvents))
}

// ---------- ListFeedPosts ----------
// PRD §8 Feed 管道：Eligibility → Hydration → Utility Ranking → Diversity/Mixing。
// 排序目标是有用的本地连接，不是最大化纯互动。

func (s *Service) listFeed(ctx context.Context, e command.Envelope) command.Result {
	posts, err := s.repository.Snapshot(ctx)
	if err != nil {
		return command.Rejected(e, "FEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.feed_read_failed", nil)
	}
	// Utility Ranking：时间衰减 + 上下文关联权重（Eligibility：PUBLIC + 可见）
	feed := make([]Post, 0, len(posts))
	for _, p := range posts {
		if p.Status != "PUBLISHED" {
			continue
		}
		if p.Visibility != "PUBLIC" && p.Visibility != "FOLLOWERS" {
			continue
		}
		feed = append(feed, p)
	}
	// 按 Utility 排序（时间衰减为主，P0 简化）
	sort.Slice(feed, func(i, j int) bool {
		return feed[i].CreatedAt.After(feed[j].CreatedAt)
	})
	// R14 §16.5：Feed Read Model Hydrate 媒体（mediaLookup + READY 过滤）
	feedMedia := make(map[string][]PostMediaItem, len(feed))
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
				aspect := 0.0
				if info.Height > 0 {
					aspect = float64(info.Width) / float64(info.Height)
				}
				items = append(items, PostMediaItem{
					MediaAssetID:     info.MediaAssetID,
					MediaType:        info.MediaType,
					ThumbnailURL:     info.ThumbnailURL,
					PlaybackURL:      info.PlaybackURL,
					Width:            info.Width,
					Height:           info.Height,
					AspectRatio:      aspect,
					DurationMs:       info.DurationMs,
					ProcessingStatus: info.ProcessingStatus,
					SortOrder:        ref.SortOrder,
				})
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
	}, nil)
}

// ---------- CreateNeedFromPost ----------
// PRD §10：Post → DM → Need 显式转化；归因保留完整 lineage；不覆盖 Agent 自带来源。

type createNeedFromPostPayload struct {
	PostID          string `json:"postId"`
	DemandOrigin    string `json:"demandOrigin"` // PROXY_OWNED | PARTNER | AGENT_OWNED
	SourceType      string `json:"sourceType"`   // POST_TO_DM | PROFILE_LINK | FOLLOW_REPLY | DIRECT
	ConversationID  string `json:"conversationId"`
	CreatorPrincipalID string `json:"creatorPrincipalId"`
	NeedSummary     string `json:"needSummary"`
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
		"needId":      record.NeedID,
		"postId":      p.PostID,
		"demandOrigin": p.DemandOrigin,
		"sourceType":  p.SourceType,
		"note":        "归因保留完整 lineage；Proxy 不得为抢归因覆盖 Agent 自带客户来源",
	})}
	if err := s.repository.SaveNeedFromPost(ctx, record); err != nil {
		return command.Rejected(e, "NEED_FROM_POST_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.need_from_post_failed", nil)
	}
	return acceptedWithPayload(e, "Post", post.ID, 1, post.Status, map[string]any{
		"needId":   record.NeedID,
		"lineage":  lineage,
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
