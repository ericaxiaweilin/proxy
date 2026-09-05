package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
			visibility, city_scope, scene_type, status, context_refs, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		post.ID, post.AuthorType, post.AuthorID, post.AuthorDisplayName, post.Body, mediaRefs,
		post.Visibility, post.CityScope, nullIfEmptyNetwork(post.SceneType), post.Status, contextRefs, post.CreatedAt,
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
			visibility, city_scope, scene_type, status, context_refs, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
			context_refs=EXCLUDED.context_refs`,
		post.ID, post.AuthorType, post.AuthorID, post.AuthorDisplayName, post.Body, mediaRefs,
		post.Visibility, post.CityScope, nullIfEmptyNetwork(post.SceneType), post.Status, contextRefs, post.CreatedAt,
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
	var sceneType *string
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, author_type, author_id, author_display_name, body, media_refs,
			visibility, city_scope, scene_type, status, context_refs, created_at
		FROM localnet.posts WHERE id = $1`, id).Scan(
		&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
		&post.Visibility, &post.CityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
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
			visibility, city_scope, scene_type, status, context_refs, created_at
		FROM localnet.posts ORDER BY created_at DESC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []localnet.Post{}
	for rows.Next() {
		var post localnet.Post
		var mediaRefs, contextRefs []byte
		var sceneType *string
		if err := rows.Scan(
			&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
			&post.Visibility, &post.CityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(mediaRefs, &post.MediaRefs)
		_ = json.Unmarshal(contextRefs, &post.ContextRefs)
		if sceneType != nil {
			post.SceneType = *sceneType
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
			visibility, city_scope, scene_type, status, context_refs, created_at
		FROM localnet.posts
		WHERE status='PUBLISHED'
		  AND (visibility='PUBLIC' OR (visibility='FOLLOWERS' AND author_id=$1))
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
		var sceneType *string
		if err := rows.Scan(
			&post.ID, &post.AuthorType, &post.AuthorID, &post.AuthorDisplayName, &post.Body, &mediaRefs,
			&post.Visibility, &post.CityScope, &sceneType, &post.Status, &contextRefs, &post.CreatedAt,
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
		result = append(result, post)
	}
	return result, rows.Err()
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
		INSERT INTO localnet.interaction_events (event_id, event_type, actor_id, target_type, target_id, need_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		ie.EventID, ie.EventType, ie.ActorID, ie.TargetType, ie.TargetID, ie.NeedID, ie.CreatedAt,
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
		INSERT INTO conversation.messages (id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		m.ID, m.ConversationID, m.SenderID, m.MessageType, m.Body, m.MediaRef, m.CreatedAt, protectionJSON, m.Protection.ViewCount,
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
		SELECT id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count
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
		SELECT id, conversation_id, sender_id, message_type, body, media_ref, created_at, protection, view_count
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
	if err := rows.Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.MessageType,
		&m.Body, &m.MediaRef, &m.CreatedAt, &protection, &m.Protection.ViewCount,
	); err != nil {
		return conversation.Message{}, err
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
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO engagement.reactions (id, post_id, actor_id, kind, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (post_id, actor_id) DO UPDATE SET kind=EXCLUDED.kind`, re.ID, re.PostID, re.ActorID, re.Kind, re.CreatedAt)
	return true, err
}

func (r *EngagementRepository) AddReply(ctx context.Context, re engagement.Reply) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.replies (reply_id, post_id, actor_id, body, created_at)
		VALUES ($1,$2,$3,$4,$5)`,
		re.ID, re.PostID, re.ActorID, re.Body, re.CreatedAt,
	)
	return err
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

func (r *EngagementRepository) AddRepost(ctx context.Context, re engagement.Repost) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.reposts (id, post_id, actor_id, created_at)
		VALUES ($1,$2,$3,$4)`,
		re.ID, re.PostID, re.ActorID, re.CreatedAt,
	)
	return err
}

func (r *EngagementRepository) AddBookmark(ctx context.Context, b engagement.Bookmark) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO engagement.bookmarks (bookmark_id, post_id, actor_id, created_at)
		VALUES ($1,$2,$3,$4)`,
		b.ID, b.PostID, b.ActorID, b.CreatedAt,
	)
	return err
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
