package contribution

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// Network Contribution System（R14.2 Chapter21J）。
// 核心规则：
//  1. 5 种 P0 Contribution Type：MERCHANT_REFERRAL / DRIVER_REFERRAL /
//     AGENT_REFERRAL / REQUESTER_REFERRAL / VENUE_DISCOVERY
//  2. 状态只能由 Domain Event / Review / Policy 推进，客户端不得直接置成功
//  3. Attribution = DIRECT_SINGLE_LEVEL（禁多级递归；与 Demand Attribution 共存不覆盖）
//  4. 三层审核分离：Contributor Access / Target Domain / Reward Gate，不合并 approved=true
//  5. Reward 必须由服务端 Verified Value Event 驱动（进 Ledger）

// ContributionType 是 P0 支持的贡献类型。
var ValidContributionTypes = map[string]bool{
	"MERCHANT_REFERRAL":  true,
	"DRIVER_REFERRAL":    true,
	"AGENT_REFERRAL":     true,
	"REQUESTER_REFERRAL": true,
	"VENUE_DISCOVERY":    true,
}

// Contribution 状态机（PRD §7）。
var ContributionStates = map[string]bool{
	"DRAFT": true, "SUBMITTED": true, "DEDUP_CHECK": true, "UNDER_REVIEW": true,
	"QUALIFIED": true, "ACTIVATED": true, "VALUE_CREATED": true, "REWARDED": true,
	"REJECTED": true, "EXPIRED": true,
}

// NetworkContribution 是网络贡献（Canonical，PRD §7）。
type NetworkContribution struct {
	ContributionID         string     `json:"contributionId"`
	ContributorPrincipalID string     `json:"contributorPrincipalId"`
	ContributionType       string     `json:"contributionType"`
	CampaignID             string     `json:"campaignId,omitempty"`
	TargetType             string     `json:"targetType"` // MERCHANT | DRIVER | AGENT | REQUESTER | VENUE
	TargetID               string     `json:"targetId,omitempty"`
	ReferralInviteID       string     `json:"referralInviteId,omitempty"`
	AttributionID          string     `json:"attributionId"`
	State                  string     `json:"state"`
	SubmittedAt            time.Time  `json:"submittedAt"`
	QualifiedAt            *time.Time `json:"qualifiedAt,omitempty"`
	ActivatedAt            *time.Time `json:"activatedAt,omitempty"`
	ValueCreatedAt         *time.Time `json:"valueCreatedAt,omitempty"`
	RewardedAt             *time.Time `json:"rewardedAt,omitempty"`
	RejectReason           string     `json:"rejectReason,omitempty"`
	ReviewAccess           string     `json:"reviewAccess,omitempty"`     // PASSED | FAILED | PENDING
	ReviewDomain           string     `json:"reviewDomain,omitempty"`     // PASSED | FAILED | PENDING
	ReviewRewardGate       string     `json:"reviewRewardGate,omitempty"` // PASSED | FAILED | PENDING
	RewardVND              int64      `json:"rewardVnd,omitempty"`
}

// ReferralInvite 是邀请（PRD §8：Invite/QR/deep link 只是 Attribution 入口，不是 Reward Truth）。
type ReferralInvite struct {
	ReferralInviteID       string     `json:"referralInviteId"`
	ContributorPrincipalID string     `json:"contributorPrincipalId"`
	CampaignID             string     `json:"campaignId,omitempty"`
	InviteCode             string     `json:"inviteCode"`
	ContributionType       string     `json:"contributionType"`
	CreatedAt              time.Time  `json:"createdAt"`
	ExpiresAt              *time.Time `json:"expiresAt,omitempty"`
	State                  string     `json:"state"` // ACTIVE | USED | EXPIRED
}

type Repository interface {
	CreateContribution(ctx context.Context, c NetworkContribution) error
	GetContribution(ctx context.Context, id string) (NetworkContribution, error)
	UpdateContribution(ctx context.Context, c NetworkContribution, expectedState string) error
	CreateInvite(ctx context.Context, i ReferralInvite) error
	GetInvite(ctx context.Context, id string) (ReferralInvite, error)
	UpdateInviteState(ctx context.Context, id, state string) error
	// ConsumeInvite atomically flips an invite ACTIVE → USED. It fails with
	// ErrInviteNotActive when the invite is missing or already consumed, which
	// prevents concurrent double-consumption of the same invite.
	ConsumeInvite(ctx context.Context, id string) error
	FindByTarget(ctx context.Context, contributionType, targetType, targetID string) (NetworkContribution, error)
	ContributionsBy(ctx context.Context, contributorID string) ([]NetworkContribution, error)
	InvitesBy(ctx context.Context, contributorID string) ([]ReferralInvite, error)
	Snapshot(ctx context.Context) ([]NetworkContribution, error)
}

var (
	ErrContributionNotFound = errors.New("contribution not found")
	ErrInviteNotFound       = errors.New("invite not found")
	ErrInviteNotActive      = errors.New("invite not active")
	ErrDuplicateTarget      = errors.New("duplicate target")
	ErrSelfReferral         = errors.New("self referral not allowed")
	ErrInvalidState         = errors.New("invalid state transition")
)

// maxRewardVND caps a single contribution reward (fail-closed against
// operator misuse / client-inflated amounts entering the Ledger).
const maxRewardVND = 100_000_000

type MemoryRepository struct {
	mu            sync.Mutex
	contributions map[string]NetworkContribution
	invites       map[string]ReferralInvite
	events        []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		contributions: make(map[string]NetworkContribution),
		invites:       make(map[string]ReferralInvite),
	}
}

func (r *MemoryRepository) CreateContribution(_ context.Context, c NetworkContribution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.contributions[c.ContributionID]; exists {
		return errors.New("contribution already exists")
	}
	r.contributions[c.ContributionID] = c
	return nil
}

func (r *MemoryRepository) GetContribution(_ context.Context, id string) (NetworkContribution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, exists := r.contributions[id]
	if !exists {
		return NetworkContribution{}, ErrContributionNotFound
	}
	return c, nil
}

func (r *MemoryRepository) UpdateContribution(_ context.Context, c NetworkContribution, expectedState string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.contributions[c.ContributionID]
	if !exists {
		return ErrContributionNotFound
	}
	if current.State != expectedState {
		return ErrInvalidState
	}
	r.contributions[c.ContributionID] = c
	return nil
}

func (r *MemoryRepository) CreateInvite(_ context.Context, i ReferralInvite) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.invites[i.ReferralInviteID] = i
	return nil
}

func (r *MemoryRepository) GetInvite(_ context.Context, id string) (ReferralInvite, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, exists := r.invites[id]
	if !exists {
		return ReferralInvite{}, ErrInviteNotFound
	}
	return i, nil
}

func (r *MemoryRepository) UpdateInviteState(_ context.Context, id, state string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, exists := r.invites[id]
	if !exists {
		return ErrInviteNotFound
	}
	i.State = state
	r.invites[id] = i
	return nil
}

func (r *MemoryRepository) ConsumeInvite(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, exists := r.invites[id]
	if !exists {
		return ErrInviteNotFound
	}
	if i.State != "ACTIVE" {
		return ErrInviteNotActive
	}
	i.State = "USED"
	r.invites[id] = i
	return nil
}

func (r *MemoryRepository) FindByTarget(_ context.Context, contributionType, targetType, targetID string) (NetworkContribution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.contributions {
		if c.ContributionType == contributionType && c.TargetType == targetType && c.TargetID == targetID {
			return c, nil
		}
	}
	return NetworkContribution{}, ErrContributionNotFound
}

func (r *MemoryRepository) ContributionsBy(_ context.Context, contributorID string) ([]NetworkContribution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []NetworkContribution{}
	for _, c := range r.contributions {
		if c.ContributorPrincipalID == contributorID {
			result = append(result, c)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SubmittedAt.After(result[j].SubmittedAt) })
	return result, nil
}

func (r *MemoryRepository) InvitesBy(_ context.Context, contributorID string) ([]ReferralInvite, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []ReferralInvite{}
	for _, i := range r.invites {
		if i.ContributorPrincipalID == contributorID {
			result = append(result, i)
		}
	}
	return result, nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]NetworkContribution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]NetworkContribution, 0, len(r.contributions))
	for _, c := range r.contributions {
		result = append(result, c)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SubmittedAt.After(result[j].SubmittedAt) })
	return result, nil
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "SubmitContribution", "CreateReferralInvite", "ListContributions",
		"ReviewContributionAccess", "ReviewContributionDomain", "ReviewRewardGate",
		"ActivateContribution", "RecordContributionValue", "GrantContributionReward":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "SubmitContribution":
		return s.submitContribution(ctx, e)
	case "CreateReferralInvite":
		return s.createInvite(ctx, e)
	case "ListContributions":
		return s.listContributions(ctx, e)
	case "ReviewContributionAccess":
		return s.reviewAccess(ctx, e)
	case "ReviewContributionDomain":
		return s.reviewDomain(ctx, e)
	case "ReviewRewardGate":
		return s.reviewRewardGate(ctx, e)
	case "ActivateContribution":
		return s.activate(ctx, e)
	case "RecordContributionValue":
		return s.recordValue(ctx, e)
	case "GrantContributionReward":
		return s.grantReward(ctx, e)
	default:
		return command.Rejected(e, "CONTRIBUTION_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "contribution.unsupported_command", nil)
	}
}

// ---------- CreateReferralInvite ----------
// PRD §8：Invite 只是 Attribution 入口，不是 Reward Truth。

type invitePayload struct {
	ContributionType string `json:"contributionType"`
	CampaignID       string `json:"campaignId"`
}

func (s *Service) createInvite(ctx context.Context, e command.Envelope) command.Result {
	var p invitePayload
	if !decode(e.Payload, &p) || p.ContributionType == "" {
		return command.Rejected(e, "INVALID_INVITE", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_invite", nil)
	}
	if !ValidContributionTypes[p.ContributionType] {
		return command.Rejected(e, "INVALID_CONTRIBUTION_TYPE", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_type", map[string]any{"type": p.ContributionType})
	}
	now := s.clock.Now().UTC()
	invite := ReferralInvite{
		ReferralInviteID:       newID("inv_"),
		ContributorPrincipalID: e.Principal.ID,
		CampaignID:             p.CampaignID,
		InviteCode:             newInviteCode(),
		ContributionType:       p.ContributionType,
		CreatedAt:              now,
		State:                  "ACTIVE",
	}
	domainEvents := []event.DomainEvent{event.New("ReferralInviteCreated", "ReferralInvite", invite.ReferralInviteID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"inviteCode":       invite.InviteCode,
		"contributionType": p.ContributionType,
		"note":             "Invite 只是 Attribution 入口，不是 Reward Truth",
	})}
	if err := s.repository.CreateInvite(ctx, invite); err != nil {
		return command.Rejected(e, "INVITE_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.invite_failed", nil)
	}
	return acceptedWithPayload(e, "ReferralInvite", invite.ReferralInviteID, 1, "ACTIVE", map[string]any{
		"referralInviteId": invite.ReferralInviteID,
		"inviteCode":       invite.InviteCode,
		"contributionType": invite.ContributionType,
	}, domainEvents)
}

// ---------- SubmitContribution ----------
// PRD §9：Discover → SUBMITTED；防 self-referral / duplicate target / prior valid attribution。

type submitPayload struct {
	ContributionType  string `json:"contributionType"`
	CampaignID        string `json:"campaignId"`
	TargetType        string `json:"targetType"`
	TargetID          string `json:"targetId"`
	ReferralInviteID  string `json:"referralInviteId"`
	TargetPrincipalID string `json:"targetPrincipalId"` // 被推荐人（self-referral 检查）
}

func (s *Service) submitContribution(ctx context.Context, e command.Envelope) command.Result {
	var p submitPayload
	if !decode(e.Payload, &p) || p.ContributionType == "" || p.TargetType == "" {
		return command.Rejected(e, "INVALID_CONTRIBUTION", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_submit", nil)
	}
	if !ValidContributionTypes[p.ContributionType] {
		return command.Rejected(e, "INVALID_CONTRIBUTION_TYPE", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_type", map[string]any{"type": p.ContributionType})
	}
	// REFERRAL 类必须显式提供被推荐人：缺省时无法做 self-referral 判定，fail-closed 拒绝。
	if strings.HasSuffix(p.ContributionType, "_REFERRAL") && p.TargetPrincipalID == "" {
		return command.Rejected(e, "TARGET_PRINCIPAL_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "contribution.target_principal_required", nil)
	}
	// 防 self-referral：被推荐人不能是贡献者自己
	if p.TargetPrincipalID != "" && p.TargetPrincipalID == e.Principal.ID {
		return command.Rejected(e, "SELF_REFERRAL_NOT_ALLOWED", "VALIDATION", "AFTER_USER_ACTION", "contribution.self_referral", nil)
	}
	// 防 duplicate target：同一类型+目标已有贡献 → 拒绝（PRD §12：duplicate merchant / duplicate target）
	if p.TargetID != "" {
		if existing, err := s.repository.FindByTarget(ctx, p.ContributionType, p.TargetType, p.TargetID); err == nil {
			return command.Rejected(e, "DUPLICATE_CONTRIBUTION_TARGET", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.duplicate_target",
				map[string]any{"existingContributionId": existing.ContributionID})
		}
	}
	// 防 self-referral（invite 路径）：邀请者不能使用自己的 invite
	inviteOwner := ""
	if p.ReferralInviteID != "" {
		invite, err := s.repository.GetInvite(ctx, p.ReferralInviteID)
		if err != nil {
			return command.Rejected(e, "INVITE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.invite_not_found", nil)
		}
		if invite.State != "ACTIVE" {
			return command.Rejected(e, "INVITE_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.invite_not_active", nil)
		}
		inviteOwner = invite.ContributorPrincipalID
		if inviteOwner == p.TargetPrincipalID {
			return command.Rejected(e, "SELF_REFERRAL_NOT_ALLOWED", "VALIDATION", "AFTER_USER_ACTION", "contribution.self_referral", nil)
		}
	}
	now := s.clock.Now().UTC()
	contribution := NetworkContribution{
		ContributionID:         newID("ctb_"),
		ContributorPrincipalID: e.Principal.ID,
		ContributionType:       p.ContributionType,
		CampaignID:             p.CampaignID,
		TargetType:             p.TargetType,
		TargetID:               p.TargetID,
		ReferralInviteID:       p.ReferralInviteID,
		AttributionID:          newID("atr_"),
		State:                  "SUBMITTED",
		SubmittedAt:            now,
		ReviewAccess:           "PENDING",
		ReviewDomain:           "PENDING",
		ReviewRewardGate:       "PENDING",
	}
	domainEvents := []event.DomainEvent{event.New("ContributionSubmitted", "NetworkContribution", contribution.ContributionID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"contributionType": p.ContributionType,
		"targetType":       p.TargetType,
		"note":             "状态只能由 Domain Event / Review / Policy 推进，客户端不得直接置成功",
	})}
	// 先 CAS 消费 invite（ACTIVE → USED），防止并发双花；失败则整体拒绝。
	if p.ReferralInviteID != "" {
		if err := s.repository.ConsumeInvite(ctx, p.ReferralInviteID); err != nil {
			return command.Rejected(e, "INVITE_ALREADY_CONSUMED", "CONCURRENCY", "AFTER_USER_ACTION", "contribution.invite_consumed", nil)
		}
	}
	if err := s.repository.CreateContribution(ctx, contribution); err != nil {
		// 创建失败时归还 invite，避免用户损失 Attribution 入口。
		if p.ReferralInviteID != "" {
			_ = s.repository.UpdateInviteState(ctx, p.ReferralInviteID, "ACTIVE")
		}
		return command.Rejected(e, "CONTRIBUTION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.create_failed", nil)
	}
	return acceptedWithPayload(e, "NetworkContribution", contribution.ContributionID, 1, "SUBMITTED", map[string]any{
		"contributionId": contribution.ContributionID,
		"attributionId":  contribution.AttributionID,
		"state":          "SUBMITTED",
	}, domainEvents)
}

// ---------- 三层审核分离（PRD §13：不合并 approved=true）----------

func (s *Service) reviewAccess(ctx context.Context, e command.Envelope) command.Result {
	return s.review(ctx, e, "ReviewContributionAccess", "ReviewAccess", "Access")
}

func (s *Service) reviewDomain(ctx context.Context, e command.Envelope) command.Result {
	return s.review(ctx, e, "ReviewContributionDomain", "ReviewDomain", "Domain")
}

func (s *Service) reviewRewardGate(ctx context.Context, e command.Envelope) command.Result {
	return s.review(ctx, e, "ReviewRewardGate", "ReviewRewardGate", "RewardGate")
}

type reviewPayload struct {
	Decision string `json:"decision"` // APPROVE | REJECT
	Reason   string `json:"reason"`
}

func (s *Service) review(ctx context.Context, e command.Envelope, commandType, field, label string) command.Result {
	var p reviewPayload
	if !decode(e.Payload, &p) || (p.Decision != "APPROVE" && p.Decision != "REJECT") {
		return command.Rejected(e, "INVALID_REVIEW_DECISION", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_review", nil)
	}
	contribution, err := s.repository.GetContribution(ctx, e.Target.ID)
	if errors.Is(err, ErrContributionNotFound) {
		return command.Rejected(e, "CONTRIBUTION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONTRIBUTION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.read_failed", nil)
	}
	if contribution.State != "SUBMITTED" && contribution.State != "DEDUP_CHECK" && contribution.State != "UNDER_REVIEW" {
		return command.Rejected(e, "CONTRIBUTION_NOT_REVIEWABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_reviewable", map[string]any{"state": contribution.State})
	}
	previousState := contribution.State
	// 三层各自独立推进（PRD §13：三者不得合并成单个 approved=true）
	switch field {
	case "ReviewAccess":
		contribution.ReviewAccess = "PASSED"
		if p.Decision == "REJECT" {
			contribution.ReviewAccess = "FAILED"
		}
	case "ReviewDomain":
		contribution.ReviewDomain = "PASSED"
		if p.Decision == "REJECT" {
			contribution.ReviewDomain = "FAILED"
		}
	case "ReviewRewardGate":
		contribution.ReviewRewardGate = "PASSED"
		if p.Decision == "REJECT" {
			contribution.ReviewRewardGate = "FAILED"
		}
	}
	// 状态推进：三层全 PASS → QUALIFIED；任一 REJECT → REJECTED
	allPassed := contribution.ReviewAccess == "PASSED" && contribution.ReviewDomain == "PASSED" && contribution.ReviewRewardGate == "PASSED"
	anyFailed := contribution.ReviewAccess == "FAILED" || contribution.ReviewDomain == "FAILED" || contribution.ReviewRewardGate == "FAILED"
	if allPassed {
		contribution.State = "QUALIFIED"
		t := s.clock.Now().UTC()
		contribution.QualifiedAt = &t
	} else if anyFailed {
		contribution.State = "REJECTED"
		contribution.RejectReason = label + " review failed: " + p.Reason
	} else {
		contribution.State = "UNDER_REVIEW"
	}
	domainEvents := []event.DomainEvent{event.New("ContributionReviewed", "NetworkContribution", contribution.ContributionID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"reviewType": label,
		"decision":   p.Decision,
		"state":      contribution.State,
		"note":       "三层审核分离：Access / Domain / RewardGate 各自独立",
	})}
	if err := s.repository.UpdateContribution(ctx, contribution, previousState); err != nil {
		// 可能并发推进，重读后再试（简化：允许从提交态更新）
		if errors.Is(err, ErrInvalidState) {
			return command.Rejected(e, "CONTRIBUTION_STATE_CHANGED", "CONCURRENCY", "SAFE_RETRY", "contribution.state_changed", nil)
		}
		return command.Rejected(e, "CONTRIBUTION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.update_failed", nil)
	}
	return command.Accepted(e, "NetworkContribution", contribution.ContributionID, 1, contribution.State, eventRefs(domainEvents))
}

// ---------- ActivateContribution ----------
// QUALIFIED → ACTIVATED（目标真正接入网络）。

func (s *Service) activate(ctx context.Context, e command.Envelope) command.Result {
	contribution, err := s.repository.GetContribution(ctx, e.Target.ID)
	if errors.Is(err, ErrContributionNotFound) {
		return command.Rejected(e, "CONTRIBUTION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONTRIBUTION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.read_failed", nil)
	}
	if contribution.State != "QUALIFIED" {
		return command.Rejected(e, "CONTRIBUTION_NOT_QUALIFIED", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_qualified", map[string]any{"state": contribution.State})
	}
	now := s.clock.Now().UTC()
	contribution.State = "ACTIVATED"
	contribution.ActivatedAt = &now
	domainEvents := []event.DomainEvent{event.New("ContributionActivated", "NetworkContribution", contribution.ContributionID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{})}
	if err := s.repository.UpdateContribution(ctx, contribution, "QUALIFIED"); err != nil {
		return command.Rejected(e, "CONTRIBUTION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.update_failed", nil)
	}
	return command.Accepted(e, "NetworkContribution", contribution.ContributionID, 1, "ACTIVATED", eventRefs(domainEvents))
}

// ---------- RecordContributionValue ----------
// ACTIVATED → VALUE_CREATED（Verified Value Event：首单完成等）。

type valuePayload struct {
	ValueType string `json:"valueType"` // FIRST_ORDER | FIRST_CONSUMPTION | FIRST_NEED | REGISTERED
	OrderID   string `json:"orderId"`
	AmountVND int64  `json:"amountVnd"`
}

func (s *Service) recordValue(ctx context.Context, e command.Envelope) command.Result {
	var p valuePayload
	if !decode(e.Payload, &p) || p.ValueType == "" {
		return command.Rejected(e, "INVALID_VALUE_EVENT", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_value", nil)
	}
	contribution, err := s.repository.GetContribution(ctx, e.Target.ID)
	if errors.Is(err, ErrContributionNotFound) {
		return command.Rejected(e, "CONTRIBUTION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONTRIBUTION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.read_failed", nil)
	}
	if contribution.State != "ACTIVATED" {
		return command.Rejected(e, "CONTRIBUTION_NOT_ACTIVATED", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_activated", map[string]any{"state": contribution.State})
	}
	now := s.clock.Now().UTC()
	contribution.State = "VALUE_CREATED"
	contribution.ValueCreatedAt = &now
	domainEvents := []event.DomainEvent{event.New("ContributionValueCreated", "NetworkContribution", contribution.ContributionID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"valueType": p.ValueType,
		"orderId":   p.OrderID,
		"note":      "Verified Value Event：Reward 必须由服务端 Verified Value Event 驱动",
	})}
	if err := s.repository.UpdateContribution(ctx, contribution, "ACTIVATED"); err != nil {
		return command.Rejected(e, "CONTRIBUTION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.update_failed", nil)
	}
	return command.Accepted(e, "NetworkContribution", contribution.ContributionID, 1, "VALUE_CREATED", eventRefs(domainEvents))
}

// ---------- GrantContributionReward ----------
// VALUE_CREATED → REWARDED（Reward Gate 通过后发奖）。

type rewardPayload struct {
	AmountVND int64 `json:"amountVnd"`
}

func (s *Service) grantReward(ctx context.Context, e command.Envelope) command.Result {
	var p rewardPayload
	if !decode(e.Payload, &p) || p.AmountVND <= 0 {
		return command.Rejected(e, "INVALID_REWARD", "VALIDATION", "AFTER_USER_ACTION", "contribution.invalid_reward", nil)
	}
	if p.AmountVND > maxRewardVND {
		return command.Rejected(e, "REWARD_EXCEEDS_LIMIT", "VALIDATION", "AFTER_USER_ACTION", "contribution.reward_exceeds_limit",
			map[string]any{"maxRewardVnd": maxRewardVND})
	}
	contribution, err := s.repository.GetContribution(ctx, e.Target.ID)
	if errors.Is(err, ErrContributionNotFound) {
		return command.Rejected(e, "CONTRIBUTION_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CONTRIBUTION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.read_failed", nil)
	}
	if contribution.State != "VALUE_CREATED" {
		return command.Rejected(e, "CONTRIBUTION_NO_VALUE", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.no_value", map[string]any{"state": contribution.State})
	}
	// Reward Gate 必须 PASSED（PRD §13 C）
	if contribution.ReviewRewardGate != "PASSED" {
		return command.Rejected(e, "REWARD_GATE_NOT_PASSED", "BUSINESS_STATE", "AFTER_USER_ACTION", "contribution.reward_gate_blocked", nil)
	}
	now := s.clock.Now().UTC()
	contribution.State = "REWARDED"
	contribution.RewardedAt = &now
	contribution.RewardVND = p.AmountVND
	domainEvents := []event.DomainEvent{event.New("ContributionRewardGranted", "NetworkContribution", contribution.ContributionID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"amountVnd": p.AmountVND,
		"note":      "Reward 是财务事实，进入 Product Truth / Ledger",
	})}
	if err := s.repository.UpdateContribution(ctx, contribution, "VALUE_CREATED"); err != nil {
		return command.Rejected(e, "CONTRIBUTION_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.update_failed", nil)
	}
	return acceptedWithPayload(e, "NetworkContribution", contribution.ContributionID, 1, "REWARDED", map[string]any{
		"contributionId": contribution.ContributionID,
		"rewardVnd":      p.AmountVND,
		"state":          "REWARDED",
	}, domainEvents)
}

// ---------- ListContributions ----------

func (s *Service) listContributions(ctx context.Context, e command.Envelope) command.Result {
	contributions, err := s.repository.ContributionsBy(ctx, e.Principal.ID)
	if err != nil {
		return command.Rejected(e, "CONTRIBUTION_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "contribution.list_failed", nil)
	}
	return acceptedWithPayload(e, "NetworkContribution", "", 0, "LIST", map[string]any{
		"contributions": contributions,
	}, nil)
}

// ---------- helpers ----------

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return false
	}
	return true
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

func newInviteCode() string {
	var raw [4]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return strings.ToUpper(hex.EncodeToString(raw[:]))
	}
	return "ABCD1234"
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
