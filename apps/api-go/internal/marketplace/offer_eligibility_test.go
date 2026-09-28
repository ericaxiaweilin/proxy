package marketplace

import (
	"encoding/json"
	"testing"
)

// ORDER-SLOT-OWNER-001：机会主人只能给在该机会上报过名的人发档位报价。
func TestOfferEligibility(t *testing.T) {
	s := New()
	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖", "price": "2,000,000₫", "skills": "中文",
	}))
	var body struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &body); err != nil {
		t.Fatalf("publish: %+v", published)
	}
	opportunityID := body.Opportunity.ID
	if r := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "creator", map[string]any{"opportunityId": opportunityID, "quote": "2,100,000₫", "scope": "中文"})); r.Outcome != "ACCEPTED" {
		t.Fatalf("apply: %+v", r)
	}
	cases := []struct {
		owner, agent string
		want         bool
	}{
		{"owner", "creator", true},
		{"owner", "not_applied", false},
		{"someone_else", "creator", false},
	}
	for _, c := range cases {
		got, err := s.OfferEligibility(t.Context(), opportunityID, c.owner, c.agent)
		if err != nil || got != c.want {
			t.Fatalf("OfferEligibility(%q,%q) = %v, %v; want %v", c.owner, c.agent, got, err, c.want)
		}
	}
}
