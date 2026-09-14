package benefit

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

var (
	ErrCampaignNotFound       = errors.New("campaign not found")
	ErrCampaignNotActive      = errors.New("campaign not active")
	ErrCampaignExhausted      = errors.New("campaign exhausted")
	ErrAllocationNotFound     = errors.New("allocation not found")
	ErrAllocationExhausted    = errors.New("allocation exhausted")
	ErrOfferNotFound          = errors.New("offer not found")
	ErrOfferExpired           = errors.New("offer expired")
	ErrOfferAlreadyClaimed    = errors.New("offer already claimed")
	ErrClaimNotFound          = errors.New("claim not found")
	ErrClaimAlreadyRedeemed   = errors.New("claim already redeemed")
	ErrClaimTokenInvalid      = errors.New("claim token invalid")
	ErrCapacityExhausted      = errors.New("capacity exhausted")
	ErrRedemptionDuplicate    = errors.New("redemption duplicate")
	ErrRedemptionNotFound     = errors.New("redemption not found")
	ErrVersionConflict        = errors.New("version conflict")
	ErrNotAuthorized          = errors.New("not authorized")
	ErrEligibilityFailed      = errors.New("eligibility failed")
)

// Service implements the Benefit Routing Network business logic.
type Service struct {
	repo    Repository
	clock   Clock
	eligibility Evaluator
}

type Clock interface {
	Now() time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now().UTC() }

func NewService(repo Repository) *Service {
	return &Service{repo: repo, clock: systemClock{}, eligibility: NewEligibilityEngine(repo, systemClock{})}
}

// WithEligibility replaces the default eligibility engine. Used by
// tests that want to inject a stub. The default engine is wired in
// NewService, so production callers do not need to call this.
func (s *Service) WithEligibility(engine Evaluator) *Service {
	s.eligibility = engine
	return s
}

// countRedemptions 统计某用户在某活动下**已核销**的次数（BENEFIT-ELIG-001）。
//
// 为什么必须存在：max_redemptions 规则比的是 ec.TotalRedemptions，而此前
// claim / redeem 两条路径都没填它 —— 恒为 0，于是 `0 >= N` 永不成立，
// 「每人最多 N 次」这条规则从来没生效过。喊了却执行不了的封顶就是个装饰。
//
// 用现成的 ListClaimsByUser 在内存里过滤，而不是给仓储加一个 count 方法：
// 后者要同时改接口 + 内存 + Postgres 三处；当前规模下过滤成本可以忽略，
// 真到量级再换成 SQL COUNT。
func (s *Service) countRedemptions(ctx context.Context, userID, campaignID string) (int, error) {
	claims, err := s.repo.ListClaimsByUser(ctx, userID, nil)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, c := range claims {
		if c.CampaignID == campaignID && c.Status == ClaimRedeemed {
			n++
		}
	}
	return n, nil
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateCampaign", "ActivateCampaign", "PauseCampaign", "AllocateBenefit", "ClaimBenefit", "RedeemBenefit":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "CreateCampaign":
		return s.HandleCreateCampaign(ctx, e)
	case "ActivateCampaign":
		return s.HandleActivateCampaign(ctx, e)
	case "PauseCampaign":
		return s.HandlePauseCampaign(ctx, e)
	case "AllocateBenefit":
		return s.HandleAllocateBenefit(ctx, e)
	case "ClaimBenefit":
		return s.HandleClaimBenefit(ctx, e)
	case "RedeemBenefit":
		return s.HandleRedeemBenefit(ctx, e)
	default:
		return command.Rejected(e, "BENEFIT_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "benefit.unsupported", nil)
	}
}

// NewServiceWithClock 给测试用的时钟构造器。
//
// BENEFIT-ELIG-001: 这里以前**不接资格引擎** —— s.eligibility 恒为 nil，
// 于是 `if s.eligibility != nil` 这道门在所有用这个构造器写的测试里**从不执行**。
// 后果是：引擎的单测全绿（它们直接测引擎、喂真实信号），而服务这条路径上的
// 资格门从来没被测过 —— 这正是「信号没喂」能潜伏到现在的原因。
// 默认引擎必须在这里也接上；要打桩的测试用 WithEligibility 覆盖。
func NewServiceWithClock(repo Repository, clock Clock) *Service {
	return &Service{repo: repo, clock: clock, eligibility: NewEligibilityEngine(repo, clock)}
}

// ──────────────────────────────────────────────────────────────
// Campaign Commands
// ──────────────────────────────────────────────────────────────

type CreateCampaignPayload struct {
	Type        CampaignType `json:"type"`
	OwnerType   string       `json:"ownerType"`
	OwnerID     string       `json:"ownerId"`
	SceneIDs    []string     `json:"sceneIds"`
	Goal        string       `json:"goal"`
	BudgetMinor int64        `json:"budgetMinor"`
	Currency    string       `json:"currency"`
	StartAt     time.Time    `json:"startAt"`
	EndAt       time.Time    `json:"endAt"`
}

func (s *Service) HandleCreateCampaign(ctx context.Context, e command.Envelope) command.Result {
	var p CreateCampaignPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	if p.Type == "" || p.OwnerType == "" || p.OwnerID == "" {
		return command.Rejected(e, "MISSING_FIELDS", "VALIDATION", "AFTER_USER_ACTION", "benefit.missing_fields", nil)
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	now := s.clock.Now()
	c := &Campaign{
		ID:          newID("camp_"),
		Type:        p.Type,
		Status:      CampaignDraft,
		OwnerType:   p.OwnerType,
		OwnerID:     p.OwnerID,
		SceneIDs:    p.SceneIDs,
		Goal:        p.Goal,
		BudgetMinor: p.BudgetMinor,
		Currency:    p.Currency,
		StartAt:     p.StartAt,
		EndAt:       p.EndAt,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1,
	}
	if err := s.repo.CreateCampaign(ctx, c); err != nil {
		return command.Rejected(e, "CAMPAIGN_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.campaign_create_failed", nil)
	}
	s.appendEvent(ctx, c.ID, "CampaignCreated", e.Actor.ID, map[string]any{"type": c.Type})
	result := command.Accepted(e, "Campaign", c.ID, 1, "CREATED", nil)
	result.Body = map[string]any{"campaignId": c.ID, "type": c.Type, "status": c.Status}
	return result
}

type ActivateCampaignPayload struct {
	CampaignID string `json:"campaignId"`
}

func (s *Service) HandleActivateCampaign(ctx context.Context, e command.Envelope) command.Result {
	var p ActivateCampaignPayload
	if !decode(e.Payload, &p) || p.CampaignID == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	c, err := s.repo.GetCampaign(ctx, p.CampaignID)
	if err != nil {
		return command.Rejected(e, "CAMPAIGN_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.campaign_not_found", nil)
	}
	if c.Status != CampaignDraft && c.Status != CampaignScheduled {
		return command.Rejected(e, "CAMPAIGN_NOT_ACTIVATABLE", "STATE", "AFTER_USER_ACTION", "benefit.campaign_not_activatable", nil)
	}
	now := s.clock.Now()
	if now.Before(c.StartAt) {
		c.Status = CampaignScheduled
	} else {
		c.Status = CampaignActive
	}
	c.UpdatedAt = now
	c.Version++
	if err := s.repo.UpdateCampaign(ctx, c); err != nil {
		return command.Rejected(e, "CAMPAIGN_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.campaign_update_failed", nil)
	}
	s.appendEvent(ctx, c.ID, "CampaignActivated", e.Actor.ID, nil)
	return command.Accepted(e, "Campaign", c.ID, c.Version, "ACTIVATED", nil)
}

type PauseCampaignPayload struct {
	CampaignID string `json:"campaignId"`
}

func (s *Service) HandlePauseCampaign(ctx context.Context, e command.Envelope) command.Result {
	var p PauseCampaignPayload
	if !decode(e.Payload, &p) || p.CampaignID == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	c, err := s.repo.GetCampaign(ctx, p.CampaignID)
	if err != nil {
		return command.Rejected(e, "CAMPAIGN_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.campaign_not_found", nil)
	}
	if c.Status != CampaignActive {
		return command.Rejected(e, "CAMPAIGN_NOT_PAUSABLE", "STATE", "AFTER_USER_ACTION", "benefit.campaign_not_pausable", nil)
	}
	c.Status = CampaignPaused
	c.UpdatedAt = s.clock.Now()
	c.Version++
	if err := s.repo.UpdateCampaign(ctx, c); err != nil {
		return command.Rejected(e, "CAMPAIGN_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.campaign_update_failed", nil)
	}
	s.appendEvent(ctx, c.ID, "CampaignPaused", e.Actor.ID, nil)
	return command.Accepted(e, "Campaign", c.ID, c.Version, "PAUSED", nil)
}

// ──────────────────────────────────────────────────────────────
// Allocation Commands
// ──────────────────────────────────────────────────────────────

type AllocateBenefitPayload struct {
	CampaignID      string          `json:"campaignId"`
	BenefitID       string          `json:"benefitId"`
	DistributorType DistributorType `json:"distributorType"`
	DistributorID   string          `json:"distributorId"`
	Quota           int             `json:"quota"`
}

func (s *Service) HandleAllocateBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p AllocateBenefitPayload
	if !decode(e.Payload, &p) || p.CampaignID == "" || p.BenefitID == "" || p.DistributorID == "" || p.Quota <= 0 {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	c, err := s.repo.GetCampaign(ctx, p.CampaignID)
	if err != nil {
		return command.Rejected(e, "CAMPAIGN_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.campaign_not_found", nil)
	}
	if c.Status != CampaignActive && c.Status != CampaignDraft && c.Status != CampaignScheduled {
		return command.Rejected(e, "CAMPAIGN_NOT_ALLOCATABLE", "STATE", "AFTER_USER_ACTION", "benefit.campaign_not_allocatable", nil)
	}
	now := s.clock.Now()
	a := &Allocation{
		ID:              newID("alloc_"),
		CampaignID:      p.CampaignID,
		BenefitID:       p.BenefitID,
		DistributorType: p.DistributorType,
		DistributorID:   p.DistributorID,
		Quota:           p.Quota,
		Distributed:     0,
		Consumed:        0,
		CreatedAt:       now,
		UpdatedAt:       now,
		Version:         1,
	}
	if err := s.repo.CreateAllocation(ctx, a); err != nil {
		return command.Rejected(e, "ALLOCATION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.allocation_create_failed", nil)
	}
	s.appendEvent(ctx, p.CampaignID, "BenefitAllocated", e.Actor.ID, map[string]any{
		"allocationId":     a.ID,
		"distributorType":  a.DistributorType,
		"distributorId":    a.DistributorID,
		"quota":            a.Quota,
	})
	return command.Accepted(e, "Allocation", a.ID, 1, "CREATED", nil)
}

// ──────────────────────────────────────────────────────────────
// Offer / Claim / Redemption
// ──────────────────────────────────────────────────────────────

type ClaimBenefitPayload struct {
	OfferID    string `json:"offerId,omitempty"`
	CampaignID string `json:"campaignId"`
	BenefitID  string `json:"benefitId"`
}

func (s *Service) HandleClaimBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p ClaimBenefitPayload
	if !decode(e.Payload, &p) || p.CampaignID == "" || p.BenefitID == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	// Verify campaign is active
	c, err := s.repo.GetCampaign(ctx, p.CampaignID)
	if err != nil {
		return command.Rejected(e, "CAMPAIGN_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.campaign_not_found", nil)
	}
	if c.Status != CampaignActive {
		return command.Rejected(e, "CAMPAIGN_NOT_ACTIVE", "STATE", "AFTER_USER_ACTION", "benefit.campaign_not_active", nil)
	}
// R16.7-P1-H: eligibility gate. Fires before the claim is written so a
// RISK_FLAGGED or SOURCE_NOT_ALLOWED user does not pollute the capacity
// counter or the claim ledger.
//
// BENEFIT-ELIG-001 — 这个门此前是装饰。上面那版注释写着「best-effort defaults
// (AccountAge=0, DeviceCount=1, AccountCount=1)」，但代码**一个都没设**，
// 四个信号全是零值。后果是：
//   - max_redemptions：TotalRedemptions 恒为 0，0 >= N 永不成立 → 封顶形同虚设；
//   - geoCities：UserCity 恒为 ""，而判断条件是 `len>0 && UserCity != ""` → 地域限制被跳过；
//   - min_account_age_days：AccountAge 恒为 0 → **所有人**都被判 ACCOUNT_TOO_NEW，
//     且理由还是错的（运营会以为没人来领，实际是规则根本验不了）；
//   - RISK_FLAGGED：DeviceCount/AccountCount 恒为 0 → 风控分支不可达。
// 前两条 fail-open，第三条 fail-closed 但理由误导，第四条纯装饰。
//
// 本轮只修**本地算得出来**的那个：TotalRedemptions（BENEFIT-ELIG-001）。
// UserCity / AccountAge / DeviceCount / AccountCount 需要身份与设备图谱，
// benefit 域拿不到，保持不填 —— 但它们对应的规则仍然不生效，见
// docs 说明；等真实信号接入再补。**不要用 0 冒充真实值**，那比留空更糟。
if s.eligibility != nil {
	totalRedemptions, err := s.countRedemptions(ctx, e.Actor.ID, p.CampaignID)
	if err != nil {
		return command.Rejected(e, "ELIGIBILITY_EVAL_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.eligibility_eval_failed", nil)
	}
	result, err := s.eligibility.Evaluate(ctx, &EligibilityContext{
		UserID:           e.Actor.ID,
		CampaignID:       p.CampaignID,
		BenefitID:        p.BenefitID,
		AccountStatus:    "ACTIVE",
		TotalRedemptions: totalRedemptions,
	})
		if err != nil {
			return command.Rejected(e, "ELIGIBILITY_EVAL_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.eligibility_eval_failed", nil)
		}
		if !result.Eligible {
			result := command.Rejected(e, "ELIGIBILITY_FAILED", "VALIDATION", "AFTER_USER_ACTION", "benefit.eligibility_failed", map[string]any{
				"reasonCode": result.ReasonCode,
			})
			return result
		}
	}
	// Check capacity
	pool, err := s.repo.GetCapacityPool(ctx, p.CampaignID, nil)
	if err == nil && pool.Claimed >= pool.TotalCapacity {
		return command.Rejected(e, "CAPACITY_EXHAUSTED", "LIMIT", "AFTER_USER_ACTION", "benefit.capacity_exhausted", nil)
	}
	// Create claim
	now := s.clock.Now()
	token := generateClaimToken()
	cl := &Claim{
		ID:         newID("clm_"),
		OfferID:    p.OfferID,
		CampaignID: p.CampaignID,
		BenefitID:  p.BenefitID,
		UserID:     e.Actor.ID,
		ClaimToken: token,
		Status:     ClaimClaimed,
		CreatedAt:  now,
		UpdatedAt:  now,
		Version:    1,
	}
	if err := s.repo.CreateClaim(ctx, cl); err != nil {
		return command.Rejected(e, "CLAIM_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.claim_create_failed", nil)
	}
	// Increment capacity
	_ = s.repo.IncrementCapacity(ctx, p.CampaignID, nil, 1, 0, 0)
	// Mark offer as claimed if provided
	if p.OfferID != "" {
		_ = s.repo.UpdateOfferStatus(ctx, p.OfferID, OfferClaimed)
	}
	s.appendEvent(ctx, p.CampaignID, "BenefitClaimed", e.Actor.ID, map[string]any{
		"claimId":   cl.ID,
		"benefitId": p.BenefitID,
	})
	result := command.Accepted(e, "Claim", cl.ID, 1, "CLAIMED", nil)
	result.Body = map[string]any{
		"claimId":    cl.ID,
		"claimToken": token,
	}
	return result
}

type RedeemBenefitPayload struct {
	ClaimToken    string `json:"claimToken"`
	MerchantID    string `json:"merchantId"`
	StaffID       string `json:"staffId,omitempty"`
	EvidenceType  string `json:"evidenceType"`
	EvidenceRef   string `json:"evidenceRef,omitempty"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) HandleRedeemBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p RedeemBenefitPayload
	if !decode(e.Payload, &p) || p.ClaimToken == "" || p.MerchantID == "" || p.EvidenceType == "" || p.IdempotencyKey == "" {
		return command.Rejected(e, "INVALID_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "benefit.invalid_payload", nil)
	}
	// Idempotency check
	if existing, _ := s.repo.GetRedemptionByIdempotency(ctx, p.IdempotencyKey); existing != nil {
		result := command.Accepted(e, "Redemption", existing.ID, existing.Version, "ALREADY_REDEEMED", nil)
		result.Body = map[string]any{"redemptionId": existing.ID, "status": existing.Status}
		return result
	}
	// Lookup claim by token
	cl, err := s.repo.GetClaimByToken(ctx, p.ClaimToken)
	if err != nil {
		return command.Rejected(e, "CLAIM_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.claim_not_found", nil)
	}
	if cl.Status != ClaimClaimed && cl.Status != ClaimReserved {
		return command.Rejected(e, "CLAIM_NOT_REDEEMABLE", "STATE", "AFTER_USER_ACTION", "benefit.claim_not_redeemable", nil)
	}
	// BENEFIT-REDEEM-001: 核销方必须是这个活动的归属商家。
	//
	// p.MerchantID 是**调用方传的**，而它被直接写进 Redemption，结算也据此进行 ——
	// 不校验的话，任何商家扫到别人的券码都能把这笔核销记到自己名下，钱也就结给了他。
	// 与 business.createStore 的 BUSINESS_WRITE_REQUIRED 同一个口径：调用方声明的
	// 身份必须被验证，不能只因为「他说他是」就算数。
	campaign, err := s.repo.GetCampaign(ctx, cl.CampaignID)
	if err != nil {
		return command.Rejected(e, "CAMPAIGN_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.campaign_not_found", nil)
	}
	// ownerType 不是 merchant（例如平台自营）时没有可比的归属方，保持放行 ——
	// 但那种情况本来就没有商家可冒充，风险不同。
	if campaign.OwnerType == "merchant" && campaign.OwnerID != "" && campaign.OwnerID != p.MerchantID {
		return command.Rejected(e, "MERCHANT_NOT_CAMPAIGN_OWNER", "AUTHORIZATION", "AFTER_USER_ACTION", "benefit.merchant_not_campaign_owner", nil)
	}
	// R16.7-P1-H prep: eligibility re-check at redemption. A claim
	// that was eligible at claim time may have aged out (max
	// redemptions reached, account suspended, risk score changed).
	// Running the engine again here is cheap and is the natural
	// place to apply lifecycle-based rules.
	if s.eligibility != nil {
		// BENEFIT-ELIG-001: 同上，填真实的已核销次数。核销时这张券还没变成
		// REDEEMED（状态检查在更前面），所以数出来的是**此前**的核销次数，
		// 正是 max_redemptions 要比较的那个值。
		totalRedemptions, err := s.countRedemptions(ctx, cl.UserID, cl.CampaignID)
		if err != nil {
			return command.Rejected(e, "ELIGIBILITY_EVAL_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.eligibility_eval_failed", nil)
		}
		result, err := s.eligibility.Evaluate(ctx, &EligibilityContext{
			UserID:           cl.UserID,
			CampaignID:       cl.CampaignID,
			BenefitID:        cl.BenefitID,
			AccountStatus:    "ACTIVE",
			TotalRedemptions: totalRedemptions,
		})
		if err != nil {
			return command.Rejected(e, "ELIGIBILITY_EVAL_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.eligibility_eval_failed", nil)
		}
		if !result.Eligible {
			result := command.Rejected(e, "ELIGIBILITY_FAILED", "VALIDATION", "AFTER_USER_ACTION", "benefit.eligibility_failed", map[string]any{
				"reasonCode": result.ReasonCode,
			})
			return result
		}
	}
	// Get benefit definition for cost breakdown
	benefit, err := s.repo.GetBenefitDefinition(ctx, cl.BenefitID)
	if err != nil {
		return command.Rejected(e, "BENEFIT_NOT_FOUND", "NOT_FOUND", "AFTER_USER_ACTION", "benefit.benefit_not_found", nil)
	}
	now := s.clock.Now()
	redemption := &Redemption{
		ID:                   newID("redeem_"),
		ClaimID:              cl.ID,
		CampaignID:           cl.CampaignID,
		MerchantID:           p.MerchantID,
		StaffID:              p.StaffID,
		UserID:               cl.UserID,
		RetailValueMinor:     benefit.RetailValueMinor,
		UserPayMinor:         benefit.UserPayMinor,
		ProxySubsidyMinor:    benefit.RetailValueMinor - benefit.UserPayMinor, // simplified
		MerchantContribMinor: 0,
		CreatorAllocMinor:    0,
		StaffRewardMinor:     0,
		Currency:             benefit.Currency,
		EvidenceType:         p.EvidenceType,
		EvidenceRef:          p.EvidenceRef,
		Status:               RedemptionConfirmed,
		IdempotencyKey:       p.IdempotencyKey,
		RedeemedAt:           now,
		CreatedAt:            now,
		Version:              1,
	}
	if err := s.repo.CreateRedemption(ctx, redemption); err != nil {
		return command.Rejected(e, "REDEMPTION_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "benefit.redemption_create_failed", nil)
	}
	// Update claim status
	_ = s.repo.UpdateClaimStatus(ctx, cl.ID, ClaimRedeemed, cl.Version)
	// Increment capacity (redeemed)
	_ = s.repo.IncrementCapacity(ctx, cl.CampaignID, nil, 0, 0, 1)
	// Create settlement entries
	s.createSettlements(ctx, redemption, benefit)
	// Create attribution edge
	s.createAttribution(ctx, cl, redemption)
	s.appendEvent(ctx, cl.CampaignID, "BenefitRedeemed", e.Actor.ID, map[string]any{
		"redemptionId": redemption.ID,
		"claimId":      cl.ID,
		"merchantId":   p.MerchantID,
	})
	result := command.Accepted(e, "Redemption", redemption.ID, 1, "CONFIRMED", nil)
	result.Body = map[string]any{"redemptionId": redemption.ID, "status": redemption.Status}
	return result
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

func (s *Service) createSettlements(ctx context.Context, r *Redemption, b *BenefitDefinition) {
	now := s.clock.Now()
	// Proxy subsidy
	if r.ProxySubsidyMinor > 0 {
		_ = s.repo.CreateSettlement(ctx, &Settlement{
			ID:            newID("set_"),
			RedemptionID:  r.ID,
			CampaignID:    r.CampaignID,
			ActorType:     SettlementProxy,
			ActorID:       "proxy",
			AmountMinor:   r.ProxySubsidyMinor,
			Currency:      r.Currency,
			SettledAt:     now,
			CreatedAt:     now,
		})
	}
	// Merchant contribution
	if r.MerchantContribMinor > 0 {
		_ = s.repo.CreateSettlement(ctx, &Settlement{
			ID:            newID("set_"),
			RedemptionID:  r.ID,
			CampaignID:    r.CampaignID,
			ActorType:     SettlementMerchant,
			ActorID:       r.MerchantID,
			AmountMinor:   r.MerchantContribMinor,
			Currency:      r.Currency,
			SettledAt:     now,
			CreatedAt:     now,
		})
	}
	// Staff reward
	if r.StaffRewardMinor > 0 && r.StaffID != "" {
		_ = s.repo.CreateSettlement(ctx, &Settlement{
			ID:            newID("set_"),
			RedemptionID:  r.ID,
			CampaignID:    r.CampaignID,
			ActorType:     SettlementStaff,
			ActorID:       r.StaffID,
			AmountMinor:   r.StaffRewardMinor,
			Currency:      r.Currency,
			SettledAt:     now,
			CreatedAt:     now,
		})
	}
}

func (s *Service) createAttribution(ctx context.Context, cl *Claim, r *Redemption) {
	now := s.clock.Now()
	_ = s.repo.CreateAttributionEdge(ctx, &AttributionEdge{
		ID:               newID("attr_"),
		SourceType:       "merchant",
		SourceID:         r.MerchantID,
		TargetUserID:     cl.UserID,
		CampaignID:       cl.CampaignID,
		RedemptionID:     r.ID,
		AttributionLevel: AttributionVerified,
		EvidenceLevel:    "REDEEMED",
		CreatedAt:        now,
		Version:          1,
	})
}

func (s *Service) appendEvent(ctx context.Context, campaignID, eventType, actorID string, payload map[string]any) {
	_ = s.repo.AppendCampaignEvent(ctx, &CampaignEvent{
		CampaignID: campaignID,
		EventType:  eventType,
		ActorID:    actorID,
		Payload:    payload,
		OccurredAt: s.clock.Now(),
	})
}

func decode(payload any, target any) bool {
	if payload == nil {
		return false
	}
	b, err := jsonMarshal(payload)
	if err != nil {
		return false
	}
	return jsonUnmarshal(b, target) == nil
}

func jsonMarshal(v any) ([]byte, error) {
	// Use encoding/json via a wrapper to avoid import cycle
	return marshalJSON(v)
}

func jsonUnmarshal(b []byte, v any) error {
	return unmarshalJSON(b, v)
}

func newID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func generateClaimToken() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// logging helper
func logWarn(msg string, args ...any) {
	slog.Warn(msg, args...)
}
