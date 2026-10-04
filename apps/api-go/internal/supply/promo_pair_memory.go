package supply

import (
	"context"
	"sort"
)

// MERCHANT-CREATOR-PROMO-002：内存仓的专属码 / 留痕 / 发券。

func (r *MemoryRepository) pairInit() {
	if r.pairPromos == nil {
		r.pairPromos = map[string]MerchantCreatorPromo{}
	}
	if r.promoIssues == nil {
		r.promoIssues = map[string]PromoIssue{}
	}
}

func (r *MemoryRepository) SaveMerchantCreatorPromo(_ context.Context, p MerchantCreatorPromo) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pairInit()
	r.pairPromos[p.Code] = p
	return nil
}

func (r *MemoryRepository) UpdateMerchantCreatorPromo(_ context.Context, p MerchantCreatorPromo) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pairInit()
	if _, ok := r.pairPromos[p.Code]; !ok {
		return ErrPairPromoNotFound
	}
	r.pairPromos[p.Code] = p
	return nil
}

func (r *MemoryRepository) GetMerchantCreatorPromo(_ context.Context, code string) (MerchantCreatorPromo, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.pairPromos[code]
	if !ok {
		return MerchantCreatorPromo{}, ErrPairPromoNotFound
	}
	return p, nil
}

func (r *MemoryRepository) GetMerchantCreatorPromoByPair(_ context.Context, merchantID, agentID string) (MerchantCreatorPromo, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.pairPromos {
		if p.MerchantID == merchantID && p.AgentID == agentID {
			return p, nil
		}
	}
	return MerchantCreatorPromo{}, ErrPairPromoNotFound
}

func (r *MemoryRepository) listPairPromos(match func(MerchantCreatorPromo) bool) []MerchantCreatorPromo {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []MerchantCreatorPromo{}
	for _, p := range r.pairPromos {
		if match(p) {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func (r *MemoryRepository) ListMerchantCreatorPromosByMerchant(_ context.Context, merchantID string) ([]MerchantCreatorPromo, error) {
	return r.listPairPromos(func(p MerchantCreatorPromo) bool { return p.MerchantID == merchantID }), nil
}

func (r *MemoryRepository) ListMerchantCreatorPromosByAgent(_ context.Context, agentID string) ([]MerchantCreatorPromo, error) {
	return r.listPairPromos(func(p MerchantCreatorPromo) bool { return p.AgentID == agentID }), nil
}

func (r *MemoryRepository) ListMerchantCreatorPromosByCategory(_ context.Context, category string) ([]MerchantCreatorPromo, error) {
	return r.listPairPromos(func(p MerchantCreatorPromo) bool { return p.Terms.Category == category }), nil
}

func (r *MemoryRepository) SavePromoChange(_ context.Context, c PromoChange) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.promoChanges = append(r.promoChanges, c)
	return nil
}

func (r *MemoryRepository) ListPromoChanges(_ context.Context, code string) ([]PromoChange, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []PromoChange{}
	for _, c := range r.promoChanges {
		if c.Code == code {
			out = append(out, c)
		}
	}
	return out, nil
}

func (r *MemoryRepository) SavePromoIssue(_ context.Context, i PromoIssue) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pairInit()
	for _, existing := range r.promoIssues {
		if existing.Code == i.Code && existing.CustomerID == i.CustomerID {
			return ErrPromoAlreadyIssued
		}
	}
	r.promoIssues[i.ID] = i
	return nil
}

func (r *MemoryRepository) GetPromoIssue(_ context.Context, id string) (PromoIssue, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	i, ok := r.promoIssues[id]
	if !ok {
		return PromoIssue{}, ErrPromoIssueNotFound
	}
	return i, nil
}

func (r *MemoryRepository) GetPromoIssueByCustomer(_ context.Context, code, customerID string) (PromoIssue, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, i := range r.promoIssues {
		if i.Code == code && i.CustomerID == customerID {
			return i, nil
		}
	}
	return PromoIssue{}, ErrPromoIssueNotFound
}

func (r *MemoryRepository) listIssues(match func(PromoIssue) bool) []PromoIssue {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []PromoIssue{}
	for _, i := range r.promoIssues {
		if match(i) {
			out = append(out, i)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].IssuedAt.After(out[b].IssuedAt) })
	return out
}

func (r *MemoryRepository) ListPromoIssuesByMerchant(_ context.Context, merchantID string) ([]PromoIssue, error) {
	return r.listIssues(func(i PromoIssue) bool { return i.MerchantID == merchantID }), nil
}

func (r *MemoryRepository) ListPromoIssuesByAgent(_ context.Context, agentID string) ([]PromoIssue, error) {
	return r.listIssues(func(i PromoIssue) bool { return i.AgentID == agentID }), nil
}

func (r *MemoryRepository) ListPromoIssuesByCustomer(_ context.Context, customerID string) ([]PromoIssue, error) {
	return r.listIssues(func(i PromoIssue) bool { return i.CustomerID == customerID }), nil
}
