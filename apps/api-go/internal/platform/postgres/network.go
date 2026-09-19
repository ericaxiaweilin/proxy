package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/conversation"
	"github.com/proxy-app/proxy-api/internal/engagement"
	"github.com/proxy-app/proxy-api/internal/localcontext"
	"github.com/proxy-app/proxy-api/internal/localnet"
)

// ---------- LocalNet ----------

type LocalNetRepository struct {
	pool *pgxpool.Pool
}

func NewLocalNetRepository(pool *pgxpool.Pool) *LocalNetRepository {
	return &LocalNetRepository{pool: pool}
}

func (r *LocalNetRepository) CreatePost(ctx context.Context, post localnet.Post) error {
	mediaRefs, contextRefs, err := encodePostJSON(post)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		post.ID, post.AuthorType, post.AuthorID, post.AuthorDisplayName, post.Body, mediaRefs,
		post.Visibility, post.CityScope, nullIfEmptyNetwork(post.SceneType), post.Status, contextRefs, post.CreatedAt,
		post.EphemeralUntil,
	)
	return err
}

// UpsertPost idempotently inserts/updates a post (used by Service.SeedDemoPosts
// to seed visitor-visible content without creating duplicates on restart).
// R15.15 P1: scene_type added to ON CONFLICT clause so the seed keeps the
// type field in sync if the row was first created without it.
func (r *LocalNetRepository) UpsertPost(ctx context.Context, post localnet.Post) error {
	mediaRefs, contextRefs, err := encodePostJSON(post)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localnet.posts (id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (id) DO UPDATE SET
			author_type=EXCLUDED.author_type,
			author_id=EXCLUDED.author_id,
			author_display_name=EXCLUDED.author_display_name,
			body=EXCLUDED.body,
			media_refs=EXCLUDED.media_refs,
			visibility=EXCLUDED.visibility,
			city_scope=EXCLUDED.city_scope,
			scene_type=EXCLUDED.scene_type,
			status=EXCLUDED.status,
			context_refs=EXCLUDED.context_refs,
			ephemeral_until=EXCLUDED.ephemeral_until`,
		post.ID, post.AuthorType, post.AuthorID, post.AuthorDisplayName, post.Body, mediaRefs,
		post.Visibility, post.CityScope, nullIfEmptyNetwork(post.SceneType), post.Status, contextRefs, post.CreatedAt,
		post.EphemeralUntil,
	)
	return err
}

func nullIfEmptyNetwork(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (r *LocalNetRepository) GetPost(ctx context.Context, id string) (localnet.Post, error) {
	var post localnet.Post
	var mediaRefs, contextRefs []byte
	var sceneType, cityScope *string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until
		FROM localnet.posts WHERE id = $1`, id).Scan(
		&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
		&post.Visibility, &cityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
		&post.EphemeralUntil,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return localnet.Post{}, localnet.ErrPostNotFound
	}
	if err != nil {
		return localnet.Post{}, err
	}
	if sceneType != nil {
		post.SceneType = *sceneType
	}
	// FEED-NULL-CITY-001: 同上，city_scope 可空，扫进 string 会因单行 NULL 打挂整页。
	if cityScope != nil {
		post.CityScope = *cityScope
	}
	if err := json.Unmarshal(mediaRefs, &post.MediaRefs); err != nil {
		return post, fmt.Errorf("decode media refs: %w", err)
	}
	if err := json.Unmarshal(contextRefs, &post.ContextRefs); err != nil {
		return post, fmt.Errorf("decode context refs: %w", err)
	}
	return post, nil
}

func (r *LocalNetRepository) UpdatePost(ctx context.Context, post localnet.Post, _ int) error {
	mediaRefs, contextRefs, err := encodePostJSON(post)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE localnet.posts SET body=$1, media_refs=$2, status=$3, context_refs=$4
		WHERE id=$5`,
		post.Body, mediaRefs, post.Status, contextRefs, post.ID,
	)
	return err
}

func (r *LocalNetRepository) Snapshot(ctx context.Context) ([]localnet.Post, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until
		FROM localnet.posts ORDER BY created_at DESC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.Post{}
	for rows.Next() {
		var post localnet.Post
		var mediaRefs, contextRefs []byte
		var sceneType, cityScope *string
		if err := rows.Scan(
			&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
			&post.Visibility, &cityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
			&post.EphemeralUntil,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(mediaRefs, &post.MediaRefs)
		_ = json.Unmarshal(contextRefs, &post.ContextRefs)
		if sceneType != nil {
			post.SceneType = *sceneType
		}
		// FEED-NULL-CITY-001: city_scope 是可空列，直接扫进 string 会让**一整页
		// feed** 因为某一行的 NULL 而整体报错（cannot scan NULL into *string）。
		// 一行脏数据打挂所有人的动态流，这个代价远大于多一次判空。
		if cityScope != nil {
			post.CityScope = *cityScope
		}
		result = append(result, post)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *LocalNetRepository) ListFeedPage(ctx context.Context, actorID string, before time.Time, beforeID string, limit int) ([]localnet.Post, error) {
	if limit <= 0 || limit > 51 {
		limit = 26
	}
	var beforeValue any
	if !before.IsZero() {
		beforeValue = before.UTC()
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until
		FROM localnet.posts
		WHERE status='PUBLISHED'
		  AND (visibility='PUBLIC' OR (visibility='FOLLOWERS' AND author_id=$1))
		  -- GHOST-24H-001: 到期的临时动态不再出现。必须写在 SQL 里而不是查完
		  -- 再在 Go 里过滤 —— 先 LIMIT 再过滤会让一页少给好几条、往下翻还会
		  -- 重复或漏帖。NULL = 永久动态（存量数据全是 NULL，无需回填）。
		  AND (ephemeral_until IS NULL OR ephemeral_until > now())
		  -- MUTED-AUTHORS-002: feed must exclude posts from authors the
		  -- viewer muted. Was missing entirely: AddMutedAuthor had no read
		  -- side — IsMuted had zero callers, so mutes were decoration
		  -- (next page / other device / re-login all re-showed the author;
		  -- the mobile UI's local filter promised server sync that never
		  -- existed). In-SQL so pagination LIMIT counting stays correct.
		  AND NOT EXISTS (
			SELECT 1 FROM engagement.muted_authors
			WHERE actor_id=$1 AND author_id=localnet.posts.author_id
		  )
		  AND ($2::timestamptz IS NULL OR created_at < $2 OR (created_at = $2 AND id > $3))
		ORDER BY created_at DESC, id ASC
		LIMIT $4`, actorID, beforeValue, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]localnet.Post, 0, limit)
	for rows.Next() {
		var post localnet.Post
		var mediaRefs, contextRefs []byte
		var sceneType, cityScope *string
		if err := rows.Scan(
			&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
			&post.Visibility, &cityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
			&post.EphemeralUntil,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(mediaRefs, &post.MediaRefs); err != nil {
			return nil, fmt.Errorf("decode media refs: %w", err)
		}
		if err := json.Unmarshal(contextRefs, &post.ContextRefs); err != nil {
			return nil, fmt.Errorf("decode context refs: %w", err)
		}
		if sceneType != nil {
			post.SceneType = *sceneType
		}
		// FEED-NULL-CITY-001: city_scope 是可空列，直接扫进 string 会让**一整页
		// feed** 因为某一行的 NULL 而整体报错（cannot scan NULL into *string）。
		// 一行脏数据打挂所有人的动态流，这个代价远大于多一次判空。
		if cityScope != nil {
			post.CityScope = *cityScope
		}
		result = append(result, post)
	}
	return result, rows.Err()
}

// ListPostsMentioning backs the profile TAGGED tab. The WHERE clause is
// deliberately the same shape as ListFeedPage — same visibility rule, same
// muted-author exclusion, same ORDER BY — so a post that is invisible in the
// feed can never become visible through a mention of the viewer. The only
// additions are "not my own post" and the mention regex.
//
// The match runs in SQL (not in Go after the fact) so LIMIT counts real
// matches: filtering a page in Go would silently truncate the tab again.
func (r *LocalNetRepository) ListPostsMentioning(ctx context.Context, actorID string, handle string, limit int) ([]localnet.Post, error) {
	if limit <= 0 || limit > 51 {
		limit = 31
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until
		FROM localnet.posts
		WHERE status='PUBLISHED'
		  AND (visibility='PUBLIC' OR (visibility='FOLLOWERS' AND author_id=$1))
		  AND author_id <> $1
		  -- GHOST-24H-001: 与 ListFeedPage 同一个过期谓语。这条查询刻意与 feed
		  -- 保持同一套 WHERE 形状，否则一条已经「消失」的 24h 帖会因为提到了谁
		  -- 而重新出现在 Ta 的 TAGGED 里 —— 从后门复活。
		  AND (ephemeral_until IS NULL OR ephemeral_until > now())
		  AND NOT EXISTS (
			SELECT 1 FROM engagement.muted_authors
			WHERE actor_id=$1 AND author_id=localnet.posts.author_id
		  )
		  AND body ~* $2
		ORDER BY created_at DESC, id ASC
		LIMIT $3`, actorID, localnet.MentionRegex(handle), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]localnet.Post, 0, limit)
	for rows.Next() {
		var post localnet.Post
		var mediaRefs, contextRefs []byte
		var sceneType, cityScope *string
		if err := rows.Scan(
			&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
			&post.Visibility, &cityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
			&post.EphemeralUntil,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(mediaRefs, &post.MediaRefs); err != nil {
			return nil, fmt.Errorf("decode media refs: %w", err)
		}
		if err := json.Unmarshal(contextRefs, &post.ContextRefs); err != nil {
			return nil, fmt.Errorf("decode context refs: %w", err)
		}
		if sceneType != nil {
			post.SceneType = *sceneType
		}
		// FEED-NULL-CITY-001: city_scope 是可空列，直接扫进 string 会让**一整页
		// feed** 因为某一行的 NULL 而整体报错（cannot scan NULL into *string）。
		// 一行脏数据打挂所有人的动态流，这个代价远大于多一次判空。
		if cityScope != nil {
			post.CityScope = *cityScope
		}
		result = append(result, post)
	}
	return result, rows.Err()
}

// ---------- POLL-VOTE-001：投票 ----------

// SavePostPoll 写入投票及其选项（一次事务）。
//
// 选项走 ON CONFLICT DO UPDATE 而不是「先删再插」：删选项会连带把已投的票
// 一起级联掉（FK ON DELETE CASCADE），而 SavePostPoll 语义上是「建/改投票」，
// 不该顺手清掉别人的票。
//
// 必须走 runInTransaction 而不是 r.pool.Begin：命令处理跑在一个挂在 ctx 上的
// 环境事务里，CreatePost 写进去的帖子行在提交前**别的连接看不见**。自己新开
// 一个事务去写 post_polls，就会撞上 post_id → posts(id) 的外键（真实报错：
// violates foreign key constraint "post_polls_post_id_fkey"），而这时帖子其实
// 已经写好了 —— 一个只在「同一条命令里补写附属表」时才出现的连锁失败。
func (r *LocalNetRepository) SavePostPoll(ctx context.Context, poll localnet.PostPoll) error {
	return runInTransaction(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
		INSERT INTO localnet.post_polls (post_id, expires_at)
		VALUES ($1, $2)
		ON CONFLICT (post_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
			poll.PostID, poll.ExpiresAt); err != nil {
			return err
		}
		for _, opt := range poll.Options {
			if _, err := tx.Exec(ctx, `
			INSERT INTO localnet.post_poll_options (option_id, post_id, label, sort_order)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (post_id, option_id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order`,
				opt.OptionID, poll.PostID, opt.Label, opt.SortOrder); err != nil {
				return err
			}
		}
		return nil
	})
}

// RecordPollVote 记一票。一人一票：重复投票 = 改票（覆盖 option_id）。
func (r *LocalNetRepository) RecordPollVote(ctx context.Context, postID, optionID, voterID string) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localnet.post_poll_votes (post_id, option_id, voter_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (post_id, voter_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = now()`,
		postID, optionID, voterID)
	return err
}

// ListPollsForPosts 一次取回一批帖子的投票：结构 + 票数 + 浏览者投了哪个。
//
// 票数一律 COUNT(*) 现算（不存计数列），"是否截止"由 service 用自己的时钟判 ——
// 这里刻意不使用 SQL 的 now()，否则测试里的假时钟永远测不到截止行为。
func (r *LocalNetRepository) ListPollsForPosts(ctx context.Context, postIDs []string, viewerID string) (map[string]localnet.PostPollTally, error) {
	out := make(map[string]localnet.PostPollTally)
	if len(postIDs) == 0 {
		return out, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT p.post_id, p.expires_at, o.option_id, o.label, o.sort_order,
		       COALESCE(v.cnt, 0) AS vote_count
		FROM localnet.post_polls p
		JOIN localnet.post_poll_options o ON o.post_id = p.post_id
		-- POLL-OPTION-SCOPE-001: 必须按 (post_id, option_id) 聚合。
		-- option_id 只在一条帖子内唯一（客户端生成，重发草稿就会与另一条帖子撞），
		-- 只按 option_id 分组会把 A 帖子的票算到 B 帖子同名选项的头上。
		LEFT JOIN (
			SELECT post_id, option_id, COUNT(*) AS cnt
			FROM localnet.post_poll_votes
			GROUP BY post_id, option_id
		) v ON v.post_id = o.post_id AND v.option_id = o.option_id
		WHERE p.post_id = ANY($1)
		ORDER BY p.post_id, o.sort_order, o.option_id`, postIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			postID    string
			expiresAt *time.Time
			optionID  string
			label     string
			sortOrder int
			votes     int
		)
		if err := rows.Scan(&postID, &expiresAt, &optionID, &label, &sortOrder, &votes); err != nil {
			return nil, err
		}
		tally := out[postID]
		tally.Poll.PostID = postID
		tally.Poll.ExpiresAt = expiresAt
		if tally.Counts == nil {
			tally.Counts = make(map[string]int)
		}
		tally.Counts[optionID] = votes
		tally.Poll.Options = append(tally.Poll.Options, localnet.PostPollOption{
			OptionID: optionID, Label: label, SortOrder: sortOrder,
		})
		out[postID] = tally
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if viewerID == "" {
		return out, nil
	}
	voteRows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT post_id, option_id FROM localnet.post_poll_votes
		WHERE post_id = ANY($1) AND voter_id = $2`, postIDs, viewerID)
	if err != nil {
		return nil, err
	}
	defer voteRows.Close()
	for voteRows.Next() {
		var postID, optionID string
		if err := voteRows.Scan(&postID, &optionID); err != nil {
			return nil, err
		}
		tally := out[postID]
		tally.VotedOptionID = optionID
		out[postID] = tally
	}
	if err := voteRows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *LocalNetRepository) SaveNeedFromPost(ctx context.Context, record localnet.NeedFromPost) error {
	lineage, err := json.Marshal(record.Lineage)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localnet.need_from_posts (need_id, post_id, lineage, created_at)
		VALUES ($1,$2,$3,$4)`,
		record.NeedID, record.PostID, lineage, record.CreatedAt,
	)
	return err
}

func (r *LocalNetRepository) AppendInteractionEvent(ctx context.Context, ie localnet.InteractionEvent) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, need_id, watch_ms, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		ie.EventID, ie.EventType, ie.ActorID, ie.TargetType, ie.TargetID, ie.NeedID, ie.WatchMs, ie.CreatedAt,
	)
	return err
}

func (r *LocalNetRepository) ListInteractionEvents(ctx context.Context, actorID string, limit int) ([]localnet.InteractionEvent, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT event_id, event_type, actor_id, target_type, target_id, need_id, created_at
		FROM localnet.interaction_events
		WHERE actor_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.InteractionEvent{}
	for rows.Next() {
		var ie localnet.InteractionEvent
		var needID *string
		if err := rows.Scan(&ie.EventID, &ie.EventType, &ie.ActorID, &ie.TargetType, &ie.TargetID, &needID, &ie.CreatedAt); err != nil {
			return nil, err
		}
		if needID != nil {
			ie.NeedID = *needID
		}
		result = append(result, ie)
	}
	return result, rows.Err()
}

func (r *LocalNetRepository) ListPostImpressionStats(ctx context.Context, authorID string, limit int) ([]localnet.PostImpressionStats, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT p.id,
			COUNT(ev.event_id) AS impressions,
			COUNT(DISTINCT ev.actor_id) AS viewers,
			COALESCE(SUM(ev.watch_ms), 0) AS total_watch_ms
		FROM (
			SELECT id, created_at FROM localnet.posts
			WHERE author_id = $1
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		) p
		LEFT JOIN localnet.interaction_events ev
			ON ev.target_type = 'POST' AND ev.target_id = p.id AND ev.event_type = 'POST_IMPRESSION'
		GROUP BY p.id, p.created_at
		ORDER BY p.created_at DESC, p.id DESC`, authorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.PostImpressionStats{}
	for rows.Next() {
		var stat localnet.PostImpressionStats
		if err := rows.Scan(&stat.PostID, &stat.Impressions, &stat.Viewers, &stat.TotalWatchMs); err != nil {
			return nil, err
		}
		result = append(result, stat)
	}
	return result, rows.Err()
}

func (r *LocalNetRepository) ListMediaImpressionStats(ctx context.Context, authorID string, limit int) ([]localnet.MediaImpressionStats, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT p.id,
			m.media_asset_id,
			COUNT(ev.event_id) AS impressions,
			COUNT(DISTINCT ev.actor_id) AS viewers,
			COALESCE(SUM(ev.watch_ms), 0) AS total_watch_ms
		FROM (
			SELECT id, created_at, media_refs FROM localnet.posts
			WHERE author_id = $1
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		) p
		CROSS JOIN LATERAL (
			SELECT (item->>'mediaAssetId') AS media_asset_id, (item->>'sortOrder')::int AS sort_order
			FROM jsonb_array_elements(p.media_refs) AS item
		) m
		LEFT JOIN localnet.interaction_events ev
			ON ev.target_type = 'MEDIA' AND ev.target_id = m.media_asset_id AND ev.event_type = 'MEDIA_IMPRESSION'
		GROUP BY p.id, p.created_at, m.media_asset_id, m.sort_order
		ORDER BY p.created_at DESC, p.id DESC, m.sort_order ASC`, authorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.MediaImpressionStats{}
	for rows.Next() {
		var stat localnet.MediaImpressionStats
		if err := rows.Scan(&stat.PostID, &stat.MediaAssetID, &stat.Impressions, &stat.Viewers, &stat.TotalWatchMs); err != nil {
			return nil, err
		}
		result = append(result, stat)
	}
	return result, rows.Err()
}

func (r *LocalNetRepository) ListMediaActivityForViewer(ctx context.Context, authorID string, viewerActorID string, limit int) ([]localnet.ViewerMediaActivity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT p.id,
			m.media_asset_id,
			COUNT(ev.event_id) AS opens,
			COALESCE(SUM(ev.watch_ms), 0) AS total_watch_ms,
			MAX(ev.created_at) AS last_opened_at
		FROM localnet.posts p
		CROSS JOIN LATERAL (
			SELECT (item->>'mediaAssetId') AS media_asset_id
			FROM jsonb_array_elements(p.media_refs) AS item
		) m
		JOIN localnet.interaction_events ev
			ON ev.target_type = 'MEDIA' AND ev.target_id = m.media_asset_id
			AND ev.event_type = 'MEDIA_IMPRESSION' AND ev.actor_id = $2
		WHERE p.author_id = $1
		GROUP BY p.id, m.media_asset_id
		ORDER BY last_opened_at DESC
		LIMIT $3`, authorID, viewerActorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.ViewerMediaActivity{}
	for rows.Next() {
		var activity localnet.ViewerMediaActivity
		if err := rows.Scan(&activity.PostID, &activity.MediaAssetID, &activity.Opens, &activity.TotalWatchMs, &activity.LastOpenedAt); err != nil {
			return nil, err
		}
		result = append(result, activity)
	}
	return result, rows.Err()
}

func (r *LocalNetRepository) ListProfileViewStats(ctx context.Context, ownerID string) (localnet.ProfileViewStats, error) {
	var stat localnet.ProfileViewStats
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COUNT(event_id), COUNT(DISTINCT actor_id)
		FROM localnet.interaction_events
		WHERE target_type = 'PROFILE' AND target_id = $1 AND event_type = 'PROFILE_OPEN'`, ownerID).
		Scan(&stat.Opens, &stat.UniqueViewers)
	if err != nil {
		return localnet.ProfileViewStats{}, err
	}
	return stat, nil
}

func (r *LocalNetRepository) ListProfileViewers(ctx context.Context, ownerID string, limit int) ([]localnet.ProfileViewerStat, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT actor_id, COUNT(event_id) AS opens, MAX(created_at) AS last_opened_at
		FROM localnet.interaction_events
		WHERE target_type = 'PROFILE' AND target_id = $1 AND event_type = 'PROFILE_OPEN'
		GROUP BY actor_id
		ORDER BY last_opened_at DESC, actor_id ASC
		LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.ProfileViewerStat{}
	for rows.Next() {
		var stat localnet.ProfileViewerStat
		if err := rows.Scan(&stat.ActorID, &stat.Opens, &stat.LastOpenedAt); err != nil {
			return nil, err
		}
		result = append(result, stat)
	}
	return result, rows.Err()
}

func (r *LocalNetRepository) SnapshotNeeds(ctx context.Context) ([]localnet.NeedFromPost, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT need_id, post_id, lineage, created_at FROM localnet.need_from_posts ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.NeedFromPost{}
	for rows.Next() {
		var record localnet.NeedFromPost
		var lineage []byte
		if err := rows.Scan(&record.NeedID, &record.PostID, &lineage, &record.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(lineage, &record.Lineage)
		result = append(result, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func encodePostJSON(post localnet.Post) ([]byte, []byte, error) {
	mediaRefs, err := json.Marshal(post.MediaRefs)
	if err != nil {
		return nil, nil, fmt.Errorf("encode media refs: %w", err)
	}
	contextRefs, err := json.Marshal(post.ContextRefs)
	if err != nil {
		return nil, nil, fmt.Errorf("encode context refs: %w", err)
	}
	return mediaRefs, contextRefs, nil
}

var _ localnet.Repository = (*LocalNetRepository)(nil)

// ---------- LocalContext ----------

type LocalContextRepository struct {
	pool *pgxpool.Pool
}

func NewLocalContextRepository(pool *pgxpool.Pool) *LocalContextRepository {
	return &LocalContextRepository{pool: pool}
}

func (r *LocalContextRepository) GetContext(ctx context.Context, actorID string) (localcontext.LocalContext, error) {
	var lc localcontext.LocalContext
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT market_id, market_label, area_id, area_label, source, precision, updated_at
		FROM localcontext.contexts WHERE actor_id = $1`, actorID).Scan(
		&lc.MarketID, &lc.MarketLabel, &lc.AreaID, &lc.AreaLabel, &lc.Source, &lc.Precision, &lc.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return localcontext.LocalContext{}, localcontext.ErrContextNotFound
	}
	return lc, err
}

func (r *LocalContextRepository) SetContext(ctx context.Context, actorID string, lc localcontext.LocalContext) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO localcontext.contexts (actor_id, market_id, market_label, area_id, area_label, source, precision, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (actor_id) DO UPDATE SET
			market_id=$2, market_label=$3, area_id=$4, area_label=$5, source=$6, precision=$7, updated_at=$8`,
		actorID, lc.MarketID, lc.MarketLabel, lc.AreaID, lc.AreaLabel, lc.Source, lc.Precision, lc.UpdatedAt,
	)
	return err
}

func (r *LocalContextRepository) Snapshot(ctx context.Context) ([]localcontext.LocalContext, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT market_id, market_label, area_id, area_label, source, precision, updated_at
		FROM localcontext.contexts ORDER BY market_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localcontext.LocalContext{}
	for rows.Next() {
		var lc localcontext.LocalContext
		if err := rows.Scan(&lc.MarketID, &lc.MarketLabel, &lc.AreaID, &lc.AreaLabel, &lc.Source, &lc.Precision, &lc.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, lc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

var _ localcontext.Repository = (*LocalContextRepository)(nil)

// ---------- Conversation ----------

type ConversationRepository struct {
	pool *pgxpool.Pool
}

func NewConversationRepository(pool *pgxpool.Pool) *ConversationRepository {
	return &ConversationRepository{pool: pool}
}

func (r *ConversationRepository) CreateConversation(ctx context.Context, c conversation.Conversation) error {
	participants, err := json.Marshal(c.Participants)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.conversations (id, type, origin_type, origin_id, market_id, state, participants, created_at, last_message_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		c.ID, c.Type, c.OriginType, c.OriginID, c.MarketID, c.State, participants, c.CreatedAt, c.LastMessageAt,
	)
	return err
}

func (r *ConversationRepository) GetConversation(ctx context.Context, id string) (conversation.Conversation, error) {
	var c conversation.Conversation
	var participants []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, type, origin_type, origin_id, market_id, state, participants, created_at, last_message_at
		FROM conversation.conversations WHERE id = $1`, id).Scan(
		&c.ID, &c.Type, &c.OriginType, &c.OriginID, &c.MarketID, &c.State, &participants, &c.CreatedAt, &c.LastMessageAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversation.Conversation{}, conversation.ErrConversationNotFound
	}
	if err != nil {
		return conversation.Conversation{}, err
	}
	if err := json.Unmarshal(participants, &c.Participants); err != nil {
		return c, fmt.Errorf("decode participants: %w", err)
	}
	return c, nil
}
func (r *ConversationRepository) UpdateConversation(ctx context.Context, c conversation.Conversation) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `UPDATE conversation.conversations SET state=$1,last_message_at=$2 WHERE id=$3`, c.State, c.LastMessageAt, c.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return conversation.ErrConversationNotFound
	}
	return nil
}

// AppendMessage persists a message plus its MessageProtection envelope
// (Lotus Chat RFC v0.1 §3). The protection column is JSONB so future
// anti-leak fields can land without a migration. ViewCount is column-level
// because it is the hot path for MarkMessageRead (PG-side CAS via
// `view_count = view_count + 1` in UpdateMessage).
func (r *ConversationRepository) AppendMessage(ctx context.Context, m conversation.Message) error {
	protectionJSON, err := json.Marshal(m.Protection)
	if err != nil {
		return fmt.Errorf("encode protection: %w", err)
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count, convo_id, reply_to)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		m.ID, m.ConversationID, m.SenderID, m.MessageType, m.Body, m.MediaRef, m.CreatedAt, protectionJSON, m.Protection.ViewCount, m.ConvoID, m.ReplyTo,
	)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE conversation.conversations SET last_message_at = $1 WHERE id = $2`,
		m.CreatedAt, m.ConversationID,
	)
	return err
}

func (r *ConversationRepository) Messages(ctx context.Context, conversationID string) ([]conversation.Message, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count, convo_id, reply_to
		FROM conversation.messages WHERE conversation_id = $1 ORDER BY created_at`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []conversation.Message{}
	for rows.Next() {
		m, err := scanConversationMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// GetMessage fetches a single message by ID. Used by MarkMessageRead
// (bump view_count), RecordScreenshot (publish SECURITY_ALERT), and
// ForwardMessage (enforce Forwardable=false → PROTECTION_VIOLATION).
//
// Protection JSONB unmarshalling is best-effort: legacy rows from before
// migration 035 have `{}` and decode into a zero MessageProtection, which
// DefaultProtectionFor semantics (or service-layer defaults) can layer on
// top. We deliberately do NOT silently rehydrate defaults here — that
// would mask the fact that the seed path skipped protection.
func (r *ConversationRepository) GetMessage(ctx context.Context, id string) (conversation.Message, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count, convo_id, reply_to
		FROM conversation.messages WHERE id = $1`, id)
	if err != nil {
		return conversation.Message{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return conversation.Message{}, conversation.ErrMessageNotFound
	}
	m, err := scanConversationMessage(rows)
	if err != nil {
		return conversation.Message{}, err
	}
	if err := rows.Err(); err != nil {
		return conversation.Message{}, err
	}
	return m, nil
}

// UpdateMessage replaces a message in place. Currently the only mutation
// the lotus-RFC path needs is bumping view_count on MarkMessageRead, but
// the method is fully general (Body / MediaRef / Protection overwrite)
// so future command handlers (e.g. edit-with-protection-override) can
// reuse it without a second method.
//
// Note: the caller (service layer) is responsible for deciding whether
// the new view_count is legal (i.e. <= protection.view_limit). The
// repository just persists; it does not enforce view-limit accounting.
func (r *ConversationRepository) UpdateMessage(ctx context.Context, m conversation.Message) error {
	protectionJSON, err := json.Marshal(m.Protection)
	if err != nil {
		return fmt.Errorf("encode protection: %w", err)
	}
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE conversation.messages
		SET body = $1, media_ref = $2, protection = $3, view_count = $4
		WHERE id = $5`,
		m.Body, m.MediaRef, protectionJSON, m.Protection.ViewCount, m.ID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return conversation.ErrMessageNotFound
	}
	return nil
}

// scanConversationMessage reads one row from conversation.messages into
// a conversation.Message. Shared by Messages + GetMessage so the column
// list stays in sync — drift here would silently drop protection fields.
func scanConversationMessage(rows pgx.Rows) (conversation.Message, error) {
	var m conversation.Message
	var protection []byte
	var convoID *string
	if err := rows.Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.MessageType,
		&m.Body, &m.MediaRef, &m.CreatedAt, &protection, &m.Protection.ViewCount,
		&convoID, &m.ReplyTo,
	); err != nil {
		return conversation.Message{}, err
	}
	if convoID != nil && *convoID != "" {
		m.ConvoID = convoID
	}
	if len(protection) > 0 {
		if err := json.Unmarshal(protection, &m.Protection); err != nil {
			return m, fmt.Errorf("decode protection: %w", err)
		}
	}
	return m, nil
}

func (r *ConversationRepository) SaveNeedDraft(ctx context.Context, d conversation.NeedDraft) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.need_drafts (id, conversation_id, summary, confirmed, need_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		d.DraftID, d.ConversationID, d.Summary, d.Confirmed, d.NeedID, d.CreatedAt,
	)
	return err
}

func (r *ConversationRepository) GetNeedDraft(ctx context.Context, draftID string) (conversation.NeedDraft, error) {
	var d conversation.NeedDraft
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, conversation_id, summary, confirmed, need_id, created_at
		FROM conversation.need_drafts WHERE id = $1`, draftID).Scan(
		&d.DraftID, &d.ConversationID, &d.Summary, &d.Confirmed, &d.NeedID, &d.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversation.NeedDraft{}, conversation.ErrDraftNotFound
	}
	return d, err
}

func (r *ConversationRepository) UpdateNeedDraft(ctx context.Context, d conversation.NeedDraft) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE conversation.need_drafts SET summary=$1, confirmed=$2, need_id=$3 WHERE id=$4`,
		d.Summary, d.Confirmed, d.NeedID, d.DraftID,
	)
	return err
}

func (r *ConversationRepository) Snapshot(ctx context.Context) ([]conversation.Conversation, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, type, origin_type, origin_id, market_id, state, participants, created_at, last_message_at
		FROM conversation.conversations ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []conversation.Conversation{}
	for rows.Next() {
		var c conversation.Conversation
		var participants []byte
		if err := rows.Scan(&c.ID, &c.Type, &c.OriginType, &c.OriginID, &c.MarketID, &c.State, &participants, &c.CreatedAt, &c.LastMessageAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(participants, &c.Participants)
		result = append(result, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// PurgeExpiredMessages hard-deletes rows past protection.expiresAt.
// Lotus RFC §5: uses partial index idx_conversation_messages_expires_at.
// Production sweeper runs hourly; dev can call directly via worker.
func (r *ConversationRepository) PurgeExpiredMessages(ctx context.Context, now time.Time) (int64, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		DELETE FROM conversation.messages
		WHERE protection->>'expiresAt' IS NOT NULL
		  AND (protection->>'expiresAt')::timestamptz <= $1`, now.UTC())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// --- Lotus v1 Convo (Message Branch) PG 实现 ---
// convos 表结构见 040 迁移（conversation.convos），与 DialogRepository
// 共用同一张表；这里只做 Conversation 世界的读写面。

func (r *ConversationRepository) CreateConvo(ctx context.Context, c conversation.Convo) error {
	pIDs, _ := json.Marshal(c.ParticipantIDs)
	ePIDs, _ := json.Marshal(c.ExternalParticipantIDs)
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO conversation.convos (id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		c.ID, c.ParentDialogID, c.SeedMessageID, c.Title, pIDs, ePIDs, c.LatestSeq, c.CreatedAt,
	)
	return err
}

func scanConvoRow(rows pgx.Rows) (conversation.Convo, error) {
	var c conversation.Convo
	var pIDs, ePIDs []byte
	if err := rows.Scan(&c.ID, &c.ParentDialogID, &c.SeedMessageID, &c.Title, &pIDs, &ePIDs, &c.LatestSeq, &c.CreatedAt); err != nil {
		return conversation.Convo{}, err
	}
	_ = json.Unmarshal(pIDs, &c.ParticipantIDs)
	_ = json.Unmarshal(ePIDs, &c.ExternalParticipantIDs)
	return c, nil
}

func (r *ConversationRepository) GetConvo(ctx context.Context, id string) (conversation.Convo, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at
		FROM conversation.convos WHERE id = $1`, id)
	if err != nil {
		return conversation.Convo{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return conversation.Convo{}, conversation.ErrConvoNotFound
	}
	c, err := scanConvoRow(rows)
	if err != nil {
		return conversation.Convo{}, err
	}
	return c, rows.Err()
}

func (r *ConversationRepository) ListConvosByConversation(ctx context.Context, conversationID string) ([]conversation.Convo, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at
		FROM conversation.convos WHERE parent_dialog_id = $1 ORDER BY created_at`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []conversation.Convo{}
	for rows.Next() {
		c, err := scanConvoRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

func (r *ConversationRepository) ListConvosByUser(ctx context.Context, userID string) ([]conversation.Convo, error) {
	needle, _ := json.Marshal([]string{userID})
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, parent_dialog_id, seed_message_id, title, participant_ids, external_participant_ids, latest_seq, created_at
		FROM conversation.convos WHERE participant_ids @> $1 ORDER BY created_at DESC`, needle)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []conversation.Convo{}
	for rows.Next() {
		c, err := scanConvoRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

var _ conversation.Repository = (*ConversationRepository)(nil)

// ---------- Engagement ----------

type EngagementRepository struct {
	pool *pgxpool.Pool
}

func NewEngagementRepository(pool *pgxpool.Pool) *EngagementRepository {
	return &EngagementRepository{pool: pool}
}

func (r *EngagementRepository) AddFollow(ctx context.Context, f engagement.Follow) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.follows (follower_id, followee_id, created_at)
		VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
		f.FollowerID, f.FolloweeID, f.CreatedAt,
	)
	return err
}

// R15.54 — RemoveFollow: 幂等返 (true=刪了, false=之前没有)
func (r *EngagementRepository) RemoveFollow(ctx context.Context, followerID, followeeID string) (bool, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		DELETE FROM engagement.follows WHERE follower_id = $1 AND followee_id = $2`,
		followerID, followeeID,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// R15.54 — CountFollowers: 数 FolloweeID == userID
func (r *EngagementRepository) CountFollowers(ctx context.Context, userID string) (int, error) {
	var n int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COUNT(*) FROM engagement.follows WHERE followee_id = $1`, userID).Scan(&n)
	return n, err
}

// R15.54 — CountFollowing: 数 FollowerID == userID
func (r *EngagementRepository) CountFollowing(ctx context.Context, userID string) (int, error) {
	var n int
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COUNT(*) FROM engagement.follows WHERE follower_id = $1`, userID).Scan(&n)
	return n, err
}

// R15.54 — IsFollowing: actor 是否 follow 了 target
func (r *EngagementRepository) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	var exists bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM engagement.follows WHERE follower_id = $1 AND followee_id = $2)`,
		followerID, followeeID).Scan(&exists)
	return exists, err
}

// R15.56 — AddPostPin: ON CONFLICT 幂等返 (stored, created=false, nil) 如果已存在
func (r *EngagementRepository) AddPostPin(ctx context.Context, p engagement.PostPin) (engagement.PostPin, bool, error) {
	var created bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO engagement.post_pins (pin_id, owner_id, post_id, created_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id, post_id) DO NOTHING RETURNING (xmax <> 0)`,
		p.PinID, p.OwnerID, p.PostID, p.CreatedAt,
	).Scan(&created)
	if err != nil {
		// 无 RETURNING 行 = 冲突, 查现存的
		if err.Error() == "no rows in result set" {
			var existing engagement.PostPin
			err2 := queryerForContext(ctx, r.pool).QueryRow(ctx, `
				SELECT pin_id, owner_id, post_id, created_at FROM engagement.post_pins
				WHERE owner_id = $1 AND post_id = $2`,
				p.OwnerID, p.PostID,
			).Scan(&existing.PinID, &existing.OwnerID, &existing.PostID, &existing.CreatedAt)
			if err2 != nil {
				return engagement.PostPin{}, false, err2
			}
			return existing, false, nil
		}
		return engagement.PostPin{}, false, err
	}
	return p, created, nil
}

// R15.56 — RemovePostPin
func (r *EngagementRepository) RemovePostPin(ctx context.Context, ownerID, postID string) (bool, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		DELETE FROM engagement.post_pins WHERE owner_id = $1 AND post_id = $2`,
		ownerID, postID,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// R15.56 — ListPinnedPosts: 按 created_at ASC 返 postID 列表
func (r *EngagementRepository) ListPinnedPosts(ctx context.Context, ownerID string) ([]string, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT post_id FROM engagement.post_pins WHERE owner_id = $1 ORDER BY created_at ASC`,
		ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// R15.61 — ListRepliesByActor (ORDER BY created_at DESC, LIMIT)
func (r *EngagementRepository) ListRepliesByActor(ctx context.Context, actorID string, limit int) ([]engagement.Reply, error) {
	if limit <= 0 {
		limit = 30
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT reply_id, post_id, actor_id, body, created_at
		FROM engagement.replies
		WHERE actor_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []engagement.Reply
	for rows.Next() {
		var r engagement.Reply
		if err := rows.Scan(&r.ID, &r.PostID, &r.ActorID, &r.Body, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

// R15.62 — ListBookmarksByActor (ORDER BY created_at DESC, LIMIT)
func (r *EngagementRepository) ListBookmarksByActor(ctx context.Context, actorID string, limit int) ([]engagement.Bookmark, error) {
	if limit <= 0 {
		limit = 60
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT bookmark_id, post_id, actor_id, created_at
		FROM engagement.bookmarks
		WHERE actor_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []engagement.Bookmark
	for rows.Next() {
		var b engagement.Bookmark
		if err := rows.Scan(&b.ID, &b.PostID, &b.ActorID, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

func (r *EngagementRepository) SetReaction(ctx context.Context, re engagement.Reaction, active bool) (bool, error) {
	if !active {
		_, err := queryerForContext(ctx, r.pool).Exec(ctx, `DELETE FROM engagement.reactions WHERE post_id=$1 AND actor_id=$2`, re.PostID, re.ActorID)
		return false, err
	}
	// R16.12: 走 insertEngagementRow 让 FK(23503) 违例翻译成 ErrPostNotFound
	// （点赞不存在的帖 → 业务码而非 500）。ON CONFLICT DO UPDATE 使 23505
	// 不可能出现，因此 alreadyExistsErr 传 nil。
	if err := insertEngagementRow(ctx, r.pool,
		`INSERT INTO engagement.reactions (id, post_id, actor_id, kind, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (post_id, actor_id) DO UPDATE SET kind=EXCLUDED.kind`,
		[]any{re.ID, re.PostID, re.ActorID, re.Kind, re.CreatedAt}, nil); err != nil {
		return false, err
	}
	return true, nil
}

func (r *EngagementRepository) AddReply(ctx context.Context, re engagement.Reply) error {
	return insertEngagementRow(ctx, r.pool, `
		INSERT INTO engagement.replies (reply_id, post_id, actor_id, body, created_at)
		VALUES ($1,$2,$3,$4,$5)`,
		[]any{re.ID, re.PostID, re.ActorID, re.Body, re.CreatedAt},
		nil, // replies 无 UNIQUE(post,actor) — 只有 FK 违例需要映射
	)
}

func (r *EngagementRepository) ListRepliesByPost(ctx context.Context, postID string, limit int) ([]engagement.Reply, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT reply_id, post_id, actor_id, body, created_at FROM engagement.replies WHERE post_id=$1 ORDER BY created_at DESC, reply_id DESC LIMIT $2`, postID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []engagement.Reply{}
	for rows.Next() {
		var reply engagement.Reply
		if err := rows.Scan(&reply.ID, &reply.PostID, &reply.ActorID, &reply.Body, &reply.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, reply)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// ListPostIDsWithMatchingReply 见 engagement.Repository 上的注释
// （SEARCH-CORPUS-003）：feed 搜索的「评论语料」由 engagement 持有，所以
// 判定写在这里而不是让 localnet 去猜。
//
// 用 strpos 而不是 LIKE：查询串是**字面**子串，用户敲的 "%" 就该匹配百分号
// 本身（PROFILE-SEARCH-001）。
func (r *EngagementRepository) ListPostIDsWithMatchingReply(ctx context.Context, postIDs []string, loweredQuery string) (map[string]bool, error) {
	hits := make(map[string]bool)
	if len(postIDs) == 0 || strings.TrimSpace(loweredQuery) == "" {
		return hits, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT DISTINCT post_id FROM engagement.replies
		WHERE post_id = ANY($1) AND strpos(lower(body), $2) > 0`, postIDs, strings.ToLower(loweredQuery))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var postID string
		if err := rows.Scan(&postID); err != nil {
			return nil, err
		}
		hits[postID] = true
	}
	return hits, rows.Err()
}

func (r *EngagementRepository) AddRepost(ctx context.Context, re engagement.Repost) error {
	return insertEngagementRow(ctx, r.pool, `
		INSERT INTO engagement.reposts (id, post_id, actor_id, created_at)
		VALUES ($1,$2,$3,$4)`,
		[]any{re.ID, re.PostID, re.ActorID, re.CreatedAt},
		engagement.ErrRepostAlreadyExists,
	)
}

func (r *EngagementRepository) AddBookmark(ctx context.Context, b engagement.Bookmark) error {
	return insertEngagementRow(ctx, r.pool, `
		INSERT INTO engagement.bookmarks (bookmark_id, post_id, actor_id, created_at)
		VALUES ($1,$2,$3,$4)`,
		[]any{b.ID, b.PostID, b.ActorID, b.CreatedAt},
		engagement.ErrBookmarkAlreadyExists,
	)
}

// insertEngagementRow 执行 engagement 写路径 INSERT, 并把 PG 约束违例翻译成域哨兵错误。
//
// R16.12 背景 (audit 2026-09-03): 直接 Exec 时, UNIQUE(post_id, actor_id) 冲突 (23505)
// 或 FK(post_id) 违例 (23503) 会把外层 command dispatch 事务毒死 — 后续
// Idempotency.Complete 在同一事务里写幂等记录时撞 25P02 (transaction aborted),
// 整个命令变成 500 command_transaction_failed, 吞掉 service 层本该返回的业务 REJECTED。
//
// 方案: SAVEPOINT 包住 INSERT。违例时 ROLLBACK TO SAVEPOINT 只回滚这一条,
// 外层事务保持可用 (幂等记录能正常落库), 同时把 pgconn.PgError 翻译成域错误:
//   - 23505 unique_violation → alreadyExistsErr (调用方指定, 如 ErrReactionAlreadyExists)
//   - 23503 foreign_key_violation → engagement.ErrPostNotFound (帖子不存在)
//
// 其余错误原样上抛 (含非事务上下文里的写失败)。
func insertEngagementRow(ctx context.Context, pool *pgxpool.Pool, sql string, args []any, alreadyExistsErr error) error {
	q := queryerForContext(ctx, pool)
	savepointID := "engagement_write_" + newSavepointToken()
	if _, err := q.Exec(ctx, "SAVEPOINT "+savepointID); err != nil {
		// 保存点建不起来 (连接故障等) — 直接执行原始 INSERT, 保留旧行为
		_, execErr := q.Exec(ctx, sql, args...)
		return execErr
	}
	if _, err := q.Exec(ctx, sql, args...); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && (pgErr.Code == "23505" || pgErr.Code == "23503") {
			// 约束违例是预期内的业务分支: 回滚保存点救活外层事务, 返域哨兵
			if _, rollbackErr := q.Exec(ctx, "ROLLBACK TO SAVEPOINT "+savepointID); rollbackErr != nil {
				return rollbackErr
			}
			if pgErr.Code == "23505" {
				if alreadyExistsErr != nil {
					return alreadyExistsErr
				}
				return err
			}
			return engagement.ErrPostNotFound
		}
		return err
	}
	if _, err := q.Exec(ctx, "RELEASE SAVEPOINT "+savepointID); err != nil {
		return err
	}
	return nil
}

// newSavepointToken 生成 SAVEPOINT 名里的随机段, 避免嵌套调用时撞名。
var savepointSource = randomTokenSource{}

func newSavepointToken() string { return savepointSource.token() }

type randomTokenSource struct{}

func (randomTokenSource) token() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		// 不可依赖 crypto 随机时退化为时间戳 — savepoint 名只需同事务内唯一
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func (r *EngagementRepository) AddFeedPreference(ctx context.Context, preference engagement.FeedPreference) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.feed_preferences (id, actor_id, post_id, author_id, action, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, preference.ID, preference.ActorID, preference.PostID, preference.AuthorID, preference.Action, preference.CreatedAt)
	return err
}

func (r *EngagementRepository) AddPostReport(ctx context.Context, report engagement.PostReport) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.post_reports (id, actor_id, post_id, reason, state, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, report.ID, report.ActorID, report.PostID, report.Reason, report.State, report.CreatedAt)
	return err
}

// AddMutedAuthor R15.45 — 幂等 mute 记录。
// ON CONFLICT (actor_id, author_id) DO NOTHING + RETURNING 用于检测是否新插入。
// 返回 (record, alreadyExisted, error).
func (r *EngagementRepository) AddMutedAuthor(ctx context.Context, mute engagement.MutedAuthor) (engagement.MutedAuthor, bool, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO engagement.muted_authors (id, actor_id, author_id, created_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (actor_id, author_id) DO NOTHING
		RETURNING id, actor_id, author_id, created_at`, mute.ID, mute.ActorID, mute.AuthorID, mute.CreatedAt)
	var out engagement.MutedAuthor
	if err := row.Scan(&out.ID, &out.ActorID, &out.AuthorID, &out.CreatedAt); err != nil {
		// ON CONFLICT 不命中: SELECT 现有记录
		if err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
			SELECT id, actor_id, author_id, created_at FROM engagement.muted_authors
			WHERE actor_id=$1 AND author_id=$2`, mute.ActorID, mute.AuthorID).Scan(&out.ID, &out.ActorID, &out.AuthorID, &out.CreatedAt); err != nil {
			return engagement.MutedAuthor{}, false, err
		}
		return out, true, nil
	}
	return out, false, nil
}

func (r *EngagementRepository) IsMuted(ctx context.Context, actorID, authorID string) (bool, error) {
	var count int
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT COUNT(*) FROM engagement.muted_authors
		WHERE actor_id=$1 AND author_id=$2`, actorID, authorID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

// RemoveMutedAuthor MUTE-REVERSIBLE-001 — 解除屏蔽。
// 返回是否真的删掉了：false = 本来就没屏蔽（幂等，重复 unmute 不报错）。
// 用 RowsAffected 而不是先 SELECT 再 DELETE，避免并发下 TOCTOU。
func (r *EngagementRepository) RemoveMutedAuthor(ctx context.Context, actorID, authorID string) (bool, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		DELETE FROM engagement.muted_authors
		WHERE actor_id=$1 AND author_id=$2`, actorID, authorID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListMutedAuthors MUTE-REVERSIBLE-001 — 「我屏蔽的人」，最新在前。
// 排序必须跟 MemoryRepository.ListMutedAuthors 一致（created_at DESC，
// id DESC 兜底）：否则同一份断言在内存与 PG 两种 repo 下会给出不同顺序。
// 走 idx_engagement_muted_authors_actor (actor_id, created_at DESC)。
func (r *EngagementRepository) ListMutedAuthors(ctx context.Context, actorID string) ([]engagement.MutedAuthor, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, actor_id, author_id, created_at FROM engagement.muted_authors
		WHERE actor_id=$1
		ORDER BY created_at DESC, id DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// 归一 nil → 空切片：读模型 JSON 输出 [] 而非 null（客户端 zod fail-closed）。
	out := make([]engagement.MutedAuthor, 0)
	for rows.Next() {
		var mute engagement.MutedAuthor
		if err := rows.Scan(&mute.ID, &mute.ActorID, &mute.AuthorID, &mute.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, mute)
	}
	return out, rows.Err()
}

func (r *EngagementRepository) Engagement(ctx context.Context, postID string, viewerIDs ...string) (engagement.PostEngagement, error) {
	e := engagement.PostEngagement{PostID: postID}
	var reactions, replies, reposts int
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx,
		`SELECT COUNT(*) FROM engagement.reactions WHERE post_id=$1`, postID).Scan(&reactions); err != nil {
		return e, err
	}
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx,
		`SELECT COUNT(*) FROM engagement.replies WHERE post_id=$1`, postID).Scan(&replies); err != nil {
		return e, err
	}
	if err := queryerForContext(ctx, r.pool).QueryRow(ctx,
		`SELECT COUNT(*) FROM engagement.reposts WHERE post_id=$1`, postID).Scan(&reposts); err != nil {
		return e, err
	}
	e.Reactions, e.Replies, e.Reposts = reactions, replies, reposts
	if len(viewerIDs) > 0 && viewerIDs[0] != "" {
		if err := queryerForContext(ctx, r.pool).QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM engagement.reactions WHERE post_id=$1 AND actor_id=$2)`, postID, viewerIDs[0]).Scan(&e.Reacted); err != nil {
			return e, err
		}
	}
	return e, nil
}

var _ engagement.Repository = (*EngagementRepository)(nil)
