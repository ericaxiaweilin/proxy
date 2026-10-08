package tagging

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// 行为源 → 信号 的抽取器（架构文档 §3）。每个抽取器只回答一个问题：这个源里，谁碰过什么带主题的条目、多重。
// 权重表（互动越主动越重）集中在这里，运营要调整时只改这一张表。
const (
	wLike      = 1.0
	wReply     = 2.0
	wRepost    = 2.0
	wBookmark  = 2.0
	wInterest  = 2.0 // 活动「感兴趣」
	wJoin      = 3.0 // 报名活动
	wPublish   = 2.0 // 自己发的市场需求
	wApply     = 1.5 // 报名别人的需求
	wActivityV = 1.0 // 看活动页：每 30 秒 +1（被动）
)

// pushTopics 把一段文字命中的主题（含祖先）变成信号。
func pushTopics(push func(user string, sg Signal), user, text string, weight float64, n int, first, last time.Time, explicit bool) {
	for _, hit := range TopicHits(text) {
		push(user, Signal{Axis: AxisInterestTopic, Value: hit.Value, Weight: weight * hit.Factor, N: n, First: first, Last: last, Explicit: explicit})
	}
}

// loadInteractionTopics：对别人的帖子做过的主动互动（赞 / 评 / 转 / 藏），按帖子正文归主题。
// 互动是用户自己做的事，不需要浏览同意；评论还会把**评论自己的字**也算进去（那是他写的）。
func (p *Postgres) loadInteractionTopics(ctx context.Context, since time.Time, push func(string, Signal)) error {
	for _, q := range []struct {
		sql    string
		weight float64
	}{
		{`SELECT x.actor_id, po.body, x.created_at FROM engagement.reactions x JOIN localnet.posts po ON po.id = x.post_id
		   WHERE x.created_at >= $1 AND x.kind = 'LIKE' AND po.author_id <> x.actor_id AND po.body <> ''`, wLike},
		{`SELECT x.actor_id, po.body || ' ' || x.body, x.created_at FROM engagement.replies x JOIN localnet.posts po ON po.id = x.post_id
		   WHERE x.created_at >= $1 AND po.author_id <> x.actor_id`, wReply},
		{`SELECT x.actor_id, po.body, x.created_at FROM engagement.reposts x JOIN localnet.posts po ON po.id = x.post_id
		   WHERE x.created_at >= $1 AND po.author_id <> x.actor_id AND po.body <> ''`, wRepost},
		{`SELECT x.actor_id, po.body, x.created_at FROM engagement.bookmarks x JOIN localnet.posts po ON po.id = x.post_id
		   WHERE x.created_at >= $1 AND po.author_id <> x.actor_id AND po.body <> ''`, wBookmark},
	} {
		rows, err := p.pool.Query(ctx, q.sql, since)
		if err != nil {
			return err
		}
		for rows.Next() {
			var user, text string
			var at time.Time
			if err := rows.Scan(&user, &text, &at); err != nil {
				rows.Close()
				return err
			}
			pushTopics(push, user, text, q.weight, 1, at, at, true)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}

// activityText 取活动 payload 里能说明「这是什么活动」的文字（标题 / 类目 / 描述 / 地点标签）。
func activityText(payload []byte) string {
	var m map[string]any
	if json.Unmarshal(payload, &m) != nil {
		return ""
	}
	var parts []string
	for _, k := range []string{"title", "category", "description", "desc", "theme", "venue", "summary"} {
		if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " ")
}

// loadActivityTopics：活动的主题。看活动页（被动，过同意）+ 感兴趣 / 报名（主动）。
func (p *Postgres) loadActivityTopics(ctx context.Context, since time.Time, valid string, push func(string, Signal)) error {
	for _, q := range []struct {
		sql      string
		explicit bool
	}{
		{`SELECT e.actor_id, a.payload::text, COALESCE(SUM(` + dwellCreditSQL(DwellActivity, "e.watch_ms") + `), 0)::float8, MIN(e.created_at), MAX(e.created_at), COUNT(*)
		    FROM localnet.interaction_events e JOIN activity.activities a ON a.id = e.target_id
		   WHERE e.event_type = 'ACTIVITY_VIEW' AND e.target_type = 'ACTIVITY' AND e.created_at >= $1 AND e.watch_ms > 0 AND ` + valid + `
		   GROUP BY e.actor_id, a.id, a.payload::text`, false},
		{`SELECT i.actor_id, a.payload::text, ` + "2.0" + `::float8, i.created_at, i.created_at, 1
		    FROM activity.interests i JOIN activity.activities a ON a.id = i.activity_id WHERE i.created_at >= $1`, true},
		{`SELECT pt.actor_id, a.payload::text, ` + "3.0" + `::float8, pt.joined_at, pt.joined_at, 1
		    FROM activity.participants pt JOIN activity.activities a ON a.id = pt.activity_id WHERE pt.joined_at >= $1`, true},
	} {
		rows, err := p.pool.Query(ctx, q.sql, since)
		if err != nil {
			return err
		}
		for rows.Next() {
			var user, payload string
			var w float64
			var first, last time.Time
			var n int
			if err := rows.Scan(&user, &payload, &w, &first, &last, &n); err != nil {
				rows.Close()
				return err
			}
			pushTopics(push, user, activityText([]byte(payload)), w, n, first, last, q.explicit)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}

// loadMarketTopics：市场需求的主题。自己发的需求（主动）+ 报名别人的需求（主动）。
func (p *Postgres) loadMarketTopics(ctx context.Context, since time.Time, push func(string, Signal)) error {
	for _, q := range []struct {
		sql    string
		weight float64
	}{
		{`SELECT o.owner_id, o.payload::text, o.created_at FROM marketplace.opportunities o WHERE o.created_at >= $1`, wPublish},
		{`SELECT a.applicant_id, o.payload::text, a.created_at FROM marketplace.applications a
		    JOIN marketplace.opportunities o ON o.id = a.opportunity_id WHERE a.created_at >= $1 AND o.owner_id <> a.applicant_id`, wApply},
	} {
		rows, err := p.pool.Query(ctx, q.sql, since)
		if err != nil {
			return err
		}
		for rows.Next() {
			var user, payload string
			var at time.Time
			if err := rows.Scan(&user, &payload, &at); err != nil {
				rows.Close()
				return err
			}
			pushTopics(push, user, activityText([]byte(payload)), q.weight, 1, at, at, true)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	return nil
}
