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
	// COMP-REPORT-004: 申诉复核（成立 / 驳回）。同样绝不能让普通用户自己写 ——
	// 否则「申诉成立 / 驳回」就成了谁都能伪造的制衡结论，申诉渠道的
	// 意义归零。同走 PROXY_OPERATOR_PRINCIPALS 白名单，未设 = 拒。
	"RecordAppealDecision": true,
	// COMP-AUTHORITY-001: 有权机关请求的受理与响应。这条更不能让普通用户碰 ——
	// 任何人都能写「有权机关要求调取某某的信息」，等于给社工和恐吓发了一
	// 枚官方印章，也会污染平台对机关请求的举证。两个入口都走
	// PROXY_OPERATOR_PRINCIPALS 白名单，未设 = 拒。
	"RecordAuthorityRequest":  true,
	"RecordAuthorityResponse": true,
	// STORE-REC-002: 运营的推荐评估队列。推荐记录含推荐人账号 id 与推荐理由，
	// 属于个人信息 —— 普通用户绝不能枚举别人的推荐。
	"ListStoreRecommendations": true,
	// STORE-REC-004: 评估结论同样 operator-only —— 记录里写着「谁否掉了哪家店」，
	// 落到普通用户手里等于把运营的判断过程公开出去。
	"DecideStoreRecommendation": true,
	// SAFETY-GATE-001: safety 域此前**一个命令都没有进这张表**，而全仓唯一的
	// 授权门就是本表（command_dispatch.go:77 的 requiresOperator）。也就是说
	// 下面这些命令对任何已登录用户都是敞开的：
	//   - GrantJITAccess：granteeId 与 scope 全从 payload 来，无任何校验 ——
	//     任何用户都能给自己签发任意 scope 的临时权限（提权）。
	//   - CreateIncident：除了建 incident，还会**自动给目标打一个 ACCOUNT 封禁**
	//     （safety/service.go 的 createIncident）。任何用户都能冻掉任意账号。
	//   - CreateSafetyBlock / CreateOperatorCase：封禁与运营工单，天然是 moderaton 动作。
	//   - CreateLegalHold / ReleaseLegalHold：法务保全，同上。
	// 全部收进 operator 门（未配 PROXY_OPERATOR_PRINCIPALS 时 fail-closed 403）。
	// 目前 App 侧对 safety 域**零调用**，所以收紧不会打断任何现网流程。
	"GrantJITAccess":     true,
	"CreateIncident":     true,
	"CreateSafetyBlock":  true,
	"CreateOperatorCase": true,
	"CreateLegalHold":    true,
	"ReleaseLegalHold":   true,
	// BENEFIT-CAMPAIGN-001: benefit 域和 safety 一样**整域没进这张表**，于是
	// 活动管理四条对任何已登录用户敞开，且全部把归属/配额身份放在 payload 里
	// 且不校验（BENEFIT-REDEEM-001 同一个洞，只是方向相反）：
	//   - CreateCampaign：ownerType + ownerId 直接来自 payload，只判非空。
	//     任何人都能建一个**挂在别人名下的活动**（budgetMinor 也自填）。
	//   - ActivateCampaign / PauseCampaign：只带 campaignId，完全不问是谁的活动 ——
	//     别人建的活动我也能激活/暂停。
	//   - AllocateBenefit：distributorId 来自 payload，能给任意活动把配额分给
	//     任意分销方。
	// 危害链：冒名活动一旦被 Activate，真实用户来领取/核销，而 BENEFIT-REDEEM-001
	// 的结算归属正是按 campaign.OwnerID 判 —— 于是被冒名的商家要为别人造的活动买单。
	// 收进 operator 门；App 侧对这四条**零调用**，收紧不打断现网。
	// 注意这是止血而非终态：等真正出现「商家自建活动」的入口，必须换成校验
	// e.Actor 是否为该 ownerId 的主体成员，而不是继续留在 operator 门里。
	"CreateCampaign":   true,
	"ActivateCampaign": true,
	"PauseCampaign":    true,
	"AllocateBenefit":  true,

	// OUTCOME-TEMPLATE-GATE-001: outcome 域的模板命令也没进这张表。
	//
	// 模板是**全局共享词汇表**：ObservationTemplate 没有 owner/scope 字段
	// （postgres 侧建表列也只有 id/name/description/keys/created_at），而
	// createTemplate 只校验 name 非空 —— 任何已登录用户都能往这张全局表里塞
	// 模板，运营和所有用户都会看到。
	//
	// 更硬的一层不是命名空间污染，而是**未授权用户能翻转全局状态**：
	// CreateObservationSet 的兼容门写的是
	//   `if len(ListTemplates()) > 0 { 必须引用已存在的模板 }`
	// ——「有没有模板」本身就是一个全局开关。没人塞过模板时放行历史 ID
	// （bootstrap），一旦表里有了模板就一律强制校验。于是普通用户塞一个垃圾
	// 模板，就能把整个平台踢出 bootstrap：之后**所有人**用历史模板 ID 建观察集
	// 都会被 TEMPLATE_NOT_FOUND 拒掉，而失败原因指向调用方，看起来像用户自己的错。
	//
	// 模板是平台级词表而不是商家私有数据，所以收进 operator 门（未配
	// PROXY_OPERATOR_PRINCIPALS 时 fail-closed 403）。App 侧对这三条**零调用**
	// （已确认无 client 方法、无 surface 引用），收紧不打断现网。
	//
	// 只收 Create：List/Get 读的是一张运营维护的词表，读本身不构成越权 ——
	// 过度收紧是静默失败（测试不会红，用户只是用不了），所以不做。
	//
	// 上面那个空行是刻意的：gofmt 以空行分组对齐，而本 key 比表里最长的
	// "RecordAuthorityResponse" 还长 —— 不留空行会把上面 33 行全部重新填充，
	// 在授权白名单里制造 33 行纯空白 diff，review 时反而看不出真正改了什么。
	"CreateObservationTemplate": true,

	// NOTIF-INBOX-GATE-001: notification 域同样**整域没进这张表**，而
	// SendInboxNotification 是这条域里唯一的「代别人写」命令：recipientId
	// 与 title/body/deepLink 全从 payload 来，handler（notification/service.go
	// 的 sendInbox）只校验 recipientId/title 非空，完全不问调用者与收件人
	// 是什么关系。
	//
	// 为什么这条尤其不能敞开：inbox 是**平台自己说话的渠道**。真正的生产者
	// 是 outbox worker —— cmd/worker/main.go 的 businessInboxDelivery 用直连
	// SQL 往 notification.inbox_items 写「订单已成立」「收到 Offer」，注释写着
	// "bypass service to avoid auth"。也就是说这条渠道在用户心里等同于系统
	// 通知；任何已登录用户却能走同一个命令，往**任意用户**的 inbox 塞任意
	// 标题/正文/deepLink，等于给钓鱼和恐吓发了一枚平台印章。openapi.yaml 的
	// 公开命令枚举里它就和 CreateIncident / GrantJITAccess / ConfirmPaymentIntent
	// 排在一起 —— 那几个都已在门里，唯独漏了它。
	//
	// App 侧 NotificationClient 只暴露 registerDevice/listInbox/markRead/
	// resolveDeepLink，**没有** sendInbox（全仓零调用），收紧不打断现网。
	//
	// 只收 SendInboxNotification：同域其余四条都是用户读自己 inbox 的正常动作
	// （ListInbox 按 principal 取、MarkRead 按 recipientId 校验），把它们一起
	// 收紧只会让用户静默用不了，故不做。
	"SendInboxNotification": true,
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
