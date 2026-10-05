package notification

import (
	"context"
	"log"
	"strings"
)

// AgentInboxResolver 把 creator 的 agent id 解析成**可投递的收件人 id**
// （MERCHANT-CREATOR-NOTIFY-001，2026-10-05）。
//
// 存在的理由是一个实测出来的坑：收件箱按 **principal id** 索引
// （listInbox / markRead / 深链归属都用 command.Envelope.Principal.ID），
// 而 agentId 既不是 user account，也不是任何会话的 principal。本地库：
//
//	supply.agent_profiles 总数                                   121
//	其中 agent_id 本身就是 user_account 的                       0
//	需要走 agent_profiles.user_account_id 桥的                  121
//	identity.sessions 里 principal_id LIKE 'agent_%'              0 行
//
// 拿 agentId 当收件人的后果不是「报错」，而是通知**正确地**写进 inbox_items，
// 然后永远没有人读到 —— 一行没人读的记录比没有通知更坏，它让「通知系统在工作」
// 看起来是真的。这个包就是为了让下一个域别再踩同一个坑。
//
// 放在 notification 而不是各个域里：这条规则**只有一个**，而踩它的域至少有
// supply / fulfillment / conversation / demand 四个。各域各写一遍解析早晚会分叉
// （有人用 agent_profiles，有人用 agent_services，还会有人直接用 agentId）。
type AgentInboxResolver interface {
	// AgentInboxRecipient 返回该 creator 的可投递收件人 id。查不到时返回空串。
	AgentInboxRecipient(ctx context.Context, agentID string) string
	// InboxRecipientFor 解析「任何指代人的 id」。
	//
	// 与 AgentInboxRecipient 的区别是**不假定**这个 id 一定是 agent id：
	//   · 是 agent id（有 profile）→ profile.user_account_id；
	//   · 不是 → 原样返回。
	//
	// 什么时候用这个：id 命名空间**混合**的地方。实测订单表就是这样 ——
	// fulfillment.orders.agent_id 里 134 行本身就是 user_account（真实数据），
	// 1 行是 agent id，684 行两边都不是（fixture 脏数据）。对这种字段用
	// 严格版会误杀 134 个本来就能收到通知的人，用 agentId 兜底又会重犯
	// 「没人读」的错。
	InboxRecipientFor(ctx context.Context, id string) string
}

// AgentInboxRecipientOf 是给「只有函数、没有结构」的域用的适配器。
//
// 宽松版直接用同一个函数（不查 profile 就原样返回）。**只在 id 命名空间确定
// 干净的域用**：如果那个 id 可能压根不是 user account，原样返回就等于把
// 「没人读的地址」又放回来了 —— 那种域请用 AgentInboxResolverFuncOf 明确传两个。
func AgentInboxRecipientOf(strict func(ctx context.Context, agentID string) string) AgentInboxResolver {
	return AgentInboxResolverFuncOf(strict, strict)
}

// AgentInboxResolverFuncOf 同时提供严格版与宽松版解析。
func AgentInboxResolverFuncOf(strict, permissive func(ctx context.Context, id string) string) AgentInboxResolver {
	return agentInboxResolverFunc{strict: strict, permissive: permissive}
}

type agentInboxResolverFunc struct {
	strict     func(ctx context.Context, agentID string) string
	permissive func(ctx context.Context, id string) string
}

func (f agentInboxResolverFunc) AgentInboxRecipient(ctx context.Context, agentID string) string {
	return f.strict(ctx, agentID)
}

func (f agentInboxResolverFunc) InboxRecipientFor(ctx context.Context, id string) string {
	return f.permissive(ctx, id)
}

// RecipientOrEmpty 归一化：空 id 一律返回空串，让调用点能用「非空即有收件人」
// 判断。**不要**在这里兜一个「看起来像 id 的值」—— 那正是 agentId 兜底会犯的错。
func RecipientOrEmpty(id string) string { return strings.TrimSpace(id) }

// LogUnresolvableRecipient 在解析不出收件人时留一行痕迹。
//
// 为什么不静默：解析不出来意味着「这个人永远收不到这类通知」。数量少的时候
// 无所谓，累积起来就是整类通知静默失效 —— 而这正是这次要消灭的东西。
// 不 return error：通知的可推导性不该让业务动作失败（调用点仍然只写业务）。
func LogUnresolvableRecipient(eventType, agentID string) {
	log.Printf("notification: no deliverable recipient for %s: agent=%q "+
		"（该 creator 的 agent_profiles.user_account_id 为空 ⇒ 这条通知不会进任何收件箱）", eventType, agentID)
}
