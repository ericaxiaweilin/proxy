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
		Templates    []OpportunityTemplate `json:"templates"`
		Categories   []TemplateCategory    `json:"categories"`
		Specs        []MomentSpecs         `json:"specs"`
		Policies     []MomentPolicy        `json:"policies"`
		Pricing      []PricingRule         `json:"pricing"`
		QualityTiers []QualityTierRule     `json:"qualityTiers"`
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
	if !strings.Contains(string(raw), "upliftPermille") {
		t.Fatal("qualityTiers upliftPermille missing from wire JSON")
	}
	if len(back.QualityTiers) == 0 {
		t.Fatal("qualityTiers lost in JSON round-trip")
	}
	// CATALOG-NULL-ARRAY-001（2026-10-07）：wire 上不许出现 `"prefs":null`。
	//
	// Go 把 nil slice 编成 `null`，契约里 prefs 是「数组或不存在」—— `null` 会让
	// 客户端**整包** safeParse 失败：listCatalog() 直接抛，market.tsx 的动态报价卡
	// 和发布向导的系统算价一起静默降级成「算不出价」。两处都是优雅降级，所以这个
	// 缺陷可以一直没人发现 —— 实测 movie / sport / translate 三条就是 nil。
	// 钉在**序列化后的字节**上，不钉 Prefs 字段：断言的是客户端真正收到的东西。
	if strings.Contains(string(raw), `"prefs":null`) {
		t.Fatal(`catalog wire JSON contains "prefs":null — 客户端整包校验会失败，价格引擎静默降级`)
	}
	// 正面：三条无偏好的模板必须以**空数组**出现（既不是 null，也不是被省略 ——
	// 省略会掩盖「这条本来就没偏好」这个事实）。
	if !strings.Contains(string(raw), `"prefs":[]`) {
		t.Fatal(`catalog wire JSON lost the empty-prefs array form`)
	}
}

// DEMAND-PRICE-ENGINE-001：资历档是**运营策略**，写错了会直接改钱 ——
// 这条钉住表本身的形状，不钉具体阈值（阈值就是要能随时调的）。
func TestQualityTierTableIsWellFormed(t *testing.T) {
	if len(qualityTiers) == 0 {
		t.Fatal("qualityTiers is empty — 履约/评分奖励没接上")
	}
	seenKey := map[string]bool{}
	seenLabel := map[string]bool{}
	for i, tier := range qualityTiers {
		if tier.Key == "" || tier.Label == "" {
			t.Fatalf("tier missing key/label: %+v", tier)
		}
		if seenKey[tier.Key] {
			t.Fatalf("duplicate tier key %s", tier.Key)
		}
		if seenLabel[tier.Label] {
			t.Fatalf("duplicate tier label %s（档位名要能区分，否则用户看不出贵在哪）", tier.Label)
		}
		seenKey[tier.Key] = true
		seenLabel[tier.Label] = true
		// 上浮必须是**正数**：这是给干得好的人的奖励，不是惩罚。
		if tier.UpliftPermille <= 0 {
			t.Fatalf("tier %s uplift must be positive, got %d", tier.Key, tier.UpliftPermille)
		}
		if tier.MinFulfillment < 0 || tier.MinFulfillment > 1 || tier.MinSatisfaction < 0 || tier.MinSatisfaction > 1 {
			t.Fatalf("tier %s rates must be 0..1: %+v", tier.Key, tier)
		}
		if tier.MinOrders < 1 {
			t.Fatalf("tier %s must require a real order count, got %d（无成交记录不许定级）", tier.Key, tier.MinOrders)
		}
		// 顺序即优先级（首个命中生效）⇒ 必须从高到低，否则低档会吃掉高档。
		// 从高到低 = 门槛**单调不升**：后一档的门槛不许比前一档更严。
		if i > 0 {
			prev := qualityTiers[i-1]
			if tier.MinOrders > prev.MinOrders || tier.MinFulfillment > prev.MinFulfillment {
				t.Fatalf("qualityTiers must be ordered best-first; %s breaks the order", tier.Key)
			}
		}
	}
}

func indexSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, v := range values {
		out[v] = true
	}
	return out
}
