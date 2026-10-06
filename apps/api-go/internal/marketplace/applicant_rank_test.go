package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/proxy-app/proxy-api/internal/matching"
)

// MARKET-RANK-001：发单方看到的报名列表按撮合口径排，理由是结构化的代码。

func publishAndApply(t *testing.T, s *Service, applicants ...string) string {
	t.Helper()
	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖",
		"price": "800,000₫", "skills": "中文", "lat": 21.05, "lng": 105.82,
	}))
	var body struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &body); err != nil || body.Opportunity.ID == "" {
		t.Fatalf("publish: %+v", published)
	}
	for _, a := range applicants {
		env := marketEnvelope("ApplyToMarketOpportunity", a, map[string]any{"opportunityId": body.Opportunity.ID, "quote": "800,000₫", "scope": "中文"})
		env.IdempotencyKey = "apply_" + a
		if r := s.HandleContext(t.Context(), env); r.Outcome != "ACCEPTED" {
			t.Fatalf("apply %s: %+v", a, r)
		}
	}
	return body.Opportunity.ID
}

func listApplications(t *testing.T, s *Service, id string) []RankedApplication {
	t.Helper()
	r := s.HandleContext(t.Context(), marketEnvelope("ListMarketApplications", "owner", map[string]any{"opportunityId": id}))
	var body struct {
		Applications []RankedApplication `json:"applications"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &body); err != nil {
		t.Fatalf("list: %+v", r)
	}
	return body.Applications
}

func TestApplicantsAreListedInMatchingOrderWithReasons(t *testing.T) {
	s := New()
	km := 2.4
	var gotLat *float64
	s.SetApplicantRanker(func(_ context.Context, ids []string, lat, lng *float64) ([]matching.Ranked, error) {
		gotLat = lat
		// late 报名晚，但履约更好、离得更近：应排第一。
		return []matching.Ranked{
			{AgentID: "late", Breakdown: matching.Breakdown{Total: 90, HasTrackRecord: true, FulfillmentRate: 0.95, SatisfactionRate: 0.9, DistanceKm: &km}},
			{AgentID: "early", Breakdown: matching.Breakdown{Total: 60, NewcomerBoost: 8}},
		}, nil
	})
	id := publishAndApply(t, s, "early", "late")
	apps := listApplications(t, s, id)
	if len(apps) != 2 || apps[0].ApplicantID != "late" || apps[0].Rank != 1 || apps[1].Rank != 2 {
		t.Fatalf("ranked by the engine, not by who applied first: %+v", apps)
	}
	if gotLat == nil || *gotLat != 21.05 {
		t.Fatal("the opportunity's own coordinates are used for the distance term")
	}
	codes := map[string]bool{}
	for _, r := range apps[0].Reasons {
		codes[r.Code] = true
	}
	if !codes["FULFILLMENT_RATE"] || !codes["DISTANCE_KM"] || codes["NEWCOMER"] {
		t.Fatalf("reasons say only what is true of her: %+v", apps[0].Reasons)
	}
	if len(apps[1].Reasons) != 1 || apps[1].Reasons[0].Code != "NEWCOMER" {
		t.Fatalf("a newcomer without a record gets NEWCOMER, not a made-up rate: %+v", apps[1].Reasons)
	}
}

func TestRankingFailureFallsBackToApplyOrder(t *testing.T) {
	s := New()
	s.SetApplicantRanker(func(context.Context, []string, *float64, *float64) ([]matching.Ranked, error) {
		return nil, errors.New("db down")
	})
	id := publishAndApply(t, s, "early", "late")
	apps := listApplications(t, s, id)
	if len(apps) != 2 || apps[0].ApplicantID != "early" || apps[0].Rank != 0 {
		t.Fatalf("the list still opens, in apply order, without ranks: %+v", apps)
	}
}
