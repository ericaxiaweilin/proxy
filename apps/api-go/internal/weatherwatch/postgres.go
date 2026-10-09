package weatherwatch

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Upcoming：已发布、有结构化开始时间、场地有坐标的活动，连同发起人和已报名的人。
func (p *Postgres) Upcoming(ctx context.Context, from, to time.Time) ([]Meeting, error) {
	acts, err := p.upcomingActivities(ctx, from, to)
	if err != nil {
		return nil, err
	}
	opps, err := p.upcomingOpportunities(ctx, from, to)
	if err != nil {
		return nil, err
	}
	return append(acts, opps...), nil
}

// upcomingOpportunities：已经有人确认合作的市场需求（发布时带了结构化开始时间和坐标），发布人 + 确认的那位。
func (p *Postgres) upcomingOpportunities(ctx context.Context, from, to time.Time) ([]Meeting, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT o.id, o.payload->>'title', (o.payload->>'startsAt')::timestamptz, COALESCE((o.payload->>'durationMinutes')::int, 0),
		       (o.payload->>'lat')::float8, (o.payload->>'lng')::float8, o.owner_id
		  FROM marketplace.opportunities o
		 WHERE o.payload->>'startsAt' IS NOT NULL AND o.payload->>'lat' IS NOT NULL AND o.payload->>'lng' IS NOT NULL
		   AND (o.payload->>'startsAt')::timestamptz >= $1 AND (o.payload->>'startsAt')::timestamptz < $2
		   AND EXISTS (SELECT 1 FROM marketplace.applications a WHERE a.opportunity_id = o.id AND a.payload->>'status' = 'CONFIRMED')`, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Meeting{}
	owners := []string{}
	for rows.Next() {
		var m Meeting
		var owner string
		if err := rows.Scan(&m.ID, &m.Title, &m.StartsAt, &m.DurationMin, &m.Lat, &m.Lng, &owner); err != nil {
			return nil, err
		}
		m.ID = "opp:" + m.ID
		out = append(out, m)
		owners = append(owners, owner)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].People = append(out[i].People, owners[i])
		arows, err := p.pool.Query(ctx, `SELECT applicant_id FROM marketplace.applications WHERE opportunity_id = $1 AND payload->>'status' = 'CONFIRMED'`, out[i].ID[len("opp:"):])
		if err != nil {
			return nil, err
		}
		for arows.Next() {
			var id string
			if err := arows.Scan(&id); err != nil {
				arows.Close()
				return nil, err
			}
			if id != owners[i] {
				out[i].People = append(out[i].People, id)
			}
		}
		arows.Close()
	}
	return out, nil
}

func (p *Postgres) upcomingActivities(ctx context.Context, from, to time.Time) ([]Meeting, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT a.id, a.payload->>'title', (a.payload->>'startsAt')::timestamptz, COALESCE((a.payload->>'durationMinutes')::int, 0),
		       sc.latitude, sc.longitude, COALESCE(a.payload->>'ownerId', '')
		  FROM activity.activities a
		  JOIN reality.scenes sc ON sc.id = a.payload->>'realitySceneId' AND sc.status = 'ACTIVE'
		 WHERE a.payload->>'status' = 'PUBLISHED'
		   AND a.payload->>'startsAt' IS NOT NULL
		   AND (a.payload->>'startsAt')::timestamptz >= $1 AND (a.payload->>'startsAt')::timestamptz < $2`, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Meeting{}
	var owners []string
	for rows.Next() {
		var m Meeting
		var owner string
		if err := rows.Scan(&m.ID, &m.Title, &m.StartsAt, &m.DurationMin, &m.Lat, &m.Lng, &owner); err != nil {
			return nil, err
		}
		out = append(out, m)
		owners = append(owners, owner)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		seen := map[string]bool{}
		add := func(id string) {
			if id != "" && !seen[id] {
				seen[id] = true
				out[i].People = append(out[i].People, id)
			}
		}
		add(owners[i])
		prow, err := p.pool.Query(ctx, `SELECT actor_id FROM activity.participants WHERE activity_id = $1`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for prow.Next() {
			var id string
			if err := prow.Scan(&id); err != nil {
				prow.Close()
				return nil, err
			}
			add(id)
		}
		prow.Close()
	}
	return out, nil
}
