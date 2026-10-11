package postgres

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/proxy-app/proxy-api/internal/localnet"
)

// FeedSignals 读推荐流打分要的事实（FEED-RANK-001）。一页只查一次：候选是 ≤150 条帖子的
// id 数组，每类信号一条 GROUP BY；读者侧的关注 / 少看 各一条。
type FeedSignals struct{ pool *pgxpool.Pool }

func NewFeedSignals(pool *pgxpool.Pool) *FeedSignals { return &FeedSignals{pool: pool} }

func (f *FeedSignals) countBy(ctx context.Context, sql string, ids []string) (map[string]int, error) {
	out := map[string]int{}
	rows, err := f.pool.Query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

func (f *FeedSignals) setOf(ctx context.Context, sql string, viewerID string) (map[string]bool, error) {
	out := map[string]bool{}
	rows, err := f.pool.Query(ctx, sql, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func (f *FeedSignals) FeedSignals(ctx context.Context, viewerID string, postIDs []string) (localnet.FeedSignals, error) {
	var s localnet.FeedSignals
	var err error
	if s.Impressions, err = f.countBy(ctx, `
		SELECT target_id, COUNT(*) FROM localnet.interaction_events
		 WHERE event_type = 'POST_IMPRESSION' AND target_id = ANY($1) GROUP BY 1`, postIDs); err != nil {
		return s, err
	}
	if s.Likes, err = f.countBy(ctx, `SELECT post_id, COUNT(*) FROM engagement.reactions WHERE post_id = ANY($1) GROUP BY 1`, postIDs); err != nil {
		return s, err
	}
	if s.Replies, err = f.countBy(ctx, `SELECT post_id, COUNT(*) FROM engagement.replies WHERE post_id = ANY($1) GROUP BY 1`, postIDs); err != nil {
		return s, err
	}
	if s.Bookmarks, err = f.countBy(ctx, `SELECT post_id, COUNT(*) FROM engagement.bookmarks WHERE post_id = ANY($1) GROUP BY 1`, postIDs); err != nil {
		return s, err
	}
	if s.Following, err = f.setOf(ctx, `SELECT followee_id FROM engagement.follows WHERE follower_id = $1`, viewerID); err != nil {
		return s, err
	}
	if s.ReducedAuthors, err = f.setOf(ctx, `
		SELECT DISTINCT author_id FROM engagement.feed_preferences
		 WHERE actor_id = $1 AND action = 'REDUCE_AUTHOR' AND author_id <> ''`, viewerID); err != nil {
		return s, err
	}
	// 「少看这类内容」记的是一条帖子；话题取那条帖子的语境引用（与 localnet.topicKeys 同一口径）。
	s.ReducedTopics = map[string]bool{}
	rows, err := f.pool.Query(ctx, `
		SELECT p.context_refs FROM engagement.feed_preferences fp
		  JOIN localnet.posts p ON p.id = fp.post_id
		 WHERE fp.actor_id = $1 AND fp.action = 'REDUCE_TOPIC'`, viewerID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return s, err
		}
		var refs []localnet.ContextRef
		if json.Unmarshal(raw, &refs) != nil {
			continue
		}
		for _, k := range localnet.TopicKeys(localnet.Post{ContextRefs: refs}) {
			s.ReducedTopics[k] = true
		}
	}
	return s, rows.Err()
}
