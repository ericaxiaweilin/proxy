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

// COMP-REPORT-004: 申诉机制。
//
// 001 + 003 让举报闭环到「收到 → 处理」：reports 证明收到、dispositions 证明
// 处理。但被处理方（被举报者、或对处置不服的举报人）没有任何渠道去申诉 ——
// 这恰恰是 §37 第 693 行、§38 第 709 行承诺的「恢复或申诉机制」，也是
// NĐ 147/2024 对社交网络的硬性要求（投诉 / 申诉渠道）。
//
// 没有申诉渠道，平台能证明自己「处理了举报」，却证明不了「被处理方有救济
// 途径」。在行政与刑事语境下，处置权缺少制衡同样是 posture 缺陷：一条
// ACCOUNT_SUSPENDED / REFERRED_TO_AUTHORITY 的处置，被处理方完全无法申辩，
// 姿态就是「平台说了算」。
//
// 沿用 086 / 087 的口径：
//   - append-only：申诉与其复核都是举证材料，不 UPDATE / 不 DELETE。
//   - fail-closed：申诉引用的举报不存在就拒；复核引用的申诉不存在就拒；
//     决策不认识 / 驳回不写理由 / 复核人不明 —— 全部拒。
//   - 复核是 operator-only（见 security.go 的 operatorCommandTypes），普通
//     用户不能给自己写「申诉成立 / 驳回」。

// 申诉复核决策。
const (
	// AppealDecisionUpheld 申诉成立：原处置被推翻（例如恢复账号、撤销下架）。
	AppealDecisionUpheld = "UPHELD"
	// AppealDecisionRejected 申诉驳回：维持原处置，必须写理由。
	AppealDecisionRejected = "REJECTED"
)

// 由复核链推导出的申诉状态。
const (
	AppealStateFiled    = "FILED"
	AppealStateUpheld   = "UPHELD"
	AppealStateRejected = "REJECTED"
)

// AppealDecisions 返回受支持的复核决策（已排序）。
func AppealDecisions() []string {
	out := []string{AppealDecisionUpheld, AppealDecisionRejected}
	sort.Strings(out)
	return out
}

// Appeal 是一条申诉提交记录。
type Appeal struct {
	ID          string    `json:"appealId"`
	ReportID    string    `json:"reportId"`
	AppellantID string    `json:"appellantAccountId"`
	Reason      string    `json:"reason"`
	CreatedAt   time.Time `json:"createdAt"`
}

// AppealDecision 是 operator 对一条申诉的复核决策（append-only）。
type AppealDecision struct {
	ID        string    `json:"appealDecisionId"`
	AppealID  string    `json:"appealId"`
	Decision  string    `json:"decision"`
	Note      string    `json:"note,omitempty"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

// AppealState 由复核链推导申诉的当前状态：没有复核 = 刚提交，仍为 FILED。
// 与 ReportState 同口径——申诉表保持 append-only，「现在到哪一步」由
// 最后一行复核回答。
func AppealState(decisions []AppealDecision) string {
	if len(decisions) == 0 {
		return AppealStateFiled
	}
	latest := decisions[len(decisions)-1]
	switch latest.Decision {
	case AppealDecisionUpheld:
		return AppealStateUpheld
	case AppealDecisionRejected:
		return AppealStateRejected
	default:
		// 认不出的决策不能悄悄当成「已复核」—— 那正是本包要防的事。
		return AppealStateFiled
	}
}

type appealPayload struct {
	ReportID string `json:"reportId"`
	Reason   string `json:"reason"`
}

// fileAppeal 受理一条申诉。任何已登录用户都能针对一条存在的举报提交申诉。
//
// 是否「有资格申诉」（举报人？被举报者？）是产品 / 运营判断，复核环节
// （RecordAppealDecision）由 operator 把关；这里只做 fail-closed 的硬校验。
// 申诉人身份（appellant_account_id）从鉴权后的 envelope.Actor 取，不信任
// 客户端自报——否则申诉记录可以被伪造归属。
func (s *Service) fileAppeal(ctx context.Context, e command.Envelope) command.Result {
	var p appealPayload
	if !decodeAppealPayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_APPEAL", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal", nil)
	}
	if strings.TrimSpace(p.ReportID) == "" {
		return command.Rejected(e, "INVALID_APPEAL_REPORT", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal_report", nil)
	}
	if strings.TrimSpace(p.Reason) == "" {
		return command.Rejected(e, "INVALID_APPEAL_REASON", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal_reason", nil)
	}
	// 申诉人身份是举证链的一部分：匿名申诉无法回访、无法核对。拿不到就拒绝。
	if e.Actor.ID == "" {
		return command.Rejected(e, "APPEAL_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.appeal_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "APPEAL_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.appeal_failed", nil)
	}
	// 申诉必须挂在真实存在的举报上：给不存在的举报写申诉，只能制造
	// 「看起来有人申诉过」的假象，比没有申诉更糟。
	if _, ok := s.repository.FindReport(ctx, p.ReportID); !ok {
		return command.Rejected(e, "APPEAL_REPORT_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "moderation.appeal_report_not_found", nil)
	}
	appeal := Appeal{
		ID:          newAppealID(),
		ReportID:    p.ReportID,
		AppellantID: e.Actor.ID,
		Reason:      strings.TrimSpace(p.Reason),
		CreatedAt:   s.clock.Now().UTC(),
	}
	if err := s.repository.AddAppeal(ctx, appeal); err != nil {
		return command.Rejected(e, "APPEAL_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.appeal_failed", nil)
	}
	return command.Accepted(e, "ModerationAppeal", appeal.ID, 1, AppealStateFiled, nil)
}

type appealDecisionPayload struct {
	AppealID string `json:"appealId"`
	Decision string `json:"decision"`
	Note     string `json:"note"`
}

// recordAppealDecision 由 operator 对申诉做复核（UPHELD / REJECTED）。
// 调用方（security.go operatorCommandTypes）保证只有 operator 能走到这里 ——
// 否则复核记录就成了谁都能伪造的东西，制衡价值归零。
func (s *Service) recordAppealDecision(ctx context.Context, e command.Envelope) command.Result {
	var p appealDecisionPayload
	if !decodeAppealDecisionPayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_APPEAL_DECISION", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal_decision", nil)
	}
	if !contains(AppealDecisions(), p.Decision) {
		return command.Rejected(e, "INVALID_APPEAL_DECISION_KIND", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal_decision_kind", nil)
	}
	// 驳回必须写理由：一条涉未成年人 / 招嫖的申诉被无理由驳回，看起来就是
	// 随手关掉。
	if p.Decision == AppealDecisionRejected && strings.TrimSpace(p.Note) == "" {
		return command.Rejected(e, "APPEAL_DECISION_NOTE_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "moderation.appeal_decision_note_required", nil)
	}
	if strings.TrimSpace(p.AppealID) == "" {
		return command.Rejected(e, "INVALID_APPEAL_DECISION_APPEAL", "VALIDATION", "AFTER_USER_ACTION", "moderation.invalid_appeal_decision_appeal", nil)
	}
	if e.Actor.ID == "" {
		return command.Rejected(e, "APPEAL_DECISION_REQUIRES_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "moderation.appeal_decision_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "APPEAL_DECISION_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.appeal_decision_failed", nil)
	}
	// 复核必须挂在真实存在的申诉上。
	if _, ok := s.repository.FindAppeal(ctx, p.AppealID); !ok {
		return command.Rejected(e, "APPEAL_DECISION_APPEAL_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "moderation.appeal_decision_appeal_not_found", nil)
	}
	decision := AppealDecision{
		ID:        newAppealDecisionID(),
		AppealID:  p.AppealID,
		Decision:  p.Decision,
		Note:      strings.TrimSpace(p.Note),
		ActorID:   e.Actor.ID,
		CreatedAt: s.clock.Now().UTC(),
	}
	if err := s.repository.AddAppealDecision(ctx, decision); err != nil {
		return command.Rejected(e, "APPEAL_DECISION_FAILED", "INTERNAL", "SAFE_RETRY", "moderation.appeal_decision_failed", nil)
	}
	return command.Accepted(e, "ModerationAppealDecision", decision.ID, 1, p.Decision, nil)
}

func decodeAppealPayload(payload map[string]any, out *appealPayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func decodeAppealDecisionPayload(payload map[string]any, out *appealDecisionPayload) bool {
	if payload == nil {
		return false
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func newAppealID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "appeal_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "appeal_" + hex.EncodeToString(buf)
}

func newAppealDecisionID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "appealdec_" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return "appealdec_" + hex.EncodeToString(buf)
}
