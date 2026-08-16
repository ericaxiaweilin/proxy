package supply

import (
	"context"
	"errors"

	"github.com/proxy-app/proxy-api/internal/citycompanion"
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
	return result, nil
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
