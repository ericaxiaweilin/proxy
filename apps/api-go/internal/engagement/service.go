package engagement

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
}

// Repost 是转发。
type Repost struct {
	ID        string    `json:"repostId"`
	PostID    string    `json:"postId"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

// Bookmark 是收藏。
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

// PostEngagement 是某帖子的互动汇总（读取视图）。
type PostEngagement struct {
	PostID     string `json:"postId"`
	Followed   bool   `json:"followed"`
	Reactions  int    `json:"reactions"`
	Replies    int    `json:"replies"`
	Reposts    int    `json:"reposts"`
	Bookmarked bool   `json:"bookmarked"`
}

type Repository interface {
	AddFollow(ctx context.Context, f Follow) error
	RemoveFollow(ctx context.Context, followerID, followeeID string) (bool, error)
	CountFollowers(ctx context.Context, userID string) (int, error)
	CountFollowing(ctx context.Context, userID string) (int, error)
	IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error)
	AddReaction(ctx context.Context, r Reaction) error
	AddReply(ctx context.Context, r Reply) error
	AddRepost(ctx context.Context, r Repost) error
	AddBookmark(ctx context.Context, b Bookmark) error
	AddFeedPreference(ctx context.Context, preference FeedPreference) error
	AddPostReport(ctx context.Context, report PostReport) error
	// AddMutedAuthor 幂等：同一 (ActorID, AuthorID) 重复 mute 返回已存在记录。
	// IsMuted 查 actor 是否屏蔽了 author（feed 过滤用）。
	AddMutedAuthor(ctx context.Context, mute MutedAuthor) (MutedAuthor, bool, error)
	IsMuted(ctx context.Context, actorID, authorID string) (bool, error)
	Engagement(ctx context.Context, postID string) (PostEngagement, error)
}

var ErrPostNotTracked = errors.New("post not tracked")

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
	events      []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
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

func (r *MemoryRepository) AddReaction(_ context.Context, re Reaction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reactions[re.ID] = re
	return nil
}

func (r *MemoryRepository) AddReply(_ context.Context, re Reply) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.replies[re.ID] = re
	return nil
}

func (r *MemoryRepository) AddRepost(_ context.Context, re Repost) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reposts[re.ID] = re
	return nil
}

func (r *MemoryRepository) AddBookmark(_ context.Context, b Bookmark) error {
	r.mu.Lock()
	defer r.mu.Unlock()
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

func (r *MemoryRepository) Engagement(_ context.Context, postID string) (PostEngagement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := PostEngagement{PostID: postID}
	for _, re := range r.reactions {
		if re.PostID == postID {
			e.Reactions++
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
	case "FollowProfile", "UnfollowProfile", "GetFollowCounts", "IsFollowing", "ReactToPost", "ReplyToPost", "RepostPost", "BookmarkPost", "GetPostEngagement", "RecordFeedPreference", "ReportPost", "MuteAuthor":
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
		"removed":     removed,
	})}
	return command.Accepted(e, "Follow", e.Actor.ID+"|"+p.FolloweeID, 1, state, eventRefs(domainEvents))
}

// ---------- GetFollowCounts (R15.54) ----------

type getFollowCountsPayload struct {
	UserID string `json:"userId"`
}

type followCounts struct {
	UserID     string `json:"userId"`
	Followers  int    `json:"followers"`
	Following  int    `json:"following"`
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
}

func (s *Service) react(ctx context.Context, e command.Envelope) command.Result {
	var p reactPayload
	if !decode(e.Payload, &p) || p.PostID == "" {
		return command.Rejected(e, "INVALID_REACTION", "VALIDATION", "AFTER_USER_ACTION", "engagement.invalid_reaction", nil)
	}
	if p.Kind == "" {
		p.Kind = "LIKE"
	}
	reaction := Reaction{ID: newID("rxn_"), PostID: p.PostID, ActorID: e.Actor.ID, Kind: p.Kind, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostReacted", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, reaction.CreatedAt, map[string]any{
		"reactionId": reaction.ID,
		"kind":       reaction.Kind,
		"actorId":    reaction.ActorID,
	})}
	if err := s.repository.AddReaction(ctx, reaction); err != nil {
		return command.Rejected(e, "REACTION_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.reaction_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "REACTED", eventRefs(domainEvents))
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
	reply := Reply{ID: newID("rep_"), PostID: p.PostID, ActorID: e.Actor.ID, Body: p.Body, CreatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("PostReplied", "Post", p.PostID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, reply.CreatedAt, map[string]any{
		"replyId": reply.ID,
		"body":    reply.Body,
	})}
	if err := s.repository.AddReply(ctx, reply); err != nil {
		return command.Rejected(e, "REPLY_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.reply_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "REPLIED", eventRefs(domainEvents))
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
		return command.Rejected(e, "REPOST_FAILED", "INTERNAL", "SAFE_RETRY", "engagement.repost_failed", nil)
	}
	return command.Accepted(e, "Post", p.PostID, 1, "REPOSTED", eventRefs(domainEvents))
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
	eng, err := s.repository.Engagement(ctx, postID)
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
