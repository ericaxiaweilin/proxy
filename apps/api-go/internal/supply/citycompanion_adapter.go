package supply

import (
	"context"
	"errors"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
	"github.com/proxy-app/proxy-api/internal/matching"
)

// CityCompanionSupplier 实现 citycompanion.Supplier：真实供给查询。
// 把城市同行需求翻译成 SupplyQuery，返回真实合格 Agent。
type CityCompanionSupplier struct {
	service *Service
}

func NewCityCompanionSupplier(service *Service) *CityCompanionSupplier {
	return &CityCompanionSupplier{service: service}
}

func (s *CityCompanionSupplier) QueryEligibleCandidates(ctx context.Context, query citycompanion.CandidateQuery) ([]citycompanion.SupplyCandidate, error) {
	if s.service == nil {
		return nil, errors.New("supply service not configured")
	}
	// 语言 → 能力（中文要求=ZH，越南语=VI）；CITY_GUIDE 不强制（能力硬要求=语言）
	capabilities := append([]string{}, query.Capabilities...)
	if query.Language != "" && query.Language != "any" {
		switch query.Language {
		case "zh":
			capabilities = append(capabilities, "ZH")
		case "vi":
			capabilities = append(capabilities, "VI")
		default:
			capabilities = append(capabilities, query.Language)
		}
	}
	q := SupplyQuery{
		MarketID:     query.MarketID,
		StartAt:      query.StartAt,
		DurationH:    query.DurationH,
		ServiceType:  "CITY_COMPANION",
		Languages:    langList(query.Language),
		Capabilities: capabilities,
	}
	profiles, err := s.service.repository.ProfilesSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	result := []citycompanion.SupplyCandidate{}
	for _, profile := range profiles {
		if profile.Status != "ACTIVE" {
			continue
		}
		snap, err := s.service.evaluateEligibility(ctx, profile.AgentID, q)
		if err != nil || !snap.Eligible {
			continue
		}
		svc, err := s.service.repository.GetService(ctx, profile.AgentID, "CITY_COMPANION")
		if err != nil {
			continue
		}
		caps, _ := s.service.repository.GetCapabilities(ctx, profile.AgentID)
		verified := []string{}
		for _, c := range caps {
			if c.Verified {
				verified = append(verified, c.Capability)
			}
		}
		result = append(result, citycompanion.SupplyCandidate{
			AgentID:        profile.AgentID,
			Name:           profile.Name,
			Languages:      profile.Languages,
			ReferencePrice: svc.ReferencePrice,
			Currency:       svc.Currency,
			VerifiedCaps:   verified,
		})
	}
	return rankCityCompanion(ctx, s.service, result, query.BudgetVND), nil
}

// rankCityCompanion：MATCH-RANK-001 —— 按真实履约 / 需求方评价 / 经验 / 引力响应 / 预算适配排序，
// 并带上真实的履约率 / 满意率 / 完成单量（以前是写死的 0.97 / 0.95 / 0 单，候选也不排序）。
func rankCityCompanion(ctx context.Context, service *Service, candidates []citycompanion.SupplyCandidate, budget int64) []citycompanion.SupplyCandidate {
	ids := make([]string, 0, len(candidates))
	prices := map[string]int64{}
	byID := map[string]citycompanion.SupplyCandidate{}
	for _, c := range candidates {
		ids = append(ids, c.AgentID)
		prices[c.AgentID] = c.ReferencePrice
		byID[c.AgentID] = c
	}
	signals := service.rankSignals(ctx, ids)
	ranked := matching.Rank(ids, prices, signals, budget)
	out := make([]citycompanion.SupplyCandidate, 0, len(ranked))
	for _, r := range ranked {
		c := byID[r.AgentID]
		breakdown := r.Breakdown
		c.Ranking = &breakdown
		c.FulfillmentRate = breakdown.FulfillmentRate
		c.SatisfactionRate = breakdown.SatisfactionRate
		c.CompletedOrders = signals[r.AgentID].Completed
		c.HasTrackRecord = breakdown.HasTrackRecord
		out = append(out, c)
	}
	return out
}

func langList(language string) []string {
	if language == "" || language == "any" {
		return nil
	}
	switch language {
	case "zh":
		return []string{"ZH"}
	case "vi":
		return []string{"VI"}
	default:
		return []string{language}
	}
}
