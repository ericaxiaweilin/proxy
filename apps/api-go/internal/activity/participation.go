package activity

import (
	"context"
	"errors"
)

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
	// FOR-YOU-SLOT-001：这一单的同行人（小美）。直接报名、不带同行人的单为空。
	// 报名主键是 (活动, 我, 同行人)：约不同的小美是不同的单。
	CompanionID string `json:"companionId,omitempty"`
	// Snapshot 是这一单落库时存的票面（含同行人 / 地点 / 时间）。
	//
	// HOME-FORYOU-ORDER-007：判重需要知道「原来那单的同行人是谁」，而这个字段
	// 之前根本没被读出来 —— 所以判重只能按 (activity, actor) 判，换一个同行人
	// 也被说成「已经下过了」。
	Snapshot *OrderSnapshot `json:"snapshot,omitempty"`
}

var (
	ErrNotJoined               = errors.New("activity not joined")
	ErrParticipationTransition = errors.New("participation state does not allow this transition")
	// ErrNumberLookupUnsupported：仓储没有按编号反查的能力（PUBLIC-NO-LOOKUP-001）。
	ErrNumberLookupUnsupported = errors.New("activity number lookup not supported by repository")
)

// NumberReader 由能按公共编号反查的仓储实现（PG 与内存仓都实现）。是可选接口，
// 不进 Repository —— 其他包里的测试仓不必跟着改。
type NumberReader interface {
	// FindParticipationByNumber：按报名订单编号反查报名和它所属的活动；没有 ⇒ ErrNotJoined。
	FindParticipationByNumber(ctx context.Context, orderNo string) (Participation, Activity, error)
	// FindActivityByCode：按全数字活动编号反查；没有 ⇒ ErrActivityNotFound。
	FindActivityByCode(ctx context.Context, code string) (Activity, error)
}

// FindParticipationByNumber / FindActivityByCode 是客服 / 运营的跨当事人反查入口
// （PUBLIC-NO-LOOKUP-001）。这里不做鉴权 —— 调用方（internal/numberlookup）负责运营门
// 和审计留痕。
func (s *Service) FindParticipationByNumber(ctx context.Context, orderNo string) (Participation, Activity, error) {
	reader, ok := s.repository.(NumberReader)
	if !ok {
		return Participation{}, Activity{}, ErrNumberLookupUnsupported
	}
	return reader.FindParticipationByNumber(ctx, orderNo)
}

func (s *Service) FindActivityByCode(ctx context.Context, code string) (Activity, error) {
	reader, ok := s.repository.(NumberReader)
	if !ok {
		return Activity{}, ErrNumberLookupUnsupported
	}
	return reader.FindActivityByCode(ctx, code)
}

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
