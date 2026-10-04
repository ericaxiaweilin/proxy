// MERCHANT-CREATOR-INVITE-001（2026-10-04，用户「缺少一个邀请合作按钮」）。
// 2026-10-04 修：出价从一口价改成区间 + 可谈 + 双向还价 —— 用户原话：
// 「商家邀约基于拉高销量/UGC产出/拉人气，价格要支持谈判、区间、高低边界，
// 单一价格覆盖不了全部场景」。照抄用户侧 SlotOffer 的一口价是买东西的逻辑，
// 商家邀 creator 是谈合作，所以 terms 是 {价格区间, 可谈?, 合作目的}，
// 双方轮流出价（PENDING↔COUNTERED），接受/拒绝/撤回是终态。
package supply

import (
	"context"
	"errors"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// 邀请状态：PENDING 是 creator 的回合（接受/拒绝/还价），COUNTERED 是商家
// 的回合（接受/拒绝/再议）；ACCEPTED/DECLINED/CANCELLED 是终态。
const (
	InvitationPending   = "PENDING"
	InvitationCountered = "COUNTERED"
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

// 合作目的封闭集：冲销量 / UGC产出 / 拉人气 / 其他 —— 用户点的三个
// 就是商家的邀约动机，结构化才方便 creator 决策（以后也方便按目的撮合）。
// 加目的要前后端一起加，不许单边编新值。
var validPurposes = map[string]bool{
	"SALES":   true, // 冲销量
	"UGC":     true, // UGC产出
	"TRAFFIC": true, // 拉人气
	"OTHER":   true, // 其他合作
}

// CollabInvitation 是一次商家→creator 的定向合作邀约。
// MerchantID 是 AuthContext 里的 merchantID（和 merchantViewer 同一口径）；
// AgentID 是被邀的 creator。Terms（价格区间/可谈/目的/留言）谁出价谁定，
// 还价即替换（termsVersion++, counterBy 记谁出的价）。
type CollabInvitation struct {
	ID           string    `json:"id"`
	MerchantID   string    `json:"merchantId"`
	AgentID      string    `json:"agentId"`
	ServiceType  string    `json:"serviceType"`
	StartAt      time.Time `json:"startAt,omitempty"`
	DurationH    int       `json:"durationH,omitempty"`
	PriceMinVND  int64     `json:"priceMinVnd"`
	PriceMaxVND  int64     `json:"priceMaxVnd"`
	Negotiable   bool      `json:"negotiable"`
	Purpose      string    `json:"purpose"`
	Message      string    `json:"message,omitempty"`
	Status       string    `json:"status"`
	TermsVersion int       `json:"termsVersion"`
	CounterBy    string    `json:"counterBy,omitempty"`
	Currency     string    `json:"currency"`
	CreatedAt    time.Time `json:"createdAt"`
	RespondedAt  time.Time `json:"respondedAt,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

// expired 读到过期就算过期 —— 不靠定时任务扫（v1 没扫表进程），
// Respond/List 时统一按 ExpiresAt 判定，判定那一刻起按 EXPIRED 对待。
func (inv CollabInvitation) expired(now time.Time) bool {
	return (inv.Status == InvitationPending || inv.Status == InvitationCountered) && !now.Before(inv.ExpiresAt)
}

func invitationMerchantID(e command.Envelope) string {
	if e.AuthContext == nil {
		return ""
	}
	id, _ := e.AuthContext["merchantID"].(string)
	return id
}

// invitationTerms 是 wire 上的出价条件：邀约和还价共用同一套校验。
// 时间也在 terms 里 —— 谈合作谈的不只是钱，档期不对价再合适也白搭，
// 所以还价可以连时间一起改（version++ 照记）。
type invitationTerms struct {
	PriceMinVND int64  `json:"priceMinVnd"`
	PriceMaxVND int64  `json:"priceMaxVnd"`
	Negotiable  bool   `json:"negotiable"`
	Purpose     string `json:"purpose"`
	Message     string `json:"message"`
	StartAt     string `json:"startAt"`
	DurationH   int    `json:"durationH"`
}

// validateTerms：区间必须 min<=max（相等=一口价，全 0=出价待商议）；
// 单边不超过 maxAmountVND；目的必须封闭集里选（逼商家说清楚为什么找她，
// creator 才好决策）；留言 200 字封顶；时长 0..24 小时；
// 开始时间给了一定要是 RFC3339（给错直接拒，不猜是几点）。
// 返回解析好的开始时间（没给就是零值，调用方按「时间待商议」处理）。
func validateTerms(e command.Envelope, t invitationTerms) (time.Time, *command.Result) {
	if t.PriceMinVND < 0 || t.PriceMaxVND < 0 || t.PriceMinVND > maxAmountVND || t.PriceMaxVND > maxAmountVND {
		r := command.Rejected(e, "INVALID_INVITATION_PRICE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_price", nil)
		return time.Time{}, &r
	}
	if t.PriceMinVND > t.PriceMaxVND {
		r := command.Rejected(e, "INVALID_INVITATION_RANGE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_range", nil)
		return time.Time{}, &r
	}
	if !validPurposes[t.Purpose] {
		r := command.Rejected(e, "INVALID_INVITATION_PURPOSE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_purpose", nil)
		return time.Time{}, &r
	}
	if len([]rune(t.Message)) > maxInvitationMessage {
		r := command.Rejected(e, "INVALID_INVITATION_MESSAGE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_message", nil)
		return time.Time{}, &r
	}
	if t.DurationH < 0 || t.DurationH > 24 {
		r := command.Rejected(e, "INVALID_INVITATION_DURATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_duration", nil)
		return time.Time{}, &r
	}
	var startAt time.Time
	if t.StartAt != "" {
		parsed, parseErr := time.Parse(time.RFC3339, t.StartAt)
		if parseErr != nil {
			r := command.Rejected(e, "INVALID_INVITATION_START", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_start", nil)
			return time.Time{}, &r
		}
		startAt = parsed
	}
	return startAt, nil
}

type inviteCreatorPayload struct {
	AgentID     string `json:"agentId"`
	ServiceType string `json:"serviceType"`
	Currency    string `json:"currency"`
	invitationTerms
}

// inviteCreator：商家向指定 creator 发定向邀约。
// merchantID 必须在 AuthContext 里（没登录商家身份不许邀）；
// 被邀的 agent 必须 ACTIVE（注销/下架的人不许再被邀）。
// 同一商家对同一 creator 同时只能有一张活单（PENDING/COUNTERED）——
// 第二张直接拒掉，不然 creator 收件箱会被同一个人刷屏。
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
	startAt, bad := validateTerms(e, p.invitationTerms)
	if bad != nil {
		return *bad
	}
	serviceType := p.ServiceType
	if serviceType == "" {
		serviceType = "CITY_COMPANION"
	}
	currency := p.Currency
	if currency == "" {
		currency = "VND"
	}
	now := s.clock.Now().UTC()
	existing, err := s.repository.ListInvitationsByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	for _, inv := range existing {
		if inv.AgentID == p.AgentID && !inv.expired(now) &&
			(inv.Status == InvitationPending || inv.Status == InvitationCountered) {
			return command.Rejected(e, "INVITATION_ALREADY_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_already_pending", nil)
		}
	}
	inv := CollabInvitation{
		ID:           newID("ci_"),
		MerchantID:   merchantID,
		AgentID:      p.AgentID,
		ServiceType:  serviceType,
		StartAt:      startAt,
		DurationH:    p.DurationH,
		PriceMinVND:  p.PriceMinVND,
		PriceMaxVND:  p.PriceMaxVND,
		Negotiable:   p.Negotiable,
		Purpose:      p.Purpose,
		Message:      p.Message,
		Status:       InvitationPending,
		TermsVersion: 1,
		Currency:     currency,
		CreatedAt:    now,
		ExpiresAt:    now.Add(invitationTTL),
	}
	if err := s.repository.SaveInvitation(ctx, inv); err != nil {
		return command.Rejected(e, "INVITATION_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("CollabInvitationCreated", "CollabInvitation", inv.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": p.AgentID, "serviceType": serviceType,
	})}
	return acceptedWithPayload(e, "CollabInvitation", inv.ID, 1, "CREATED", map[string]any{"invitation": inv}, domainEvents)
}

type respondInvitationPayload struct {
	InvitationID string `json:"invitationId"`
	Decision     string `json:"decision"`
	invitationTerms
	// 还价条件只在 Decision=COUNTER 时读，其他 decision 带了也忽略
	// （不拿没用的字段卡人，但也不存 —— 存的永远是当前轮出价）。
}

// respondCollabInvitation：轮流出价。PENDING 是 creator 的回合
// （接受/拒绝/还价），COUNTERED 是商家的回合（接受/拒绝/再议）。
// 还价即替换当前 terms（version++，counterBy 记谁出的价）。
// 一口价（negotiable=false）的单不许还价 —— 标了不谈就别谈，
// 要么接受要么拒绝，别拿还价糊弄人。
func (s *Service) respondCollabInvitation(ctx context.Context, e command.Envelope) command.Result {
	var p respondInvitationPayload
	if !decode(e.Payload, &p) || p.InvitationID == "" {
		return command.Rejected(e, "INVALID_INVITATION_RESPONSE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_response", nil)
	}
	if p.Decision != InvitationAccepted && p.Decision != InvitationDeclined && p.Decision != InvitationCountered {
		return command.Rejected(e, "INVALID_INVITATION_DECISION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_invitation_decision", nil)
	}
	inv, err := s.repository.GetInvitation(ctx, p.InvitationID)
	if errors.Is(err, ErrInvitationNotFound) {
		return command.Rejected(e, "INVITATION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	if (inv.Status != InvitationPending && inv.Status != InvitationCountered) || inv.expired(now) {
		if (inv.Status == InvitationPending || inv.Status == InvitationCountered) && inv.expired(now) {
			inv.Status = InvitationExpired
			inv.RespondedAt = now
			_ = s.repository.UpdateInvitation(ctx, inv)
		}
		return command.Rejected(e, "INVITATION_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_pending", nil)
	}
	merchantID := invitationMerchantID(e)
	isAgentTurn := inv.Status == InvitationPending && inv.AgentID == e.Principal.ID
	isMerchantTurn := inv.Status == InvitationCountered && merchantID != "" && inv.MerchantID == merchantID
	if !isAgentTurn && !isMerchantTurn {
		return command.Rejected(e, "INVITATION_NOT_YOUR_TURN", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_not_your_turn", nil)
	}
	by := e.Principal.ID
	if isMerchantTurn {
		by = merchantID
	}
	next := inv
	switch p.Decision {
	case InvitationAccepted:
		next.Status = InvitationAccepted
		next.RespondedAt = now
	case InvitationDeclined:
		next.Status = InvitationDeclined
		next.RespondedAt = now
	case InvitationCountered:
		if !inv.Negotiable {
			return command.Rejected(e, "INVITATION_NOT_NEGOTIABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.invitation_not_negotiable", nil)
		}
		counterStartAt, bad := validateTerms(e, p.invitationTerms)
		if bad != nil {
			return *bad
		}
		next.PriceMinVND = p.PriceMinVND
		next.PriceMaxVND = p.PriceMaxVND
		next.Negotiable = p.Negotiable
		next.Purpose = p.Purpose
		next.Message = p.Message
		// 时间只在还价带了时间条件时才替换 —— 没带就是"时间维持上版"，
		// 不许用零值把原档期清掉（v1 不支持单独清除时间，想改期就填新的）。
		if p.StartAt != "" || p.DurationH != 0 {
			next.StartAt = counterStartAt
			next.DurationH = p.DurationH
		}
		next.TermsVersion = inv.TermsVersion + 1
		next.CounterBy = by
		if inv.Status == InvitationPending {
			next.Status = InvitationCountered
		} else {
			next.Status = InvitationPending
		}
	}
	if err := s.repository.UpdateInvitation(ctx, next); err != nil {
		return command.Rejected(e, "INVITATION_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("CollabInvitationResponded", "CollabInvitation", inv.ID, 2, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"decision": p.Decision, "merchantId": inv.MerchantID, "agentId": inv.AgentID,
	})}
	return acceptedWithPayload(e, "CollabInvitation", inv.ID, 2, "RESPONDED", map[string]any{"invitation": next}, domainEvents)
}

type cancelInvitationPayload struct {
	InvitationID string `json:"invitationId"`
}

// cancelCollabInvitation：商家撤回自己发的活单（PENDING 或 COUNTERED）。
// 终态的不能撤（那是双方已经落定的结论），creator 侧用拒绝不用撤回。
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
	if (inv.Status != InvitationPending && inv.Status != InvitationCountered) || inv.expired(now) {
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
