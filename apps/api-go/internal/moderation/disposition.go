package moderation

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-REPORT-003: 举报的处置留痕。
//
// 086 建的 reports 表把 state 钉死在 SUBMITTED 且整表 append-only，所以它能
// 证明「平台收到过举报」，但证明不了「平台处理过举报」。法律文件 §38 / §39
// 承诺了举报与申诉渠道，服务条款还承诺「依法要求删除违法信息：最迟 24 小时内
// 处理」——收进来却没有处置记录，等于书面承认收到、却拿不出任何处理痕迹。
//
// 这件事在刑法 327 条（介绍卖淫）的语境下尤其要命：MINOR_SAFETY /
// SOLICITATION 两类举报进来后如果查不到处置记录，姿态就是「知情不办」。
//
// 沿用 086 与 media review decision 的既有口径：
//   - append-only：处置记录也是举证材料，不 UPDATE / 不 DELETE。结论要改就
//     再写一行（REOPEN 或新的 ACTION_TAKEN），历史永远留着。
//   - fail-closed：动作不认识 / 结论不认识 / 处置人不明 / 说处置了却不说
//     处置了什么 / 判定不成立却不写理由 —— 全部拒绝。

// 处置动作。
const (
	// ActionTriage 已有人接手在看，尚未下结论。
	ActionTriage = "TRIAGE"
	// ActionEscalate 升级（法务 / 有权机关 / 更高权限）。
	ActionEscalate = "ESCALATE"
	// ActionTaken 已处置。必须同时给出 Outcome —— 「处置了」不说处置了什么，
	// 在举证上等于没处置。
	ActionTaken = "ACTION_TAKEN"
	// ActionDismiss 判定不成立。必须同时写 Note —— 一条涉未成年人或招嫖的
	// 举报被无理由关掉，看起来就是随手关掉。
	ActionDismiss = "DISMISS"
	// ActionReopen 重新打开：前一次结论被推翻。
	ActionReopen = "REOPEN"
)

// 处置结论，仅 ActionTaken 有意义。
const (
	OutcomeContentRemoved      = "CONTENT_REMOVED"
	OutcomeAccountRestricted   = "ACCOUNT_RESTRICTED"
	OutcomeAccountSuspended    = "ACCOUNT_SUSPENDED"
	OutcomeReferredToAuthority = "REFERRED_TO_AUTHORITY"
	OutcomeNoAction            = "NO_ACTION"
)

// 由处置动作推导出的举报状态。
const (
	ReportStateSubmitted = "SUBMITTED"
	ReportStateTriaged   = "TRIAGED"
	ReportStateEscalated = "ESCALATED"
	ReportStateActioned  = "ACTIONED"
	ReportStateDismissed = "DISMISSED"
	ReportStateReopened  = "REOPENED"
)

// DispositionActions 返回受支持的处置动作（已排序）。
func DispositionActions() []string {
	out := []string{ActionTriage, ActionEscalate, ActionTaken, ActionDismiss, ActionReopen}
	sort.Strings(out)
	return out
}

// DispositionOutcomes 返回受支持的处置结论（已排序）。
func DispositionOutcomes() []string {
	out := []string{
		OutcomeContentRemoved, OutcomeAccountRestricted, OutcomeAccountSuspended,
		OutcomeReferredToAuthority, OutcomeNoAction,
	}
	sort.Strings(out)
	return out
}

// Disposition 是一条举报处置记录。
type Disposition struct {
	ID        string    `json:"dispositionId"`
	ReportID  string    `json:"reportId"`
	Action    string    `json:"action"`
	Outcome   string    `json:"outcome,omitempty"`
	ActorID   string    `json:"actorId"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// ReportState 由处置链推导举报的当前状态：reports 表保持 append-only，
// 「现在到哪一步了」由 dispositions 的最后一行回答。
//
// 没有任何处置记录 = 刚受理，仍为 SUBMITTED。
func ReportState(dispositions []Disposition) string {
	if len(dispositions) == 0 {
		return ReportStateSubmitted
	}
	latest := dispositions[len(dispositions)-1]
	switch latest.Action {
	case ActionTriage:
		return ReportStateTriaged
	case ActionEscalate:
		return ReportStateEscalated
	case ActionTaken:
		return ReportStateActioned
	case ActionDismiss:
		return ReportStateDismissed
	case ActionReopen:
		return ReportStateReopened
	default:
		// 认不出的动作不能悄悄当成「已处理」—— 那正是本包要防的事。
		return ReportStateSubmitted
	}
}

type dispositionPayload struct {
	ReportID string `json:"reportId"`
	Action   string `json:"action"`
	Outcome  string `json:"outcome"`
	Note     string `json:"note"`
}

// recordDisposition 记录一次举报处置。调用方（Service.HandleContext）负责
// 保证只有 operator 能走到这里 —— 见 internal/api/security.go 的
// operatorCommandTypes。这里再兜一层：处置人身份不明就拒绝。
func (s *Service) recordDisposition(ctx context.Context, e command.Envelope) command.Result {
	var p dispositionPayload
	if !decodeDispositionPayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_DISPOSITION", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_disposition", nil)
	}
	if !contains(DispositionActions(), p.Action) {
		return command.Rejected(e, "INVALID_DISPOSITION_ACTION", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_disposition_action", nil)
	}
	if p.Outcome != "" && !contains(DispositionOutcomes(), p.Outcome) {
		return command.Rejected(e, "INVALID_DISPOSITION_OUTCOME", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_disposition_outcome", nil)
	}
	// 「已处置」必须说清处置了什么。
	if p.Action == ActionTaken && p.Outcome == "" {
		return command.Rejected(e, "DISPOSITION_OUTCOME_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "moderation.disposition_outcome_required", nil)
	}
	// 「判定不成立」必须写理由。
	if p.Action == ActionDismiss && strings.TrimSpace(p.Note) == "" {
		return command.Rejected(e, "DISPOSITION_NOTE_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "moderation.disposition_note_required", nil)
	}
	if strings.TrimSpace(p.ReportID) == "" {
		return command.Rejected(e, "INVALID_DISPOSITION_REPORT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_disposition_report", nil)
	}
	// 处置人身份是举证链的一部分：一条没有署名的处置，日后说不清是谁决定的。
	if e.Actor.ID == "" {
		return command.Rejected(e, "DISPOSITION_REQUIRES_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.disposition_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "DISPOSITION_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.disposition_failed", nil)
	}
	// 举报必须真实存在：给一条不存在的举报写处置，只能制造「看起来处理过」
	// 的假象，比没有记录更糟。
	if _, ok := s.repository.FindReport(ctx, p.ReportID); !ok {
		return command.Rejected(e, "DISPOSITION_REPORT_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "moderation.disposition_report_not_found", nil)
	}
	disposition := Disposition{
		ID:        newDispositionID(),
		ReportID:  p.ReportID,
		Action:    p.Action,
		Outcome:   p.Outcome,
		ActorID:   e.Actor.ID,
		Note:      strings.TrimSpace(p.Note),
		CreatedAt: s.clock.Now().UTC(),
	}
	if err := s.repository.AddDisposition(ctx, disposition); err != nil {
		return command.Rejected(e, "DISPOSITION_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.disposition_failed", nil)
	}
	return command.Accepted(e, "ModerationDisposition", disposition.ID, 1, disposition.Action, nil)
}

func decodeDispositionPayload(payload map[string]any, out *dispositionPayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func newDispositionID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "disp_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "disp_" + hex.EncodeToString(buf)
}
