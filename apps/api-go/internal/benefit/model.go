// Package benefit implements the Benefit Routing Network (BRN) — Proxy's
// programmable liquidity engine. Benefits are not "coupons" in the traditional
// sense; they are context-aware action triggers that connect the right user,
// creator, merchant, and scene at the right moment.
//
// R0 scope: Campaign → Allocation → Offer → Claim → Redemption → Settlement
package benefit

import (
	"time"
)

// ──────────────────────────────────────────────────────────────
// Campaign
// ──────────────────────────────────────────────────────────────

type CampaignType string

const (
	CampaignSceneIgnition   CampaignType = "SCENE_IGNITION"
	CampaignCreatorSeed     CampaignType = "CREATOR_SEED"
	CampaignNewToScene      CampaignType = "NEW_TO_SCENE"
	CampaignReactivation    CampaignType = "REACTIVATION"
	CampaignNewcomer        CampaignType = "NEWCOMER"
	CampaignActivityAttach  CampaignType = "ACTIVITY_ATTACH"
	CampaignOrderCompletion CampaignType = "ORDER_COMPLETION"
	CampaignCreatorGift     CampaignType = "CREATOR_GIFT"
	CampaignMerchant        CampaignType = "MERCHANT_CAMPAIGN"
)

type CampaignStatus string

const (
	CampaignDraft    CampaignStatus = "DRAFT"
	CampaignReview   CampaignStatus = "REVIEW"
	CampaignScheduled CampaignStatus = "SCHEDULED"
	CampaignActive   CampaignStatus = "ACTIVE"
	CampaignPaused   CampaignStatus = "PAUSED"
	CampaignEnded    CampaignStatus = "ENDED"
	CampaignExhausted CampaignStatus = "EXHAUSTED"
	CampaignCancelled CampaignStatus = "CANCELLED"
)

type Campaign struct {
	ID          string         `json:"campaignId"`
	Type        CampaignType   `json:"type"`
	Status      CampaignStatus `json:"status"`
	OwnerType   string         `json:"ownerType"`   // "proxy" | "merchant" | "creator"
	OwnerID     string         `json:"ownerId"`
	SceneIDs    []string       `json:"sceneIds"`
	Goal        string         `json:"goal"`
	BudgetMinor int64          `json:"budgetMinor"`
	SpentMinor  int64          `json:"spentMinor"`
	Currency    string         `json:"currency"`
	StartAt     time.Time      `json:"startAt"`
	EndAt       time.Time      `json:"endAt"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	Version     int            `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// BenefitDefinition
// ──────────────────────────────────────────────────────────────

type BenefitKind string

const (
	FreeDrink         BenefitKind = "FREE_DRINK"
	FreeMeal          BenefitKind = "FREE_MEAL"
	DiscountPercent   BenefitKind = "DISCOUNT_PERCENT"
	DiscountFixed     BenefitKind = "DISCOUNT_FIXED"
	Gift              BenefitKind = "GIFT"
	Upgrade           BenefitKind = "UPGRADE"
	Voucher           BenefitKind = "VOUCHER"
	ActivityCredit    BenefitKind = "ACTIVITY_CREDIT"
)

type BenefitDefinition struct {
	ID                 string       `json:"benefitId"`
	CampaignID         string       `json:"campaignId"`
	Kind               BenefitKind `json:"kind"`
	Label              string       `json:"label"`
	Description        string       `json:"description,omitempty"`
	RetailValueMinor   int64        `json:"retailValueMinor"`
	UserPayMinor       int64        `json:"userPayMinor"`
	Currency           string       `json:"currency"`
	TermsVersion       string       `json:"termsVersion,omitempty"`
	CreatedAt          time.Time    `json:"createdAt"`
}

// ──────────────────────────────────────────────────────────────
// CapacityPool
// ──────────────────────────────────────────────────────────────

type CapacityPool struct {
	ID               string `json:"poolId"`
	CampaignID       string `json:"campaignId"`
	TotalCapacity    int    `json:"totalCapacity"`
	DailyCapacity    *int   `json:"dailyCapacity,omitempty"`
	TimeslotCapacity *int   `json:"timeslotCapacity,omitempty"`
	Claimed          int    `json:"claimed"`
	Reserved         int    `json:"reserved"`
	Redeemed         int    `json:"redeemed"`
	Date             *string `json:"date,omitempty"` // YYYY-MM-DD for daily tracking
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	Version          int    `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// BenefitAllocation — distributor inventory
// ──────────────────────────────────────────────────────────────

type DistributorType string

const (
	DistributorProxy         DistributorType = "PROXY"
	DistributorMerchant      DistributorType = "MERCHANT"
	DistributorStaff         DistributorType = "STAFF"
	DistributorCreator       DistributorType = "CREATOR"
	DistributorScout         DistributorType = "SCOUT"
	DistributorUserReferral  DistributorType = "USER_REFERRAL"
)

type Allocation struct {
	ID              string          `json:"allocationId"`
	CampaignID      string          `json:"campaignId"`
	BenefitID       string          `json:"benefitId"`
	DistributorType DistributorType `json:"distributorType"`
	DistributorID   string          `json:"distributorId"`
	Quota           int             `json:"quota"`
	Distributed     int             `json:"distributed"`
	Consumed        int             `json:"consumed"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	Version         int             `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// BenefitOffer
// ──────────────────────────────────────────────────────────────

type OfferStatus string

const (
	OfferActive  OfferStatus = "ACTIVE"
	OfferClaimed OfferStatus = "CLAIMED"
	OfferExpired OfferStatus = "EXPIRED"
	OfferRevoked OfferStatus = "REVOKED"
)

type Offer struct {
	ID         string     `json:"offerId"`
	CampaignID string     `json:"campaignId"`
	BenefitID  string     `json:"benefitId"`
	UserID     string     `json:"userId"`
	ContextType string   `json:"contextType"`  // "HOME" | "SCENE" | "POST" | "ACTIVITY" | "PUSH"
	ContextID  string     `json:"contextId"`
	ReasonCode string     `json:"reasonCode"`   // eligibility reason for audit
	Status     OfferStatus `json:"status"`
	OfferedAt  time.Time  `json:"offeredAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	ClaimedAt  *time.Time `json:"claimedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// ──────────────────────────────────────────────────────────────
// BenefitClaim
// ──────────────────────────────────────────────────────────────

type ClaimStatus string

const (
	ClaimClaimed   ClaimStatus = "CLAIMED"
	ClaimReserved  ClaimStatus = "RESERVED"
	ClaimRedeemed  ClaimStatus = "REDEEMED"
	ClaimExpired   ClaimStatus = "EXPIRED"
	ClaimVoid      ClaimStatus = "VOID"
	ClaimReleased  ClaimStatus = "RELEASED"
)

type Claim struct {
	ID             string      `json:"claimId"`
	OfferID        string      `json:"offerId,omitempty"`
	CampaignID     string      `json:"campaignId"`
	BenefitID      string      `json:"benefitId"`
	UserID         string      `json:"userId"`
	ClaimToken     string      `json:"claimToken"`
	Status         ClaimStatus `json:"status"`
	ReservedUntil  *time.Time  `json:"reservedUntil,omitempty"`
	RedeemedAt     *time.Time  `json:"redeemedAt,omitempty"`
	CreatedAt      time.Time   `json:"createdAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
	Version        int         `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// BenefitRedemption
// ──────────────────────────────────────────────────────────────

type RedemptionStatus string

const (
	RedemptionPending   RedemptionStatus = "PENDING"
	RedemptionConfirmed RedemptionStatus = "CONFIRMED"
	RedemptionSettled   RedemptionStatus = "SETTLED"
	RedemptionVoid      RedemptionStatus = "VOID"
	RedemptionFraudHold RedemptionStatus = "FRAUD_HOLD"
)

type Redemption struct {
	ID                  string          `json:"redemptionId"`
	ClaimID             string          `json:"claimId"`
	CampaignID          string          `json:"campaignId"`
	MerchantID          string          `json:"merchantId"`
	StaffID             string          `json:"staffId,omitempty"`
	UserID              string          `json:"userId"`
	RetailValueMinor    int64           `json:"retailValueMinor"`
	UserPayMinor        int64           `json:"userPayMinor"`
	ProxySubsidyMinor   int64           `json:"proxySubsidyMinor"`
	MerchantContribMinor int64          `json:"merchantContributionMinor"`
	CreatorAllocMinor   int64           `json:"creatorAllocationMinor"`
	StaffRewardMinor    int64           `json:"staffRewardMinor"`
	Currency            string          `json:"currency"`
	EvidenceType        string          `json:"evidenceType"`   // "MERCHANT_SCAN" | "ORDER_VERIFIED"
	EvidenceRef         string          `json:"evidenceRef"`
	Status              RedemptionStatus `json:"status"`
	IdempotencyKey      string          `json:"idempotencyKey"`
	RedeemedAt          time.Time       `json:"redeemedAt"`
	SettledAt           *time.Time      `json:"settledAt,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`
	Version             int             `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// SubsidySettlement
// ──────────────────────────────────────────────────────────────

type SettlementActor string

const (
	SettlementProxy    SettlementActor = "PROXY"
	SettlementMerchant SettlementActor = "MERCHANT"
	SettlementCreator  SettlementActor = "CREATOR"
	SettlementPartner  SettlementActor = "PARTNER"
	SettlementStaff    SettlementActor = "STAFF"
	SettlementScout    SettlementActor = "SCOUT"
)

type Settlement struct {
	ID            string          `json:"settlementId"`
	RedemptionID  string          `json:"redemptionId"`
	CampaignID    string          `json:"campaignId"`
	ActorType     SettlementActor `json:"actorType"`
	ActorID       string          `json:"actorId"`
	AmountMinor   int64           `json:"amountMinor"`
	Currency      string          `json:"currency"`
	SettledAt     time.Time       `json:"settledAt"`
	CreatedAt     time.Time       `json:"createdAt"`
}

// ──────────────────────────────────────────────────────────────
// Reward
// ──────────────────────────────────────────────────────────────

type RewardType string

const (
	RewardStaffQualifiedRedemption RewardType = "STAFF_QUALIFIED_REDEMPTION"
	RewardCreatorDistribution      RewardType = "CREATOR_DISTRIBUTION"
	RewardScoutActivation          RewardType = "SCOUT_ACTIVATION"
	RewardScoutTail                RewardType = "SCOUT_TAIL"
	RewardUserReferral             RewardType = "USER_REFERRAL"
	RewardMerchantStaffQuality     RewardType = "MERCHANT_STAFF_QUALITY"
)

type RewardStatus string

const (
	RewardPending   RewardStatus = "PENDING"
	RewardQualified RewardStatus = "QUALIFIED"
	RewardSettled   RewardStatus = "SETTLED"
	RewardReversed  RewardStatus = "REVERSED"
	RewardRejected  RewardStatus = "REJECTED"
	RewardCapped    RewardStatus = "CAPPED"
)

type Reward struct {
	ID              string       `json:"rewardId"`
	CampaignID      string       `json:"campaignId"`
	RedemptionID    string       `json:"redemptionId,omitempty"`
	RewardType      RewardType   `json:"rewardType"`
	BeneficiaryType string       `json:"beneficiaryType"` // "staff" | "creator" | "scout" | "user"
	BeneficiaryID   string       `json:"beneficiaryId"`
	AmountMinor     int64        `json:"amountMinor"`
	Currency        string       `json:"currency"`
	Status          RewardStatus `json:"status"`
	CapRef          string       `json:"capRef,omitempty"`
	CreatedAt       time.Time    `json:"createdAt"`
	SettledAt       *time.Time   `json:"settledAt,omitempty"`
	Version         int          `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// AttributionEdge
// ──────────────────────────────────────────────────────────────

type AttributionLevel string

const (
	AttributionVerified  AttributionLevel = "VERIFIED"
	AttributionAttributed AttributionLevel = "ATTRIBUTED"
	AttributionAssisted  AttributionLevel = "ASSISTED"
	AttributionInferred  AttributionLevel = "INFERRED"
)

type AttributionEdge struct {
	ID               string            `json:"edgeId"`
	SourceType       string            `json:"sourceType"`   // "proxy" | "staff" | "creator" | "scout" | "user_referral"
	SourceID         string            `json:"sourceId"`
	TargetUserID     string            `json:"targetUserId"`
	CampaignID       string            `json:"campaignId"`
	RedemptionID     string            `json:"redemptionId,omitempty"`
	SceneID          string            `json:"sceneId,omitempty"`
	AttributionLevel AttributionLevel  `json:"attributionLevel"`
	EvidenceLevel    string            `json:"evidenceLevel"` // "CLAIMED" | "REDEEMED" | "ORDER" | "VISIT"
	CreatedAt        time.Time         `json:"createdAt"`
	Version          int               `json:"version"`
}

// ──────────────────────────────────────────────────────────────
// CampaignAudience (eligibility rules)
// ──────────────────────────────────────────────────────────────

type CampaignAudience struct {
	CampaignID       string                 `json:"campaignId"`
	EligibilityRules map[string]any         `json:"eligibilityRules"`
	SourceAllowlist  []string               `json:"sourceAllowlist,omitempty"`
	GeoCities        []string               `json:"geoCities,omitempty"`
	LifecyclePreds   map[string]any         `json:"lifecyclePreds,omitempty"`
	CreatedAt        time.Time              `json:"createdAt"`
	UpdatedAt        time.Time              `json:"updatedAt"`
}

// ──────────────────────────────────────────────────────────────
// CampaignEvent (audit trail)
// ──────────────────────────────────────────────────────────────

type CampaignEvent struct {
	ID         int64          `json:"id"`
	CampaignID string         `json:"campaignId"`
	EventType  string         `json:"eventType"`
	ActorID    string         `json:"actorId,omitempty"`
	Payload    map[string]any `json:"payload,omitempty"`
	OccurredAt time.Time      `json:"occurredAt"`
}
