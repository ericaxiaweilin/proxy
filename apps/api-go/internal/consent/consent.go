// Package consent 是平台唯一的同意管线（COMP-CONSENT-PIPELINE-001，2026-10-08 用户定）：
//
//	「统一不能是一次统一，必须分开统一，纳入统一同意管线。」
//
// 两句话的意思：
//  1. **分开**：同意按**用途**分开表态、分开撤回、分开留证。一个开关同时批准「推荐内容」「AI 分身洞察」
//     「运营看逐人明细」，用户就没法只同意其中一件 —— 那不是明确的同意（Nghị định 356/2025 Art. 6.1：
//     可验证；Art. 6.3：不得用含糊的指示让数据主体分不清同意与不同意）。
//  2. **统一管线**：用途的登记、政策版本、「某一刻是否有效」的判定规则，全平台只有这一个地方。
//     采集闸、引力计算、分身洞察、运营明细、将来的投流 —— 都只问这里，不各自写一份
//     「去 privacy.purpose_consents 查最新一条」。各写一份的结果是各有各的错法（本仓最熟的那种病）。
//
// 判定规则（所有消费方共用，见 ValidAtSQL）：一条事件只有在**它发生的那一刻同意有效**、
// **并且用户现在也没撤回**时，才能被该用途处理。只看「现在有同意」会把同意之前采的数据洗白；
// 只看「当时有同意」会在用户撤回后继续处理。
package consent

import (
	"fmt"
	"sort"
)

// 用途（Code 必须与客户端 apps/mobile 里的字面量完全一致，见 scripts 里的跨语言钉）。
const (
	// Recommendation：用你的浏览行为给你推更对味的内容。
	Recommendation = "RECOMMENDATION"
	// TwinInsight：生成「AI 分身 · 好友洞察」里的浏览统计。
	TwinInsight = "TWIN_INSIGHT"
	// OperatorAudienceDetail：平台运营侧可以查看**逐人**明细（谁、看了几秒、放大几次），用于内容运营。
	OperatorAudienceDetail = "OPERATOR_AUDIENCE_DETAIL"
	// AdTargeting：精准投流。已登记、**尚未开放**：没有产品入口、没有用户可见的说明文案之前，
	// 记录它的同意会被拒绝 —— 用户不可能同意一段他没见过的话。
	AdTargeting = "AD_TARGETING"
	// LegacyBehaviorAnalytics：2026-09-27 的单一大开关，一个同意同时批准上面几件事。
	// 已退役：**不能再授予**，也不被任何用途承认；仍然可以撤回（用户随时有权说不）。
	// 老同意不自动折算成新用途 —— 用户当时同意的是一整包，不是其中某一项。
	LegacyBehaviorAnalytics = "BEHAVIOR_ANALYTICS"
)

// Purpose 是一个用途的登记项。
type Purpose struct {
	Code string
	// PolicyVersion：这个用途的说明文本版本。读同意时按它过滤，所以改它 = 这个用途的旧同意立即失效、
	// 用户必须重新同意。改它之前必须先改用户看到的说明文案，否则用户同意的是一段他没见过的话。
	PolicyVersion string
	// CapturesBehavior：处理这个用途需要采集浏览行为事件。采集闸的规则是「至少有一个这类用途有效」，
	// 事件才能入库；入库之后每个用途各管各的读取（各自按 ValidAtSQL 过滤）。
	CapturesBehavior bool
	// Offered：是否已对用户开放（可以授予）。
	Offered bool
	// Retired：已退役（只允许撤回）。
	Retired bool
}

var registry = map[string]Purpose{
	Recommendation:          {Code: Recommendation, PolicyVersion: "2026-10-08", CapturesBehavior: true, Offered: true},
	TwinInsight:             {Code: TwinInsight, PolicyVersion: "2026-10-08", CapturesBehavior: true, Offered: true},
	OperatorAudienceDetail:  {Code: OperatorAudienceDetail, PolicyVersion: "2026-10-08", CapturesBehavior: true, Offered: true},
	AdTargeting:             {Code: AdTargeting, PolicyVersion: "2026-10-08"},
	LegacyBehaviorAnalytics: {Code: LegacyBehaviorAnalytics, PolicyVersion: "2026-09-27", Retired: true},
}

// Lookup 返回登记项；没登记的用途就是不存在 —— 记录同意时不接受任意字符串。
func Lookup(code string) (Purpose, bool) {
	p, ok := registry[code]
	return p, ok
}

// Grantable：可以授予（已开放且没退役）。
func Grantable(code string) bool {
	p, ok := registry[code]
	return ok && p.Offered && !p.Retired
}

// Withdrawable：可以撤回（登记过的都可以，包括退役的和尚未开放的 —— 撤回永远不该被挡）。
func Withdrawable(code string) bool {
	_, ok := registry[code]
	return ok
}

// PolicyVersion 是用途当前的说明文本版本。没登记的用途返回空串 —— 调用方应当先 Lookup。
func PolicyVersion(code string) string { return registry[code].PolicyVersion }

// CapturePurposes 是处理时需要采集浏览行为的用途（按字母序，稳定）。
func CapturePurposes() []string {
	out := []string{}
	for _, p := range registry {
		if p.CapturesBehavior && p.Offered && !p.Retired {
			out = append(out, p.Code)
		}
	}
	sort.Strings(out)
	return out
}

// All 是全部登记项（按 Code 排序），给运营页 / 核查命令枚举用。
func All() []Purpose {
	out := make([]Purpose, 0, len(registry))
	for _, p := range registry {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

// ValidAtSQL 返回一个 SQL 布尔表达式：「userExpr 这个用户，对 purpose 这个用途，在 atExpr 那一刻同意有效，
// 并且现在也没撤回」。userExpr / atExpr 是调用方 SQL 里的列或表达式（常量，不是用户输入）。
//
// 规则全平台就这一份：
//   - 只看当前政策版本的动作（版本一改，旧同意失效）；
//   - 「那一刻」= 取 acted_at <= at 的最新一条，必须是 GRANT；
//   - 「现在」= 取最新一条，必须是 GRANT；
//   - 同一时刻用 id 决胜（与 PurposeConsentState 的 ORDER BY 一致）。
//
// 用途必须已登记，否则 panic：把一个拼错的用途名悄悄当成「没有同意」会让整个处理静默地一条都不处理，
// 而且谁都看不出来为什么 —— 在启动 / 测试时就炸出来更好。
func ValidAtSQL(userExpr, atExpr, purpose string) string {
	p, ok := registry[purpose]
	if !ok {
		panic(fmt.Sprintf("consent: unregistered purpose %q", purpose))
	}
	latest := func(upTo string) string {
		return fmt.Sprintf(`(SELECT c.action FROM privacy.purpose_consents c
			WHERE c.user_id = %s AND c.purpose = '%s' AND c.policy_version = '%s'%s
			ORDER BY c.acted_at DESC, c.id DESC LIMIT 1) = 'GRANT'`, userExpr, p.Code, p.PolicyVersion, upTo)
	}
	return "(" + latest(" AND c.acted_at <= "+atExpr) + " AND " + latest("") + ")"
}
