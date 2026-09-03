package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/realityscene"
)

type RealitySceneRepository struct{ pool *pgxpool.Pool }

func NewRealitySceneRepository(pool *pgxpool.Pool) *RealitySceneRepository {
	return &RealitySceneRepository{pool: pool}
}
func (r *RealitySceneRepository) ListUserStates(ctx context.Context, actorID string) ([]realityscene.UserState, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT scene_id,saved,planned,private_visited FROM reality.user_scene_states WHERE actor_id=$1 ORDER BY updated_at DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []realityscene.UserState{}
	for rows.Next() {
		var s realityscene.UserState
		if err := rows.Scan(&s.SceneID, &s.Saved, &s.Planned, &s.PrivateVisited); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
func (r *RealitySceneRepository) SetUserState(ctx context.Context, actorID, sceneID, field string, enabled bool) error {
	column := map[string]string{"saved": "saved", "planned": "planned", "private_visited": "private_visited"}[field]
	if column == "" {
		return &invalidRealitySceneField{field: field}
	}
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO reality.user_scene_states(actor_id,scene_id,`+column+`) VALUES($1,$2,$3) ON CONFLICT(actor_id,scene_id) DO UPDATE SET `+column+`=EXCLUDED.`+column+`,updated_at=now()`, actorID, sceneID, enabled)
	return err
}

type invalidRealitySceneField struct{ field string }

func (e *invalidRealitySceneField) Error() string { return "invalid reality scene field: " + e.field }
