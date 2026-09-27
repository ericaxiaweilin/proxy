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

func (r *ActivityRepository) Create(ctx context.Context, item activity.Activity) error {
	payload, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("encode activity: %w", err)
	}
	_, err = queryerForContext(ctx, r.pool).Exec(ctx, `INSERT INTO activity.activities (id,payload,interested_count,joined_count,capacity) VALUES ($1,$2,$3,$4,$5)`, item.ID, payload, item.Interested, item.Joined, item.Capacity)
	return err
}

func (r *ActivityRepository) List(ctx context.Context) ([]activity.Activity, error) {
	// R15.x+: 过滤 origin='TEST'。TEST 用途是测试 fixture 写入
	// (如 activity_facet_integration_test.go 的 act_pg_* 'Lifecycle Pin')。
	// 这些不应该被 ListActivities 返回给客户端。AI 状态 (aiStatus / aiActorKind)
	// 是 Activity 内部的元信息，正常返回；AI 不能作为 origin 出现。
	// PLATFORM / MERCHANT / USER / TEST 都按上面规则走。
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `SELECT payload, interested_count, joined_count, capacity FROM activity.activities WHERE COALESCE(payload->>'origin', '') <> 'TEST' ORDER BY created_at`)
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

// R17.x: 我的活动物化路径。ListByOwner 按 payload->>'ownerId' 过滤
// 并附加 origin='TEST' 过滤 (与 List() 一致) ;
// ListByParticipant 走 activity.participants
// JOIN activity.activities。后者需要真实 participants
// 行来表达“在 ”状态 — 仅靠 payload->>'joinedBy' 不够 (memory only)。
func (r *ActivityRepository) ListByOwner(ctx context.Context, ownerID string) ([]activity.Activity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT payload, interested_count, joined_count, capacity
		FROM activity.activities
		WHERE COALESCE(payload->>'ownerId', '') = $1
		  AND COALESCE(payload->>'origin', '') <> 'TEST'
		ORDER BY created_at DESC`, ownerID)
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
func (r *ActivityRepository) ListByParticipant(ctx context.Context, actorID string) ([]activity.Activity, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT a.payload, a.interested_count, a.joined_count, a.capacity
		FROM activity.activities a
		JOIN activity.participants p ON p.activity_id = a.id
		WHERE p.actor_id = $1
		  AND COALESCE(a.payload->>'origin', '') <> 'TEST'
		ORDER BY a.created_at DESC`, actorID)
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

// FilterKnownParticipants 实现见 activity.Repository 接口注释：只测已知
// 候选，不反查名单——ANY($2) 只能命中调用方已经给出的 actor id。
// realitySceneId 存在 payload JSONB 里（见 037_activity_persistence.sql，
// activities 表没有专列），所以走 payload->>'realitySceneId' 表达式过滤。
func (r *ActivityRepository) FilterKnownParticipants(ctx context.Context, sceneID string, candidateActorIDs []string) ([]string, error) {
	if len(candidateActorIDs) == 0 {
		return []string{}, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT DISTINCT p.actor_id
		FROM activity.participants p
		JOIN activity.activities a ON a.id = p.activity_id
		WHERE a.payload->>'realitySceneId' = $1
		  AND p.actor_id = ANY($2)`,
		sceneID, candidateActorIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var actorID string
		if err := rows.Scan(&actorID); err != nil {
			return nil, err
		}
		out = append(out, actorID)
	}
	return out, rows.Err()
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
