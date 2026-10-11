// Package decisionengine 是 /v1/decisions/evaluate 的第一版（DECISION-ENGINE-001，2026-10-11）。
//
// 它回答一件事：现在该不该对这个人做这个动作？——并且把每一步为什么写下来。
//
// 规格依据：《Personalization & Orchestration Engineering Spec v1》§9 证据门 / §11 状态机 /
// §13 干预预算 / §14 点火，以及《Decision Engine Governance Addendum v2》§2 的策略域顺序：
//
//	Safety / Legal → Explicit User Negative → Hard Resource → Intervention Budget
//	→ Evidence Gate → Human Value Guardrail → …
//
// 按这个顺序逐步判，第一个 BLOCK 的步骤决定结论；后面的步骤仍然跑、仍然留痕（运营要看见
// 「就算没被预算拦，证据也不够」这种叠加原因）。
//
// 只用库里真有的数据，没有的步骤写 SKIP + 原因，不编：
//   - SAFETY              账号限制（accountstatus）。
//   - EXPLICIT_NEGATIVE   用户关掉了引导推送（notification.nudge_optouts）；只对打扰型动作有意义。
//   - INTERVENTION_BUDGET 今天（河内时间）已经主动打扰过几次；只对打扰型动作。
//   - EVIDENCE_GATE       引力状态的证据覆盖与 P60；动作越打扰门槛越高。不是基于预测的动作
//     （生命周期引导，event_type 为空）SKIP —— 它的依据是「注册几天还没做某件事」，不是预测。
//   - HUMAN_VALUE         §12 获得感 / 愤怒感还没有实现：SKIP，写明。
//
// 任何一步的数据读不出来 = 这一步 BLOCK（GATE_UNAVAILABLE），与撮合引擎的资格门一样 fail-closed。
//
// 结论里**永远不会**出现 ACTIVE_ORCHESTRATE：主动编排还需要 §12，没有实现之前不给（与
// gravity.TestNeverAutoActiveOrchestrate 同一条约束）。
package decisionengine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

const PolicyVersion = "decision-policy-v1"

// 动作。打扰型（会主动出现在用户面前、用户没在找）只有 NUDGE。
const (
	ActionFeedCard = "FEED_CARD" // 在 Feed / Market 里自然靠前（用户自己在刷）
	ActionNudge    = "NUDGE"     // 主动推送 / 收件箱提醒（用户没在找）
)

const (
	StepSafety        = "SAFETY"
	StepNegative      = "EXPLICIT_NEGATIVE"
	StepBudget        = "INTERVENTION_BUDGET"
	StepEvidence      = "EVIDENCE_GATE"
	StepHumanValue    = "HUMAN_VALUE"
	VerdictPass       = "PASS"
	VerdictBlock      = "BLOCK"
	VerdictSkip       = "SKIP"
	StateObserve      = "OBSERVE"
	StateLearnOnly    = "LEARN_ONLY"
	StatePassive      = "PASSIVE"
	StateSoftNudge    = "SOFT_NUDGE"
	StateBlocked      = "BLOCKED"
	ReasonUnavailable = "GATE_UNAVAILABLE"
)

// Market 时区：河内（UTC+7，无夏令时）。「今天」按这里算。
var Market = time.FixedZone("ICT", 7*3600)

// Threshold 是证据门对某个动作的最低要求。
type Threshold struct {
	MinCoverage float64 `json:"minCoverage"`
	MinP60      float64 `json:"minP60"`
}

type Config struct {
	// DailyInterventions：每人每天（河内时间）最多被主动打扰几次。用户 2026-10-11 定为 1。
	DailyInterventions int
	Thresholds         map[string]Threshold
}

// DefaultConfig：FEED_CARD 与引力的 SOFT_NUDGE 判定同口径（覆盖 ≥0.5、P60 ≥0.5）；
// NUDGE 打扰更重，门槛按规格 §9.2 的例子（Feed θ≈.72 / Push θ≈.91）取 0.9。
func DefaultConfig() Config {
	return Config{
		DailyInterventions: 1,
		Thresholds: map[string]Threshold{
			ActionFeedCard: {MinCoverage: 0.5, MinP60: 0.5},
			ActionNudge:    {MinCoverage: 0.9, MinP60: 0.9},
		},
	}
}

// GravityState 是证据门要读的那一点引力状态。
type GravityState struct {
	ActionState string
	P60         float64
	Coverage    float64
	Confidence  float64
	ComputedAt  time.Time
}

// Source 读判断要用的事实。每个方法读不出来就返回 error —— 引擎把那一步判 BLOCK。
type Source interface {
	RestrictionLevel(ctx context.Context, userID string) (string, error)
	NudgesOptedOut(ctx context.Context, userID string) (bool, error)
	InterventionsSince(ctx context.Context, userID string, since time.Time) (int, error)
	// GravityState 没有这一行时返回 (nil, nil)。
	GravityState(ctx context.Context, userID, eventType string) (*GravityState, error)
}

// Ledger 记账。记账失败不改变结论（结论已经算出来了），但会打日志。
type Ledger interface {
	Record(ctx context.Context, d Decision) error
}

type Request struct {
	UserID    string `json:"userId"`
	EventType string `json:"eventType"` // 引力事件类型；'' = 不是基于预测的动作
	Action    string `json:"action"`
	Caller    string `json:"caller"`
	Subject   string `json:"subject"`
}

type Step struct {
	Name    string `json:"name"`
	Verdict string `json:"verdict"`
	Reason  string `json:"reason"`
	Detail  string `json:"detail,omitempty"`
}

type Decision struct {
	ID            string    `json:"id"`
	Request       Request   `json:"request"`
	Allowed       bool      `json:"allowed"`
	State         string    `json:"state"`
	BlockedStep   string    `json:"blockedStep,omitempty"`
	Reason        string    `json:"reason,omitempty"`
	Steps         []Step    `json:"steps"`
	PolicyVersion string    `json:"policyVersion"`
	LatencyMicros int64     `json:"latencyMicros"`
	At            time.Time `json:"at"`
}

var ErrInvalidRequest = errors.New("decisionengine: invalid request")

type Engine struct {
	Source Source
	Ledger Ledger // nil = 不记账（测试 / 内存模式）
	Config Config
	Now    func() time.Time
}

func New(src Source, ledger Ledger) *Engine {
	return &Engine{Source: src, Ledger: ledger, Config: DefaultConfig()}
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

func interruptive(action string) bool { return action == ActionNudge }

// Evaluate 判一次。只有请求本身不合法时返回 error；数据读不出来不是 error，是 BLOCK。
func (e *Engine) Evaluate(ctx context.Context, req Request) (Decision, error) {
	req.UserID = strings.TrimSpace(req.UserID)
	req.EventType = strings.TrimSpace(req.EventType)
	req.Caller = strings.TrimSpace(req.Caller)
	if req.UserID == "" || req.Caller == "" {
		return Decision{}, fmt.Errorf("%w: userId and caller are required", ErrInvalidRequest)
	}
	th, ok := e.Config.Thresholds[req.Action]
	if !ok {
		return Decision{}, fmt.Errorf("%w: unknown action %q", ErrInvalidRequest, req.Action)
	}
	start := time.Now()
	now := e.now()
	d := Decision{ID: newID(), Request: req, PolicyVersion: PolicyVersion, At: now}
	var gs *GravityState

	// 1. SAFETY
	if lvl, err := e.Source.RestrictionLevel(ctx, req.UserID); err != nil {
		d.Steps = append(d.Steps, Step{StepSafety, VerdictBlock, ReasonUnavailable, err.Error()})
	} else if lvl != "" {
		d.Steps = append(d.Steps, Step{StepSafety, VerdictBlock, "ACCOUNT_" + lvl, ""})
	} else {
		d.Steps = append(d.Steps, Step{StepSafety, VerdictPass, "ACCOUNT_OK", ""})
	}

	// 2. EXPLICIT_NEGATIVE
	if !interruptive(req.Action) {
		d.Steps = append(d.Steps, Step{StepNegative, VerdictSkip, "NOT_INTERRUPTIVE", "非打扰型动作；内容级负反馈由 Feed 自己过滤"})
	} else if out, err := e.Source.NudgesOptedOut(ctx, req.UserID); err != nil {
		d.Steps = append(d.Steps, Step{StepNegative, VerdictBlock, ReasonUnavailable, err.Error()})
	} else if out {
		d.Steps = append(d.Steps, Step{StepNegative, VerdictBlock, "NUDGES_OPTED_OUT", "用户关掉了引导推送"})
	} else {
		d.Steps = append(d.Steps, Step{StepNegative, VerdictPass, "NO_EXPLICIT_NEGATIVE", ""})
	}

	// 3. INTERVENTION_BUDGET（§13）
	if !interruptive(req.Action) {
		d.Steps = append(d.Steps, Step{StepBudget, VerdictSkip, "NOT_INTERRUPTIVE", ""})
	} else {
		local := now.In(Market)
		dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, Market)
		used, err := e.Source.InterventionsSince(ctx, req.UserID, dayStart)
		switch {
		case err != nil:
			d.Steps = append(d.Steps, Step{StepBudget, VerdictBlock, ReasonUnavailable, err.Error()})
		case used >= e.Config.DailyInterventions:
			d.Steps = append(d.Steps, Step{StepBudget, VerdictBlock, "BUDGET_EXHAUSTED", fmt.Sprintf("今天已打扰 %d 次，上限 %d", used, e.Config.DailyInterventions)})
		default:
			d.Steps = append(d.Steps, Step{StepBudget, VerdictPass, "BUDGET_LEFT", fmt.Sprintf("今天已打扰 %d 次，上限 %d", used, e.Config.DailyInterventions)})
		}
	}

	// 4. EVIDENCE_GATE（§9）
	if req.EventType == "" {
		d.Steps = append(d.Steps, Step{StepEvidence, VerdictSkip, "NOT_PREDICTION", "不是基于预测的动作（生命周期引导），没有可检验的证据"})
	} else if st, err := e.Source.GravityState(ctx, req.UserID, req.EventType); err != nil {
		d.Steps = append(d.Steps, Step{StepEvidence, VerdictBlock, ReasonUnavailable, err.Error()})
	} else if st == nil {
		d.Steps = append(d.Steps, Step{StepEvidence, VerdictBlock, "NO_EVIDENCE", "这个人在这类事件上没有引力状态"})
	} else {
		gs = st
		detail := fmt.Sprintf("覆盖 %.2f（≥%.2f）· P60 %.2f（≥%.2f）· 状态 %s", st.Coverage, th.MinCoverage, st.P60, th.MinP60, st.ActionState)
		switch {
		case st.ActionState == StateObserve || st.ActionState == StateLearnOnly || st.ActionState == StateBlocked:
			d.Steps = append(d.Steps, Step{StepEvidence, VerdictBlock, "STATE_" + st.ActionState, detail})
		case st.Coverage < th.MinCoverage:
			d.Steps = append(d.Steps, Step{StepEvidence, VerdictBlock, "COVERAGE_BELOW_MIN", detail})
		case st.P60 < th.MinP60:
			d.Steps = append(d.Steps, Step{StepEvidence, VerdictBlock, "P60_BELOW_MIN", detail})
		default:
			d.Steps = append(d.Steps, Step{StepEvidence, VerdictPass, "EVIDENCE_OK", detail})
		}
	}

	// 5. HUMAN_VALUE（§12）—— 未实现，不假装判过。
	d.Steps = append(d.Steps, Step{StepHumanValue, VerdictSkip, "NOT_IMPLEMENTED", "§12 获得感 / 愤怒感未实现"})

	d.Allowed = true
	for _, s := range d.Steps {
		if s.Verdict == VerdictBlock {
			d.Allowed = false
			d.BlockedStep, d.Reason = s.Name, s.Reason
			break
		}
	}
	d.State = resolveState(d, gs)
	d.LatencyMicros = time.Since(start).Microseconds()
	if e.Ledger != nil {
		if err := e.Ledger.Record(ctx, d); err != nil {
			log.Printf("decisionengine: ledger record %s: %v", d.ID, err)
		}
	}
	return d, nil
}

// resolveState 把结论映射到 §11 状态。放行 = SOFT_NUDGE（永远不给 ACTIVE_ORCHESTRATE）。
func resolveState(d Decision, gs *GravityState) string {
	if d.Allowed {
		return StateSoftNudge
	}
	switch d.BlockedStep {
	case StepSafety, StepNegative:
		return StateBlocked
	case StepBudget:
		// 预算用完不是「这个人不合适」：用户自己去找时仍然可以出现。
		return StatePassive
	}
	if gs != nil {
		switch gs.ActionState {
		case StateObserve, StateLearnOnly, StatePassive, StateBlocked:
			return gs.ActionState
		}
		return StatePassive
	}
	return StateObserve
}

func newID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("dec_%d", time.Now().UnixNano())
	}
	return "dec_" + hex.EncodeToString(b[:])
}
