package treasure

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
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
	// 有奖品的场景，箱子带券位（最多 PrizeSlotsPerChest 个，不超过奖品剩余数量）和更高的分数；没有奖品的只给成长值。
	tag, err := p.pool.Exec(ctx, `
		INSERT INTO treasure.chests (id, scene_id, points, capacity, created_at, expires_at, prize_id, prize_slots)
		SELECT 'tc_' || md5(sc.id || clock_timestamp()::text), sc.id,
		       CASE WHEN pr.id IS NOT NULL THEN $6::int ELSE $1::int END, $2::int, $3::timestamptz, $4::timestamptz,
		       COALESCE(pr.id, ''), CASE WHEN pr.id IS NOT NULL THEN GREATEST(LEAST($7::int, pr.quota - pr.awarded - COALESCE(held.slots, 0)), 0) ELSE 0 END
		  FROM reality.scenes sc
		  LEFT JOIN treasure.prizes pr ON pr.scene_id = sc.id AND pr.status = 'ACTIVE' AND pr.awarded < pr.quota
		  LEFT JOIN LATERAL (SELECT COALESCE(SUM(c2.prize_slots),0) AS slots FROM treasure.chests c2 WHERE c2.prize_id = pr.id AND c2.status = 'ACTIVE') held ON TRUE
		 WHERE sc.status = 'ACTIVE' AND sc.type LIKE '咖啡%'
		   AND NOT EXISTS (SELECT 1 FROM treasure.chests c WHERE c.scene_id = sc.id AND c.status = 'ACTIVE')
		 ORDER BY sc.id LIMIT $5::int
		ON CONFLICT DO NOTHING`, SoloPoints, SoloCapacity, now.UTC(), now.Add(ChestTTL).UTC(), room, PrizePoints, PrizeSlotsPerChest)
	return int(tag.RowsAffected()), err
}

// ---------------------------------------------------------------- 附近

type Chest struct {
	ID         string    `json:"id"`
	SceneID    string    `json:"sceneId"`
	Name       string    `json:"name"`
	Area       string    `json:"area"`
	Lat        float64   `json:"lat"` // 场景（店）的公开坐标，客户端算方位用
	Lng        float64   `json:"lng"`
	DistanceM  int       `json:"distanceM"`
	Points     int       `json:"points"`
	Remaining  int       `json:"remaining"`
	ExpiresAt  time.Time `json:"expiresAt"`
	OpenedByMe bool      `json:"openedByMe"`
	// 奖品：这个箱子里有券位时给出（金色箱）。slots = 还没被抽走的券位数。
	PrizeLabel string `json:"prizeLabel,omitempty"`
	PrizeSlots int    `json:"prizeSlots,omitempty"`
}

type Booking struct {
	ActivityID  string  `json:"activityId"`
	CompanionID string  `json:"companionId"`
	Title       string  `json:"title"`
	SceneID     string  `json:"sceneId"`
	Name        string  `json:"name"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	DistanceM   int     `json:"distanceM"`
	Points      int     `json:"points"`
	WithVoucher bool    `json:"withVoucher"`
	PrizeLabel  string  `json:"prizeLabel,omitempty"` // 这家店当前的奖品（同行加成必出）
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

// Nearby：5 公里内的活箱子（含我是否开过），以及我现在可以凭它开同行箱的订单。
func (p *Postgres) Nearby(ctx context.Context, userID string, lat, lng float64, now time.Time) (Nearby, error) {
	out := Nearby{Chests: []Chest{}, Bookings: []Booking{}, DailyCap: DailySoloCap, RadiusM: int(RadiusM)}
	rows, err := p.pool.Query(ctx, `
		SELECT c.id, c.scene_id, sc.name, sc.area, sc.latitude, sc.longitude, c.points, c.capacity - c.opened, c.expires_at,
		       EXISTS (SELECT 1 FROM treasure.opens o WHERE o.user_id = $1 AND o.chest_id = c.id AND o.kind = 'SOLO'),
		       COALESCE(pr.label, ''), c.prize_slots
		  FROM treasure.chests c JOIN reality.scenes sc ON sc.id = c.scene_id
		  LEFT JOIN treasure.prizes pr ON pr.id = c.prize_id AND c.prize_slots > 0
		 WHERE c.status = 'ACTIVE' AND c.expires_at > $2 AND c.opened < c.capacity`, userID, now.UTC())
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var c Chest
		var slat, slng float64
		if err := rows.Scan(&c.ID, &c.SceneID, &c.Name, &c.Area, &slat, &slng, &c.Points, &c.Remaining, &c.ExpiresAt, &c.OpenedByMe, &c.PrizeLabel, &c.PrizeSlots); err != nil {
			rows.Close()
			return out, err
		}
		d := matching.DistanceMeters(lat, lng, slat, slng)
		if d > nearbyLimitM {
			continue
		}
		c.DistanceM, c.Lat, c.Lng = int(d), slat, slng
		out.Chests = append(out.Chests, c)
	}
	rows.Close()
	sortChests(out.Chests)

	brows, err := p.pool.Query(ctx, `
		SELECT pt.activity_id, pt.companion_id, COALESCE(a.payload->>'title',''), sc.id, sc.name, sc.latitude, sc.longitude, COALESCE(pr.label, '')
		  FROM activity.participants pt
		  JOIN activity.activities a ON a.id = pt.activity_id
		  JOIN reality.scenes sc ON sc.id = a.payload->>'realitySceneId' AND sc.status = 'ACTIVE'
		  LEFT JOIN treasure.prizes pr ON pr.scene_id = sc.id AND pr.status = 'ACTIVE' AND pr.awarded < pr.quota
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
		if err := brows.Scan(&b.ActivityID, &b.CompanionID, &b.Title, &b.SceneID, &b.Name, &slat, &slng, &b.PrizeLabel); err != nil {
			brows.Close()
			return out, err
		}
		b.DistanceM, b.Lat, b.Lng = int(matching.DistanceMeters(lat, lng, slat, slng)), slat, slng
		b.Points, b.WithVoucher = CompanionPts, b.PrizeLabel != "" && p.Claimer != nil
		out.Bookings = append(out.Bookings, b)
	}
	brows.Close()
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM treasure.opens WHERE user_id = $1 AND kind = 'SOLO' AND opened_at >= $2`, userID, LocalDayStart(now)).Scan(&out.OpenedToday); err != nil {
		return out, err
	}
	_ = p.pool.QueryRow(ctx, `SELECT COALESCE(SUM(delta),0) FROM growth.point_ledger WHERE subject_kind = 'USER' AND subject_id = $1`, userID).Scan(&out.TotalPoints)
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
	Kind       string `json:"kind"`
	Points     int    `json:"points"`
	SceneName  string `json:"sceneName"`
	DistanceM  int    `json:"distanceM"`
	ClaimID    string `json:"claimId,omitempty"`    // 带出了券（福利领取记录）
	PrizeLabel string `json:"prizeLabel,omitempty"` // 券的名字，例如「免费美式一杯」
	HadPrize   bool   `json:"hadPrize,omitempty"`   // 这个箱子里本来有券位（金色箱），没抽中也会告诉你
	Total      int    `json:"totalPoints"`          // 开完之后账本里的积分合计（用户）
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
	var points, capacity, opened, prizeSlots int
	var status, prizeID string
	var expires time.Time
	err = tx.QueryRow(ctx, `
		SELECT c.scene_id, sc.name, sc.latitude, sc.longitude, c.points, c.capacity, c.opened, c.status, c.expires_at, c.prize_id, c.prize_slots
		  FROM treasure.chests c JOIN reality.scenes sc ON sc.id = c.scene_id WHERE c.id = $1 FOR UPDATE OF c`, chestID).
		Scan(&sceneID, &sceneName, &slat, &slng, &points, &capacity, &opened, &status, &expires, &prizeID, &prizeSlots)
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
	// 抽奖：券位 / 剩余开箱名额 的概率（券位 ≥ 剩余名额就必中）。先在事务里占住券位和奖品名额，领券失败再退回。
	won := false
	var prizeLabel, campaignID, benefitID string
	if prizeID != "" && prizeSlots > 0 && p.Claimer != nil && Roll(prizeSlots, capacity-opened) {
		err := tx.QueryRow(ctx, `
			UPDATE treasure.prizes SET awarded = awarded + 1 WHERE id = $1 AND status = 'ACTIVE' AND awarded < quota
			RETURNING label, campaign_id, benefit_id`, prizeID).Scan(&prizeLabel, &campaignID, &benefitID)
		if err == nil {
			won = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return Result{}, err
		}
	}
	slotsAfter := prizeSlots
	if won {
		slotsAfter--
	}
	if _, err := tx.Exec(ctx, `UPDATE treasure.chests SET opened = opened + 1, prize_slots = $2 WHERE id = $1`, chestID, slotsAfter); err != nil {
		return Result{}, err
	}
	if err := p.credit(ctx, tx, userID, "TREASURE_SOLO", chestID, points, now); err != nil {
		return Result{}, err
	}
	openID := newOpenID(userID, now, chestID)
	res := Result{Kind: "SOLO", Points: points, SceneName: sceneName, DistanceM: dist, Total: p.total(ctx, tx, userID), HadPrize: prizeSlots > 0}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	if won {
		p.awardPrize(ctx, userID, openID, chestID, prizeID, prizeLabel, campaignID, benefitID, &res)
	}
	return res, nil
}

// Roll：slots 个券位分给 remaining 个开箱名额，这一次抽中的概率 = slots / remaining（≥ 1 必中）。用密码学随机数。
func Roll(slots, remaining int) bool {
	if slots <= 0 || remaining <= 0 {
		return false
	}
	if slots >= remaining {
		return true
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(remaining)))
	if err != nil {
		return false
	}
	return int(n.Int64()) < slots
}

// awardPrize 在事务外领券（福利服务有自己的资格 / 容量检查）。领不到就把占住的奖品名额和券位退回，成长值不受影响。
func (p *Postgres) awardPrize(ctx context.Context, userID, openID, chestID, prizeID, label, campaignID, benefitID string, res *Result) {
	_ = userID
	claimID, err := p.Claimer.Claim(ctx, userID, campaignID, benefitID)
	if err != nil || claimID == "" {
		_, _ = p.pool.Exec(ctx, `UPDATE treasure.prizes SET awarded = GREATEST(awarded - 1, 0) WHERE id = $1`, prizeID)
		if chestID != "" {
			_, _ = p.pool.Exec(ctx, `UPDATE treasure.chests SET prize_slots = prize_slots + 1 WHERE id = $1`, chestID)
		}
		return
	}
	res.ClaimID, res.PrizeLabel = claimID, label
	_, _ = p.pool.Exec(ctx, `UPDATE treasure.opens SET claim_id = $2, prize_label = $3 WHERE id = $1`, openID, claimID, label)
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
	// 同行加成必出券：这家店的奖品还有余量就占一个名额，事务外领券；领不到退回名额。
	if p.Claimer != nil {
		var prizeID, label, campaignID, benefitID string
		err := p.pool.QueryRow(ctx, `
			UPDATE treasure.prizes SET awarded = awarded + 1
			 WHERE scene_id = $1 AND status = 'ACTIVE' AND awarded < quota
			RETURNING id, label, campaign_id, benefit_id`, sceneID).Scan(&prizeID, &label, &campaignID, &benefitID)
		if err == nil {
			claimID, cerr := p.Claimer.Claim(ctx, userID, campaignID, benefitID)
			if cerr != nil || claimID == "" {
				_, _ = p.pool.Exec(ctx, `UPDATE treasure.prizes SET awarded = GREATEST(awarded - 1, 0) WHERE id = $1`, prizeID)
			} else {
				res.ClaimID, res.PrizeLabel = claimID, label
				_, _ = p.pool.Exec(ctx, `UPDATE treasure.opens SET claim_id = $2, prize_label = $3 WHERE id = $1`, openID, claimID, label)
			}
		}
	}
	return res, nil
}

// ---------------------------------------------------------------- 奖品（运营）

type Prize struct {
	ID         string    `json:"id"`
	SceneID    string    `json:"sceneId"`
	SceneName  string    `json:"sceneName"`
	CampaignID string    `json:"campaignId"`
	BenefitID  string    `json:"benefitId"`
	Label      string    `json:"label"`
	Quota      int       `json:"quota"`
	Awarded    int       `json:"awarded"`
	Status     string    `json:"status"`
	CreatedBy  string    `json:"createdBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (p *Postgres) ListPrizes(ctx context.Context) ([]Prize, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT pr.id, pr.scene_id, COALESCE(sc.name, pr.scene_id), pr.campaign_id, pr.benefit_id, pr.label, pr.quota, pr.awarded, pr.status, pr.created_by, pr.created_at
		  FROM treasure.prizes pr LEFT JOIN reality.scenes sc ON sc.id = pr.scene_id ORDER BY pr.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Prize{}
	for rows.Next() {
		var x Prize
		if err := rows.Scan(&x.ID, &x.SceneID, &x.SceneName, &x.CampaignID, &x.BenefitID, &x.Label, &x.Quota, &x.Awarded, &x.Status, &x.CreatedBy, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

var ErrPrizeExists = errors.New("PRIZE_EXISTS")

// CreatePrize 记一个已建好券的奖品。一个场景同时只有一个生效奖品（唯一索引挡住第二个）。
func (p *Postgres) CreatePrize(ctx context.Context, sceneID, campaignID, benefitID, label string, quota int, by string, now time.Time) (string, error) {
	id := "tp_" + fmt.Sprintf("%x", fmt.Sprintf("%s|%d", sceneID, now.UnixNano()))
	_, err := p.pool.Exec(ctx, `INSERT INTO treasure.prizes (id, scene_id, campaign_id, benefit_id, label, quota, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, sceneID, campaignID, benefitID, label, quota, by, now.UTC())
	if err != nil && (err.Error() != "" && containsUnique(err)) {
		return "", ErrPrizeExists
	}
	return id, err
}

func containsUnique(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}

// EndPrize 结束一个奖品：不再往新箱子上放；已领出的券不受影响。
func (p *Postgres) EndPrize(ctx context.Context, id string) (bool, error) {
	tag, err := p.pool.Exec(ctx, `UPDATE treasure.prizes SET status = 'ENDED' WHERE id = $1 AND status = 'ACTIVE'`, id)
	return tag.RowsAffected() == 1, err
}
