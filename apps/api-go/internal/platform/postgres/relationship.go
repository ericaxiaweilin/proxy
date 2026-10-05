package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/relationship"
)

// RelationshipRepository persists friendships in
// relationship.friendships (migration 040). The (a,b)
// pair is canonicalised on insert via a CHECK constraint
// (user_a < user_b), so the in-memory orderPair() helper
// in the domain layer and the SQL CHECK agree on which
// user is UserA.
type RelationshipRepository struct {
	pool   *pgxpool.Pool
	outbox *OutboxRepository
}

// NewRelationshipRepository 只读用法/测试用（没有 outbox ⇒ 不能发事件）。
func NewRelationshipRepository(pool *pgxpool.Pool) *RelationshipRepository {
	return &RelationshipRepository{pool: pool}
}

// NewRelationshipRepositoryWithOutbox 是生产接线：好友请求要能通知到人。
func NewRelationshipRepositoryWithOutbox(pool *pgxpool.Pool, outboxRepository *OutboxRepository) *RelationshipRepository {
	return &RelationshipRepository{pool: pool, outbox: outboxRepository}
}

func (r *RelationshipRepository) UpsertFriendship(ctx context.Context, rec relationship.FriendshipRecord) (relationship.FriendshipRecord, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO relationship.friendships (id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_a, user_b) DO UPDATE SET
			state=EXCLUDED.state,
			requester_id=EXCLUDED.requester_id,
			blocked_by=EXCLUDED.blocked_by,
			updated_at=EXCLUDED.updated_at
		RETURNING id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at`,
		rec.ID, rec.UserA, rec.UserB, string(rec.State), rec.RequesterID, rec.BlockedBy, rec.CreatedAt, rec.UpdatedAt)
	var state string
	var out relationship.FriendshipRecord
	if err := row.Scan(&out.ID, &out.UserA, &out.UserB, &state, &out.RequesterID, &out.BlockedBy, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return relationship.FriendshipRecord{}, err
	}
	out.State = relationship.FriendshipStatus(state)
	return out, nil
}

// UpsertFriendshipAndPublish：好友关系与「对方收到了好友申请」这个事件同一事务。
//
// MERCHANT-CREATOR-NOTIFY-001：改之前 UpsertFriendship 只写关系表，事件只在
// Result.EventRefs 里回给**发起申请的本人** —— 而「对方」在另一台手机上什么
// 都收不到。申请挂在那里，对方不打开 App 就永远不知道。
func (r *RelationshipRepository) UpsertFriendshipAndPublish(ctx context.Context, rec relationship.FriendshipRecord, domainEvents []event.DomainEvent) (relationship.FriendshipRecord, error) {
	if r.outbox == nil {
		return relationship.FriendshipRecord{}, errors.New("relationship transactional outbox is not configured")
	}
	if len(domainEvents) == 0 {
		return relationship.FriendshipRecord{}, errors.New("UpsertFriendshipAndPublish requires at least one domain event")
	}
	var out relationship.FriendshipRecord
	var state string
	err := runInTransaction(ctx, r.pool, func(transactionContext context.Context, transaction pgx.Tx) error {
		row := queryerForContext(transactionContext, r.pool).QueryRow(transactionContext, `
			INSERT INTO relationship.friendships (id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (user_a, user_b) DO UPDATE SET
				state=EXCLUDED.state,
				requester_id=EXCLUDED.requester_id,
				blocked_by=EXCLUDED.blocked_by,
				updated_at=EXCLUDED.updated_at
			RETURNING id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at`,
			rec.ID, rec.UserA, rec.UserB, string(rec.State), rec.RequesterID, rec.BlockedBy, rec.CreatedAt, rec.UpdatedAt)
		if err := row.Scan(&out.ID, &out.UserA, &out.UserB, &state, &out.RequesterID, &out.BlockedBy, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		for _, domainEvent := range domainEvents {
			if err := r.outbox.publishWithExec(transactionContext, transaction, domainEvent); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return relationship.FriendshipRecord{}, err
	}
	out.State = relationship.FriendshipStatus(state)
	return out, nil
}

func (r *RelationshipRepository) GetFriendship(ctx context.Context, userA, userB string) (relationship.FriendshipRecord, error) {
	a, b := orderPair(userA, userB)
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at
		FROM relationship.friendships
		WHERE user_a=$1 AND user_b=$2 AND state <> 'IGNORED_TOMBSTONE'`, a, b)
	var state string
	var rec relationship.FriendshipRecord
	if err := row.Scan(&rec.ID, &rec.UserA, &rec.UserB, &state, &rec.RequesterID, &rec.BlockedBy, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return relationship.FriendshipRecord{}, relationship.ErrFriendshipNotFound
		}
		return relationship.FriendshipRecord{}, err
	}
	rec.State = relationship.FriendshipStatus(state)
	return rec, nil
}

func (r *RelationshipRepository) ListByUser(ctx context.Context, userID string) ([]relationship.FriendshipRecord, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, user_a, user_b, state, requester_id, blocked_by, created_at, updated_at
		FROM relationship.friendships
		WHERE (user_a=$1 OR user_b=$1) AND state <> 'IGNORED_TOMBSTONE'
		ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]relationship.FriendshipRecord, 0, 8)
	for rows.Next() {
		var state string
		var rec relationship.FriendshipRecord
		if err := rows.Scan(&rec.ID, &rec.UserA, &rec.UserB, &state, &rec.RequesterID, &rec.BlockedBy, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		rec.State = relationship.FriendshipStatus(state)
		out = append(out, rec)
	}
	return out, rows.Err()
}

func orderPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

var _ relationship.Repository = (*RelationshipRepository)(nil)

// compile-time avoidance of an unused-import warning when
// the package is included but the test file is not
var _ = time.Time{}
