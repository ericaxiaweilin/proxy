package marketplace

import (
	"encoding/json"
	"strings"
	"testing"
)

// OPP-CATALOG-001 (R58): the publish catalog engine — categories over
// the same 16 cards, per-card Moment specs, ratio policy, dynamic
// pricing. Guard tests pin the cross-references so a rename or a new
// card can never produce a dead reference silently.

func TestCatalogCategoriesResolveToRealTemplates(t *testing.T) {
	for _, cat := range templateCategories {
		if len(cat.Items) == 0 {
			t.Fatalf("category %s has no items", cat.ID)
		}
		seen := map[string]bool{}
		for _, id := range cat.Items {
			if seen[id] {
				t.Fatalf("category %s lists %s twice", cat.ID, id)
			}
			seen[id] = true
			if _, ok := resolveTemplate(id); !ok {
				t.Fatalf("category %s references unknown template %s", cat.ID, id)
			}
		}
	}
	// R58 的五档分类必须齐：热门/见面/娱乐/出行/主题
	want := map[string]bool{"hot": false, "meet": false, "fun": false, "outdoor": false, "theme": false}
	for _, cat := range templateCategories {
		if _, ok := want[cat.ID]; ok {
			want[cat.ID] = true
		}
	}
	for id, found := range want {
		if !found {
			t.Fatalf("R58 category rail missing %q", id)
		}
	}
	// “热门”档必须含全部 6 张 HOT 卡（外卖首屏不能少菜）
	hotIDs := map[string]bool{}
	for _, item := range templateCategories[0].Items {
		hotIDs[item] = true
	}
	for _, tpl := range opportunityTemplates {
		if tpl.Group == "HOT" && !hotIDs[tpl.ID] {
			t.Fatalf("HOT card %s missing from the hot category rail", tpl.ID)
		}
	}
}

func TestCatalogSpecsAndPoliciesCoverEveryTemplate(t *testing.T) {
	for _, tpl := range opportunityTemplates {
		spec, ok := momentSpecs[tpl.ID]
		if !ok {
			t.Fatalf("template %s has no Moment specs — dead card in step 2", tpl.ID)
		}
		if len(spec.Groups) == 0 || len(spec.Times) == 0 || len(spec.Durations) == 0 || len(spec.Places) == 0 {
			t.Fatalf("template %s has an empty spec dimension", tpl.ID)
		}
		pol, ok := momentPolicies[tpl.ID]
		if !ok {
			t.Fatalf("template %s has no Moment policy — ratio badge would lie", tpl.ID)
		}
		if pol.Ratio == "" || pol.RatioText == "" {
			t.Fatalf("template %s policy missing ratio text", tpl.ID)
		}
		if len(pol.Groups) == 0 {
			t.Fatalf("template %s policy has no allowed groups", tpl.ID)
		}
		// policy groups must be a subset of spec groups (spec sheet is
		// the rendered truth)
		specGroups := map[string]bool{}
		for _, g := range spec.Groups {
			specGroups[g] = true
		}
		for _, g := range pol.Groups {
			if !specGroups[g] {
				t.Fatalf("policy of %s allows group %q not present in its specs", tpl.ID, g)
			}
		}
		// policy pref options must be non-empty and carry a Value
		for _, pref := range pol.Prefs {
			if pref.Key == "" || pref.Label == "" || len(pref.Options) == 0 {
				t.Fatalf("template %s has a malformed preference row %+v", tpl.ID, pref)
			}
		}
	}
}

func TestCatalogPricingRulesMatchSpecDimensions(t *testing.T) {
	// Cards without a pricing entry are allowed (fixed-price long
	// tail) — but an entry must only reference options the specs offer.
	for id, rule := range pricingRules {
		spec, ok := momentSpecs[id]
		if !ok {
			t.Fatalf("pricing rule for unknown template %s", id)
		}
		dims := map[string]map[string]int{"duration": rule.Duration, "time": rule.Time, "group": rule.Group}
		for dim, table := range dims {
			var allowed map[string]bool
			switch dim {
			case "duration":
				allowed = indexSet(spec.Durations)
			case "time":
				allowed = indexSet(spec.Times)
			case "group":
				allowed = indexSet(spec.Groups)
			}
			for option := range table {
				if !allowed[option] {
					t.Fatalf("pricing %s entry %s references option %q not in specs of %s", id, dim, option, id)
				}
			}
		}
	}
	// per-pair cards must be fixed 1:1 in policy (perPair × non-fixed
	// would double-count)
	if rule, ok := pricingRules["ao-bike-photo"]; ok && rule.PerPair {
		pol := momentPolicies["ao-bike-photo"]
		if !pol.Fixed || pol.Ratio != "1:1" {
			t.Fatalf("perPair pricing on %s requires a fixed 1:1 policy", "ao-bike-photo")
		}
	}
}

func TestCatalogSnapshotSerializesWholeEngine(t *testing.T) {
	snap := buildCatalogSnapshot()
	if len(snap.Templates) != 16 {
		t.Fatalf("catalog snapshot lost cards: got %d", len(snap.Templates))
	}
	if len(snap.Categories) != 5 {
		t.Fatalf("catalog snapshot lost categories: got %d", len(snap.Categories))
	}
	if len(snap.Specs) != 16 || len(snap.Policies) != 16 {
		t.Fatalf("snapshot incomplete: specs=%d policies=%d", len(snap.Specs), len(snap.Policies))
	}
	// OPP-CATALOG-002: the activity line must ship its presets too.
	if len(snap.ActivityPresets) != 6 {
		t.Fatalf("activity presets lost: got %d", len(snap.ActivityPresets))
	}
	seenPreset := map[string]bool{}
	for _, p := range snap.ActivityPresets {
		if seenPreset[p.ID] {
			t.Fatalf("duplicate activity preset %s", p.ID)
		}
		seenPreset[p.ID] = true
		if p.Title == "" || p.Capacity == "" || p.Time == "" || len(p.Tags) == 0 {
			t.Fatalf("activity preset %s incomplete: %+v", p.ID, p)
		}
	}
	// wire shape: the payload must serialize without losing fields
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	var back struct {
		Templates  []OpportunityTemplate `json:"templates"`
		Categories []TemplateCategory    `json:"categories"`
		Specs      []MomentSpecs         `json:"specs"`
		Policies   []MomentPolicy        `json:"policies"`
		Pricing    []PricingRule         `json:"pricing"`
	}
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	if len(back.Categories) == 0 || back.Categories[0].Label != "热门" {
		t.Fatalf("categories lost label in JSON round-trip: %+v", back.Categories[0])
	}
	// Moment spec JSON must keep all four dimensions
	first := back.Specs[0]
	if len(first.Groups) == 0 || len(first.Times) == 0 || len(first.Durations) == 0 || len(first.Places) == 0 {
		t.Fatalf("specs lost dimensions in JSON round-trip: %+v", first)
	}
	if !strings.Contains(string(raw), "ratioText") {
		t.Fatal("policy ratioText missing from wire JSON")
	}
	if !strings.Contains(string(raw), "perPair") {
		t.Fatal("pricing perPair missing from wire JSON")
	}
}

func indexSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[v] = true
	}
	return out
}
