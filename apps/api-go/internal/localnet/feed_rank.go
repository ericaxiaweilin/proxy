package localnet

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// FEED-RANK-001（2026-10-11，用户：「可以 你自己决定」）：登录读者的推荐时间流按分数排序。
//
// 匿名读者、「关注」tab、搜索都不走这里，仍是时间倒序（FEED-TIME-SORT-001）；没有接
// 信号源（内存仓 / 测试）也不走这里。
//
// 分数 = 时间衰减 × 互动质量 × 相关性：
//
//	时间衰减   0.5^(帖龄小时 / 12)
//	互动质量   (赞 + 2×评论 + 3×收藏 + 1) ÷ (曝光 + 20)   —— +1/+20 是平滑，曝光少的帖子不会因为一个赞冲到顶
//	相关性     关注的作者 ×1.5；「少看这个人」×0.3；「少看这类内容」同话题 ×0.5
//
// 新帖保底：曝光 < 30 且发布不到 48 小时的帖子，每 8 个位置插一条（约每页 3 条），按新到旧 ——
// 否则新人发帖永远攒不到互动、永远排不上来。
//
// 同一作者在一页里只出现一次，多的顺延到后面的页（排序模式下不折叠，不丢帖）；读者自己的帖子不受限。
//
// 分页：第一页时刻 t0 取当时最新的 rankPoolSize 条可见帖子当作排序池；游标带 (t0, offset)，
// 之后每页用同一个 t0 重建同一个池、同一个时间衰减，所以顺序稳定（互动数在两次翻页之间变了，
// 顺序可能微调，客户端按 postId 去重）。池翻完、而且池是满的，就接回时间倒序游标继续往下。
//
// 系数是初值：今天几乎没有真实互动数据，等有了再用实验框架（OPS-RESEARCH-001）校准。
const (
	rankPoolSize           = 150
	rankHalfLifeHours      = 12.0
	rankPriorImpressions   = 20.0
	rankFollowBoost        = 1.5
	rankReduceAuthor       = 0.3
	rankReduceTopic        = 0.5
	rankExploreImpressions = 30
	rankExploreMaxAge      = 48 * time.Hour
	rankExploreEvery       = 8
	rankExploreFirstSlot   = 2
)

// FeedSignals 是给一批候选帖子打分要用的事实。
type FeedSignals struct {
	Impressions    map[string]int  // postId → 曝光次数
	Likes          map[string]int  // postId → 赞
	Replies        map[string]int  // postId → 评论
	Bookmarks      map[string]int  // postId → 收藏
	Following      map[string]bool // 读者关注的作者
	ReducedAuthors map[string]bool // 读者点过「少看这个人」的作者
	ReducedTopics  map[string]bool // 读者点过「少看这类内容」的帖子所带的话题（见 topicKeys）
}

// FeedSignalSource 读打分信号（PG 实现在 platform/postgres）。
type FeedSignalSource interface {
	FeedSignals(ctx context.Context, viewerID string, postIDs []string) (FeedSignals, error)
}

// WithFeedSignals 接上信号源后，登录读者的推荐时间流按分数排序。
func (s *Service) WithFeedSignals(src FeedSignalSource) *Service {
	s.feedSignals = src
	return s
}

// TopicKeys：帖子的话题 = 非 GENERAL 的语境引用（GENERAL/日常 是分类器的兜底，人人都有，当话题会误伤一切）。
func TopicKeys(p Post) []string {
	keys := []string{}
	for _, r := range p.ContextRefs {
		if r.ContextType == "" || strings.EqualFold(r.ContextType, "GENERAL") {
			continue
		}
		keys = append(keys, r.ContextType+":"+r.ContextID)
	}
	return keys
}

func rankScore(p Post, sig FeedSignals, now time.Time) float64 {
	age := now.Sub(p.CreatedAt).Hours()
	if age < 0 {
		age = 0
	}
	decay := math.Pow(0.5, age/rankHalfLifeHours)
	interactions := float64(sig.Likes[p.ID]) + 2*float64(sig.Replies[p.ID]) + 3*float64(sig.Bookmarks[p.ID]) + 1
	quality := interactions / (float64(sig.Impressions[p.ID]) + rankPriorImpressions)
	rel := 1.0
	if sig.Following[p.AuthorID] {
		rel *= rankFollowBoost
	}
	if sig.ReducedAuthors[p.AuthorID] {
		rel *= rankReduceAuthor
	}
	for _, k := range TopicKeys(p) {
		if sig.ReducedTopics[k] {
			rel *= rankReduceTopic
			break
		}
	}
	return decay * quality * rel
}

func isExploreCandidate(p Post, sig FeedSignals, now time.Time) bool {
	return sig.Impressions[p.ID] < rankExploreImpressions && now.Sub(p.CreatedAt) < rankExploreMaxAge
}

// rankFeed 把整个池排成一条确定的序列（同样的输入永远同样的输出）。pageSize 用来做「一页一作者」。
func rankFeed(pool []Post, sig FeedSignals, viewerID string, now time.Time, pageSize int) []Post {
	if pageSize <= 0 {
		pageSize = 25
	}
	byScore := append([]Post(nil), pool...)
	scores := make(map[string]float64, len(pool))
	for _, p := range byScore {
		scores[p.ID] = rankScore(p, sig, now)
	}
	sort.SliceStable(byScore, func(i, j int) bool {
		si, sj := scores[byScore[i].ID], scores[byScore[j].ID]
		if si != sj {
			return si > sj
		}
		if !byScore[i].CreatedAt.Equal(byScore[j].CreatedAt) {
			return byScore[i].CreatedAt.After(byScore[j].CreatedAt)
		}
		return byScore[i].ID < byScore[j].ID
	})
	explore := []Post{}
	for _, p := range pool { // pool 已是时间倒序 ⇒ 保底位按新到旧
		if isExploreCandidate(p, sig, now) {
			explore = append(explore, p)
		}
	}

	placed := make(map[string]bool, len(pool))
	out := make([]Post, 0, len(pool))
	pageAuthors := map[string]bool{}
	// take 从 queue 里取第一条「这一页还没出现过这个作者」的帖子；全都撞了且 allowFallback 就取第一条没放过的。
	take := func(queue []Post, allowFallback bool) (Post, bool) {
		var fallback *Post
		for i := range queue {
			p := queue[i]
			if placed[p.ID] {
				continue
			}
			if p.AuthorID == viewerID || !pageAuthors[p.AuthorID] {
				return p, true
			}
			if fallback == nil {
				fallback = &queue[i]
			}
		}
		if fallback != nil && allowFallback {
			return *fallback, true
		}
		return Post{}, false
	}
	for len(out) < len(pool) {
		pos := len(out)
		if pos%pageSize == 0 {
			pageAuthors = map[string]bool{}
		}
		var next Post
		ok := false
		if (pos%pageSize)%rankExploreEvery == rankExploreFirstSlot {
			next, ok = take(explore, false) // 保底位不破「一页一作者」：撞了就让给分数序
		}
		if !ok {
			next, ok = take(byScore, true)
		}
		if !ok {
			break
		}
		placed[next.ID] = true
		pageAuthors[next.AuthorID] = true
		out = append(out, next)
	}
	return out
}

// viewerIsSignedIn：真实登录读者（匿名公开读是 PUBLIC / anonymous_reader）。
func viewerIsSignedIn(e command.Envelope) bool {
	return e.Actor.ID != "" && e.Actor.ID != "anonymous_reader" && e.Actor.Type != "PUBLIC"
}

// listFeedRanked 给出排序池里 [off, off+limit) 这一页。t0 为零 = 第一页，取现在。
func (s *Service) listFeedRanked(ctx context.Context, e command.Envelope, repo FeedPageRepository, limit int, t0 time.Time, off int) command.Result {
	now := s.clock.Now().UTC()
	if t0.IsZero() || t0.After(now) {
		t0 = now
	}
	if off < 0 {
		off = 0
	}
	// 池 = t0 之前最新的 rankPoolSize 条（同一个 t0 每页重建出同一个池）。屏蔽 / 不感兴趣已在 SQL 里按读者滤掉。
	raw, err := repo.ListFeedPage(ctx, e.Actor.ID, t0, "", rankPoolSize+1)
	if err != nil {
		return command.Rejected(e, "FEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localnet.feed_read_failed", nil)
	}
	poolFull := len(raw) > rankPoolSize
	if poolFull {
		raw = raw[:rankPoolSize]
	}
	audience := s.loadTargetedAudience(ctx, raw)
	pool := make([]Post, 0, len(raw))
	for _, p := range raw {
		if p.Status != "PUBLISHED" || !postVisibleTo(p, e.Actor.ID, audience) || postIsExpired(p, now) {
			continue
		}
		if p.MediaRefs == nil {
			p.MediaRefs = []PostMediaRef{}
		}
		if p.ContextRefs == nil {
			p.ContextRefs = []ContextRef{}
		}
		pool = append(pool, p)
	}
	sort.SliceStable(pool, func(i, j int) bool {
		if pool[i].CreatedAt.Equal(pool[j].CreatedAt) {
			return pool[i].ID < pool[j].ID
		}
		return pool[i].CreatedAt.After(pool[j].CreatedAt)
	})
	ids := make([]string, 0, len(pool))
	for _, p := range pool {
		ids = append(ids, p.ID)
	}
	sig, sigErr := s.feedSignals.FeedSignals(ctx, e.Actor.ID, ids)
	if sigErr != nil {
		// 信号读不出来：只剩时间衰减（≈ 时间倒序），不让 feed 失败。
		log.Printf("localnet: feed signals for %s: %v", e.Actor.ID, sigErr)
		sig = FeedSignals{}
	}
	ordered := rankFeed(pool, sig, e.Actor.ID, t0, limit)

	page := []Post{}
	if off < len(ordered) {
		end := off + limit
		if end > len(ordered) {
			end = len(ordered)
		}
		page = append(page, ordered[off:end]...)
	}
	nextCursor, hasMore := "", false
	switch {
	case off+limit < len(ordered):
		raw, _ := json.Marshal(map[string]any{"m": "rank", "t0": t0, "o": off + limit})
		nextCursor, hasMore = signCursor(raw), true
	case poolFull && len(pool) > 0:
		// 池翻完了、后面还有更老的：接回时间倒序，从池里最老的那条之后继续。
		oldest := pool[len(pool)-1]
		raw, _ := json.Marshal(map[string]any{"createdAt": oldest.CreatedAt, "postId": oldest.ID})
		nextCursor, hasMore = signCursor(raw), true
	}
	page = attachAudienceTargets(page, e.Actor.ID, audience)
	page = s.attachPolls(ctx, page, e.Actor.ID)
	media := s.hydratePostMedia(ctx, page)
	return acceptedWithPayload(e, "Post", "", 0, "FEED", map[string]any{
		"posts":      page,
		"media":      media,
		"note":       "实时交易事实（价格/可用性/商家状态）由读取时 Hydration 获得，Post 不是 Source of Truth；媒体只呈现 READY",
		"unfiltered": true,
		"ranked":     true,
		"nextCursor": nextCursor,
		"hasMore":    hasMore,
	}, nil)
}
