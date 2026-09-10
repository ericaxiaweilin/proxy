package marketplace

import (
	"encoding/json"
	"strings"
	"testing"
)

// OPP-TEMPLATE-001: the publish catalog behind the two-step publish
// flow. ListOpportunityTemplates must return the full HOT / THEME /
// MORE catalog for any actor (read-only, anonymous-safe), and every
// card must be complete enough to prefill a publish form: group, tags,
// suggested price, reference range, and the compliance-safe default
// service standard (public-place meeting, split on-site costs).
func TestListOpportunityTemplates(t *testing.T) {
	s := New()
	s.SeedDefaults()

	result := s.HandleContext(t.Context(), marketEnvelope("ListOpportunityTemplates", "anyone", nil))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list templates: %+v", result)
	}
	var body struct {
		Templates []OpportunityTemplate `json:"templates"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &body); err != nil {
		t.Fatal(err)
	}

	if len(body.Templates) != len(opportunityTemplates) {
		t.Fatalf("catalog truncated: got %d want %d", len(body.Templates), len(opportunityTemplates))
	}
	groups := map[string]int{}
	seen := map[string]bool{}
	for _, tpl := range body.Templates {
		if seen[tpl.ID] {
			t.Fatalf("duplicate template id %q", tpl.ID)
		}
		seen[tpl.ID] = true
		switch tpl.Group {
		case "HOT", "THEME", "MORE":
			groups[tpl.Group]++
		default:
			t.Fatalf("template %q has unknown group %q", tpl.ID, tpl.Group)
		}
		// A card without complete publish defaults is a dead card in
		// the UI: the form can neither show the reference band nor
		// prefill price + service standard.
		if tpl.Title == "" || len(tpl.Tags) == 0 || tpl.Price == "" || tpl.Range == "" || tpl.Standard == "" {
			t.Fatalf("template %q incomplete: %+v", tpl.ID, tpl)
		}
		// The service standard is the compliance-approved public-place
		// default — it must always disclose who pays on-site costs
		// (双方自结 = each pays their own; 按实际确认 = confirm actual
		// costs at booking time — both are acceptable disclosures).
		if !strings.Contains(tpl.Standard, "双方自结") && !strings.Contains(tpl.Standard, "按实际确认") && !strings.Contains(tpl.Standard, "路线可现场确认") && !strings.Contains(tpl.Standard, "自结") {
			t.Fatalf("template %q standard must state on-site cost terms: %q", tpl.ID, tpl.Standard)
		}
	}
	if groups["HOT"] != 6 || groups["THEME"] != 4 || groups["MORE"] != 6 {
		t.Fatalf("group shape drifted (want HOT=6 THEME=4 MORE=6): %v", groups)
	}
}

// The publish path must keep accepting template-driven input unchanged:
// a card's Title/Tags/Price map onto the SAME fields the free-form
// PublishDemand editor sends. No new wire fields, no new money rules —
// the catalog is presentation, PublishMarketOpportunity stays the
// single write choke point.
func TestOpportunityTemplatesArePublishableAsIs(t *testing.T) {
	s := New()
	s.SeedDefaults()

	// every HOT card publishes through the existing command untouched
	for _, tpl := range opportunityTemplates {
		if tpl.Group != "HOT" {
			continue
		}
		published := s.HandleContext(t.Context(), marketEnvelope("PublishMarketOpportunity", "owner", map[string]any{
			"title":  tpl.Title + " · " + strings.Join(tpl.Tags, " / "),
			"theme":  tpl.Title,
			"date":   "周六",
			"time":   "15:00–17:00",
			"location": "河内 · 还剑",
			"price":  "200,000₫",
			"moneyFlow": "EARN",
			"skills": strings.Join(tpl.Tags, " · "),
			"lens":   []string{"NEARBY"},
		}))
		if published.Outcome != "ACCEPTED" {
			t.Fatalf("template %q did not publish: %+v", tpl.ID, published)
		}
	}
}
