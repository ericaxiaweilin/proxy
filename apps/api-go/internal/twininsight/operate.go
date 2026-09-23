package twininsight

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// TWIN-INSIGHT-002 写侧：observe / operate。
//
// 两个动作都是**对一个具体好友**的运营决定，不是对内容或对账号的改动，
// 所以它们既不碰 relationship 的好友状态（CRM 永不反向改好友状态，
// 见 relationship/crm.go），也不碰任何内容表 —— 只往审计表追加一行。
//
// 「当前这个好友是什么状态」= 审计表里最新那一行。这是本仓的数据不变式：
// 不硬删、走状态机 + 审计（PRD §1 第 7 条）。

type OperateAction string

const (
	ActionObserve OperateAction = "observe"
	ActionOperate OperateAction = "operate"
)

func (a OperateAction) Valid() bool {
	return a == ActionObserve || a == ActionOperate
}

// OperateResult 对齐契约的 TwinOperateResultSchema。
type OperateResult struct {
	TargetID string        `json:"targetId"`
	Action   OperateAction `json:"action"`
	// ActedAt 用 RFC3339（契约 min 1，客户端只展示）。
	ActedAt string `json:"actedAt"`
}

// RecordedAction 是审计表的一行。
type RecordedAction struct {
	ID       string
	TwinID   string
	OwnerID  string
	TargetID string
	Action   OperateAction
	ActedAt  time.Time
}

// ActionLog 是审计落点。接口只有一个写方法 —— 读当前状态不在 v1 的 wire 上
// （契约的 TwinInsight 没有这个字段），所以不预留读方法当摆设。
type ActionLog interface {
	RecordAction(ctx context.Context, action RecordedAction) error
}

// CompanionGate 判定 owner 是否被允许使用 AI 伴侣 / 数字分身。
// 生产实现是 aipersona.CompanionAllowedFor（COMP-AI-MINOR-001，fail-closed）。
// 注入而不是直接 import，是为了让本包不依赖 aipersona 的仓储形状，
// 也为了让测试能用一个确定性的假门禁。
type CompanionGate func(ctx context.Context, ownerID string) error

var (
	// ErrActionInvalid：action 不是 observe/operate。
	ErrActionInvalid = errors.New("twininsight: unknown operate action")
	// ErrActionLogUnavailable：没接审计落点。写路径 fail-closed。
	ErrActionLogUnavailable = errors.New("twininsight: action log unavailable")
	// ErrCompanionGateUnavailable：没接未成年人门禁。写路径 fail-closed。
	ErrCompanionGateUnavailable = errors.New("twininsight: companion gate unavailable")
)

// RecordOperate 记录一次运营动作。
//
// 顺序是刻意的：先判 action 合法性（便宜的校验），再判门禁（合规），
// 再判目标是不是好友（越权），最后才写 —— 任何一步不过都不留痕，
// 避免审计表被无效尝试灌满。
//
// targetID 必须是 owner 的**活跃好友**：不加这条，任何人可以对任意账号
// 开"单独运营"，审计表会变成一张可以随便往别人身上写的表。
func (s *Service) RecordOperate(ctx context.Context, twinID, ownerID, targetID string, action OperateAction) (OperateResult, error) {
	if err := s.viewerAllowed(ctx, ownerID); err != nil {
		return OperateResult{}, err
	}
	if !action.Valid() {
		return OperateResult{}, ErrActionInvalid
	}
	if s.actions == nil {
		return OperateResult{}, ErrActionLogUnavailable
	}
	if s.companionGate == nil {
		return OperateResult{}, ErrCompanionGateUnavailable
	}
	if err := s.companionGate(ctx, ownerID); err != nil {
		return OperateResult{}, err
	}
	if strings.TrimSpace(targetID) == "" {
		return OperateResult{}, ErrTargetNotAFriend
	}
	friends, err := s.friends.ListActiveFriends(ctx, ownerID)
	if err != nil {
		return OperateResult{}, fmt.Errorf("twininsight: list friends: %w", err)
	}
	allowed := false
	for _, friend := range friends {
		if friend.UserID == targetID {
			allowed = true
			break
		}
	}
	if !allowed {
		return OperateResult{}, ErrTargetNotAFriend
	}
	actedAt := s.clockNow()
	if err := s.actions.RecordAction(ctx, RecordedAction{
		ID:       newActionID(),
		TwinID:   twinID,
		OwnerID:  ownerID,
		TargetID: targetID,
		Action:   action,
		ActedAt:  actedAt,
	}); err != nil {
		return OperateResult{}, fmt.Errorf("twininsight: record action: %w", err)
	}
	return OperateResult{
		TargetID: targetID,
		Action:   action,
		ActedAt:  actedAt.Format(time.RFC3339),
	}, nil
}

func newActionID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 失败意味着系统熵源坏了，不该静默降级成可预测 id。
		return fmt.Sprintf("toa_fallback_%d", time.Now().UnixNano())
	}
	return "toa_" + hex.EncodeToString(buf)
}
