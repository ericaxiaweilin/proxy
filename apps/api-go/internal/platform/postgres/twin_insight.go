package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/twininsight"
)

// TwinInsightRepository 是好友洞察读模型（TWIN-INSIGHT-002）的 Postgres 实现。
//
// 这个仓储**跨 schema 直读**四组表，这是刻意的，不是越界：
//
//	localnet.interaction_events          主页访问 / 媒体停留
//	localnet.posts                       帖子（媒体与点赞都挂在帖子上）
//	engagement.reactions                 点赞
//	conversation.conversations/messages  对话
//
// 「某个好友值不值得运营」这个问题不属于上面任何一个域，所以它没有天然的
// 归属；拆成四次服务调用再在 Go 里 join，只会把同一个 7 天窗口条件写四遍、
// 多三次往返，还得在 Go 里对四个 map 做外连接。这个包**只读不写** ——
// 写入路径仍然各归各域（operate 的审计表见 migrations/114）。
type TwinInsightRepository struct {
	pool *pgxpool.Pool
}

func NewTwinInsightRepository(pool *pgxpool.Pool) *TwinInsightRepository {
	return &TwinInsightRepository{pool: pool}
}

// ListFacts 返回 ownerID 在 since 之后的全部关系信号原料。
//
// 这里**不过滤好友**：好友集合归 relationship 域，本仓储不认识「好友」
// （同 localnet 的立场）。它按 actor 聚合出所有交互过的人，由 twininsight
// 的 Service 与好友名单求交集。多算几个 actor 的代价远小于把好友概念
// 抄进第四个包。
//
// 关于对话：只算**双人**会话（jsonb_array_length(participants) = 2）。
// 群聊里一条消息属于一群人，把它算成"这个人给你发了消息"是把群里的
// 热闹记到某一个人头上 —— 那是编数据。群聊洞察不在 v1 范围（PRD §2 OUT）。
func (r *TwinInsightRepository) ListFacts(ctx context.Context, ownerID string, since time.Time) (twininsight.Facts, error) {
	out := twininsight.Facts{Signals: []twininsight.SignalFact{}, Events: []twininsight.RecentEvent{}}
	q := queryerForContext(ctx, r.pool)

	signals, err := q.Query(ctx, `
		WITH win AS (
			SELECT actor_id, event_type, target_type, target_id, watch_ms, created_at
			FROM localnet.interaction_events
			WHERE created_at >= $2
		),
		views AS (
			SELECT actor_id, COUNT(*) AS n, MAX(created_at) AS last_at
			FROM win
			WHERE event_type = 'PROFILE_OPEN' AND target_type = 'PROFILE' AND target_id = $1
			GROUP BY actor_id
		),
		dwell AS (
			SELECT w.actor_id, COUNT(*) AS opens,
				COALESCE(SUM(w.watch_ms), 0) AS total_ms,
				MAX(w.created_at) AS last_at
			FROM win w
			WHERE w.event_type = 'MEDIA_IMPRESSION' AND w.target_type = 'MEDIA'
				AND EXISTS (
					SELECT 1 FROM localnet.posts p
					WHERE p.author_id = $1
						AND jsonb_typeof(p.media_refs) = 'array'
						AND EXISTS (
							SELECT 1 FROM jsonb_array_elements(p.media_refs) item
							WHERE item->>'mediaAssetId' = w.target_id
						)
				)
			GROUP BY w.actor_id
		),
		likes AS (
			SELECT r.actor_id, COUNT(*) AS n, MAX(r.created_at) AS last_at
			FROM engagement.reactions r
			JOIN localnet.posts p ON p.id = r.post_id
			WHERE p.author_id = $1 AND r.created_at >= $2
			GROUP BY r.actor_id
		),
		msgs AS (
			SELECT other.actor_id, COUNT(*) AS n, MAX(m.created_at) AS last_at
			FROM conversation.messages m
			JOIN conversation.conversations c ON c.id = m.conversation_id
			CROSS JOIN LATERAL (
				SELECT elem AS actor_id
				FROM jsonb_array_elements_text(c.participants) elem
				WHERE elem <> $1
			) other
			WHERE m.created_at >= $2
				AND m.deleted_at IS NULL
				AND jsonb_array_length(c.participants) = 2
				AND c.participants @> to_jsonb(ARRAY[$1::text])
			GROUP BY other.actor_id
		),
		actors AS (
			SELECT actor_id FROM views
			UNION SELECT actor_id FROM dwell
			UNION SELECT actor_id FROM likes
			UNION SELECT actor_id FROM msgs
		)
		SELECT a.actor_id,
			COALESCE(v.n, 0),
			COALESCE(m.n, 0),
			COALESCE(d.opens, 0),
			COALESCE(d.total_ms, 0),
			COALESCE(l.n, 0),
			GREATEST(
				COALESCE(v.last_at, 'epoch'::timestamptz),
				COALESCE(d.last_at, 'epoch'::timestamptz),
				COALESCE(l.last_at, 'epoch'::timestamptz),
				COALESCE(m.last_at, 'epoch'::timestamptz)
			) AS last_signal_at
		FROM actors a
		LEFT JOIN views v ON v.actor_id = a.actor_id
		LEFT JOIN dwell d ON d.actor_id = a.actor_id
		LEFT JOIN likes l ON l.actor_id = a.actor_id
		LEFT JOIN msgs  m ON m.actor_id = a.actor_id`, ownerID, since)
	if err != nil {
		return out, err
	}
	defer signals.Close()
	for signals.Next() {
		var fact twininsight.SignalFact
		if err := signals.Scan(&fact.ActorID, &fact.Views7d, &fact.Messages7d,
			&fact.DwellOpens, &fact.TotalWatchMs, &fact.Likes7d, &fact.LastSignalAt); err != nil {
			return out, err
		}
		out.Signals = append(out.Signals, fact)
	}
	if err := signals.Err(); err != nil {
		return out, err
	}

	events, err := q.Query(ctx, `
		WITH win AS (
			SELECT actor_id, 'PROFILE_OPEN'::text AS kind, created_at, false AS by_owner
			FROM localnet.interaction_events
			WHERE created_at >= $2 AND event_type = 'PROFILE_OPEN'
				AND target_type = 'PROFILE' AND target_id = $1
			UNION ALL
			SELECT r.actor_id, 'LIKE', r.created_at, false
			FROM engagement.reactions r
			JOIN localnet.posts p ON p.id = r.post_id
			WHERE p.author_id = $1 AND r.created_at >= $2
			UNION ALL
			SELECT other.actor_id, 'MESSAGE', m.created_at, (m.sender_id = $1)
			FROM conversation.messages m
			JOIN conversation.conversations c ON c.id = m.conversation_id
			CROSS JOIN LATERAL (
				SELECT elem AS actor_id
				FROM jsonb_array_elements_text(c.participants) elem
				WHERE elem <> $1
			) other
			WHERE m.created_at >= $2
				AND m.deleted_at IS NULL
				AND jsonb_array_length(c.participants) = 2
				AND c.participants @> to_jsonb(ARRAY[$1::text])
		)
		SELECT actor_id, kind, by_owner, created_at
		FROM win
		ORDER BY created_at DESC
		LIMIT $3`, ownerID, since, 200)
	if err != nil {
		return out, err
	}
	defer events.Close()
	for events.Next() {
		var event twininsight.RecentEvent
		var kind string
		if err := events.Scan(&event.ActorID, &kind, &event.ByOwner, &event.At); err != nil {
			return out, err
		}
		event.Kind = twininsight.EventKind(kind)
		out.Events = append(out.Events, event)
	}
	return out, events.Err()
}

// RecordAction 追加一行运营动作审计（TWIN-INSIGHT-002 写侧）。
//
// 只有 INSERT —— 表上还有 BEFORE UPDATE/DELETE 触发器在数据库层兜底
// （migrations/114），所以这里即使写错也改不动历史行。
// owner_id 由服务端盖章（internal/twininsight 的 RecordOperate 从会话取），
// 客户端无法把它指向别人。
func (r *TwinInsightRepository) RecordAction(ctx context.Context, action twininsight.RecordedAction) error {
	_, err := execerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO ai.twin_operate_actions (id, twin_id, owner_id, target_id, action, acted_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		action.ID, action.TwinID, action.OwnerID, action.TargetID, string(action.Action), action.ActedAt)
	return err
}
