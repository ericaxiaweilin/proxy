package engagement

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

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// Post 互动（R14 Chapter21I §3 Social：Follow/Reply/Repost/Bookmark）。
// 互动是 lightweight 事实，不改变 Post durable content。

// Follow 是关注关系。
type Follow struct {
	FollowerID string    `json:"followerId"`
	FolloweeID string    `json:"followeeId"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Reaction 是轻量情绪反馈（点赞等）。
type Reaction struct {
	ID        string    `json:"reactionId"`
	PostID    string    `json:"postId"`
	ActorID   string    `json:"actorId"`
	Kind      string    `json:"kind"` // LIKE | LOVE | HELPFUL
	CreatedAt time.Time `json:"createdAt"`
}

// Reply 是帖子回复（可嵌套 Conversation）。
type Reply struct {
	ID        string    `json:"replyId"`
	PostID    string    `json:"postId"`
	ActorID   string    `json:"actorId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	// ActorDisplayName 是评论作者的展示名（FEED-REPLY-001）。它在读时由
	// profile 解析，既不落库也不接受客户端提供——客户端拿不到名字时只能
	// 退化成中性标签，绝不允许把 actorId 当成名字显示给用户。
	ActorDisplayName string `json:"actorDisplayName,omitempty"`
}

// Repost 是转发。
type Repost struct {
	ID        string    `json:"repostId"`
	PostID    string    `json:"postId"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

// R15.61 — UserRepliesList (反查该 user 的全部 reply posts)
type UserRepliesList struct {
	UserID  string        `json:"userId"`
	Replies []RepliedPost `json:"replies"`
	Count   int           `json:"count"`
}

type RepliedPost struct {
	ReplyID      string    `json:"replyId"`
	PostID       string    `json:"postId"`
	ParentPostID string    `json:"parentPostId"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"createdAt"`
}

// R15.62 — UserBookmarksList (反查该 user 的全部 bookmark posts)
type UserBookmarksList struct {
	UserID    string   `json:"userId"`
	Bookmarks []string `json:"bookmarks"`
	Count     int      `json:"count"`
}

// Bookmark 是收藏。
// R15.56 — PostPin: 置顶帖 (per user)
type PostPin struct {
	PinID     string    `json:"pinId"`
	OwnerID   string    `json:"ownerId"`
	PostID    string    `json:"postId"`
	CreatedAt time.Time `json:"createdAt"`
}

type Bookmark struct {
	ID        string    `json:"bookmarkId"`
	PostID    string    `json:"postId"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

type FeedPreference struct {
	ID        string    `json:"preferenceId"`
	ActorID   string    `json:"actorId"`
	PostID    string    `json:"postId"`
	AuthorID  string    `json:"authorId,omitempty"`
	Action    string    `json:"action"`
	CreatedAt time.Time `json:"createdAt"`
}

type PostReport struct {
	ID        string    `json:"reportId"`
	ActorID   string    `json:"actorId"`
	PostID    string    `json:"postId"`
	Reason    string    `json:"reason"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"createdAt"`
}

// MutedAuthor 是 R15.45 引入的"屏蔽作者"关系记录。
//
// 设计：与 FeedPreference.REDUCE_AUTHOR 区别：
//   - REDUCE_AUTHOR 是 feed 推荐信号（"少推 Ta"），算法层
//   - MuteAuthor 是关系层（"我屏蔽 Ta，全部看不到"），UI 层
//
// 二者都持久化，但 MuteAuthor 优先级更高 — 一旦 mute，feed 应
// 直接过滤（不展示任何 Ta 的 post），跟 REDUCE_AUTHOR 是否存在无关。
//
// 复合主键 (ActorID, AuthorID) — 重复 mute 同一作者幂等。
type MutedAuthor struct {
	ID        string    `json:"muteId"`
	ActorID   string    `json:"actorId"`
	AuthorID  string    `json:"authorId"`
	CreatedAt time.Time `json:"createdAt"`
}

// MutedAuthorView 是「我屏蔽的人」列表里的一行（MUTE-REVERSIBLE-001）。
//
// AuthorDisplayName 跟评论一样是**读时**用同一个 profile 解析器填的
// （见 withMutedAuthorNames）：客户端手里只有一个 authorId，除了这条读时
// 解析没有任何 id → 名字的通路，而屏蔽列表恰恰是「帖子全被过滤掉」的一群人，
// 所以没法像 feed 那样从帖子读模型里借名字。不回填名字的话，这个列表就只能
// 显示一串账号 id —— 那就等于让用户对着 id 猜该解除谁。
//
// 不复用 MutedAuthor 聚合本体：聚合是落库形态（含 actorId），读模型只该带
// 界面需要的东西，免得以后有人把 ActorDisplayName 也写进表里。
type MutedAuthorView struct {
	MuteID            string    `json:"muteId"`
	AuthorID          string    `json:"authorId"`
	CreatedAt         time.Time `json:"createdAt"`
	AuthorDisplayName string    `json:"authorDisplayName,omitempty"`
}

// MutedAuthorsList 是 ListMutedAuthors 的读模型（MUTE-REVERSIBLE-001）。
type MutedAuthorsList struct {
	ActorID      string            `json:"actorId"`
	MutedAuthors []MutedAuthorView `json:"mutedAuthors"`
	Count        int               `json:"count"`
}

// PostEngagement 是某帖子的互动汇总（读取视图）。
type PostEngagement struct {
	PostID     string `json:"postId"`
	Followed   bool   `json:"followed"`
	Reactions  int    `json:"reactions"`
	Replies    int    `json:"replies"`
	Reposts    int    `json:"reposts"`
	Bookmarked bool   `json:"bookmarked"`
	Reacted    bool   `json:"reacted"`
}

type Repository interface {
	AddFollow(ctx context.Context, f Follow) error
	RemoveFollow(ctx context.Context, followerID, followeeID string) (bool, error)
	CountFollowers(ctx context.Context, userID string) (int, error)
	CountFollowing(ctx context.Context, userID string) (int, error)
	IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error)
	SetReaction(ctx context.Context, r Reaction, active bool) (bool, error)
	AddReply(ctx context.Context, r Reply) error
	ListRepliesByPost(ctx context.Context, postID string, limit int) ([]Reply, error)
	AddRepost(ctx context.Context, r Repost) error
	AddBookmark(ctx context.Context, b Bookmark) error
	// R15.61 / R15.62 — 反查 user 的 reply / bookmark 列表 (profile 5-tab)
	ListRepliesByActor(ctx context.Context, actorID string, limit int) ([]Reply, error)
	ListBookmarksByActor(ctx context.Context, actorID string, limit int) ([]Bookmark, error)
	// R15.56 — 置顶: 幂等 (同一 user+post 重复 pin 返旧), 限 3 个上限
	AddPostPin(ctx context.Context, p PostPin) (PostPin, bool, error)
	RemovePostPin(ctx context.Context, ownerID, postID string) (bool, error)
	ListPinnedPosts(ctx context.Context, ownerID string) ([]string, error)
	AddFeedPreference(ctx context.Context, preference FeedPreference) error
	AddPostReport(ctx context.Context, report PostReport) error
	// AddMutedAuthor 幂等：同一 (ActorID, AuthorID) 重复 mute 返回已存在记录。
	// IsMuted 查 actor 是否屏蔽了 author（feed 过滤用）。
	AddMutedAuthor(ctx context.Context, mute MutedAuthor) (MutedAuthor, bool, error)
	IsMuted(ctx context.Context, actorID, authorID string) (bool, error)
	// MUTE-REVERSIBLE-001：RemoveMutedAuthor 解除屏蔽，返回是否真的删掉了
	// （false = 本来就没屏蔽，幂等）。ListMutedAuthors 按 created_at DESC
	// 列出 actor 屏蔽过的人，供「我屏蔽的人」界面把屏蔽解掉。
	//
	// 没有这两个方法时 MuteAuthor 是**单向**的：被屏蔽者的帖子被 feed 永久过滤，
	// 你再也点不到 Ta 的帖子菜单，于是没有任何入口能撤销 —— 一个只能进不能出的
	// 关系操作不是功能，是陷阱。
	RemoveMutedAuthor(ctx context.Context, actorID, authorID string) (bool, error)
	ListMutedAuthors(ctx context.Context, actorID string) ([]MutedAuthor, error)
	Engagement(ctx context.Context, postID string, viewerID ...string) (PostEngagement, error)
}

var ErrPostNotTracked = errors.New("post not tracked")

// R16.12 — engagement 写路径约束映射哨兵。
// PG 仓层把唯一/外键约束违例翻译成这些域错误, service 层据此返回业务拒绝码,
// 而不是让原始 23505/23503 毒死 dispatch 事务 (25P02 → 500 command_transaction_failed)。
var (
	ErrReactionAlreadyExists = errors.New("reaction already exists")
	ErrRepostAlreadyExists   = errors.New("repost already exists")
	ErrBookmarkAlreadyExists = errors.New("bookmark already exists")
	ErrPostNotFound          = errors.New("post not found")
)

type MemoryRepository struct {
	mu          sync.Mutex
	follows     map[string]Follow
	reactions   map[string]Reaction
	replies     map[string]Reply
	reposts     map[string]Repost
	bookmarks   map[string]Bookmark
	preferences map[string]FeedPreference
	reports     map[string]PostReport
	mutes       map[string]MutedAuthor // key = actorID + "|" + authorID
	pins        map[string]PostPin     // key = ownerID + "|" + postID (R15.56 幂等)
	pinOrder    map[string][]string    // key = ownerID → postIDs in pin order (R15.56)
	events      []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		pins:        make(map[string]PostPin),
		pinOrder:    make(map[string][]string),
		follows:     make(map[string]Follow),
		reactions:   make(map[string]Reaction),
		replies:     make(map[string]Reply),
		reposts:     make(map[string]Repost),
		bookmarks:   make(map[string]Bookmark),
		preferences: make(map[string]FeedPreference),
		reports:     make(map[string]PostReport),
		mutes:       make(map[string]MutedAuthor),
	}
}

func (r *MemoryRepository) AddFollow(_ context.Context, f Follow) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.follows[f.FollowerID+"|"+f.FolloweeID] = f
	return nil
}

// R15.54 — RemoveFollow: 幂等返 (true=删了, false=之前没有)
func (r *MemoryRepository) RemoveFollow(_ context.Context, followerID, followeeID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := followerID + "|" + followeeID
	if _, ok := r.follows[key]; !ok {
		return false, nil
	}
	delete(r.follows, key)
	return true, nil
}

// R15.54 — CountFollowers: 数 FolloweeID == userID 的 follow 数
func (r *MemoryRepository) CountFollowers(_ context.Context, userID string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, f := range r.follows {
		if f.FolloweeID == userID {
			count++
		}
	}
	return count, nil
}

// R15.54 — CountFollowing: 数 FollowerID == userID 的 follow 数
func (r *MemoryRepository) CountFollowing(_ context.Context, userID string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, f := range r.follows {
		if f.FollowerID == userID {
			count++
		}
	}
	return count, nil
}

// R15.54 — IsFollowing: actor 是否 follow 了 target
func (r *MemoryRepository) IsFollowing(_ context.Context, followerID, followeeID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.follows[followerID+"|"+followeeID]
	return ok, nil
}

// R15.56 — AddPostPin: 幂等返 (stored, created bool, error)
func (r *MemoryRepository) AddPostPin(_ context.Context, p PostPin) (PostPin, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := p.OwnerID + "|" + p.PostID
	if existing, ok := r.pins[key]; ok {
		return existing, false, nil // 幂等
	}
	r.pins[key] = p
	r.pinOrder[p.OwnerID] = append(r.pinOrder[p.OwnerID], p.PostID)
	return p, true, nil
}

// R15.56 — RemovePostPin: 幂等返 (true=删了, false=之前没有)
func (r *MemoryRepository) RemovePostPin(_ context.Context, ownerID, postID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := ownerID + "|" + postID
	if _, ok := r.pins[key]; !ok {
		return false, nil
	}
	delete(r.pins, key)
	// 维护 pinOrder: 过滤掉
	order := r.pinOrder[ownerID]
	for i, id := range order {
		if id == postID {
			r.pinOrder[ownerID] = append(order[:i], order[i+1:]...)
			break
		}
	}
	return true, nil
}

// R15.56 — ListPinnedPosts: 返 owner pin 顺序的 postIDs
func (r *MemoryRepository) ListPinnedPosts(_ context.Context, ownerID string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.pinOrder[ownerID]))
	copy(out, r.pinOrder[ownerID])
	return out, nil
}

// R15.61 — ListRepliesByActor: 返该 actor 的全部 reply (按 created_at DESC, 上限 limit)
func (r *MemoryRepository) ListRepliesByActor(_ context.Context, actorID string, limit int) ([]Reply, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Reply
	for _, rep := range r.replies {
		if rep.ActorID == actorID {
			out = append(out, rep)
		}
	}
	// 排序: 最新在前
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].CreatedAt.After(out[i].CreatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// R15.62 — ListBookmarksByActor: 返该 actor 的全部 bookmark (按 created_at DESC, 上限 limit)
func (r *MemoryRepository) ListBookmarksByActor(_ context.Context, actorID string, limit int) ([]Bookmark, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []Bookmark
	for _, bm := range r.bookmarks {
		if bm.ActorID == actorID {
			out = append(out, bm)
		}
	}
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].CreatedAt.After(out[i].CreatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *MemoryRepository) SetReaction(_ context.Context, re Reaction, active bool) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, existing := range r.reactions {
		if existing.PostID == re.PostID && existing.ActorID == re.ActorID {
			if !active {
				delete(r.reactions, id)
				return false, nil
			}
			return true, nil
		}
	}
	if !active {
		return false, nil
	}
	r.reactions[re.ID] = re
	return true, nil
}

func (r *MemoryRepository) AddReply(_ context.Context, re Reply) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.replies[re.ID] = re
	return nil
}

func (r *MemoryRepository) ListRepliesByPost(_ context.Context, postID string, limit int) ([]Reply, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Reply, 0)
	for _, reply := range r.replies {
		if reply.PostID == postID {
			out = append(out, reply)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

func (r *MemoryRepository) AddRepost(_ context.Context, re Repost) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.reposts {
		if existing.PostID == re.PostID && existing.ActorID == re.ActorID {
			return ErrRepostAlreadyExists
		}
	}
	r.reposts[re.ID] = re
	return nil
}

func (r *MemoryRepository) AddBookmark(_ context.Context, b Bookmark) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.bookmarks {
		if existing.PostID == b.PostID && existing.ActorID == b.ActorID {
			return ErrBookmarkAlreadyExists
		}
	}
	r.bookmarks[b.ID] = b
	return nil
}

func (r *MemoryRepository) AddFeedPreference(_ context.Context, preference FeedPreference) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.preferences[preference.ID] = preference
	return nil
}

func (r *MemoryRepository) AddPostReport(_ context.Context, report PostReport) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reports[report.ID] = report
	return nil
}

// AddMutedAuthor 幂等：同一 (ActorID, AuthorID) 重复 mute 返回已存在记录。
// 返回 (record, alreadyExisted, error) — alreadyExisted=true 时 record 是旧的。
func (r *MemoryRepository) AddMutedAuthor(_ context.Context, mute MutedAuthor) (MutedAuthor, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := mute.ActorID + "|" + mute.AuthorID
	if existing, ok := r.mutes[key]; ok {
		return existing, true, nil
	}
	r.mutes[key] = mute
	return mute, false, nil
}

func (r *MemoryRepository) IsMuted(_ context.Context, actorID, authorID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.mutes[actorID+"|"+authorID]
	return ok, nil
}

// RemoveMutedAuthor MUTE-REVERSIBLE-001 — 幂等解除屏蔽。
// 返回是否真的删掉了：false 表示本来就没屏蔽（重复 unmute 不报错）。
func (r *MemoryRepository) RemoveMutedAuthor(_ context.Context, actorID, authorID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := actorID + "|" + authorID
	if _, ok := r.mutes[key]; !ok {
		return false, nil
	}
	delete(r.mutes, key)
	return true, nil
}

// ListMutedAuthors MUTE-REVERSIBLE-001 — 列出 actor 屏蔽过的人，最新在前。
// 与 PG 的 ORDER BY created_at DESC 对齐；created_at 相同时用 ID 兜底，
// 保证顺序稳定（否则 map 遍历顺序会让同一个测试时红时绿）。
func (r *MemoryRepository) ListMutedAuthors(_ context.Context, actorID string) ([]MutedAuthor, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]MutedAuthor, 0, len(r.mutes))
	for _, mute := range r.mutes {
		if mute.ActorID == actorID {
			out = append(out, mute)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (r *MemoryRepository) Engagement(_ context.Context, postID string, viewerIDs ...string) (PostEngagement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := PostEngagement{PostID: postID}
	for _, re := range r.reactions {
		if re.PostID == postID {
			e.Reactions++
			if len(viewerIDs) > 0 && re.ActorID == viewerIDs[0] {
				e.Reacted = true
			}
		}
	}
	for _, re := range r.replies {
		if re.PostID == postID {
			e.Replies++
		}
	}
	for _, re := range r.reposts {
		if re.PostID == postID {
			e.Reposts++
		}
	}
	return e, nil
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
	// authorNames 解析评论作者的展示名（profile 权威）。nil = 未接线，
	// 保持旧行为（只回 actorId）；生产接线必设（main.go）。
	authorNames authorNameResolver
}

// authorNameResolver 是消费侧窄接口，engagement 不需要 import identity。
type authorNameResolver interface {
	ResolveAuthorDisplayName(ctx context.Context, userAccountID string) (string, bool)
}

// SetAuthorNameResolver wires profile-backed reply author resolution.
func (s *Service) SetAuthorNameResolver(resolver authorNameResolver) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorNames = resolver
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "FollowProfile", "UnfollowProfile", "GetFollowCounts", "IsFollowing", "ReactToPost", "ReplyToPost", "ListPostReplies", "RepostPost", "BookmarkPost", "GetPostEngagement", "RecordFeedPreference", "ReportPost", "MuteAuthor", "UnmuteAuthor", "ListMutedAuthors", "PinPost", "UnpinPost", "ListPinnedPosts", "ListUserReplies", "ListUserBookmarks":
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
	case "FollowProfile":
		return s.follow(ctx, e)
	case "UnfollowProfile":
		return s.unfollow(ctx, e)
	case "GetFollowCounts":
		return s.getFollowCounts(ctx, e)
	case "IsFollowing":
		return s.isFollowing(ctx, e)
	case "ReactToPost":
		return s.react(ctx, e)
	case "ReplyToPost":
		return s.reply(ctx, e)
	case "ListPostReplies":
		return s.listPostReplies(ctx, e)
	case "RepostPost":
		return s.repost(ctx, e)
	case "BookmarkPost":
		return s.bookmark(ctx, e)
	case "GetPostEngagement":
		return s.engagement(ctx, e)
	case "RecordFeedPreference":
		return s.recordFeedPreference(ctx, e)
	case "ReportPost":
		return s.reportPost(ctx, e)
	case "MuteAuthor":
		return s.muteAuthor(ctx, e)
	case "UnmuteAuthor":
		return s.unmuteAuthor(ctx, e)
	case "ListMutedAuthors":
		return s.listMutedAuthors(ctx, e)
	case "PinPost":
		return s.pinPost(ctx, e)
	case "UnpinPost":
		return s.unpinPost(ctx, e)
	case "ListPinnedPosts":
		return s.listPinnedPosts(ctx, e)
	case "ListUserReplies":
		return s.listUserReplies(ctx, e)
	case "ListUserBookmarks":
		return s.listUserBookmarks(ctx, e)
	default:
		return command.Rejected(e, "ENGAGEMENT_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "engagement.unsupported_command", nil)
	}
}

// ---------- FollowProfile ----------

type followPayload struct {
	FolloweeID string `json:"followeeId"`
}

func (s *Service) follow(ctx context.Context, e command.Envelope) command.Result {
	var p followPayload
	if !decode(e.Payload, &p) || p.FolloweeID == "" {
		return command.Rejected(e, "INVALID_FOLLOW", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_follow", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "FOLLOW_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.follow_not_allowed", nil)
	}
	f := Follow{FollowerID: e.Actor.ID, FolloweeID: p.FolloweeID, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("ProfileFollowed", "Follow", e.Actor.ID+"|"+p.FolloweeID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, f.CreatedAt, map[string]any{
		"followerId": f.FollowerID,
		"followeeId": f.FolloweeID,
	})}
	if err := s.repository.AddFollow(ctx, f); err != nil {
		return command.Rejected(e, "FOLLOW_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.follow_failed", nil)
	}
	return command.Accepted(e, "Follow", e.Actor.ID+"|"+p.FolloweeID, 1, "FOLLOWING", eventRefs(domainEvents))
}

// ---------- UnfollowProfile (R15.54) ----------

func (s *Service) unfollow(ctx context.Context, e command.Envelope) command.Result {
	var p followPayload
	if !decode(e.Payload, &p) || p.FolloweeID == "" {
		return command.Rejected(e, "INVALID_UNFOLLOW", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_unfollow", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "UNFOLLOW_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.unfollow_not_allowed", nil)
	}
	if p.FolloweeID == e.Actor.ID {
		return command.Rejected(e, "CANNOT_UNFOLLOW_SELF", "VALIDATION", "AFTER_USER_ACTION", "engagement.cannot_unfollow_self", nil)
	}
	removed, err := s.repository.RemoveFollow(ctx, e.Actor.ID, p.FolloweeID)
	if err != nil {
		return command.Rejected(e, "UNFOLLOW_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.unfollow_failed", nil)
	}
	state := "UNFOLLOWED"
	if !removed {
		state = "NOT_FOLLOWING" // 幂等: 之前就没 follow
	}
	domainEvents := []event.DomainEvent{event.New("ProfileUnfollowed", "Follow", e.Actor.ID+"|"+p.FolloweeID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"followerId": e.Actor.ID,
		"followeeId": p.FolloweeID,
		"removed":    removed,
	})}
	return command.Accepted(e, "Follow", e.Actor.ID+"|"+p.FolloweeID, 1, state, eventRefs(domainEvents))
}

// ---------- GetFollowCounts (R15.54) ----------

type getFollowCountsPayload struct {
	UserID string `json:"userId"`
}

type followCounts struct {
	UserID    string `json:"userId"`
	Followers int    `json:"followers"`
	Following int    `json:"following"`
}

func (s *Service) getFollowCounts(ctx context.Context, e command.Envelope) command.Result {
	var p getFollowCountsPayload
	if !decode(e.Payload, &p) || p.UserID == "" {
		return command.Rejected(e, "INVALID_GET_FOLLOW_COUNTS", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_get_follow_counts", nil)
	}
	followers, err := s.repository.CountFollowers(ctx, p.UserID)
	if err != nil {
		return command.Rejected(e, "FOLLOW_COUNTS_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.follow_counts_failed", nil)
	}
	following, err := s.repository.CountFollowing(ctx, p.UserID)
	if err != nil {
		return command.Rejected(e, "FOLLOW_COUNTS_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.follow_counts_failed", nil)
	}
	return func() command.Result {
		accepted := command.Accepted(e, "FollowCounts", p.UserID, 1, "OK", nil)
		accepted.OperationRef = mustMarshal(followCounts{
			UserID:    p.UserID,
			Followers: followers,
			Following: following,
		})
		return accepted
	}()
}

// ---------- IsFollowing (R15.54) ----------

type isFollowingPayload struct {
	FollowerID string `json:"followerId"`
	FolloweeID string `json:"followeeID"`
}

type followingState struct {
	IsFollowing bool `json:"isFollowing"`
}

func (s *Service) isFollowing(ctx context.Context, e command.Envelope) command.Result {
	var p isFollowingPayload
	if !decode(e.Payload, &p) || p.FolloweeID == "" {
		return command.Rejected(e, "INVALID_IS_FOLLOWING", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_is_following", nil)
	}
	if p.FollowerID == "" {
		// 匿名查: 默认 false
		return func() command.Result {
			accepted := command.Accepted(e, "FollowingState", p.FollowerID+"|"+p.FolloweeID, 1, "OK", nil)
			accepted.OperationRef = mustMarshal(followingState{IsFollowing: false})
			return accepted
		}()
	}
	is, err := s.repository.IsFollowing(ctx, p.FollowerID, p.FolloweeID)
	if err != nil {
		return command.Rejected(e, "IS_FOLLOWING_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.is_following_failed", nil)
	}
	return func() command.Result {
		accepted := command.Accepted(e, "FollowingState", p.FollowerID+"|"+p.FolloweeID, 1, "OK", nil)
		accepted.OperationRef = mustMarshal(followingState{IsFollowing: is})
		return accepted
	}()
}

// ---------- ReactToPost ----------

type reactPayload struct {
	PostID string `json:"postId"`
	Kind   string `json:"kind"`
	Active *bool  `json:"active"`
}

func (s *Service) react(ctx context.Context, e command.Envelope) command.Result {
	var p reactPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_REACTION", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_reaction", nil)
	}
	if p.Kind == "" {
		p.Kind = "LIKE"
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "REACTION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.reaction_not_allowed", nil)
	}
	reaction := Reaction{ID: newID("rxn_"), PostID: p.PostID, ActorID: e.Actor.ID, Kind: p.Kind, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostReacted", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, reaction.CreatedAt, map[string]any{
		"reactionId": reaction.ID,
		"kind":       reaction.Kind,
		"actorId":    reaction.ActorID,
	})}
	desired := true
	if p.Active != nil {
		desired = *p.Active
	}
	active, err := s.repository.SetReaction(ctx, reaction, desired)
	if err != nil {
		// R16.12: PG 约束违例已翻译成域哨兵（FK 23503 → ErrPostNotFound），
		// 这里映射成业务码；点赞不存在的帖不允许泄成 500。
		if errors.Is(err, ErrPostNotFound) {
			return command.Rejected(e, "POST_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.post_not_found", map[string]any{"postId": p.PostID})
		}
		return command.Rejected(e, "REACTION_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.reaction_failed", nil)
	}
	state := "UNREACTED"
	if active {
		state = "REACTED"
	}
	view, err := s.repository.Engagement(ctx, p.PostID, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "ENGAGEMENT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.read_failed", nil)
	}
	return acceptedWithPayload(e, "Post", p.PostID, 1, state, map[string]any{"engagement": view}, domainEvents)
}

// ---------- ReplyToPost ----------

type replyPayload struct {
	PostID string `json:"postId"`
	Body   string `json:"body"`
}

func (s *Service) reply(ctx context.Context, e command.Envelope) command.Result {
	var p replyPayload
	if !decode(e.Payload, &p) || p.PostID == "" || p.Body == "" {
		return command.Rejected(e, "INVALID_REPLY", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_reply", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "REPLY_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.reply_not_allowed", nil)
	}
	reply := Reply{ID: newID("rep_"), PostID: p.PostID, ActorID: e.Actor.ID, Body: p.Body, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostReplied", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, reply.CreatedAt, map[string]any{
		"replyId": reply.ID,
		"body":    reply.Body,
	})}
	if err := s.repository.AddReply(ctx, reply); err != nil {
		// R16.12 — FK(post_id) 违例 → 帖子不存在, 返业务码而非 500
		if errors.Is(err, ErrPostNotFound) {
			return command.Rejected(e, "POST_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.post_not_found", map[string]any{"postId": p.PostID})
		}
		return command.Rejected(e, "REPLY_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.reply_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "REPLIED", eventRefs(domainEvents))
}

func (s *Service) listPostReplies(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		PostID string `json:"postId"`
		Limit  int    `json:"limit"`
	}
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_LIST_POST_REPLIES", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_list_post_replies", nil)
	}
	if p.Limit <= 0 || p.Limit > 50 {
		p.Limit = 20
	}
	replies, err := s.repository.ListRepliesByPost(ctx, p.PostID, p.Limit)
	if err != nil {
		return command.Rejected(e, "LIST_POST_REPLIES_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.list_post_replies_failed", nil)
	}
	if replies == nil {
		replies = []Reply{}
	}
	replies = s.withReplyActorNames(ctx, replies)
	return acceptedWithPayload(e, "Post", p.PostID, 1, "REPLIES_LISTED", map[string]any{"postId": p.PostID, "replies": replies, "count": len(replies)}, nil)
}

// withReplyActorNames 用 profile 名字填充每条评论的 ActorDisplayName
// （FEED-REPLY-001）。
//
// 名字是读时解析、按作者去重的：加这个字段之前写下的存量评论也能拿到名字，
// 不需要迁移；一条评论流只花「不同作者数」次查询，而不是「评论数」次。
// 解析不到的作者保持空串，由客户端降级成中性标签——服务端绝不回填 actorId。
func (s *Service) withReplyActorNames(ctx context.Context, replies []Reply) []Reply {
	if s.authorNames == nil || len(replies) == 0 {
		return replies
	}
	names := make(map[string]string, len(replies))
	for _, reply := range replies {
		actor := strings.TrimSpace(reply.ActorID)
		if actor == "" {
			continue
		}
		if _, seen := names[actor]; seen {
			continue
		}
		name, ok := s.authorNames.ResolveAuthorDisplayName(ctx, actor)
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name != "" && name != "你" {
			// "你" 是历史客户端硬编码写进 profile 的脏值（FEED-OWN-001），
			// 当成名字回给所有人会让别人的评论显示成"你"。
			names[actor] = name
		}
	}
	if len(names) == 0 {
		return replies
	}
	out := make([]Reply, 0, len(replies))
	for _, reply := range replies {
		if name, ok := names[strings.TrimSpace(reply.ActorID)]; ok {
			reply.ActorDisplayName = name
		}
		out = append(out, reply)
	}
	return out
}

// ---------- RepostPost ----------

type repostPayload struct {
	PostID string `json:"postId"`
}

func (s *Service) repost(ctx context.Context, e command.Envelope) command.Result {
	var p repostPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_REPOST", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_repost", nil)
	}
	r := Repost{ID: newID("rs_"), PostID: p.PostID, ActorID: e.Actor.ID, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostReposted", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, r.CreatedAt, map[string]any{
		"repostId": r.ID,
	})}
	if err := s.repository.AddRepost(ctx, r); err != nil {
		// R16.12 — UNIQUE(post_id, actor_id) / FK(post_id) → 业务码
		switch {
		case errors.Is(err, ErrRepostAlreadyExists):
			return command.Rejected(e, "ALREADY_REPOSTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.already_reposted", map[string]any{"postId": p.PostID})
		case errors.Is(err, ErrPostNotFound):
			return command.Rejected(e, "POST_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.post_not_found", map[string]any{"postId": p.PostID})
		}
		return command.Rejected(e, "REPOST_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.repost_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "REPOSTED", eventRefs(domainEvents))
}

// ---------- PinPost (R15.56) ----------

const maxPinnedPostsPerUser = 3

type pinPostPayload struct {
	PostID string `json:"postId"`
}

func (s *Service) pinPost(ctx context.Context, e command.Envelope) command.Result {
	var p pinPostPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_PIN", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_pin", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PIN_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.pin_not_allowed", nil)
	}
	existing, err := s.repository.ListPinnedPosts(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "PIN_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.pin_failed", nil)
	}
	// 幂等: 已经在列表里 → 返 ALREADY_PINNED
	for _, id := range existing {
		if id == p.PostID {
			return command.Accepted(e, "PostPin", e.Actor.ID+"|"+p.PostID, 1, "ALREADY_PINNED", nil)
		}
	}
	// 上限检查
	if len(existing) >= maxPinnedPostsPerUser {
		return command.Rejected(e, "PIN_LIMIT_EXCEEDED", "VALIDATION", "AFTER_USER_ACTION", "engagement.pin_limit_exceeded", map[string]any{"max": maxPinnedPostsPerUser})
	}
	pin := PostPin{
		PinID:     newID("pin_"),
		OwnerID:   e.Actor.ID,
		PostID:    p.PostID,
		CreatedAt: s.clock.Now().UTC(),
	}
	stored, created, err := s.repository.AddPostPin(ctx, pin)
	if err != nil {
		return command.Rejected(e, "PIN_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.pin_failed", nil)
	}
	state := "PINNED"
	if !created {
		state = "ALREADY_PINNED"
	}
	domainEvents := []event.DomainEvent{event.New("PostPinned", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, stored.CreatedAt, map[string]any{
		"pinId":   stored.PinID,
		"ownerId": stored.OwnerID,
		"postId":  stored.PostID,
	})}
	return command.Accepted(e, "PostPin", e.Actor.ID+"|"+p.PostID, 1, state, eventRefs(domainEvents))
}

// ---------- UnpinPost (R15.56) ----------

func (s *Service) unpinPost(ctx context.Context, e command.Envelope) command.Result {
	var p pinPostPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_UNPIN", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_unpin", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "UNPIN_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.unpin_not_allowed", nil)
	}
	removed, err := s.repository.RemovePostPin(ctx, e.Actor.ID, p.PostID)
	if err != nil {
		return command.Rejected(e, "UNPIN_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.unpin_failed", nil)
	}
	state := "UNPINNED"
	if !removed {
		state = "NOT_PINNED"
	}
	domainEvents := []event.DomainEvent{event.New("PostUnpinned", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"ownerId": e.Actor.ID,
		"postId":  p.PostID,
		"removed": removed,
	})}
	return command.Accepted(e, "PostPin", e.Actor.ID+"|"+p.PostID, 1, state, eventRefs(domainEvents))
}

// ---------- ListPinnedPosts (R15.56) ----------

type listPinnedPostsPayload struct {
	OwnerID string `json:"ownerId"`
}

type pinnedPostsList struct {
	OwnerID string   `json:"ownerId"`
	PostIDs []string `json:"postIds"`
	Count   int      `json:"count"`
}

func (s *Service) listPinnedPosts(ctx context.Context, e command.Envelope) command.Result {
	var p listPinnedPostsPayload
	if !decode(e.Payload, &p) || p.OwnerID == "" {
		return command.Rejected(e, "INVALID_LIST_PINNED", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_list_pinned", nil)
	}
	ids, err := s.repository.ListPinnedPosts(ctx, p.OwnerID)
	if err != nil {
		return command.Rejected(e, "LIST_PINNED_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.list_pinned_failed", nil)
	}
	if ids == nil {
		ids = []string{}
	}
	return func() command.Result {
		accepted := command.Accepted(e, "PostPin", p.OwnerID, 1, "LISTED", nil)
		accepted.OperationRef = mustMarshal(pinnedPostsList{
			OwnerID: p.OwnerID,
			PostIDs: ids,
			Count:   len(ids),
		})
		return accepted
	}()
}

// ---------- ListUserReplies (R15.61) ----------

type listUserRepliesPayload struct {
	UserID string `json:"userId"`
	Limit  int    `json:"limit"`
}

const defaultListUserRepliesLimit = 30
const maxListUserRepliesLimit = 100

func (s *Service) listUserReplies(ctx context.Context, e command.Envelope) command.Result {
	var p listUserRepliesPayload
	if !decode(e.Payload, &p) || p.UserID == "" {
		return command.Rejected(e, "INVALID_LIST_REPLIES", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_list_replies", nil)
	}
	limit := p.Limit
	if limit <= 0 {
		limit = defaultListUserRepliesLimit
	}
	if limit > maxListUserRepliesLimit {
		limit = maxListUserRepliesLimit
	}
	replies, err := s.repository.ListRepliesByActor(ctx, p.UserID, limit)
	if err != nil {
		return command.Rejected(e, "LIST_REPLIES_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.list_replies_failed", nil)
	}
	out := make([]RepliedPost, 0, len(replies))
	for _, r := range replies {
		out = append(out, RepliedPost{
			ReplyID: r.ID, PostID: r.PostID, ParentPostID: r.PostID, Body: r.Body, CreatedAt: r.CreatedAt,
		})
	}
	return func() command.Result {
		accepted := command.Accepted(e, "Reply", p.UserID, 1, "LISTED", nil)
		accepted.OperationRef = mustMarshal(UserRepliesList{UserID: p.UserID, Replies: out, Count: len(out)})
		return accepted
	}()
}

// ---------- ListUserBookmarks (R15.62) ----------

type listUserBookmarksPayload struct {
	UserID string `json:"userId"`
	Limit  int    `json:"limit"`
}

const defaultListUserBookmarksLimit = 60
const maxListUserBookmarksLimit = 200

func (s *Service) listUserBookmarks(ctx context.Context, e command.Envelope) command.Result {
	var p listUserBookmarksPayload
	if !decode(e.Payload, &p) || p.UserID == "" {
		return command.Rejected(e, "INVALID_LIST_BOOKMARKS", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_list_bookmarks", nil)
	}
	limit := p.Limit
	if limit <= 0 {
		limit = defaultListUserBookmarksLimit
	}
	if limit > maxListUserBookmarksLimit {
		limit = maxListUserBookmarksLimit
	}
	bms, err := s.repository.ListBookmarksByActor(ctx, p.UserID, limit)
	if err != nil {
		return command.Rejected(e, "LIST_BOOKMARKS_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.list_bookmarks_failed", nil)
	}
	ids := make([]string, 0, len(bms))
	for _, b := range bms {
		ids = append(ids, b.PostID)
	}
	return func() command.Result {
		accepted := command.Accepted(e, "Bookmark", p.UserID, 1, "LISTED", nil)
		accepted.OperationRef = mustMarshal(UserBookmarksList{UserID: p.UserID, Bookmarks: ids, Count: len(ids)})
		return accepted
	}()
}

// ---------- BookmarkPost ----------

type bookmarkPayload struct {
	PostID string `json:"postId"`
}

func (s *Service) bookmark(ctx context.Context, e command.Envelope) command.Result {
	var p bookmarkPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_BOOKMARK", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_bookmark", nil)
	}
	b := Bookmark{ID: newID("bm_"), PostID: p.PostID, ActorID: e.Actor.ID, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostBookmarked", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, b.CreatedAt, map[string]any{
		"bookmarkId": b.ID,
	})}
	if err := s.repository.AddBookmark(ctx, b); err != nil {
		// R16.12 — UNIQUE(post_id, actor_id) / FK(post_id) → 业务码
		switch {
		case errors.Is(err, ErrBookmarkAlreadyExists):
			return command.Rejected(e, "ALREADY_BOOKMARKED", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.already_bookmarked", map[string]any{"postId": p.PostID})
		case errors.Is(err, ErrPostNotFound):
			return command.Rejected(e, "POST_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "engagement.post_not_found", map[string]any{"postId": p.PostID})
		}
		return command.Rejected(e, "BOOKMARK_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.bookmark_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "BOOKMARKED", eventRefs(domainEvents))
}

// ---------- GetPostEngagement ----------

func (s *Service) engagement(ctx context.Context, e command.Envelope) command.Result {
	postID := e.Target.ID
	if postID == "" {
		var p struct {
			PostID string `json:"postId"`
		}
		if !decode(e.Payload, &p) || p.PostID == "" {
			return command.Rejected(e, "INVALID_ENGAGEMENT_QUERY", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_query", nil)
		}
		postID = p.PostID
	}
	eng, err := s.repository.Engagement(ctx, postID, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "ENGAGEMENT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.read_failed", nil)
	}
	return acceptedWithPayload(e, "Post", postID, 1, "ENGAGEMENT", map[string]any{
		"engagement": eng,
	}, nil)
}

func (s *Service) recordFeedPreference(ctx context.Context, e command.Envelope) command.Result {
	var payload struct {
		PostID   string `json:"postId"`
		AuthorID string `json:"authorId"`
		Action   string `json:"action"`
	}
	if !decode(e.Payload, &payload) || payload.PostID == "" || !oneOf(payload.Action, "NOT_INTERESTED", "REDUCE_TOPIC", "REDUCE_AUTHOR") {
		return command.Rejected(e, "INVALID_FEED_PREFERENCE", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_feed_preference", nil)
	}
	if payload.Action == "REDUCE_AUTHOR" && payload.AuthorID == "" {
		return command.Rejected(e, "INVALID_FEED_PREFERENCE", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_feed_preference", nil)
	}
	preference := FeedPreference{ID: newID("pref_"), ActorID: e.Actor.ID, PostID: payload.PostID, AuthorID: payload.AuthorID, Action: payload.Action, CreatedAt: s.clock.Now().UTC()}
	if err := s.repository.AddFeedPreference(ctx, preference); err != nil {
		return command.Rejected(e, "FEED_PREFERENCE_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.feed_preference_failed", nil)
	}
	return command.Accepted(e, "FeedPreference", preference.ID, 1, "RECORDED", nil)
}

func (s *Service) reportPost(ctx context.Context, e command.Envelope) command.Result {
	var payload struct {
		PostID string `json:"postId"`
		Reason string `json:"reason"`
	}
	if !decode(e.Payload, &payload) || payload.PostID == "" || !oneOf(payload.Reason, "SPAM", "HARASSMENT", "UNSAFE", "OTHER") {
		return command.Rejected(e, "INVALID_POST_REPORT", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_post_report", nil)
	}
	report := PostReport{ID: newID("report_"), ActorID: e.Actor.ID, PostID: payload.PostID, Reason: payload.Reason, State: "SUBMITTED", CreatedAt: s.clock.Now().UTC()}
	if err := s.repository.AddPostReport(ctx, report); err != nil {
		return command.Rejected(e, "POST_REPORT_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.post_report_failed", nil)
	}
	return command.Accepted(e, "PostReport", report.ID, 1, report.State, nil)
}

// ---------- MuteAuthor ----------

type muteAuthorPayload struct {
	AuthorID string `json:"authorId"`
}

func (s *Service) muteAuthor(ctx context.Context, e command.Envelope) command.Result {
	var p muteAuthorPayload
	if !decode(e.Payload, &p) || p.AuthorID == "" {
		return command.Rejected(e, "INVALID_MUTE_AUTHOR", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_mute_author", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "MUTE_AUTHOR_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "engagement.mute_author_not_allowed", nil)
	}
	if e.Actor.ID == p.AuthorID {
		return command.Rejected(e, "CANNOT_MUTE_SELF", "VALIDATION", "AFTER_USER_ACTION", "engagement.cannot_mute_self", nil)
	}
	mute := MutedAuthor{ID: newID("mute_"), ActorID: e.Actor.ID, AuthorID: p.AuthorID, CreatedAt: s.clock.Now().UTC()}
	stored, alreadyExisted, err := s.repository.AddMutedAuthor(ctx, mute)
	if err != nil {
		return command.Rejected(e, "MUTE_AUTHOR_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.mute_author_failed", nil)
	}
	// 幂等：重复 mute 不发新事件（避免 audit log 重复）。
	var eventRefsOut []string
	if !alreadyExisted {
		domainEvents := []event.DomainEvent{event.New("AuthorMuted", "MuteAuthor", stored.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, stored.CreatedAt, map[string]any{
			"actorId":  stored.ActorID,
			"authorId": stored.AuthorID,
		})}
		eventRefsOut = eventRefs(domainEvents)
	}
	state := "MUTED"
	if alreadyExisted {
		state = "ALREADY_MUTED"
	}
	return command.Accepted(e, "MutedAuthor", stored.ID, 1, state, eventRefsOut)
}

// ---------- UnmuteAuthor / ListMutedAuthors (MUTE-REVERSIBLE-001) ----------

type unmuteAuthorPayload struct {
	AuthorID string `json:"authorId"`
}

// unmuteAuthor 解除对某个作者的屏蔽。
//
// 幂等：本来没屏蔽也算成功（state=NOT_MUTED），只有真的删掉了才发 AuthorUnmuted
// 事件 —— 跟 muteAuthor 只在 !alreadyExisted 时发事件同一个道理，免得 audit log
// 里出现「解除了一条并不存在的屏蔽」。
//
// 为什么必须有这条命令：MuteAuthor 以前是**单向**的。被屏蔽者的帖子会被 feed
// 永久过滤（PG 侧是 NOT EXISTS 子查询），你再也点不到 Ta 的帖子菜单或头像，
// 于是没有任何入口能撤销这次屏蔽。一个只能进不能出的关系操作不是功能，是陷阱。
func (s *Service) unmuteAuthor(ctx context.Context, e command.Envelope) command.Result {
	var p unmuteAuthorPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.AuthorID) == "" {
		return command.Rejected(e, "INVALID_UNMUTE_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_unmute_payload", nil)
	}
	removed, err := s.repository.RemoveMutedAuthor(ctx, e.Actor.ID, p.AuthorID)
	if err != nil {
		return command.Rejected(e, "UNMUTE_AUTHOR_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.unmute_author_failed", nil)
	}
	state := "UNMUTED"
	if !removed {
		state = "NOT_MUTED"
	}
	var eventRefsOut []string
	if removed {
		domainEvents := []event.DomainEvent{event.New("AuthorUnmuted", "UnmuteAuthor", p.AuthorID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
			"actorId":  e.Actor.ID,
			"authorId": p.AuthorID,
		})}
		eventRefsOut = eventRefs(domainEvents)
	}
	return command.Accepted(e, "MutedAuthor", p.AuthorID, 1, state, eventRefsOut)
}

type listMutedAuthorsPayload struct {
	Limit int `json:"limit"`
}

const (
	defaultListMutedAuthorsLimit = 50
	maxListMutedAuthorsLimit     = 100
)

// listMutedAuthors 列出「我屏蔽的人」，最新在前。
//
// 没有这个查询，被屏蔽的人会从 feed 里彻底消失，也就没有入口能把屏蔽解掉 ——
// 所以它跟 UnmuteAuthor 是一对，缺一个这条链路就还是死的。
func (s *Service) listMutedAuthors(ctx context.Context, e command.Envelope) command.Result {
	var p listMutedAuthorsPayload
	_ = decode(e.Payload, &p) // legacy/空 payload 保持默认
	limit := p.Limit
	if limit <= 0 {
		limit = defaultListMutedAuthorsLimit
	}
	if limit > maxListMutedAuthorsLimit {
		limit = maxListMutedAuthorsLimit
	}
	mutes, err := s.repository.ListMutedAuthors(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "LIST_MUTED_AUTHORS_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.list_muted_authors_failed", nil)
	}
	if len(mutes) > limit {
		mutes = mutes[:limit]
	}
	// 归一 nil → 空数组：读模型 JSON 永远输出 [] 而非 null（客户端 zod fail-closed）。
	out := make([]MutedAuthorView, 0, len(mutes))
	for _, mute := range mutes {
		out = append(out, MutedAuthorView{MuteID: mute.ID, AuthorID: mute.AuthorID, CreatedAt: mute.CreatedAt})
	}
	out = s.withMutedAuthorNames(ctx, out)
	accepted := command.Accepted(e, "MutedAuthor", e.Actor.ID, 1, "LISTED", nil)
	accepted.OperationRef = mustMarshal(MutedAuthorsList{ActorID: e.Actor.ID, MutedAuthors: out, Count: len(out)})
	return accepted
}

// withMutedAuthorNames 用 profile 名字填充「我屏蔽的人」每一行（MUTE-REVERSIBLE-001）。
//
// 跟 withReplyActorNames 是同一套规矩，刻意共用同一个解析器：屏蔽列表里的人和
// 评论里的人必须给出同一个称呼，否则同一个人在两处显示不同名字。按作者去重，
// 解析不到就留空串由客户端降级成中性标签 —— 服务端绝不回填 authorId 当名字。
func (s *Service) withMutedAuthorNames(ctx context.Context, rows []MutedAuthorView) []MutedAuthorView {
	if s.authorNames == nil || len(rows) == 0 {
		return rows
	}
	names := make(map[string]string, len(rows))
	for _, row := range rows {
		author := strings.TrimSpace(row.AuthorID)
		if author == "" {
			continue
		}
		if _, seen := names[author]; seen {
			continue
		}
		name, ok := s.authorNames.ResolveAuthorDisplayName(ctx, author)
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name != "" && name != "你" {
			// 同 withReplyActorNames：历史客户端把 "你" 硬编码进过 profile，
			// 当成名字回给所有人会让被屏蔽者显示成"你"。
			names[author] = name
		}
	}
	if len(names) == 0 {
		return rows
	}
	out := make([]MutedAuthorView, 0, len(rows))
	for _, row := range rows {
		if name, ok := names[strings.TrimSpace(row.AuthorID)]; ok {
			row.AuthorDisplayName = name
		}
		out = append(out, row)
	}
	return out
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
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

func sortFollows(follows map[string]Follow) []Follow {
	result := make([]Follow, 0, len(follows))
	for _, f := range follows {
		result = append(result, f)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result
}

func mustMarshal(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
