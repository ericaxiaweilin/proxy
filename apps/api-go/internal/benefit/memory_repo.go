package benefit

import (
	"context"
	"sync"
)

// MemoryRepository is an in-memory implementation of Repository for testing.
type MemoryRepository struct {
	mu               sync.RWMutex
	campaigns        map[string]*Campaign
	definitions      map[string]*BenefitDefinition
	capacityPools    map[string]*CapacityPool
	allocations      map[string]*Allocation
	offers           map[string]*Offer
	claims           map[string]*Claim
	claimsByToken    map[string]*Claim
	redemptions      map[string]*Redemption
	redemptionsByKey map[string]*Redemption
	settlements      []*Settlement
	rewards          map[string]*Reward
	attributionEdges []*AttributionEdge
	audiences        map[string]*CampaignAudience
	events           []*CampaignEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		campaigns:        make(map[string]*Campaign),
		definitions:      make(map[string]*BenefitDefinition),
		capacityPools:    make(map[string]*CapacityPool),
		allocations:      make(map[string]*Allocation),
		offers:           make(map[string]*Offer),
		claims:           make(map[string]*Claim),
		claimsByToken:    make(map[string]*Claim),
		redemptions:      make(map[string]*Redemption),
		redemptionsByKey: make(map[string]*Redemption),
		rewards:          make(map[string]*Reward),
		audiences:        make(map[string]*CampaignAudience),
	}
}

// Campaign

func (r *MemoryRepository) CreateCampaign(_ context.Context, c *Campaign) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.campaigns[c.ID] = c
	return nil
}

func (r *MemoryRepository) GetCampaign(_ context.Context, id string) (*Campaign, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.campaigns[id]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	return c, nil
}

func (r *MemoryRepository) ListCampaigns(_ context.Context, opts ListCampaignOpts) ([]Campaign, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Campaign
	for _, c := range r.campaigns {
		if opts.Status != nil && c.Status != *opts.Status {
			continue
		}
		if opts.OwnerType != nil && c.OwnerType != *opts.OwnerType {
			continue
		}
		if opts.OwnerID != nil && c.OwnerID != *opts.OwnerID {
			continue
		}
		result = append(result, *c)
	}
	if opts.Limit > 0 && len(result) > opts.Limit {
		result = result[:opts.Limit]
	}
	return result, nil
}

func (r *MemoryRepository) UpdateCampaign(_ context.Context, c *Campaign) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.campaigns[c.ID] = c
	return nil
}

func (r *MemoryRepository) UpdateCampaignStatus(_ context.Context, id string, status CampaignStatus, version int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.campaigns[id]
	if !ok {
		return ErrCampaignNotFound
	}
	if c.Version != version {
		return ErrVersionConflict
	}
	c.Status = status
	c.Version++
	return nil
}

// BenefitDefinition

func (r *MemoryRepository) CreateBenefitDefinition(_ context.Context, b *BenefitDefinition) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.definitions[b.ID] = b
	return nil
}

func (r *MemoryRepository) GetBenefitDefinition(_ context.Context, id string) (*BenefitDefinition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	b, ok := r.definitions[id]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	return b, nil
}

func (r *MemoryRepository) ListBenefitDefinitionsByCampaign(_ context.Context, campaignID string) ([]BenefitDefinition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []BenefitDefinition
	for _, b := range r.definitions {
		if b.CampaignID == campaignID {
			result = append(result, *b)
		}
	}
	return result, nil
}

// CapacityPool

func (r *MemoryRepository) UpsertCapacityPool(_ context.Context, p *CapacityPool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := p.CampaignID
	if p.Date != nil {
		key = p.CampaignID + ":" + *p.Date
	}
	r.capacityPools[key] = p
	return nil
}

func (r *MemoryRepository) GetCapacityPool(_ context.Context, campaignID string, date *string) (*CapacityPool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := campaignID
	if date != nil {
		key = campaignID + ":" + *date
	}
	p, ok := r.capacityPools[key]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	return p, nil
}

func (r *MemoryRepository) IncrementCapacity(_ context.Context, campaignID string, date *string, claimed, reserved, redeemed int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := campaignID
	if date != nil {
		key = campaignID + ":" + *date
	}
	p, ok := r.capacityPools[key]
	if !ok {
		return nil
	}
	p.Claimed += claimed
	p.Reserved += reserved
	p.Redeemed += redeemed
	return nil
}

// Allocation

func (r *MemoryRepository) CreateAllocation(_ context.Context, a *Allocation) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.allocations[a.ID] = a
	return nil
}

func (r *MemoryRepository) GetAllocation(_ context.Context, id string) (*Allocation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.allocations[id]
	if !ok {
		return nil, ErrAllocationNotFound
	}
	return a, nil
}

func (r *MemoryRepository) ListAllocationsByDistributor(_ context.Context, distType DistributorType, distID string) ([]Allocation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Allocation
	for _, a := range r.allocations {
		if a.DistributorType == distType && a.DistributorID == distID {
			result = append(result, *a)
		}
	}
	return result, nil
}

func (r *MemoryRepository) ListAllocationsByCampaign(_ context.Context, campaignID string) ([]Allocation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Allocation
	for _, a := range r.allocations {
		if a.CampaignID == campaignID {
			result = append(result, *a)
		}
	}
	return result, nil
}

func (r *MemoryRepository) IncrementAllocation(_ context.Context, id string, distributed, consumed int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, ok := r.allocations[id]
	if !ok {
		return ErrAllocationNotFound
	}
	a.Distributed += distributed
	a.Consumed += consumed
	return nil
}

// Offer

func (r *MemoryRepository) CreateOffer(_ context.Context, o *Offer) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.offers[o.ID] = o
	return nil
}

func (r *MemoryRepository) GetOffer(_ context.Context, id string) (*Offer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	o, ok := r.offers[id]
	if !ok {
		return nil, ErrOfferNotFound
	}
	return o, nil
}

func (r *MemoryRepository) ListOffersByUser(_ context.Context, userID string, status *OfferStatus) ([]Offer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Offer
	for _, o := range r.offers {
		if o.UserID == userID {
			if status != nil && o.Status != *status {
				continue
			}
			result = append(result, *o)
		}
	}
	return result, nil
}

func (r *MemoryRepository) UpdateOfferStatus(_ context.Context, id string, status OfferStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, ok := r.offers[id]
	if !ok {
		return ErrOfferNotFound
	}
	o.Status = status
	return nil
}

// Claim

func (r *MemoryRepository) CreateClaim(_ context.Context, c *Claim) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.claims[c.ID] = c
	r.claimsByToken[c.ClaimToken] = c
	return nil
}

func (r *MemoryRepository) GetClaim(_ context.Context, id string) (*Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.claims[id]
	if !ok {
		return nil, ErrClaimNotFound
	}
	return c, nil
}

func (r *MemoryRepository) GetClaimByToken(_ context.Context, token string) (*Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.claimsByToken[token]
	if !ok {
		return nil, ErrClaimTokenInvalid
	}
	return c, nil
}

func (r *MemoryRepository) ListClaimsByUser(_ context.Context, userID string, status *ClaimStatus) ([]Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Claim
	for _, c := range r.claims {
		if c.UserID == userID {
			if status != nil && c.Status != *status {
				continue
			}
			result = append(result, *c)
		}
	}
	return result, nil
}

func (r *MemoryRepository) UpdateClaimStatus(_ context.Context, id string, status ClaimStatus, version int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.claims[id]
	if !ok {
		return ErrClaimNotFound
	}
	if c.Version != version {
		return ErrVersionConflict
	}
	c.Status = status
	c.Version++
	return nil
}

// Redemption

func (r *MemoryRepository) CreateRedemption(_ context.Context, red *Redemption) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.redemptions[red.ID] = red
	r.redemptionsByKey[red.IdempotencyKey] = red
	return nil
}

func (r *MemoryRepository) GetRedemption(_ context.Context, id string) (*Redemption, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	red, ok := r.redemptions[id]
	if !ok {
		return nil, ErrRedemptionNotFound
	}
	return red, nil
}

func (r *MemoryRepository) GetRedemptionByIdempotency(_ context.Context, key string) (*Redemption, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	red, ok := r.redemptionsByKey[key]
	if !ok {
		return nil, ErrRedemptionNotFound
	}
	return red, nil
}

func (r *MemoryRepository) ListRedemptionsByCampaign(_ context.Context, campaignID string) ([]Redemption, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Redemption
	for _, red := range r.redemptions {
		if red.CampaignID == campaignID {
			result = append(result, *red)
		}
	}
	return result, nil
}

func (r *MemoryRepository) UpdateRedemptionStatus(_ context.Context, id string, status RedemptionStatus, version int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	red, ok := r.redemptions[id]
	if !ok {
		return ErrRedemptionNotFound
	}
	if red.Version != version {
		return ErrVersionConflict
	}
	red.Status = status
	red.Version++
	return nil
}

// Settlement

func (r *MemoryRepository) CreateSettlement(_ context.Context, s *Settlement) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.settlements = append(r.settlements, s)
	return nil
}

func (r *MemoryRepository) ListSettlementsByRedemption(_ context.Context, redemptionID string) ([]Settlement, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Settlement
	for _, s := range r.settlements {
		if s.RedemptionID == redemptionID {
			result = append(result, *s)
		}
	}
	return result, nil
}

func (r *MemoryRepository) ListSettlementsByCampaign(_ context.Context, campaignID string) ([]Settlement, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Settlement
	for _, s := range r.settlements {
		if s.CampaignID == campaignID {
			result = append(result, *s)
		}
	}
	return result, nil
}

// Reward

func (r *MemoryRepository) CreateReward(_ context.Context, rew *Reward) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rewards[rew.ID] = rew
	return nil
}

func (r *MemoryRepository) GetReward(_ context.Context, id string) (*Reward, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rew, ok := r.rewards[id]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	return rew, nil
}

func (r *MemoryRepository) ListRewardsByBeneficiary(_ context.Context, beneficiaryType, beneficiaryID string) ([]Reward, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []Reward
	for _, rew := range r.rewards {
		if rew.BeneficiaryType == beneficiaryType && rew.BeneficiaryID == beneficiaryID {
			result = append(result, *rew)
		}
	}
	return result, nil
}

func (r *MemoryRepository) UpdateRewardStatus(_ context.Context, id string, status RewardStatus, version int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	rew, ok := r.rewards[id]
	if !ok {
		return ErrCampaignNotFound
	}
	if rew.Version != version {
		return ErrVersionConflict
	}
	rew.Status = status
	rew.Version++
	return nil
}

// AttributionEdge

func (r *MemoryRepository) CreateAttributionEdge(_ context.Context, e *AttributionEdge) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.attributionEdges = append(r.attributionEdges, e)
	return nil
}

func (r *MemoryRepository) ListAttributionByUser(_ context.Context, userID string) ([]AttributionEdge, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AttributionEdge
	for _, e := range r.attributionEdges {
		if e.TargetUserID == userID {
			result = append(result, *e)
		}
	}
	return result, nil
}

func (r *MemoryRepository) ListAttributionByCampaign(_ context.Context, campaignID string) ([]AttributionEdge, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AttributionEdge
	for _, e := range r.attributionEdges {
		if e.CampaignID == campaignID {
			result = append(result, *e)
		}
	}
	return result, nil
}

// CampaignAudience

func (r *MemoryRepository) UpsertCampaignAudience(_ context.Context, a *CampaignAudience) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.audiences[a.CampaignID] = a
	return nil
}

func (r *MemoryRepository) GetCampaignAudience(_ context.Context, campaignID string) (*CampaignAudience, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.audiences[campaignID]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	return a, nil
}

// CampaignEvent

func (r *MemoryRepository) AppendCampaignEvent(_ context.Context, e *CampaignEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	e.ID = int64(len(r.events) + 1)
	r.events = append(r.events, e)
	return nil
}
