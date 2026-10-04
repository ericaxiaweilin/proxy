package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/activity"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
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

// Join 报名（ACT-PARTICIPATION-DURABLE-001 / ORDER-NO-001 / ORDER-RECIPE-001）：活动行 FOR UPDATE
// 串行化同一场活动的占座；报名记录（状态 + 订单编号 + 票面快照）与 joined_count 同一事务写。
// 订单编号在同一事务里原子取号（场地类别码 + 越南本地日期的每日计数器 ordering.daily_sequences）。
// 之前取消过的报名重新激活同一行：沿用原编号，票面快照按这次下单刷新。

func (r *ActivityRepository) Join(ctx context.Context, activityID, actorID string, recipe activity.JoinRecipe) (activity.Activity, activity.Participation, error) {
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
		companionID := activity.CompanionIDOf(recipe)
		existing, found, err := readParticipation(txCtx, tx, activityID, actorID, companionID, true)
		if err != nil {
			return err
		}
		// FOR-YOU-SLOT-001（2026-10-04，推翻 HOME-FORYOU-ORDER-ONE-001）：一单 =
		// (活动, 我, 同行人)。约不同的小美是不同的单，各自一行、各自一个编号、各自一张
		// 票面——不再像 ORDER-007 那样改写已有那一行。同一组再下 ⇒ ErrAlreadyJoined。
		if found && existing.State != activity.PartCancelled {
			participation = existing
			_ = decodeActivity(payload, interested, joined, capacity, &result)
			return activity.ErrAlreadyJoined
		}
		_ = decodeActivity(payload, interested, joined, capacity, &result)
		slotKey := activity.SlotKey(result.Time)
		if companionID != "" {
			// 小美的这个时段被任何人、任何一场活动约走了 ⇒ 不可约。并发由
			// ux_participants_companion_slot 唯一索引兜底（见下面 INSERT 的错误映射）。
			var taken bool
			if err := tx.QueryRow(txCtx, `
				SELECT EXISTS (SELECT 1 FROM activity.participants
				 WHERE companion_id=$1 AND slot_key=$2 AND state <> 'CANCELLED')`, companionID, slotKey).Scan(&taken); err != nil {
				return err
			}
			if taken {
				return activity.ErrCompanionSlotTaken
			}
		} else if capacity > 0 && joined >= capacity {
			// For You 单不扣活动名额（咖啡店是场景载体，承载上限后期再做，现在不限）；
			// 直接报名照旧看名额。
			return activity.ErrActivityFull
		}
		_ = decodeActivity(payload, interested, joined, capacity, &result)
		now := time.Now()
		orderNo := existing.OrderNo // 取消后再报名：同一条记录、同一个编号
		if !found || orderNo == "" {
			// 场地类型从活动 payload 里解（解码失败就按未知走通用码，不拦下单）。
			// 日期与时分秒取同一时刻，避免跨午夜两调 time.Now 错位。
			number, err := nextDailyOrderNumber(txCtx, tx, ordernumber.CategoryForVenueType(result.VenueType), now)
			if err != nil {
				return err
			}
			orderNo = number
		}
		// 票面快照跟编号同一事务落库；人数按本单报名之后的值记。
		afterJoin := result
		afterJoin.Joined = joined + 1
		snapshot, err := json.Marshal(activity.BuildOrderSnapshot(afterJoin, orderNo, now, recipe))
		if err != nil {
			return err
		}
		if found {
			// 取消过的同一组 (活动, 我, 同行人) 重新下：沿用原编号。
			if _, err := tx.Exec(txCtx, `
				UPDATE activity.participants
				SET state='CONFIRMED', order_no=COALESCE(order_no, $4), order_snapshot=$5, slot_key=$6, updated_at=NOW()
				WHERE activity_id=$1 AND actor_id=$2 AND companion_id=$3`, activityID, actorID, companionID, orderNo, snapshot, slotKey); err != nil {
				return mapCompanionSlotViolation(err)
			}
		} else {
			if _, err := tx.Exec(txCtx, `
				INSERT INTO activity.participants (activity_id, actor_id, companion_id, slot_key, state, order_no, order_snapshot)
				VALUES ($1,$2,$3,$4,'CONFIRMED',$5,$6)`, activityID, actorID, companionID, slotKey, orderNo, snapshot); err != nil {
				return mapCompanionSlotViolation(err)
			}
		}
		participation = activity.Participation{ActivityID: activityID, UserID: actorID, State: activity.PartConfirmed, OrderNo: orderNo, CompanionID: companionID}
		joined++
		if _, err := tx.Exec(txCtx, `UPDATE activity.activities SET joined_count=$1 WHERE id=$2`, joined, activityID); err != nil {
			return err
		}
		return decodeActivity(payload, interested, joined, capacity, &result)
	})
	return result, participation, err
}

// mapCompanionSlotViolation：并发下两人同时约同一个小美的同一时段，后到的那个撞
// ux_participants_companion_slot —— 那是「她这个时段已经被约了」，不是内部错误。
func mapCompanionSlotViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "ux_participants_companion_slot" {
		return activity.ErrCompanionSlotTaken
	}
	return err
}

func readParticipation(ctx context.Context, q sqlQueryer, activityID, actorID, companionID string, lock bool) (activity.Participation, bool, error) {
	query := `SELECT state, COALESCE(order_no, ''), order_snapshot FROM activity.participants WHERE activity_id=$1 AND actor_id=$2 AND companion_id=$3`
	if lock {
		query += ` FOR UPDATE`
	}
	participation := activity.Participation{ActivityID: activityID, UserID: actorID, CompanionID: companionID}
	var state string
	// order_snapshot 也要读出来：重复下单时要把原票面带回去（HOME-FORYOU-ORDER-ONE-001）。
	// 老数据的这一列可能是 NULL，扫进 **[]byte 得到 nil，不是错误。
	var snapshotBytes []byte
	err := q.QueryRow(ctx, query, activityID, actorID, companionID).Scan(&state, &participation.OrderNo, &snapshotBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return activity.Participation{}, false, nil
	}
	if err != nil {
		return activity.Participation{}, false, err
	}
	participation.State = activity.ParticipationState(state)
	if len(snapshotBytes) > 0 {
		var snap activity.OrderSnapshot
		if err := json.Unmarshal(snapshotBytes, &snap); err != nil {
			// 快照坏了不该让报名读不出来 —— 读侧只需要"有没有同行人可比对"。
			// 解不开就当作没有快照（读侧只用它带回原票面，不参与判重）。
			return participation, true, nil
		}
		participation.Snapshot = &snap
	}
	return participation, true, nil
}

func (r *ActivityRepository) GetParticipation(ctx context.Context, activityID, actorID, companionID string) (activity.Participation, error) {
	participation, found, err := readParticipation(ctx, queryerForContext(ctx, r.pool), activityID, actorID, companionID, false)
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
		SELECT p.activity_id, p.actor_id, p.companion_id, p.state, COALESCE(p.order_no, ''),
		       a.payload, a.interested_count, a.joined_count, a.capacity
		FROM activity.participants p
		JOIN activity.activities a ON a.id = p.activity_id
		WHERE p.order_no = $1`, orderNo).Scan(
		&participation.ActivityID, &participation.UserID, &participation.CompanionID, &state, &participation.OrderNo,
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
// 用 EXPLAIN 钉住它走索引）。`{16,}` 和索引谓词同源：历史 16 位编号也要能反查到
// （见 migrations/147_order_number_legacy_compat.sql —— 收成 `{21,}` 会让索引
// 谓词不蕴含查询谓词，计划退化成 Seq Scan，而旧号还直接查不到）。
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
func (r *ActivityRepository) TransitionParticipation(ctx context.Context, activityID, actorID, companionID string, allowedFrom []activity.ParticipationState, to activity.ParticipationState) (activity.Participation, activity.Activity, error) {
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
		current, found, err := readParticipation(txCtx, tx, activityID, actorID, companionID, true)
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
		if _, err := tx.Exec(txCtx, `UPDATE activity.participants SET state=$4, updated_at=NOW() WHERE activity_id=$1 AND actor_id=$2 AND companion_id=$3`, activityID, actorID, companionID, string(to)); err != nil {
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
		WHERE EXISTS (SELECT 1 FROM activity.participants p
		               WHERE p.activity_id = a.id AND p.actor_id = $1 AND p.state <> 'CANCELLED')
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

// MY-ORDERS-DETAIL-001：本人每笔报名的订单编号 + 下单时间。
func (r *ActivityRepository) ListJoinOrders(ctx context.Context, actorID string) ([]activity.JoinOrder, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT activity_id, companion_id, COALESCE(order_no, ''), joined_at, state, order_snapshot
		FROM activity.participants
		WHERE actor_id = $1
		ORDER BY joined_at DESC`, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activity.JoinOrder{}
	for rows.Next() {
		item, err := scanJoinOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *ActivityRepository) GetJoinOrder(ctx context.Context, activityID, actorID, companionID string) (activity.JoinOrder, bool, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT activity_id, companion_id, COALESCE(order_no, ''), joined_at, state, order_snapshot
		FROM activity.participants
		WHERE activity_id = $1 AND actor_id = $2 AND companion_id = $3`, activityID, actorID, companionID)
	item, err := scanJoinOrder(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return activity.JoinOrder{}, false, nil
	}
	if err != nil {
		return activity.JoinOrder{}, false, err
	}
	return item, true, nil
}

func scanJoinOrder(row pgx.Row) (activity.JoinOrder, error) {
	var item activity.JoinOrder
	var snapshot []byte
	if err := row.Scan(&item.ActivityID, &item.CompanionID, &item.OrderNo, &item.JoinedAt, &item.State, &snapshot); err != nil {
		return item, err
	}
	if len(snapshot) > 0 {
		var snap activity.OrderSnapshot
		if err := json.Unmarshal(snapshot, &snap); err == nil {
			item.Snapshot = &snap
		}
	}
	return item, nil
}

// ListBookedCompanionSlots（FOR-YOU-SLOT-001）：这批小美里哪些时段已有未取消的单。
// 只命中调用方给出的 companion id；只返回时段，不返回下单人。
func (r *ActivityRepository) ListBookedCompanionSlots(ctx context.Context, companionIDs []string) ([]activity.CompanionSlot, error) {
	out := []activity.CompanionSlot{}
	if len(companionIDs) == 0 {
		return out, nil
	}
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT DISTINCT companion_id, slot_key
		FROM activity.participants
		WHERE companion_id = ANY($1) AND state <> 'CANCELLED'
		ORDER BY companion_id, slot_key`, companionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var slot activity.CompanionSlot
		if err := rows.Scan(&slot.CompanionID, &slot.Time); err != nil {
			return nil, err
		}
		out = append(out, slot)
	}
	return out, rows.Err()
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
