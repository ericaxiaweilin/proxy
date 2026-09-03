package benefit

import (
	"context"
)

// Repository defines the persistence interface for the Benefit Routing Network.
// Implementations can be in-memory (tests) or PostgreSQL (production).
type Repository interface {
	// Campaign
	CreateCampaign(ctx context.Context, c *Campaign) error
	GetCampaign(ctx context.Context, id string) (*Campaign, error)
	ListCampaigns(ctx context.Context, opts ListCampaignOpts) ([]Campaign, error)
	UpdateCampaign(ctx context.Context, c *Campaign) error
	UpdateCampaignStatus(ctx context.Context, id string, status CampaignStatus, version int) error

	// BenefitDefinition
	CreateBenefitDefinition(ctx context.Context, b *BenefitDefinition) error
	GetBenefitDefinition(ctx context.Context, id string) (*BenefitDefinition, error)
	ListBenefitDefinitionsByCampaign(ctx context.Context, campaignID string) ([]BenefitDefinition, error)

	// CapacityPool
	UpsertCapacityPool(ctx context.Context, p *CapacityPool) error
	GetCapacityPool(ctx context.Context, campaignID string, date *string) (*CapacityPool, error)
	IncrementCapacity(ctx context.Context, campaignID string, date *string, claimed, reserved, redeemed int) error

	// Allocation
	CreateAllocation(ctx context.Context, a *Allocation) error
	GetAllocation(ctx context.Context, id string) (*Allocation, error)
	ListAllocationsByDistributor(ctx context.Context, distType DistributorType, distID string) ([]Allocation, error)
	ListAllocationsByCampaign(ctx context.Context, campaignID string) ([]Allocation, error)
	IncrementAllocation(ctx context.Context, id string, distributed, consumed int) error

	// Offer
	CreateOffer(ctx context.Context, o *Offer) error
	GetOffer(ctx context.Context, id string) (*Offer, error)
	ListOffersByUser(ctx context.Context, userID string, status *OfferStatus) ([]Offer, error)
	UpdateOfferStatus(ctx context.Context, id string, status OfferStatus) error

	// Claim
	CreateClaim(ctx context.Context, c *Claim) error
	GetClaim(ctx context.Context, id string) (*Claim, error)
	GetClaimByToken(ctx context.Context, token string) (*Claim, error)
	ListClaimsByUser(ctx context.Context, userID string, status *ClaimStatus) ([]Claim, error)
	UpdateClaimStatus(ctx context.Context, id string, status ClaimStatus, version int) error

	// Redemption
	CreateRedemption(ctx context.Context, r *Redemption) error
	GetRedemption(ctx context.Context, id string) (*Redemption, error)
	GetRedemptionByIdempotency(ctx context.Context, key string) (*Redemption, error)
	ListRedemptionsByCampaign(ctx context.Context, campaignID string) ([]Redemption, error)
	UpdateRedemptionStatus(ctx context.Context, id string, status RedemptionStatus, version int) error

	// Settlement
	CreateSettlement(ctx context.Context, s *Settlement) error
	ListSettlementsByRedemption(ctx context.Context, redemptionID string) ([]Settlement, error)
	ListSettlementsByCampaign(ctx context.Context, campaignID string) ([]Settlement, error)

	// Reward
	CreateReward(ctx context.Context, r *Reward) error
	GetReward(ctx context.Context, id string) (*Reward, error)
	ListRewardsByBeneficiary(ctx context.Context, beneficiaryType, beneficiaryID string) ([]Reward, error)
	UpdateRewardStatus(ctx context.Context, id string, status RewardStatus, version int) error

	// AttributionEdge
	CreateAttributionEdge(ctx context.Context, e *AttributionEdge) error
	ListAttributionByUser(ctx context.Context, userID string) ([]AttributionEdge, error)
	ListAttributionByCampaign(ctx context.Context, campaignID string) ([]AttributionEdge, error)

	// CampaignAudience
	UpsertCampaignAudience(ctx context.Context, a *CampaignAudience) error
	GetCampaignAudience(ctx context.Context, campaignID string) (*CampaignAudience, error)

	// CampaignEvent
	AppendCampaignEvent(ctx context.Context, e *CampaignEvent) error
}

type ListCampaignOpts struct {
	Status *CampaignStatus
	OwnerType *string
	OwnerID *string
	Limit  int
	Offset int
}
