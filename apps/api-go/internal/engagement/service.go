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
	AddReaction(ctx context.Context, r Reaction) error
	AddReply(ctx context.Context, r Reply) error
	AddRepost(ctx context.Context, r Repost) error
	AddBookmark(ctx context.Context, b Bookmark) error
	Engagement(ctx context.Context, postID string) (PostEngagement, error)
}

var ErrPostNotTracked = errors.New("post not tracked")

type MemoryRepository struct {
	mu       sync.Mutex
	follows  map[string]Follow
	reactions map[string]Reaction
	replies  map[string]Reply
	reposts  map[string]Repost
	bookmarks map[string]Bookmark
	events   []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		follows:  make(map[string]Follow),
		reactions: make(map[string]Reaction),
		replies:  make(map[string]Reply),
		reposts:  make(map[string]Repost),
		bookmarks: make(map[string]Bookmark),
	}
}

func (r *MemoryRepository) AddFollow(_ context.Context, f Follow) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.follows[f.FollowerID+"|"+f.FolloweeID] = f
	return nil
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
	case "FollowProfile", "ReactToPost", "ReplyToPost", "RepostPost", "BookmarkPost", "GetPostEngagement":
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
