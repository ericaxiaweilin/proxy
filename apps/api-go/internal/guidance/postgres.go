package guidance

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) LoadState(ctx context.Context, userID string) (State, error) {
	var s State
	err := p.pool.QueryRow(ctx, `
		SELECT
		  EXISTS (SELECT 1 FROM identity.profiles WHERE user_account_id = $1 AND btrim(name) <> '' AND avatar_path <> ''),
		  (SELECT COUNT(*) FROM localnet.posts WHERE author_id = $1 AND author_type = 'USER' AND status = 'PUBLISHED'),
		  (SELECT COUNT(*) FROM marketplace.opportunities WHERE owner_id = $1)
		    + (SELECT COUNT(*) FROM fulfillment.orders WHERE requester_id = $1),
		  (SELECT COUNT(*) FROM activity.participants WHERE actor_id = $1)`, userID).
		Scan(&s.ProfileComplete, &s.Posts, &s.Demands, &s.ActivitiesJoined)
	return s, err
}

func (p *Postgres) Candidates(ctx context.Context, now time.Time, minAge, maxAge time.Duration, limit int) ([]string, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id FROM identity.user_accounts
		 WHERE status = 'ACTIVE' AND created_at <= $1 AND created_at >= $2
		 ORDER BY created_at LIMIT $3`, now.Add(-minAge), now.Add(-maxAge), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
