package api

import (
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// OperatorGate decides whether the authenticated principal may run privileged
// commands (capability verification, contribution review/reward, media
// readiness override). Fail-closed: a nil gate denies everything.
type OperatorGate interface {
	IsOperator(actor command.Actor, principal command.Principal, authContext map[string]any) bool
}

// StaticOperatorGate grants operator rights to an explicit principal allowlist
// (env PROXY_OPERATOR_PRINCIPALS) or to sessions carrying role=OPERATOR in
// their server-issued auth context.
type StaticOperatorGate struct {
	principalIDs map[string]bool
}

func NewStaticOperatorGate(principalIDs []string) *StaticOperatorGate {
	allowed := make(map[string]bool, len(principalIDs))
	for _, id := range principalIDs {
		if id != "" {
			allowed[id] = true
		}
	}
	return &StaticOperatorGate{principalIDs: allowed}
}

func (g *StaticOperatorGate) IsOperator(_ command.Actor, principal command.Principal, authContext map[string]any) bool {
	if g == nil {
		return false
	}
	if g.principalIDs[principal.ID] {
		return true
	}
	if role, ok := authContext["role"].(string); ok && role == "OPERATOR" {
		return true
	}
	return false
}

// operatorCommandTypes are privileged commands that must never be reachable by
// ordinary authenticated users.
var operatorCommandTypes = map[string]bool{
	"VerifyCapability":         true,
	"ReviewContributionAccess": true,
	"ReviewContributionDomain": true,
	"ReviewRewardGate":         true,
	"ActivateContribution":     true,
	"RecordContributionValue":  true,
	"GrantContributionReward":  true,
	"MarkMediaReady":           true,
	// R15.17: admin content review — nudity / politics / violence.
	// 仍需通过 PROXY_OPERATOR_PRINCIPALS 白名单检。未设 = 拒。
	"ReviewMediaAsset": true,
	// R15.18: audit list — operator 查 content review 决策历史。
	// 同走 PROXY_OPERATOR_PRINCIPALS 门 (server 验证在 /v1/commands 边界)。
	"ListMediaReviewDecisions": true,
	// R15.19: 修订决策 (append-only 多 1 行)。同走 operator 门,
	// 写新行 note="amends:<prev_id>:<reason>:<note>", prev 行不动。
	"AmendMediaReviewDecision": true,
	// Money movement and settlement confirmation are server/operator actions.
	// Mobile users may create a payment intent, but cannot impersonate a bank
	// callback, mint/refund value, or release held payout funds.
	"ConfirmPaymentIntent": true,
	"RefundPaymentIntent":  true,
	"CreatePayoutHold":     true,
	"ReleasePayout":        true,
	"CreateVoucher":        true,
	"SettleVoucher":        true,
	// COMP-REPORT-003: 举报处置（接手 / 升级 / 处置 / 判定不成立 / 重开）。
	// 这是「平台处理过举报」的唯一留痕入口，绝不能让普通用户自己写 ——
	// 否则处置记录就成了谁都能伪造的东西，举证价值归零。
	// 同走 PROXY_OPERATOR_PRINCIPALS 白名单，未设 = 拒。
	"RecordReportDisposition": true,
}

func requiresOperator(commandType string) bool {
	return operatorCommandTypes[commandType]
}

// RateLimiter is a fixed-window per-scope limiter protecting the command
// boundary from brute force / scraping abuse (rotating idempotency keys must
// not allow unbounded command volume).
type RateLimiter struct {
	mu       sync.Mutex
	window   time.Duration
	limit    int
	counters map[string]windowCounter
}

type windowCounter struct {
	windowStart time.Time
	count       int
}

func NewRateLimiter(window time.Duration, limit int) *RateLimiter {
	if window <= 0 {
		window = time.Minute
	}
	if limit <= 0 {
		limit = 120
	}
	return &RateLimiter{window: window, limit: limit, counters: make(map[string]windowCounter)}
}

// Allow reports whether the scope may issue one more request in the current
// window. It also prunes expired windows opportunistically.
func (r *RateLimiter) Allow(scope string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.counters[scope]
	if !exists || now.Sub(current.windowStart) >= r.window {
		r.counters[scope] = windowCounter{windowStart: now, count: 1}
		if len(r.counters) > 4096 {
			for key, counter := range r.counters {
				if now.Sub(counter.windowStart) >= r.window {
					delete(r.counters, key)
				}
			}
		}
		return true
	}
	if current.count >= r.limit {
		return false
	}
	current.count++
	r.counters[scope] = current
	return true
}
