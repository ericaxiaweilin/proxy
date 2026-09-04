package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/realityscene"
)

type RealitySceneRepository struct{ pool *pgxpool.Pool }

func NewRealitySceneRepository(pool *pgxpool.Pool) *RealitySceneRepository {
	return &RealitySceneRepository{pool: pool}
}
func (r *RealitySceneRepository) ListUserStates(ctx context.Context, actorID string) ([]realityscene.UserState, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT scene_id,saved,planned,private_visited,visited_at FROM reality.user_scene_states WHERE actor_id=$1 ORDER BY COALESCE(visited_at,updated_at) DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.UserState{}
	for rows.Next() {
		var s realityscene.UserState
		if err := rows.Scan(&s.SceneID, &s.Saved, &s.Planned, &s.PrivateVisited, &s.VisitedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r *RealitySceneRepository) SetUserState(ctx context.Context, actorID, sceneID, field string, enabled bool, now time.Time) error {
	column := map[string]string{"saved": "saved", "planned": "planned", "private_visited": "private_visited"}[field]
	if column == "" {
		return &invalidRealitySceneField{field: field}
	}
	if column == "private_visited" {
		_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.user_scene_states(actor_id,scene_id,private_visited,visited_at) VALUES($1,$2,$3,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END) ON CONFLICT(actor_id,scene_id) DO UPDATE SET private_visited=EXCLUDED.private_visited,visited_at=EXCLUDED.visited_at,updated_at=$4::timestamptz`, actorID, sceneID, enabled, now.UTC())
		return err
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.user_scene_states(actor_id,scene_id,`+column+`) VALUES($1,$2,$3) ON CONFLICT(actor_id,scene_id) DO UPDATE SET `+column+`=EXCLUDED.`+column+`,updated_at=$4`, actorID, sceneID, enabled, now.UTC())
	return err
}

func (r *RealitySceneRepository) ListScenes(ctx context.Context) ([]realityscene.Scene, error) {
	return r.listScenes(ctx, "", nil)
}

func (r *RealitySceneRepository) ListNearbyScenes(ctx context.Context, lat, lng, radiusKM float64, limit int) ([]realityscene.Scene, error) {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 || radiusKM <= 0 || radiusKM > 100 || limit < 1 || limit > 100 {
		return nil, fmt.Errorf("invalid nearby scene query")
	}
	return r.listScenes(ctx, `WHERE distance_m <= $3 ORDER BY recommendation_score DESC, distance_m ASC LIMIT $4`, []any{lat, lng, radiusKM * 1000, limit})
}

func (r *RealitySceneRepository) listScenes(ctx context.Context, suffix string, args []any) ([]realityscene.Scene, error) {
	query := `WITH ranked AS (SELECT id,name,area,type,latitude,longitude,quality,best,posts,creators,activities,invites,active,description, CASE WHEN $1::double precision IS NULL THEN 0 ELSE 6371000*2*asin(sqrt(power(sin(radians(latitude-$1)/2),2)+cos(radians($1))*cos(radians(latitude))*power(sin(radians(longitude-$2)/2),2))) END AS distance_m FROM reality.scenes WHERE status='ACTIVE') SELECT id,name,area,type,latitude,longitude,quality,best,posts,creators,activities,invites,active,description,distance_m,(quality*.55 + ln(1+posts+2*creators+4*activities+2*invites)*8 - distance_m/1000*2.5) AS recommendation_score FROM ranked ` + suffix
	if args == nil {
		args = []any{nil, nil}
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.Scene{}
	for rows.Next() {
		var s realityscene.Scene
		if err := rows.Scan(&s.ID, &s.Name, &s.Area, &s.Type, &s.Latitude, &s.Longitude, &s.Quality, &s.Best, &s.Posts, &s.Creators, &s.Activities, &s.Invites, &s.Active, &s.Description, &s.DistanceMeters, &s.RecommendationScore); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type invalidRealitySceneField struct{ field string }

func (e *invalidRealitySceneField) Error() string { return "invalid reality scene field: " + e.field }
