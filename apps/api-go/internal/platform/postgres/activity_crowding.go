package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/proxy-app/proxy-api/internal/activity"
)

// VenueSlotLoads 实现 activity.CrowdingReader（STORE-CROWD-001）：与 activityID 同一个时间标签的所有活动
// （含它自己）的现状。人数是 CONFIRMED 报名的人数（一对 2 人、没有同行人 1 人）；
// 场地 key（场景 id / 场地名）与标签的拼接在 Go 里做，这里只负责把真数读出来。
func (r *ActivityRepository) VenueSlotLoads(ctx context.Context, activityID string) ([]activity.VenueSlotLoad, error) {
	var label string
	err := r.pool.QueryRow(ctx, `SELECT COALESCE(payload->>'time', '') FROM activity.activities WHERE id = $1`, activityID).Scan(&label)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, activity.ErrActivityNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT a.id, COALESCE(a.payload->>'title', ''), COALESCE(a.payload->>'venueName', ''),
		       COALESCE(a.payload->>'realitySceneId', ''), COALESCE(a.payload->>'time', ''),
		       a.capacity, a.joined_count,
		       COALESCE((SELECT SUM(CASE WHEN COALESCE(p.companion_id, '') <> '' THEN 2 ELSE 1 END)
		                 FROM activity.participants p
		                 WHERE p.activity_id = a.id AND p.state = 'CONFIRMED'), 0)::int
		FROM activity.activities a
		WHERE COALESCE(a.payload->>'time', '') = $1`, label)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activity.VenueSlotLoad{}
	for rows.Next() {
		var v activity.VenueSlotLoad
		if err := rows.Scan(&v.ActivityID, &v.Title, &v.VenueName, &v.SceneID, &v.TimeLabel, &v.Capacity, &v.Joined, &v.People); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

var _ activity.CrowdingReader = (*ActivityRepository)(nil)
