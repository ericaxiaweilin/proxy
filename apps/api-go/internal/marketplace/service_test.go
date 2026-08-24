package marketplace

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func marketEnvelope(kind, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "cmd_" + kind, CommandType: kind, CommandVersion: 1, Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor}, Target: command.Target{Type: "Market", ID: "local"}, IdempotencyKey: "idem_" + kind + actor, CorrelationID: "corr", RequestedAt: "2026-08-24T00:00:00Z", Payload: payload}
}

func TestOpportunityPublishApplyAndDismiss(t *testing.T) {
	s := New()
	s.SeedDefaults()
	published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00–18:00", "location": "河内 · 西湖", "price": "2,000,000₫", "skills": "中文 · 摄影",
	}))
	if published.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %+v", published)
	}
	var publishBody struct {
		Opportunity Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(published.OperationRef), &publishBody); err != nil {
		t.Fatal(err)
	}

	applied := s.HandleContext(t.Context(), marketEnvelope("ApplyToMarketOpportunity", "creator", map[string]any{"opportunityId": publishBody.Opportunity.ID, "quote": "2,100,000₫", "scope": "中文 · 摄影"}))
	if applied.Outcome != "ACCEPTED" {
		t.Fatalf("apply: %+v", applied)
	}

	listed := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "creator", nil))
	var listBody struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatal(err)
	}
	if len(listBody.Opportunities) == 0 || !listBody.Opportunities[0].Applied || listBody.Opportunities[0].Responses != 1 {
		t.Fatalf("application not reflected: %+v", listBody.Opportunities)
	}

	dismissed := s.HandleContext(t.Context(), marketEnvelope("DismissMarketOpportunity", "creator", map[string]any{"opportunityId": publishBody.Opportunity.ID}))
	if dismissed.Outcome != "ACCEPTED" {
		t.Fatalf("dismiss: %+v", dismissed)
	}
	listed = s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "creator", nil))
	if err := json.Unmarshal([]byte(listed.OperationRef), &listBody); err != nil {
		t.Fatal(err)
	}
	for _, item := range listBody.Opportunities {
		if item.ID == publishBody.Opportunity.ID {
			t.Fatal("dismissed opportunity remained visible")
		}
	}
}
