package matchengine

import "context"

// 标准资格门。每一道都只回答一个问题；读不出依据时不通过且标记 Unknown（fail-closed），
// 这样「读不出来」不会被悄悄当成「合格」——也不会被当成「她不合格」（原因码是 GATE_UNAVAILABLE）。

// ExclusionGate：不该被考虑的人（发单方自己、已经报过名的、之前邀过的）。
type ExclusionGate struct{ Excluded map[string]string }

func (ExclusionGate) ID() string { return "exclusion" }
func (g ExclusionGate) Evaluate(_ context.Context, _ Subject, c Candidate) GateResult {
	if reason, ok := g.Excluded[c.AgentID]; ok {
		return GateResult{Reason: reason}
	}
	return GateResult{Pass: true}
}

// AccountGate：被限制 / 封禁的账号不进池（accountstatus）。
type AccountGate struct {
	Level func(ctx context.Context, userID string) (string, error)
}

func (AccountGate) ID() string { return "account" }
func (g AccountGate) Evaluate(ctx context.Context, _ Subject, c Candidate) GateResult {
	if g.Level == nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	level, err := g.Level(ctx, c.AgentID)
	if err != nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	if level != "" {
		return GateResult{Reason: ReasonAccountRestricted}
	}
	return GateResult{Pass: true}
}

// SafetyGate：被安全运营封了的账号（safety.blocks，ACCOUNT 类，未过期）。
type SafetyGate struct {
	Blocked func(ctx context.Context, userID string) (bool, error)
}

func (SafetyGate) ID() string { return "safety" }
func (g SafetyGate) Evaluate(ctx context.Context, _ Subject, c Candidate) GateResult {
	if g.Blocked == nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	blocked, err := g.Blocked(ctx, c.AgentID)
	if err != nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	if blocked {
		return GateResult{Reason: ReasonSafetyBlocked}
	}
	return GateResult{Pass: true}
}

// PermissionGate：没有接单权限（没通过 KYC）的人不进池——她没主动开通，平台不能替她出现在别人的邀约里。
type PermissionGate struct {
	Granted func(ctx context.Context, userID string) (bool, error)
}

func (PermissionGate) ID() string { return "permission" }
func (g PermissionGate) Evaluate(ctx context.Context, _ Subject, c Candidate) GateResult {
	if g.Granted == nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	ok, err := g.Granted(ctx, c.AgentID)
	if err != nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	if !ok {
		return GateResult{Reason: ReasonNoOrderPermission}
	}
	return GateResult{Pass: true}
}

// UserBlockGate：发单方和她之间有一方拉黑了另一方（双向）。
type UserBlockGate struct {
	Blocked func(ctx context.Context, a, b string) (bool, error)
}

func (UserBlockGate) ID() string { return "user_block" }
func (g UserBlockGate) Evaluate(ctx context.Context, s Subject, c Candidate) GateResult {
	if g.Blocked == nil || s.RequesterID == "" {
		return GateResult{Pass: true} // 没有发单方（或没配）就没有「谁拉黑谁」可言
	}
	blocked, err := g.Blocked(ctx, s.RequesterID, c.AgentID)
	if err != nil {
		return GateResult{Reason: ReasonGateUnavailable, Unknown: true}
	}
	if blocked {
		return GateResult{Reason: ReasonUserBlocked}
	}
	return GateResult{Pass: true}
}

// LocationGate：距离。「不知道在哪」≠「很近」：位置未知不通过（LOCATION_UNKNOWN），超出半径不通过。
// 发单没有坐标时这道门放行（说不出「附近」的单由调用方在检索阶段就不检索）。
type LocationGate struct{ RadiusM float64 }

func (LocationGate) ID() string { return "location" }
func (g LocationGate) Evaluate(_ context.Context, s Subject, c Candidate) GateResult {
	if s.Lat == nil || s.Lng == nil || g.RadiusM <= 0 {
		return GateResult{Pass: true}
	}
	if c.Signals.DistanceM == nil {
		return GateResult{Reason: ReasonLocationUnknown}
	}
	if *c.Signals.DistanceM > g.RadiusM {
		return GateResult{Reason: ReasonOutOfRadius}
	}
	return GateResult{Pass: true}
}
