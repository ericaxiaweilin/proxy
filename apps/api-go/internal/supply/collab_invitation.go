// MERCHANT-CREATOR-INVITE-001（2026-10-04，用户「缺少一个邀请合作按钮」）：
// 商家在 creator 主页点「邀请合作」→ 定向邀请单 → creator 接受/拒绝 → 进合作记录。
//
// 系统里原来没有「商家直接邀请某位 creator」的命令（三条老路都要额外上下文：
// 机会报名→选择要先有报名，场景邀请要先有场景，Offer 要先有任务）。
// 所以这里是一个新的小聚合 CollabInvitation，状态机只有
// PENDING → ACCEPTED / DECLINED / CANCELLED（+ 读到过期算 EXPIRED），不碰订单。
// 接受之后怎么成单/履约是下一步的事 —— 这版只把「邀约」本身做实。
package supply

import (
	"context"
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// 邀请状态：只有 PENDING 能流转；ACCEPTED/DECLINED/CANCELLED 是终态。
const (
	InvitationPending   = "PENDING"
	InvitationAccepted  = "ACCEPTED"
	InvitationDeclined  = "DECLINED"
	InvitationCancelled = "CANCELLED"
	InvitationExpired   = "EXPIRED"
)

// invitationTTL：邀约 72 小时不回算过期。太短商家来不及等（creator 未必天天上线），
// 太长 PENDING 堆着挡第二次邀 —— 72 小时是折中，调这里。
const invitationTTL = 72 * time.Hour

// maxInvitationMessage：留言 200 字封顶，防刷屏。
const maxInvitationMessage = 200

var ErrInvitationNotFound = errors.New("collab invitation not found")

// CollabInvitation 是一次商家→creator 的定向合作邀约。
// MerchantID 是 AuthContext 里的 merchantID（和 merchantViewer 同一口径）；
// AgentID 是被邀的 creator。Terms（serviceType/startAt/durationH/price）是
// 商家这版的开价，message 是给 creator 看的人话。
type CollabInvitation struct {
	ID          string    `json:"id"`
	MerchantID  string    `json:"merchantId"`
	AgentID     string    `json:"agentId"`
	ServiceType string    `json:"serviceType"`
	StartAt     time.Time `json:"startAt,omitempty"`
	DurationH   int       `json:"durationH,omitempty"`
	PriceVND    int64     `json:"priceVnd,omitempty"`
	Currency    string    `json:"currency"`
	Message     string    `json:"message,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	RespondedAt time.Time `json:"respondedAt,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

// expired 读到过期就算过期 —— 不靠定时任务扫（v1 没扫表进程），
// Respond/List 时统一按 ExpiresAt 判定，判定那一刻起按 EXPIRED 对待。
func (inv CollabInvitation) expired(now time.Time) bool {
	return inv.Status == InvitationPending && !now.Before(inv.ExpiresAt)
}

func invitationMerchantID(e command.Envelope) string {
	if e.AuthContext == nil {
		return ""
	}
	id, _ := e.AuthContext["merchantID"].(string)
	return id
}

type inviteCreatorPayload struct {
	AgentID     string `json:"agentId"`
	ServiceType string `json:"serviceType"`
	StartAt     string `json:"startAt"`
	DurationH   int    `json:"durationH"`
	PriceVND    int64  `json:"priceVnd"`
	Currency    string `json:"currency"`
	Message     string `json:"message"`
}

// inviteCreator：商家向指定 creator 发定向邀约。
// merchantID 必须在 AuthContext 里（没登录商家身份不许邀）；
// 被邀的 agent 必须 ACTIVE（注销/下架的人不许再被邀）。
// 同一商家对同一 creator 同时只能有一张 PENDING —— 第二张直接拒掉，
// 不然 creator 收件箱会被同一个人刷屏。
func (s *Service) inviteCreator(ctx context.Context, e command.Envelope) command.Result {
	var p inviteCreatorPayload
	if !decode(e.Payload, &p) || p.AgentID == "" {
		return command.Rejected(e, "INVALID_INVITATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	profile, err := s.repository.GetProfile(ctx, p.AgentID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}
	if profile.Status != "ACTIVE" {
		return command.Rejected(e, "AGENT_NOT_INVITABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.agent_not_invitable", nil)
	}
	serviceType := p.ServiceType
	if serviceType == "" {
		serviceType = "CITY_COMPANION"
	}
	var startAt time.Time
	if p.StartAt != "" {
		parsed, parseErr := time.Parse(time.RFC3339, p.StartAt)
		if parseErr != nil {
			return command.Rejected(e, "INVALID_INVITATION_START", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_start", nil)
		}
		startAt = parsed
	}
	if p.DurationH < 0 || p.DurationH > 24 {
		return command.Rejected(e, "INVALID_INVITATION_DURATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_duration", nil)
	}
	if p.PriceVND < 0 || p.PriceVND > maxAmountVND {
		return command.Rejected(e, "INVALID_INVITATION_PRICE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_price", nil)
	}
	currency := p.Currency
	if currency == "" {
		currency = "VND"
	}
	message := p.Message
	if len([]rune(message)) > maxInvitationMessage {
		return command.Rejected(e, "INVALID_INVITATION_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_message", nil)
	}
	now := s.clock.Now().UTC()
	existing, err := s.repository.ListInvitationsByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	for _, inv := range existing {
		if inv.AgentID == p.AgentID && !inv.expired(now) {
			return command.Rejected(e, "INVITATION_ALREADY_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_already_pending", nil)
		}
	}
	inv := CollabInvitation{
		ID:          newID("ci_"),
		MerchantID:  merchantID,
		AgentID:     p.AgentID,
		ServiceType: serviceType,
		StartAt:     startAt,
		DurationH:   p.DurationH,
		PriceVND:    p.PriceVND,
		Currency:    currency,
		Message:     message,
		Status:      InvitationPending,
		CreatedAt:   now,
		ExpiresAt:   now.Add(invitationTTL),
	}
	if err := s.repository.SaveInvitation(ctx, inv); err != nil {
		return command.Rejected(e, "INVITATION_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("CollabInvitationCreated", "CollabInvitation", inv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": p.AgentID, "serviceType": serviceType})}
	return acceptedWithPayload(e, "CollabInvitation", inv.ID, 1, "CREATED", map[string]any{"invitation": inv}, domainEvents)
}

type respondInvitationPayload struct {
	InvitationID string `json:"invitationId"`
	Decision     string `json:"decision"`
}

// respondCollabInvitation：creator 本人接受/拒绝。
// 鉴权和 LinkAgentSocial 同一口径：Principal.ID 必须等于被邀的 agentID ——
// 别人不能替她点接受，商家也不能自己为自己点。
// 只接受 PENDING 且未过期的；过期点接受算 EXPIRED，不进 ACCEPTED。
func (s *Service) respondCollabInvitation(ctx context.Context, e command.Envelope) command.Result {
	var p respondInvitationPayload
	if !decode(e.Payload, &p) || p.InvitationID == "" {
		return command.Rejected(e, "INVALID_INVITATION_RESPONSE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_response", nil)
	}
	if p.Decision != InvitationAccepted && p.Decision != InvitationDeclined {
		return command.Rejected(e, "INVALID_INVITATION_DECISION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_decision", nil)
	}
	inv, err := s.repository.GetInvitation(ctx, p.InvitationID)
	if errors.Is(err, ErrInvitationNotFound) {
		return command.Rejected(e, "INVITATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	if inv.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	now := s.clock.Now().UTC()
	if inv.Status != InvitationPending || inv.expired(now) {
		if inv.Status == InvitationPending && inv.expired(now) {
			inv.Status = InvitationExpired
			inv.RespondedAt = now
			_ = s.repository.UpdateInvitation(ctx, inv)
		}
		return command.Rejected(e, "INVITATION_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_pending", nil)
	}
	inv.Status = p.Decision
	inv.RespondedAt = now
	if err := s.repository.UpdateInvitation(ctx, inv); err != nil {
		return command.Rejected(e, "INVITATION_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("CollabInvitationResponded", "CollabInvitation", inv.ID, 2, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"decision": p.Decision, "merchantId": inv.MerchantID, "agentId": inv.AgentID})}
	return acceptedWithPayload(e, "CollabInvitation", inv.ID, 2, "RESPONDED", map[string]any{"invitation": inv}, domainEvents)
}

type cancelInvitationPayload struct {
	InvitationID string `json:"invitationId"`
}

// cancelCollabInvitation：商家撤回自己发的 PENDING 邀约。
// 只能撤 PENDING（对方已接受/拒绝的不能撤，那是人家的决定）。
func (s *Service) cancelCollabInvitation(ctx context.Context, e command.Envelope) command.Result {
	var p cancelInvitationPayload
	if !decode(e.Payload, &p) || p.InvitationID == "" {
		return command.Rejected(e, "INVALID_INVITATION_CANCEL", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_cancel", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	inv, err := s.repository.GetInvitation(ctx, p.InvitationID)
	if errors.Is(err, ErrInvitationNotFound) {
		return command.Rejected(e, "INVITATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	if inv.MerchantID != merchantID {
		return command.Rejected(e, "INVITATION_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_not_owned", nil)
	}
	now := s.clock.Now().UTC()
	if inv.Status != InvitationPending || inv.expired(now) {
		return command.Rejected(e, "INVITATION_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_pending", nil)
	}
	inv.Status = InvitationCancelled
	inv.RespondedAt = now
	if err := s.repository.UpdateInvitation(ctx, inv); err != nil {
		return command.Rejected(e, "INVITATION_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_write_failed", nil)
	}
	return acceptedWithPayload(e, "CollabInvitation", inv.ID, 2, "CANCELLED", map[string]any{"invitation": inv}, nil)
}

type listInvitationsPayload struct {
	Role string `json:"role"`
}

// listCollabInvitations：sent 查我发出去的（merchantID 口径），
// received 查我收到的（Principal.ID == agentID 口径，和 respond 同一鉴权）。
// role 写错直接 validation 拒掉，不猜。
func (s *Service) listCollabInvitations(ctx context.Context, e command.Envelope) command.Result {
	var p listInvitationsPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_INVITATION_LIST", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_list", nil)
	}
	now := s.clock.Now().UTC()
	switch p.Role {
	case "sent":
		merchantID := invitationMerchantID(e)
		if merchantID == "" {
			return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
		}
		invs, err := s.repository.ListInvitationsByMerchant(ctx, merchantID)
		if err != nil {
			return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
		}
		return acceptedWithPayload(e, "CollabInvitation", merchantID, 1, "LISTED", map[string]any{"invitations": withExpiredMarked(invs, now)}, nil)
	case "received":
		if e.Principal.ID == "" {
			return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
		}
		invs, err := s.repository.ListInvitationsByAgent(ctx, e.Principal.ID)
		if err != nil {
			return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
		}
		return acceptedWithPayload(e, "CollabInvitation", e.Principal.ID, 1, "LISTED", map[string]any{"invitations": withExpiredMarked(invs, now)}, nil)
	default:
		return command.Rejected(e, "INVALID_INVITATION_ROLE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_role", nil)
	}
}

// withExpiredMarked：列表里把过期未回的标成 EXPIRED（展示用，不落库 ——
// 落库那一下留给 respond，列表是只读的，不写）。
func withExpiredMarked(invs []CollabInvitation, now time.Time) []CollabInvitation {
	out := make([]CollabInvitation, 0, len(invs))
	for _, inv := range invs {
		if inv.expired(now) {
			inv.Status = InvitationExpired
		}
		out = append(out, inv)
	}
	return out
}
