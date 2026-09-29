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

// Join 报名（ACT-PARTICIPATION-DURABLE-001 / ACT-ORDER-NO-001）：活动行 FOR UPDATE
// 串行化同一场活动的占座；报名记录（状态 + 订单编号）与 joined_count 同一事务写。
// 之前取消过的报名重新激活同一行，沿用原编号。
func (r *ActivityRepository) Join(ctx context.Context, activityID, actorID, orderNo string) (activity.Activity, activity.Participation, error) {
	var result activity.Activity
	var participation activity.Participation
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
		existing, found, err := readParticipation(txCtx, tx, activityID, actorID, true)
		if err != nil {
			return err
		}
		if found && existing.State != activity.PartCancelled {
			participation = existing
			_ = decodeActivity(payload, interested, joined, capacity, &result)
			return activity.ErrAlreadyJoined
		}
		if capacity > 0 && joined >= capacity {
			_ = decodeActivity(payload, interested, joined, capacity, &result)
			return activity.ErrActivityFull
		}
		if found {
			if err := tx.QueryRow(txCtx, `
				UPDATE activity.participants
				SET state='CONFIRMED', order_no=COALESCE(order_no, $3), updated_at=NOW()
				WHERE activity_id=$1 AND actor_id=$2
				RETURNING COALESCE(order_no, '')`, activityID, actorID, nullableText(orderNo)).Scan(&participation.OrderNo); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(txCtx, `INSERT INTO activity.participants (activity_id, actor_id, state, order_no) VALUES ($1,$2,'CONFIRMED',$3)`, activityID, actorID, nullableText(orderNo)); err != nil {
				return err
			}
			participation.OrderNo = orderNo
		}
		participation.ActivityID, participation.UserID, participation.State = activityID, actorID, activity.PartConfirmed
		joined++
		if _, err := tx.Exec(txCtx, `UPDATE activity.activities SET joined_count=$1 WHERE id=$2`, joined, activityID); err != nil {
			return err
		}
		return decodeActivity(payload, interested, joined, capacity, &result)
	})
	return result, participation, err
}

func readParticipation(ctx context.Context, q sqlQueryer, activityID, actorID string, lock bool) (activity.Participation, bool, error) {
	query := `SELECT state, COALESCE(order_no, '') FROM activity.participants WHERE activity_id=$1 AND actor_id=$2`
	if lock {
		query += ` FOR UPDATE`
	}
	participation := activity.Participation{ActivityID: activityID, UserID: actorID}
	var state string
	err := q.QueryRow(ctx, query, activityID, actorID).Scan(&state, &participation.OrderNo)
	if errors.Is(err, pgx.ErrNoRows) {
		return activity.Participation{}, false, nil
	}
	if err != nil {
		return activity.Participation{}, false, err
	}
	participation.State = activity.ParticipationState(state)
	return participation, true, nil
}

func (r *ActivityRepository) GetParticipation(ctx context.Context, activityID, actorID string) (activity.Participation, error) {
	participation, found, err := readParticipation(ctx, queryerForContext(ctx, r.pool), activityID, actorID, false)
	if err != nil {
		return activity.Participation{}, err
	}
	if !found {
		return activity.Participation{}, activity.ErrNotJoined
	}
	return participation, nil
}

// FindParticipationByNumber 按报名订单编号反查（PUBLIC-NO-LOOKUP-001），走
// activity_participants_order_no_key 唯一索引。
func (r *ActivityRepository) FindParticipationByNumber(ctx context.Context, orderNo string) (activity.Participation, activity.Activity, error) {
	var participation activity.Participation
	var result activity.Activity
	var state string
	var payload []byte
	var interested, joined, capacity int
	if orderNo == "" {
		return activity.Participation{}, activity.Activity{}, activity.ErrNotJoined
	}
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT p.activity_id, p.actor_id, p.state, COALESCE(p.order_no, ''),
		       a.payload, a.interested_count, a.joined_count, a.capacity
		FROM activity.participants p
		JOIN activity.activities a ON a.id = p.activity_id
		WHERE p.order_no = $1`, orderNo).Scan(
		&participation.ActivityID, &participation.UserID, &state, &participation.OrderNo,
		&payload, &interested, &joined, &capacity)
	if errors.Is(err, pgx.ErrNoRows) {
		return activity.Participation{}, activity.Activity{}, activity.ErrNotJoined
	}
	if err != nil {
		return activity.Participation{}, activity.Activity{}, err
	}
	participation.State = activity.ParticipationState(state)
	if err := decodeActivity(payload, interested, joined, capacity, &result); err != nil {
		return activity.Participation{}, activity.Activity{}, err
	}
	return participation, result, nil
}

// activityByCodeSQL 的谓词要和 activity_code_digits_key 部分唯一索引一致（集成测试
// 用 EXPLAIN 钉住它走索引）。
const activityByCodeSQL = `
	SELECT payload, interested_count, joined_count, capacity
	FROM activity.activities
	WHERE payload->>'code' ~ '^[0-9]{16,}$' AND payload->>'code' = $1`

// FindActivityByCode 按全数字活动编号反查（PUBLIC-NO-LOOKUP-001）。谓词里的正则要和
// activity_code_digits_key 部分唯一索引一致，否则走不了索引；老的 PX-A-… 展示码
// 不是全数字、也不保证唯一，故意不在这里反查。
func (r *ActivityRepository) FindActivityByCode(ctx context.Context, code string) (activity.Activity, error) {
	var result activity.Activity
	err := scanActivity(queryerForContext(ctx, r.pool).QueryRow(ctx, activityByCodeSQL, code), &result)
	if errors.Is(err, pgx.ErrNoRows) {
		return activity.Activity{}, activity.ErrActivityNotFound
	}
	if err != nil {
		return activity.Activity{}, err
	}
	return result, nil
}

// TransitionParticipation（ACT-SEAT-RELEASE-001）：活动行与报名行都加锁；离开占座
// 状态（取消）时 joined_count - 1，同一事务。以前取消只改内存，名额永远不还。
func (r *ActivityRepository) TransitionParticipation(ctx context.Context, activityID, actorID string, allowedFrom []activity.ParticipationState, to activity.ParticipationState) (activity.Participation, activity.Activity, error) {
	var result activity.Activity
	var participation activity.Participation
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
		current, found, err := readParticipation(txCtx, tx, activityID, actorID, true)
		if err != nil {
			return err
		}
		if !found {
			return activity.ErrNotJoined
		}
		participation = current
		allowed := false
		for _, state := range allowedFrom {
			allowed = allowed || state == current.State
		}
		if !allowed {
			return activity.ErrParticipationTransition
		}
		if _, err := tx.Exec(txCtx, `UPDATE activity.participants SET state=$3, updated_at=NOW() WHERE activity_id=$1 AND actor_id=$2`, activityID, actorID, string(to)); err != nil {
			return err
		}
		seatHeld := func(state activity.ParticipationState) bool {
			return state == activity.PartConfirmed || state == activity.PartAttended || state == activity.PartNoShow
		}
		if seatHeld(current.State) && !seatHeld(to) && joined > 0 {
			joined--
			if _, err := tx.Exec(txCtx, `UPDATE activity.activities SET joined_count=$1 WHERE id=$2`, joined, activityID); err != nil {
				return err
			}
		}
		participation.State = to
		return decodeActivity(payload, interested, joined, capacity, &result)
	})
	return participation, result, err
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
		  AND p.state <> 'CANCELLED'
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
		  AND p.actor_id = ANY($2)
		  AND p.state <> 'CANCELLED'`,
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
var _ activity.NumberReader = (*ActivityRepository)(nil)
