package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
)

type ActivityRepository struct{ pool *pgxpool.Pool }

func NewActivityRepository(pool *pgxpool.Pool) *ActivityRepository {
	return &ActivityRepository{pool: pool}
}

func (r *ActivityRepository) Seed(ctx context.Context, activities []activity.Activity) error {
	for _, item := range activities {
		payload, err := json.Marshal(item)
		if err != nil {
			return fmt.Errorf("encode activity: %w", err)
		}
		if _, err := queryerForContext(ctx, r.pool).Exec(ctx, `
			INSERT INTO activity.activities (id,payload,interested_count,joined_count,capacity)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, item.ID, payload, item.Interested, item.Joined, item.Capacity); err != nil {
			return err
		}
	}
	return nil
}

func (r *ActivityRepository) List(ctx context.Context) ([]activity.Activity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT payload, interested_count, joined_count, capacity FROM activity.activities ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []activity.Activity{}
	for rows.Next() {
		item, err := scanActivityRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *ActivityRepository) ToggleInterest(ctx context.Context, activityID, actorID string) (activity.Activity, bool, error) {
	var result activity.Activity
	interested := false
	err := runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		var lockedID string
		if err := tx.QueryRow(txCtx, `SELECT id FROM activity.activities WHERE id=$1 FOR UPDATE`, activityID).Scan(&lockedID); errors.Is(err, pgx.ErrNoRows) {
			return activity.ErrActivityNotFound
		} else if err != nil {
			return err
		}
		tag, err := tx.Exec(txCtx, `DELETE FROM activity.interests WHERE activity_id=$1 AND actor_id=$2`, activityID, actorID)
		if err != nil {
			return err
		}
		interested = tag.RowsAffected() == 0
		delta := -1
		if interested {
			if _, err := tx.Exec(txCtx, `INSERT INTO activity.interests (activity_id,actor_id) VALUES ($1,$2)`, activityID, actorID); err != nil {
				return err
			}
			delta = 1
		}
		if _, err := tx.Exec(txCtx, `UPDATE activity.activities SET interested_count=GREATEST(0,interested_count+$1) WHERE id=$2`, delta, activityID); err != nil {
			return err
		}
		return scanActivity(tx.QueryRow(txCtx, `SELECT payload,interested_count,joined_count,capacity FROM activity.activities WHERE id=$1`, activityID), &result)
	})
	return result, interested, err
}

func (r *ActivityRepository) Join(ctx context.Context, activityID, actorID string) (activity.Activity, error) {
	var result activity.Activity
	err := runInTransaction(ctx, r.pool, func(txCtx context.Context, tx pgx.Tx) error {
		var payload []byte
		var interested, joined, capacity int
		err := tx.QueryRow(txCtx, `SELECT payload,interested_count,joined_count,capacity FROM activity.activities WHERE id=$1 FOR UPDATE`, activityID).Scan(&payload, &interested, &joined, &capacity)
		if errors.Is(err, pgx.ErrNoRows) {
			return activity.ErrActivityNotFound
		}
		if err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRow(txCtx, `SELECT EXISTS(SELECT 1 FROM activity.participants WHERE activity_id=$1 AND actor_id=$2)`, activityID, actorID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			_ = decodeActivity(payload, interested, joined, capacity, &result)
			return activity.ErrAlreadyJoined
		}
		if capacity > 0 && joined >= capacity {
			_ = decodeActivity(payload, interested, joined, capacity, &result)
			return activity.ErrActivityFull
		}
		if _, err := tx.Exec(txCtx, `INSERT INTO activity.participants (activity_id,actor_id) VALUES ($1,$2)`, activityID, actorID); err != nil {
			return err
		}
		joined++
		if _, err := tx.Exec(txCtx, `UPDATE activity.activities SET joined_count=$1 WHERE id=$2`, joined, activityID); err != nil {
			return err
		}
		return decodeActivity(payload, interested, joined, capacity, &result)
	})
	return result, err
}

type activityScanner interface{ Scan(dest ...any) error }

func scanActivityRow(row activityScanner) (activity.Activity, error) {
	var result activity.Activity
	if err := scanActivity(row, &result); err != nil {
		return activity.Activity{}, err
	}
	return result, nil
}
func scanActivity(row activityScanner, result *activity.Activity) error {
	var payload []byte
	var interested, joined, capacity int
	if err := row.Scan(&payload, &interested, &joined, &capacity); err != nil {
		return err
	}
	return decodeActivity(payload, interested, joined, capacity, result)
}
func decodeActivity(payload []byte, interested, joined, capacity int, result *activity.Activity) error {
	if err := json.Unmarshal(payload, result); err != nil {
		return fmt.Errorf("decode activity: %w", err)
	}
	result.Interested = interested
	result.Joined = joined
	result.Capacity = capacity
	return nil
}

var _ activity.Repository = (*ActivityRepository)(nil)
