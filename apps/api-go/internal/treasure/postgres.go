package treasure

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/matching"
)

type Postgres struct {
	pool *pgxpool.Pool
	// Claimer 在同行加成里替用户领一张咖啡券（运营配了福利才会用）；nil = 只给成长值。
	Claimer Claimer
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Claimer 替用户领一份福利（组合根接 benefit 服务）。失败不影响已开的箱子和成长值。
type Claimer interface {
	Claim(ctx context.Context, userID, campaignID, benefitID string) (claimID string, err error)
}

// ---------------------------------------------------------------- 投放

// Spawn：过期的箱子收掉，给还没有活箱子的咖啡店场景各投一个（总数不超过 MaxSpawnTotal）。返回新投的个数。
func (p *Postgres) Spawn(ctx context.Context, now time.Time) (int, error) {
	if _, err := p.pool.Exec(ctx, `UPDATE treasure.chests SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND (expires_at <= $1 OR opened >= capacity)`, now.UTC()); err != nil {
		return 0, err
	}
	var active int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.chests WHERE status = 'ACTIVE'`).Scan(&active); err != nil {
		return 0, err
	}
	room := MaxSpawnTotal - active
	if room <= 0 {
		return 0, nil
	}
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO treasure.chests (id, scene_id, points, capacity, created_at, expires_at)
		SELECT 'tc_' || md5(sc.id || clock_timestamp()::text), sc.id, $1, $2, $3, $4
		  FROM reality.scenes sc
		 WHERE sc.status = 'ACTIVE' AND sc.type LIKE '咖啡%'
		   AND NOT EXISTS (SELECT 1 FROM treasure.chests c WHERE c.scene_id = sc.id AND c.status = 'ACTIVE')
		 ORDER BY sc.id LIMIT $5
		ON CONFLICT DO NOTHING`, SoloPoints, SoloCapacity, now.UTC(), now.Add(ChestTTL).UTC(), room)
	return int(tag.RowsAffected()), err
}

// ---------------------------------------------------------------- 附近

type Chest struct {
	ID         string    `json:"id"`
	SceneID    string    `json:"sceneId"`
	Name       string    `json:"name"`
	Area       string    `json:"area"`
	DistanceM  int       `json:"distanceM"`
	Points     int       `json:"points"`
	Remaining  int       `json:"remaining"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OpenedByMe bool      `json:"openedByMe"`
}

type Booking struct {
	ActivityID  string `json:"activityId"`
	CompanionID string `json:"companionId"`
	Title       string `json:"title"`
	SceneID     string `json:"sceneId"`
	Name        string `json:"name"`
	DistanceM   int    `json:"distanceM"`
	Points      int    `json:"points"`
	WithVoucher bool   `json:"withVoucher"`
}

type Nearby struct {
	Chests      []Chest   `json:"chests"`
	Bookings    []Booking `json:"companionBookings"` // 可凭它开同行箱的订单
	OpenedToday int       `json:"openedToday"`
	DailyCap    int       `json:"dailyCap"`
	RadiusM     int       `json:"radiusM"`
	TotalPoints int       `json:"-"`
}

const nearbyLimitM = 5000

func (p *Postgres) voucherConfigured(ctx context.Context) (campaign, benefit string) {
	rows, err := p.pool.Query(ctx, `SELECT key, value FROM treasure.settings WHERE key IN ('companion_campaign_id','companion_benefit_id')`)
	if err != nil {
		return "", ""
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			if k == "companion_campaign_id" {
				campaign = v
			} else {
				benefit = v
			}
		}
	}
	return
}

// Nearby：5 公里内的活箱子（含我是否开过），以及我现在可以凭它开同行箱的订单。
func (p *Postgres) Nearby(ctx context.Context, userID string, lat, lng float64, now time.Time) (Nearby, error) {
	out := Nearby{Chests: []Chest{}, Bookings: []Booking{}, DailyCap: DailySoloCap, RadiusM: int(RadiusM)}
	rows, err := p.pool.Query(ctx, `
		SELECT c.id, c.scene_id, sc.name, sc.area, sc.latitude, sc.longitude, c.points, c.capacity - c.opened, c.expires_at,
		       EXISTS (SELECT 1 FROM treasure.opens o WHERE o.user_id = $1 AND o.chest_id = c.id AND o.kind = 'SOLO')
		  FROM treasure.chests c JOIN reality.scenes sc ON sc.id = c.scene_id
		 WHERE c.status = 'ACTIVE' AND c.expires_at > $2 AND c.opened < c.capacity`, userID, now.UTC())
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var c Chest
		var slat, slng float64
		if err := rows.Scan(&c.ID, &c.SceneID, &c.Name, &c.Area, &slat, &slng, &c.Points, &c.Remaining, &c.ExpiresAt, &c.OpenedByMe); err != nil {
			rows.Close()
			return out, err
		}
		d := matching.DistanceMeters(lat, lng, slat, slng)
		if d > nearbyLimitM {
			continue
		}
		c.DistanceM = int(d)
		out.Chests = append(out.Chests, c)
	}
	rows.Close()
	sortChests(out.Chests)

	campaign, benefit := p.voucherConfigured(ctx)
	withVoucher := campaign != "" && benefit != "" && p.Claimer != nil
	brows, err := p.pool.Query(ctx, `
		SELECT pt.activity_id, pt.companion_id, COALESCE(a.payload->>'title',''), sc.id, sc.name, sc.latitude, sc.longitude
		  FROM activity.participants pt
		  JOIN activity.activities a ON a.id = pt.activity_id
		  JOIN reality.scenes sc ON sc.id = a.payload->>'realitySceneId' AND sc.status = 'ACTIVE'
		 WHERE pt.actor_id = $1 AND pt.companion_id <> '' AND pt.state IN ('CONFIRMED','ATTENDED')
		   AND ( ((a.payload->>'startsAt') IS NOT NULL AND (a.payload->>'startsAt')::timestamptz >= $2::timestamptz - $3::interval
		                                              AND (a.payload->>'startsAt')::timestamptz <  $2::timestamptz + $4::interval)
		      OR ((a.payload->>'startsAt') IS NULL AND pt.updated_at >= $2::timestamptz - interval '48 hours') )
		   AND NOT EXISTS (SELECT 1 FROM treasure.opens o WHERE o.user_id = $1 AND o.kind = 'COMPANION'
		                      AND o.activity_id = pt.activity_id AND o.companion_id = pt.companion_id)`,
		userID, now.UTC(), fmt.Sprintf("%d seconds", int(CompanionAfter.Seconds())), fmt.Sprintf("%d seconds", int(CompanionBefore.Seconds())))
	if err != nil {
		return out, err
	}
	for brows.Next() {
		var b Booking
		var slat, slng float64
		if err := brows.Scan(&b.ActivityID, &b.CompanionID, &b.Title, &b.SceneID, &b.Name, &slat, &slng); err != nil {
			brows.Close()
			return out, err
		}
		b.DistanceM = int(matching.DistanceMeters(lat, lng, slat, slng))
		b.Points, b.WithVoucher = CompanionPts, withVoucher
		out.Bookings = append(out.Bookings, b)
	}
	brows.Close()
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.opens WHERE user_id = $1 AND kind = 'SOLO' AND opened_at >= $2`, userID, LocalDayStart(now)).Scan(&out.OpenedToday); err != nil {
		return out, err
	}
	return out, nil
}

func sortChests(c []Chest) {
	for i := 1; i < len(c); i++ {
		for j := i; j > 0 && c[j].DistanceM < c[j-1].DistanceM; j-- {
			c[j], c[j-1] = c[j-1], c[j]
		}
	}
}

// ---------------------------------------------------------------- 开箱

type Result struct {
	Kind      string `json:"kind"`
	Points    int    `json:"points"`
	SceneName string `json:"sceneName"`
	DistanceM int    `json:"distanceM"`
	ClaimID   string `json:"claimId,omitempty"` // 带出了咖啡券
	Total     int    `json:"totalPoints"`       // 开完之后账本里的积分合计（用户）
}

func newOpenID(userID string, now time.Time, ref string) string {
	return fmt.Sprintf("to_%x", fmt.Sprintf("%s|%s|%d", userID, ref, now.UnixNano()))
}

func (p *Postgres) prevOpen(ctx context.Context, tx pgx.Tx, userID string) (*Prev, error) {
	var pr Prev
	err := tx.QueryRow(ctx, `
		SELECT sc.latitude, sc.longitude, o.opened_at FROM treasure.opens o JOIN reality.scenes sc ON sc.id = o.scene_id
		 WHERE o.user_id = $1 ORDER BY o.opened_at DESC LIMIT 1`, userID).Scan(&pr.Lat, &pr.Lng, &pr.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &pr, nil
}

func (p *Postgres) credit(ctx context.Context, tx pgx.Tx, userID, reason, ref string, delta int, now time.Time) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO growth.point_ledger (id, subject_kind, subject_id, delta, reason, ref, created_at)
		VALUES ('pl_' || md5('USER|' || $1 || '|' || $2 || '|' || $3), 'USER', $1, $4, $2, $3, $5)
		ON CONFLICT (subject_kind, subject_id, reason, ref) DO NOTHING`, userID, reason, ref, delta, now.UTC())
	return err
}

func (p *Postgres) total(ctx context.Context, tx pgx.Tx, userID string) int {
	var n int
	_ = tx.QueryRow(ctx, `SELECT COALESCE(SUM(delta),0) FROM growth.point_ledger WHERE subject_kind = 'USER' AND subject_id = $1`, userID).Scan(&n)
	return n
}

// OpenSolo：开一个普通箱子。
func (p *Postgres) OpenSolo(ctx context.Context, userID, chestID string, loc Location, now time.Time) (Result, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var sceneID, sceneName string
	var slat, slng float64
	var points, capacity, opened int
	var status string
	var expires time.Time
	err = tx.QueryRow(ctx, `
		SELECT c.scene_id, sc.name, sc.latitude, sc.longitude, c.points, c.capacity, c.opened, c.status, c.expires_at
		  FROM treasure.chests c JOIN reality.scenes sc ON sc.id = c.scene_id WHERE c.id = $1 FOR UPDATE OF c`, chestID).
		Scan(&sceneID, &sceneName, &slat, &slng, &points, &capacity, &opened, &status, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrChestGone
	}
	if err != nil {
		return Result{}, err
	}
	if status != "ACTIVE" || !expires.After(now) || opened >= capacity {
		return Result{}, ErrChestGone
	}
	dist, perr := CheckPresence(loc, slat, slng)
	if perr != nil {
		return Result{DistanceM: dist}, perr
	}
	var already int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.opens WHERE user_id = $1 AND chest_id = $2 AND kind = 'SOLO'`, userID, chestID).Scan(&already); err != nil {
		return Result{}, err
	}
	if already > 0 {
		return Result{}, ErrAlreadyOpened
	}
	var today int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.opens WHERE user_id = $1 AND kind = 'SOLO' AND opened_at >= $2`, userID, LocalDayStart(now)).Scan(&today); err != nil {
		return Result{}, err
	}
	if today >= DailySoloCap {
		return Result{}, ErrDailyCap
	}
	prev, err := p.prevOpen(ctx, tx, userID)
	if err != nil {
		return Result{}, err
	}
	if !SpeedPlausible(prev, slat, slng, now) {
		return Result{}, ErrSpeed
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO treasure.opens (id, user_id, kind, chest_id, scene_id, points, distance_m, accuracy_m, opened_at)
		VALUES ($1,$2,'SOLO',$3,$4,$5,$6,$7,$8)`, newOpenID(userID, now, chestID), userID, chestID, sceneID, points, dist, int(loc.AccuracyM), now.UTC()); err != nil {
		return Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE treasure.chests SET opened = opened + 1 WHERE id = $1`, chestID); err != nil {
		return Result{}, err
	}
	if err := p.credit(ctx, tx, userID, "TREASURE_SOLO", chestID, points, now); err != nil {
		return Result{}, err
	}
	res := Result{Kind: "SOLO", Points: points, SceneName: sceneName, DistanceM: dist, Total: p.total(ctx, tx, userID)}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return res, nil
}

// OpenCompanion：凭一单「带小美的活动报名」开同行加成箱（到店 100 米内、窗口内、每单一次）。
func (p *Postgres) OpenCompanion(ctx context.Context, userID, activityID, companionID string, loc Location, now time.Time) (Result, error) {
	nearby := now
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var sceneID, sceneName string
	var slat, slng float64
	var startsAt *time.Time
	var updatedAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT sc.id, sc.name, sc.latitude, sc.longitude, (a.payload->>'startsAt')::timestamptz, pt.updated_at
		  FROM activity.participants pt
		  JOIN activity.activities a ON a.id = pt.activity_id
		  JOIN reality.scenes sc ON sc.id = a.payload->>'realitySceneId' AND sc.status = 'ACTIVE'
		 WHERE pt.actor_id = $1 AND pt.activity_id = $2 AND pt.companion_id = $3 AND pt.companion_id <> ''
		   AND pt.state IN ('CONFIRMED','ATTENDED') FOR UPDATE OF pt`, userID, activityID, companionID).
		Scan(&sceneID, &sceneName, &slat, &slng, &startsAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrNotEligible
	}
	if err != nil {
		return Result{}, err
	}
	if startsAt != nil {
		if !CompanionWindowOpen(*startsAt, nearby) {
			return Result{}, ErrNotEligible
		}
	} else if nearby.Sub(updatedAt) > 48*time.Hour {
		return Result{}, ErrNotEligible
	}
	dist, perr := CheckPresence(loc, slat, slng)
	if perr != nil {
		return Result{DistanceM: dist}, perr
	}
	var already int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.opens WHERE user_id = $1 AND kind = 'COMPANION' AND activity_id = $2 AND companion_id = $3`, userID, activityID, companionID).Scan(&already); err != nil {
		return Result{}, err
	}
	if already > 0 {
		return Result{}, ErrAlreadyOpened
	}
	prev, err := p.prevOpen(ctx, tx, userID)
	if err != nil {
		return Result{}, err
	}
	if !SpeedPlausible(prev, slat, slng, now) {
		return Result{}, ErrSpeed
	}
	openID := newOpenID(userID, now, activityID+companionID)
	if _, err := tx.Exec(ctx, `
		INSERT INTO treasure.opens (id, user_id, kind, activity_id, companion_id, scene_id, points, distance_m, accuracy_m, opened_at)
		VALUES ($1,$2,'COMPANION',$3,$4,$5,$6,$7,$8,$9)`, openID, userID, activityID, companionID, sceneID, CompanionPts, dist, int(loc.AccuracyM), now.UTC()); err != nil {
		return Result{}, err
	}
	if err := p.credit(ctx, tx, userID, "TREASURE_COMPANION", activityID+"|"+companionID, CompanionPts, now); err != nil {
		return Result{}, err
	}
	res := Result{Kind: "COMPANION", Points: CompanionPts, SceneName: sceneName, DistanceM: dist, Total: p.total(ctx, tx, userID)}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	// 咖啡券：事务之外领（福利有自己的名额和资格）；领不到不影响已经开出的成长值。
	if campaign, benefit := p.voucherConfigured(ctx); campaign != "" && benefit != "" && p.Claimer != nil {
		if claimID, err := p.Claimer.Claim(ctx, userID, campaign, benefit); err == nil && claimID != "" {
			res.ClaimID = claimID
			_, _ = p.pool.Exec(ctx, `UPDATE treasure.opens SET claim_id = $2 WHERE id = $1`, openID, claimID)
		}
	}
	return res, nil
}

// SetCompanionReward：运营配置同行箱带的咖啡券；两个都空 = 清除（只给成长值）。
func (p *Postgres) SetCompanionReward(ctx context.Context, campaignID, benefitID string, now time.Time) error {
	for k, v := range map[string]string{"companion_campaign_id": campaignID, "companion_benefit_id": benefitID} {
		if v == "" {
			if _, err := p.pool.Exec(ctx, `DELETE FROM treasure.settings WHERE key = $1`, k); err != nil {
				return err
			}
			continue
		}
		if _, err := p.pool.Exec(ctx, `INSERT INTO treasure.settings (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`, k, v, now.UTC()); err != nil {
			return err
		}
	}
	return nil
}
