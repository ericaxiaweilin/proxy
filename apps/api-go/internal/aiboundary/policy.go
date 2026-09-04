// Package aiboundary owns the closed set of "AI actor → side effect" rules.
//
// 三种 AI 主体（与 PRD v1.4 LC-06/07 / aipersona catalog 一致）：
//
//   PLATFORM_AI     平台 AI 小美 — 平台自营，可写冷启动内容、辅助生成与
//                   摘要，但**不能**以主体身份接单、报名、付款、收款、
//                   发活动、报名活动。
//
//   USER_TWIN       用户 AI 分身 — 用户授权的真人 likeness 代理，受
//                   LC-07 likeness consent 约束；可以代表真人发内容，
//                   不能执行金钱动作。
//
//   USER_ASSISTANT  用户 AI 助理 — 用户的工具型助手（例如起草报价）；
//                   起草是允许的，最终提交必须是真人 actor。
//
// HUMAN            真人账号。所有经济动作与"参与/创建"动作的唯一主体。
//
// AI 主体仍然可以做（与 PRD 一致）：
//   * AI 生成媒体（media.MarkMediaReady 走 aiStatus=AI_GENERATED
//     + likeness consent gate）
//   * 冷启动活动/机会的 AI 起草，但 draft 必须是 PLATFORM/MERCHANT/USER
//     origin + aiStatus=AI_GENERATED + aiActorKind=PLATFORM_AI，
//     由平台或商家作为发布主体（不写入 ai 主体作 origin）。
//
// AI 主体禁止做（这条规则拒绝"AI 假装是真人"或"AI 自己接单"）：
//   * 接单 (ApplyOpportunity)
//   * 报名 (JoinActivity / InterestActivity / CheckinActivity /
//     CancelActivity / MarkNoShow)
//   * 金钱动作 (PublishOpportunity + MoneyFlow=PAY/EARN 不能由 AI 触发)
//   * 直接发布 (PublishOpportunity / PublishActivity)
//
// 调用方式：服务入口用 aiboundary.Allows(aiboundary.FromCommandIdentity(
//   envelope.Actor.Type, envelope.Principal.Type),
//   aiboundary.<Action>) 判断。失败必须返回 REJECTED + 错误码
//   "AI_ACTION_FORBIDDEN"，UI 用 "ai.action_forbidden" messageKey 显式
// 提示，而不是静默吃掉。
package aiboundary

import "strings"

// ActorKind is the runtime-classification of the call's *effective*
// subject — the entity whose action the command represents. It is
// derived from the envelope (Actor.Type + Principal.Type) by
// FromCommandIdentity so that services do not have to re-derive.
type ActorKind string

// Action is the named capability the service is gating. Adding a
// new entry requires (1) a default Allow or Deny in Allows(), and
// (2) a focused unit test in policy_test.go. The closed set is
// intentional — a new "AI can do X" must be justified by name.
type Action string

const (
	Human          ActorKind = "HUMAN"
	PlatformAI      ActorKind = "PLATFORM_AI"
	UserTwin        ActorKind = "USER_TWIN"
	UserAssistant   ActorKind = "USER_ASSISTANT"
	PublishOpportunity Action = "PUBLISH_OPPORTUNITY"
	ApplyOpportunity   Action = "APPLY_OPPORTUNITY"
	// AIBOUND-001: Dismiss（隐藏机会）也是副作用，必须进 gate。
	// 之前只有 Publish/Apply 有落点，Dismiss 无 Action → AI 主体可调。
	DismissOpportunity Action = "DISMISS_OPPORTUNITY"
	PublishActivity    Action = "PUBLISH_ACTIVITY"
	JoinActivity     Action = "JOIN_ACTIVITY"
	InterestActivity Action = "INTEREST_ACTIVITY"
	// Lifecycle commands stay AI-forbidden too — a user-assistant
	// that calls CheckinActivity on the user's behalf is the
	// user giving consent; the right pattern is for the assistant
	// to surface a confirmation UI and let the user re-fire the
	// command as HUMAN. Treating lifecycle as human-only prevents
	// the assistant from silently consuming a checkin window.
	CheckinActivity    Action = "CHECKIN_ACTIVITY"
	CancelActivity     Action = "CANCEL_ACTIVITY"
	NoShowActivity     Action = "NO_SHOW_ACTIVITY"
)

// AllActions is the canonical list exported so tests / audits can
// iterate without re-declaring the constants. Keep in sync with
// the const block above.
var AllActions = []Action{
	PublishOpportunity,
	ApplyOpportunity,
	DismissOpportunity,
	PublishActivity,
	JoinActivity,
	InterestActivity,
	CheckinActivity,
	CancelActivity,
	NoShowActivity,
}

// AllAIActorKinds is the canonical list of AI actors. Keep in
// sync with the const block above.
var AllAIActorKinds = []ActorKind{PlatformAI, UserTwin, UserAssistant}

// Allows is the closed-set policy table. Returning false means
// the caller must REJECT the command with code AI_ACTION_FORBIDDEN
// and messageKey ai.action_forbidden. Returning true is the
// default for HUMAN.
//
// AI actor × consequential action is always false. New entries in
// the Action enum that *should* be AI-allowed must be added here
// explicitly — the default branch is "no AI action allowed",
// matching the fail-closed posture of the rest of the codebase.
// AIBOUND-001 注：PublishActivity 目前没有命令映射到它（activity 只有
// List/Toggle/Join/Cancel/Checkin/NoShow，无发布命令）——作为保留位，
// 未来加发布命令时必须先接 gate 再上线；AllActions 迭代测试已锁死 fail-closed。
func Allows(kind ActorKind, action Action) bool {
	if kind == Human {
		return true
	}
	// Any AI actor against any currently-defined Action is
	// forbidden. New Actions default to forbidden; explicitly
	// adding an "AI may X" override requires both a named case
	// here and a focused test in policy_test.go. The default
	// fall-through keeps the rule explicit rather than rely on
	// the absence of a matching case.
	switch action {
	case PublishOpportunity,
		ApplyOpportunity,
		DismissOpportunity,
		PublishActivity,
		JoinActivity,
		InterestActivity,
		CheckinActivity,
		CancelActivity,
		NoShowActivity:
		return false
	default:
		return false
	}
}

// FromCommandIdentity classifies the command's effective subject.
// It accepts both envelope.Actor.Type and envelope.Principal.Type
// strings and is case/whitespace tolerant. PUBLIC / SYSTEM / USER /
// INDIVIDUAL / BUSINESS all map to HUMAN — the AI variants must be
// spelled (or aliased) explicitly. Unknown types fail closed to
// HUMAN, not to an AI kind, because misclassifying as AI would
// silently widen the deny set; misclassifying as HUMAN only opens
// a path that the next server-side authorization check will catch.
func FromCommandIdentity(actorType, principalType string) ActorKind {
	// principal type first: business/individual principals are
	// humans regardless of actor.type (e.g. an OPERATOR acting on
	// behalf of a BUSINESS principal is still acting on the
	// principal's behalf, not as an AI).
	if classify(principalType) != "" {
		return classify(principalType)
	}
	if classify(actorType) != "" {
		return classify(actorType)
	}
	return Human
}

// classify returns the AI kind for a single type string, or ""
// if the string does not name an AI actor. Empty string means
// "treat as human for this dimension".
func classify(value string) ActorKind {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "AI_NATIVE", "PLATFORM_AI":
		return PlatformAI
	case "AI_TWIN", "USER_TWIN":
		return UserTwin
	case "AI_ASSISTANT", "USER_ASSISTANT":
		return UserAssistant
	}
	return ""
}