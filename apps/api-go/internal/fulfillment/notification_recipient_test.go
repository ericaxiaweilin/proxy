package fulfillment

import (
	"context"
	"testing"

	"github.com/proxy-app/proxy-api/internal/notification"
)

// MERCHANT-CREATOR-NOTIFY-001：Offer 通知的收件人必须是**可投递**的 id。
//
// OfferCreated 的时效是 5 分钟 —— 收件人算不出来，等于这条通知对所有人都不存在，
// 而订单照样创建成功、没有任何报错、门禁全绿。
//
// 之前这条通知拿 payload 里的 agentId 当收件人，而 agentId 既不是 user account
// 也不是任何会话的 principal（本地库 121 个 creator，0 个的 agent_id 是 user account）。
func TestOfferCreatedCarriesADeliverableRecipientNotAnAgentId(t *testing.T) {
	if got := (&Service{}).inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_x"); got != "" {
		t.Fatalf("with no resolver wired there must be NO recipient (never a guess), got %q", got)
	}

	s := New()
	s.SetAgentInboxRecipient(notification.AgentInboxRecipientOf(func(_ context.Context, agentID string) string {
		if agentID == "agent_known" {
			return "user_account_known"
		}
		return "" // 查不到 ⇒ 不发，不拿 agentId 兜底
	}))
	if got := s.inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_known"); got != "user_account_known" {
		t.Fatalf("recipient = %q, want user_account_known", got)
	}
	if got := s.inboxRecipientForAgent(context.Background(), "OfferCreated", "agent_unknown"); got != "" {
		t.Fatalf("an unresolvable creator must produce NO recipient, got %q（拿 agentId 兜底就是重犯那个错）", got)
	}
}
