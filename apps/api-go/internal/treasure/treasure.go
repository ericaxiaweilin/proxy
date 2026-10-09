// Package treasure：寻宝（TREASURE-001）。学 PAO0 的玩法，改成适合撮合的机制：
//
//   - 普通宝箱：落在真实的咖啡店场景上，任何用户到店 100 米内都能开，给成长值。
//   - 同行加成：用户在这家店有一单已确认、带小美同行的活动报名 —— 到店后可以多开一次，分数更高，
//     运营配了的话还带一张咖啡券。这是「下单小美」才有的特殊激励。
//
// 判定全在服务端，客户端只报定位；不存用户坐标，只存离店距离与精度。奖励只有成长值（积分账本）和券，没有现金。
package treasure

import (
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
)

// 规则常量（一处）。数值是第一版，放在代码里，调整只改这里。
const (
	RadiusM       = 100.0 // 离店多近才能开
	MaxAccuracyM  = 150.0 // 定位精度差于这个不认
	MaxSpeedKmh   = 120.0 // 两次开箱之间折算速度超过这个不像真人
	SoloPoints    = 10
	SoloCapacity  = 8
	ChestTTL      = 3 * time.Hour
	DailySoloCap  = 10 // 每人每天最多开几个普通箱
	CompanionPts  = 30
	MaxSpawnTotal = 30 // 同时活着的箱子总数上限
)

// 开不了的原因码（客户端按它说人话；不用文案当协议）。
var (
	ErrTooFar        = errors.New("TOO_FAR")
	ErrAccuracy      = errors.New("ACCURACY_TOO_LOW")
	ErrAlreadyOpened = errors.New("ALREADY_OPENED")
	ErrChestGone     = errors.New("CHEST_GONE") // 不存在 / 到期 / 被开空
	ErrDailyCap      = errors.New("DAILY_CAP")
	ErrSpeed         = errors.New("SPEED_IMPLAUSIBLE")
	ErrNotEligible   = errors.New("NOT_ELIGIBLE") // 没有可凭的同行订单
	ErrBadLocation   = errors.New("BAD_LOCATION")
)

type Location struct {
	Lat, Lng  float64
	AccuracyM float64
}

func (l Location) Valid() bool {
	return l.Lat >= -90 && l.Lat <= 90 && l.Lng >= -180 && l.Lng <= 180 && !(l.Lat == 0 && l.Lng == 0) && l.AccuracyM >= 0
}

// CheckPresence：到店判定。返回离店距离（米，取整）。精度太差 / 太远分别报不同原因。
func CheckPresence(loc Location, sceneLat, sceneLng float64) (int, error) {
	if !loc.Valid() {
		return 0, ErrBadLocation
	}
	if loc.AccuracyM > MaxAccuracyM {
		return 0, ErrAccuracy
	}
	d := matching.DistanceMeters(loc.Lat, loc.Lng, sceneLat, sceneLng)
	if d > RadiusM {
		return int(d), ErrTooFar
	}
	return int(d), nil
}

// Prev 是上一次开箱的地点与时间（折算速度用）。
type Prev struct {
	Lat, Lng float64
	At       time.Time
}

// SpeedPlausible：从上一次开箱的店到这家店，折算速度不超过 MaxSpeedKmh。
// 间隔不足一分钟按一分钟算，避免除零；同一家店（距离 0）永远合理。
func SpeedPlausible(prev *Prev, lat, lng float64, now time.Time) bool {
	if prev == nil {
		return true
	}
	dist := matching.DistanceMeters(prev.Lat, prev.Lng, lat, lng)
	dt := now.Sub(prev.At)
	if dt < time.Minute {
		dt = time.Minute
	}
	kmh := (dist / 1000.0) / dt.Hours()
	return kmh <= MaxSpeedKmh
}

// 越南本地自然日（UTC+7）的起点，每日上限按它算。
func LocalDayStart(now time.Time) time.Time {
	loc := time.FixedZone("ICT", 7*3600)
	n := now.In(loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, loc).UTC()
}

// 同行加成的时间窗口：开始前 2 小时到开始后 6 小时。
const (
	CompanionBefore = 2 * time.Hour
	CompanionAfter  = 6 * time.Hour
)

// CompanionWindowOpen：这一单（有结构化开始时间）现在能不能凭它开同行箱。
func CompanionWindowOpen(startsAt, now time.Time) bool {
	return !now.Before(startsAt.Add(-CompanionBefore)) && now.Before(startsAt.Add(CompanionAfter))
}
