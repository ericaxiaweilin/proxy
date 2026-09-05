package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/relationship"
)

// RelationshipRepository persists friendships in
// relationship.friendships (migration 040). The (a,b)
// pair is canonicalised on insert via a CHECK constraint
// (user_a < user_b), so the in-memory orderPair() helper
// in the domain layer and the SQL CHECK agree on which
// user is UserA.
type RelationshipRepository struct {
	pool *pgxpool.Pool
}

func NewRelationshipRepository(pool *pgxpool.Pool) *RelationshipRepository {
	return &RelationshipRepository{pool: pool}
}

func (r *RelationshipRepository) UpsertFriendship(ctx context.Context, rec relationship.FriendshipRecord) (relationship.FriendshipRecord, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		INSERT INTO relationship.friendships (id, user_a, user_b, state, requester_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (user_a, user_b) DO UPDATE SET
			state=EXCLUDED.state,
			requester_id=EXCLUDED.requester_id,
			updated_at=EXCLUDED.updated_at
		RETURNING id, user_a, user_b, state, requester_id, created_at, updated_at`,
		rec.ID, rec.UserA, rec.UserB, string(rec.State), rec.RequesterID, rec.CreatedAt, rec.UpdatedAt)
	var state string
	var out relationship.FriendshipRecord
	if err := row.Scan(&out.ID, &out.UserA, &out.UserB, &state, &out.RequesterID, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return relationship.FriendshipRecord{}, err
	}
	out.State = relationship.FriendshipStatus(state)
	return out, nil
}

func (r *RelationshipRepository) GetFriendship(ctx context.Context, userA, userB string) (relationship.FriendshipRecord, error) {
	a, b := orderPair(userA, userB)
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_a, user_b, state, requester_id, created_at, updated_at
		FROM relationship.friendships
		WHERE user_a=$1 AND user_b=$2 AND state <> 'IGNORED_TOMBSTONE'`, a, b)
	var state string
	var rec relationship.FriendshipRecord
	if err := row.Scan(&rec.ID, &rec.UserA, &rec.UserB, &state, &rec.RequesterID, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
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
		SELECT id, user_a, user_b, state, requester_id, created_at, updated_at
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
		if err := rows.Scan(&rec.ID, &rec.UserA, &rec.UserB, &state, &rec.RequesterID, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
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
