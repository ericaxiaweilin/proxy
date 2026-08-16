package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/citycompanion"
)

// CityCompanionRepository 持久化城市同行需求（含行程 Route / RouteChanges）。
type CityCompanionRepository struct {
	pool *pgxpool.Pool
}

func NewCityCompanionRepository(pool *pgxpool.Pool) *CityCompanionRepository {
	return &CityCompanionRepository{pool: pool}
}

func (r *CityCompanionRepository) CreateNeed(ctx context.Context, need citycompanion.CityCompanionNeed) error {
	interests, route, routeChanges, confirmedAgent, sceneVisits, err := encodeNeedJSON(need)
	if err != nil {
		return err
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO citycompanion.needs (
			id, owner_user_id, lifecycle, version, duration, language, gender_pref,
			interests, meeting, budget_vnd, route, route_changes, confirmed_agent,
			scene_visits, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		need.ID, need.OwnerUserID, need.Lifecycle, need.Version, need.Duration, need.Language, need.GenderPref,
		interests, need.Meeting, need.BudgetVND, route, routeChanges, confirmedAgent,
		sceneVisits, need.UpdatedAt,
	)
	return err
}

func (r *CityCompanionRepository) GetNeed(ctx context.Context, id string) (citycompanion.CityCompanionNeed, error) {
	var need citycompanion.CityCompanionNeed
	var interests, route, routeChanges, confirmedAgent, sceneVisits []byte
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, owner_user_id, lifecycle, version, duration, language, gender_pref,
		       interests, meeting, budget_vnd, route, route_changes, confirmed_agent,
		       scene_visits, updated_at
		FROM citycompanion.needs WHERE id = $1`, id).Scan(
		&need.ID, &need.OwnerUserID, &need.Lifecycle, &need.Version, &need.Duration, &need.Language, &need.GenderPref,
		&interests, &need.Meeting, &need.BudgetVND, &route, &routeChanges, &confirmedAgent,
		&sceneVisits, &need.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return citycompanion.CityCompanionNeed{}, citycompanion.ErrNeedNotFound
	}
	if err != nil {
		return citycompanion.CityCompanionNeed{}, err
	}
	if err := json.Unmarshal(interests, &need.Interests); err != nil {
		return need, fmt.Errorf("decode interests: %w", err)
	}
	if len(route) > 0 {
		if err := json.Unmarshal(route, &need.Route); err != nil {
			return need, fmt.Errorf("decode route: %w", err)
		}
	}
	if err := json.Unmarshal(routeChanges, &need.RouteChanges); err != nil {
		return need, fmt.Errorf("decode route changes: %w", err)
	}
	if len(confirmedAgent) > 0 {
		if err := json.Unmarshal(confirmedAgent, &need.ConfirmedAgent); err != nil {
			return need, fmt.Errorf("decode confirmed agent: %w", err)
		}
	}
	if err := json.Unmarshal(sceneVisits, &need.SceneVisits); err != nil {
		return need, fmt.Errorf("decode scene visits: %w", err)
	}
	return need, nil
}

func (r *CityCompanionRepository) UpdateNeed(ctx context.Context, need citycompanion.CityCompanionNeed, expectedVersion int) error {
	interests, route, routeChanges, confirmedAgent, sceneVisits, err := encodeNeedJSON(need)
	if err != nil {
		return err
	}
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE citycompanion.needs
		SET lifecycle=$1, version=$2, interests=$3, route=$4, route_changes=$5,
		    confirmed_agent=$6, scene_visits=$7, updated_at=$8
		WHERE id=$9 AND version=$10`,
		need.Lifecycle, need.Version, interests, route, routeChanges, confirmedAgent,
		sceneVisits, need.UpdatedAt, need.ID, expectedVersion,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return citycompanion.ErrVersionConflict
	}
	return nil
}

func (r *CityCompanionRepository) Snapshot(ctx context.Context) ([]citycompanion.CityCompanionNeed, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, owner_user_id, lifecycle, version, duration, language, gender_pref,
		       interests, meeting, budget_vnd, route, route_changes, confirmed_agent,
		       scene_visits, updated_at
		FROM citycompanion.needs ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []citycompanion.CityCompanionNeed{}
	for rows.Next() {
		var need citycompanion.CityCompanionNeed
		var interests, route, routeChanges, confirmedAgent, sceneVisits []byte
		if err := rows.Scan(
			&need.ID, &need.OwnerUserID, &need.Lifecycle, &need.Version, &need.Duration, &need.Language, &need.GenderPref,
			&interests, &need.Meeting, &need.BudgetVND, &route, &routeChanges, &confirmedAgent,
			&sceneVisits, &need.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(interests, &need.Interests)
		if len(route) > 0 {
			_ = json.Unmarshal(route, &need.Route)
		}
		_ = json.Unmarshal(routeChanges, &need.RouteChanges)
		if len(confirmedAgent) > 0 {
			_ = json.Unmarshal(confirmedAgent, &need.ConfirmedAgent)
		}
		_ = json.Unmarshal(sceneVisits, &need.SceneVisits)
		result = append(result, need)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func encodeNeedJSON(need citycompanion.CityCompanionNeed) ([]byte, []byte, []byte, []byte, []byte, error) {
	interests, err := json.Marshal(need.Interests)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("encode interests: %w", err)
	}
	var route, confirmedAgent []byte
	if need.Route != nil {
		route, err = json.Marshal(need.Route)
		if err != nil {
			return nil, nil, nil, nil, nil, fmt.Errorf("encode route: %w", err)
		}
	}
	routeChanges, err := json.Marshal(need.RouteChanges)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("encode route changes: %w", err)
	}
	if need.ConfirmedAgent != nil {
		confirmedAgent, err = json.Marshal(need.ConfirmedAgent)
		if err != nil {
			return nil, nil, nil, nil, nil, fmt.Errorf("encode confirmed agent: %w", err)
		}
	}
	sceneVisits, err := json.Marshal(need.SceneVisits)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("encode scene visits: %w", err)
	}
	return interests, route, routeChanges, confirmedAgent, sceneVisits, nil
}

var _ citycompanion.Repository = (*CityCompanionRepository)(nil)
