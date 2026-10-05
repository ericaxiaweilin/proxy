package fulfillment

import (
	"strings"
	"time"
)

// ORDER-CANCEL-WINDOW-001：取消窗口（冷静期）。
//
// 用户定的规则（2026-10-05，原话）：
//
//	「这个订单没有执行 可以取消 不能取消的是执行中 执行完不可能取消
//	  执行前12h也不能取消 如果用户下单距离约定执行时间不足12h 那么取消时间就是5m
//	  这5m内可以取消 超过5m不能取消 适用于所有订单」
//
// 也就是「什么时候还能取消」由**距离约定执行时间还有多久**决定，而不是由订单
// 当前处于哪个生命周期决定：
//
//	距离执行 ≥ 12h  →  还能取消到「执行前 12h」为止（提前预约，双方都有余地）
//	距离执行 <  12h  →  只能取消到「下单后 5 分钟」为止（临时单：creator 来不及安排）
//	执行中 / 已完成  →  不能取消（服务已经在发生，钱不该退）
//
// 为什么按时间而不是按状态：真人服务里「订单还没开始」不等于「可以随时反悔」。
//
//	creator 是真人，临期取消对他伤害最大（活接不到、档期被占），所以临期收紧；
//	而提前很久的预约用户改主意很正常，所以留足窗口。
//
// 结算守卫（ORDER-SETTLE-GUARD-001）是**另一条**独立的理由，不受这里的窗口影响：
//
//	线下钱已经换手，任何时候都不能取消。
const (
	// 提前预约的取消截止提前量：执行前 12h 就锁。
	plannedCancellationLead = 12 * time.Hour
	// 临期下单（距离执行不足 12h）的取消窗口：下单后 5 分钟。
	lastMinuteCancellationWindow = 5 * time.Minute
)

// cancellationWindowKind 说清这个订单走的是哪条分支 —— 拒绝时要告诉用户为什么
// 「不能取消」，否则用户只会以为是 bug。
type cancellationWindowKind string

const (
	// 提前预约：窗口在「执行前 12h」关闭。
	windowPlanned cancellationWindowKind = "planned"
	// 临期下单：窗口在「下单后 5 分钟」关闭。
	windowLastMinute cancellationWindowKind = "last-minute"
	// 说不清执行时间：按最紧的窗口处理（见 cancellationDeadline 的说明）。
	windowUnknownTime cancellationWindowKind = "unknown-scheduled-time"
)

// parseScheduledStart 取出订单约定的执行时间。
//
// ⚠️ 真的取不到的情况是多数而不是少数：本地库 819 单里只有 699 单 startTime 是
// ISO 时间戳，114 单是空串、6 单是 "10:00" 这种**只有时分、没有日期**。所以
// 「执行前 12h」这个规则对 120 单（14.7%）算不出来 —— 猜一个日期（比如当成今天
// 的 10:00）会给真人订单编出一个不存在的截止时间，比不给更糟。
func parseScheduledStart(order Order) (time.Time, bool) {
	raw := strings.TrimSpace(order.Snapshot.StartTime)
	if raw == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// cancellationDeadline 算出这个订单还能取消到什么时候，以及走的是哪条分支。
//
// 决策点只有一个：**距离约定执行时间还有多久**。
//
// 取不到执行时间时（空串 / 只有时分）走最紧的分支（下单后 5 分钟）。理由：
// 那不是「没有限制」，而是「我们不知道什么时候执行」—— 对 creator 最安全的解释
// 是按最紧的窗口处理。真要把这 120 单算准，得先修 startTime 的数据（单独一轮），
// 不能在取消规则里现编一个日期。
func cancellationDeadline(order Order) (time.Time, cancellationWindowKind) {
	created := order.CreatedAt.UTC()
	lastMinute := created.Add(lastMinuteCancellationWindow)

	start, ok := parseScheduledStart(order)
	if !ok {
		return lastMinute, windowUnknownTime
	}
	planned := start.Add(-plannedCancellationLead)
	// 恰好 12h：走「提前预约」分支（用户说的是「不足 12h」才收紧），于是截止点就是
	// 现在 —— 刚下单就锁死。想让边界更宽松就把 < 改成 <=，只动这一处。
	if start.Sub(created) < plannedCancellationLead {
		return lastMinute, windowLastMinute
	}
	return planned, windowPlanned
}

// cancellationWindowOpen 判断 now 时刻是否还在取消窗口内。
func cancellationWindowOpen(order Order, now time.Time) (bool, time.Time, cancellationWindowKind) {
	deadline, kind := cancellationDeadline(order)
	return now.UTC().Before(deadline), deadline, kind
}
