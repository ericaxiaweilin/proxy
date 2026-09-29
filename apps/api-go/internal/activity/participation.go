package activity

import "errors"

// P1 ACT-01: Participation state — Master §13
type ParticipationState string

const (
	PartRequested  ParticipationState = "REQUESTED"
	PartConfirmed  ParticipationState = "CONFIRMED"
	PartWaitlisted ParticipationState = "WAITLISTED"
	PartCancelled  ParticipationState = "CANCELLED"
	PartAttended   ParticipationState = "ATTENDED"
	PartNoShow     ParticipationState = "NO_SHOW"
)

// Participation 是一个人对一场活动的报名（For You「确认下单」的订单）。
//
// ACT-PARTICIPATION-DURABLE-001：以前报名状态放在进程内存（ParticipationStore），
// 重启即丢，取消 / 签到 / 爽约全报「没报名」。现在由仓储持久化（PG：
// activity.participants 的 state / order_no），与占座在同一事务里写。
// ACT-ORDER-NO-001：OrderNo 是这笔报名自己的全数字订单编号（与履约订单共用
// 同一个分配器）；取消后再报名沿用同一条记录、同一个编号。
type Participation struct {
	ActivityID string             `json:"activityId"`
	UserID     string             `json:"userId"`
	State      ParticipationState `json:"state"`
	OrderNo    string             `json:"orderNo,omitempty"`
}

var (
	ErrNotJoined               = errors.New("activity not joined")
	ErrParticipationTransition = errors.New("participation state does not allow this transition")
)

// holdsSeat：这些状态占着名额（joined 计数）。CANCELLED 释放名额。
func holdsSeat(state ParticipationState) bool {
	return state == PartConfirmed || state == PartAttended || state == PartNoShow
}

func stateIn(state ParticipationState, allowed []ParticipationState) bool {
	for _, candidate := range allowed {
		if candidate == state {
			return true
		}
	}
	return false
}
