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

// R15.x: when the mobile client passes a foreground-location
// fix to ListMarketOpportunities, the server must recompute
// Travel from haversine distance, not echo the editor's seeded
// placeholder. Without this, NEARBY / RECOMMEND sort order is
// the same for everyone regardless of where they actually are,
// which is the 'NEARBY 还是旧版' bug that the user reported.
func TestListMarketOpportunitiesRecomputesTravelFromUserLocation(t *testing.T) {
	s := New()
	s.SeedDefaults()
	// A viewer 0 km from Hoàn Kiếm should see a much shorter
	// Travel to biz_negotiation (Hoàn Kiếm) than to supplier_visit
	// (Bắc Ninh). With the seeded 18/52 min values, the Bắc Ninh
	// row would dominate even when the viewer is in central Hanoi.
	resp := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "viewer", map[string]any{
		"userLat": 21.0285,
		"userLng": 105.8542,
	}))
	if resp.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", resp)
	}
	var body struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(resp.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	var hk *Opportunity
	var bn *Opportunity
	for i := range body.Opportunities {
		switch body.Opportunities[i].ID {
		case "biz_negotiation":
			hk = &body.Opportunities[i]
		case "supplier_visit":
			bn = &body.Opportunities[i]
		}
	}
	if hk == nil || bn == nil {
		t.Fatal("seeded rows missing")
	}
	if hk.Travel == nil || bn.Travel == nil {
		t.Fatal("Travel was not recomputed for one or both rows")
	}
	if hk.TravelSource != "user_distance" || bn.TravelSource != "user_distance" {
		t.Fatalf("TravelSource not user_distance: hk=%q bn=%q", hk.TravelSource, bn.TravelSource)
	}
	if *hk.Travel >= *bn.Travel {
		t.Fatalf("central-Hanoi viewer should see shorter Travel to Hoàn Kiếm (%d min) than to Bắc Ninh (%d min)", *hk.Travel, *bn.Travel)
	}
	if *hk.Travel < 1 || *hk.Travel > 5 {
		t.Fatalf("Hoàn Kiếm → Hoàn Kiếm Travel should be 1–5 min, got %d", *hk.Travel)
	}
	if *bn.Travel < 25 || *bn.Travel > 45 {
		t.Fatalf("Hanoi → Bắc Ninh Travel should be 25–45 min, got %d", *bn.Travel)
	}
}

// R15.x: when no user fix is supplied, the seeded Travel stays
// in place. The mobile list view calls list() before GPS is
// granted; the order must be the existing seed order, not a
// zero-everything fallback.
func TestListMarketOpportunitiesPreservesSeededTravelWithoutUserFix(t *testing.T) {
	s := New()
	s.SeedDefaults()
	resp := s.HandleContext(t.Context(), marketEnvelope("ListMarketOpportunities", "viewer", nil))
	if resp.Outcome != "ACCEPTED" {
		t.Fatalf("list: %+v", resp)
	}
	var body struct {
		Opportunities []Opportunity `json:"opportunities"`
	}
	if err := json.Unmarshal([]byte(resp.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	for _, item := range body.Opportunities {
		if item.TravelSource != "seeded" {
			t.Fatalf("row %s should be tagged seeded, got %q", item.ID, item.TravelSource)
		}
	}
}

// R15.x: readUserFix rejects garbage input (out-of-range,
// (0,0) sentinel, missing fields). A bad fix must not crash
// the list and must not poison the seeded Travel.
func TestReadUserFixRejectsGarbage(t *testing.T) {
	cases := map[string]map[string]any{
		"nil payload":        nil,
		"empty payload":      {},
		"only userLat":       {"userLat": 21.0},
		"only userLng":       {"userLng": 105.0},
		"lat out of range":   {"userLat": 999.0, "userLng": 105.0},
		"lng out of range":   {"userLat": 21.0, "userLng": -999.0},
		"sentinel (0,0)":     {"userLat": 0.0, "userLng": 0.0},
		"lat as string":      {"userLat": "21.0", "userLng": 105.0},
	}
	for name, payload := range cases {
		if _, _, ok := readUserFix(payload); ok {
			t.Fatalf("%s: expected ok=false, got true", name)
		}
	}
	// A valid Vietnamese fix must be accepted.
	lat, lng, ok := readUserFix(map[string]any{"userLat": 21.0285, "userLng": 105.8542})
	if !ok || lat != 21.0285 || lng != 105.8542 {
		t.Fatalf("valid Hanoi fix rejected: lat=%v lng=%v ok=%v", lat, lng, ok)
	}
}

func TestHaversineKnownDistances(t *testing.T) {
	// Hanoi (Hoàn Kiếm) ↔ Bắc Ninh (Yên Phong) is ~20 km by road;
	// the great-circle distance is in the 16–18 km band.
	d := haversineKm(21.0285, 105.8542, 21.1600, 105.9600)
	if d < 14 || d > 22 {
		t.Fatalf("Hanoi–Bắc Ninh great-circle distance should be 14–22 km, got %.1f", d)
	}
	// Same point to itself is 0 km.
	if d2 := haversineKm(21.0285, 105.8542, 21.0285, 105.8542); d2 > 0.01 {
		t.Fatalf("self-distance should be 0, got %.3f", d2)
	}
}
