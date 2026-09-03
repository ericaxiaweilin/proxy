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
	repo     Repository
	clock    Clock
}

type Clock interface {
	Now() time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now().UTC() }

func NewService(repo Repository) *Service {
	return &Service{repo: repo, clock: systemClock{}}
}

func NewServiceWithClock(repo Repository, clock Clock) *Service {
	return &Service{repo: repo, clock: clock}
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
