package tagging

import (
	"fmt"
	"strings"
	"testing"
)

func TestShippedTaxonomyLoadsAndIsHealthy(t *testing.T) {
	tx, err := DefaultTaxonomy()
	if err != nil {
		t.Fatalf("the shipped taxonomy must load: %v", err)
	}
	t.Logf("taxonomy: %d active nodes, %d keyword conflicts", tx.Size(), len(tx.Conflicts))
	if tx.Size() < 25 {
		t.Fatalf("at least the root categories: %d", tx.Size())
	}
	// 冲突占比受限：词典越长越要守住「一个词指向一个概念」。
	keywords := 0
	for _, n := range tx.nodes {
		keywords += len(n.Keywords)
	}
	if keywords > 0 && float64(len(tx.Conflicts))/float64(keywords) > 0.03 {
		t.Fatalf("too many ambiguous keywords: %d of %d (%v...)", len(tx.Conflicts), keywords, firstN(tx.Conflicts, 10))
	}
}

func firstN(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func TestTaxonomyRejectsDirtyNodesAndTheRedLine(t *testing.T) {
	ok := Node{ID: "interest", Name: Names{ZH: "兴趣", VI: "Sở thích", EN: "Interests"}}
	child := func(id string, kws ...string) Node {
		return Node{ID: id, Parent: "interest", Name: Names{ZH: "甲", VI: "A", EN: "A"}, Keywords: kws}
	}
	for name, nodes := range map[string][]Node{
		"duplicate id":     {ok, child("interest/a", "甲甲", "aa"), child("interest/a", "乙乙", "bb")},
		"unknown parent":   {ok, {ID: "interest/a/b", Parent: "interest/a", Name: Names{ZH: "甲", VI: "A", EN: "A"}, Keywords: []string{"xx", "yy"}}},
		"not a child path": {ok, {ID: "other/a", Parent: "interest", Name: Names{ZH: "甲", VI: "A", EN: "A"}, Keywords: []string{"xx", "yy"}}},
		"missing english":  {ok, {ID: "interest/a", Parent: "interest", Name: Names{ZH: "甲", VI: "A"}, Keywords: []string{"xx", "yy"}}},
		"one keyword":      {ok, child("interest/a", "甲甲")},
		"bad id chars":     {ok, child("interest/A-b", "甲甲", "aa")},
		"too deep":         {ok, child("interest/a/b/c/d/e", "甲甲", "aa")},
		"red line zh":      {ok, child("interest/a", "夜生活", "nightlife")},
		"red line vi":      {ok, child("interest/a", "mát xa", "spa")},
		"red line en":      {ok, child("interest/a", "massage", "relax")},
	} {
		if _, err := BuildTaxonomy(nodes); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}

func TestTaxonomyMatchesLanguagesAndRollsUpToAncestors(t *testing.T) {
	tx, err := BuildTaxonomy([]Node{
		{ID: "interest", Name: Names{ZH: "兴趣", VI: "Sở thích", EN: "Interests"}},
		{ID: "interest/outdoor", Parent: "interest", Name: Names{ZH: "户外", VI: "Ngoài trời", EN: "Outdoors"}, Keywords: []string{"户外", "outdoor"}},
		{ID: "interest/outdoor/hiking", Parent: "interest/outdoor", Name: Names{ZH: "徒步", VI: "Đi bộ đường dài", EN: "Hiking"}, Keywords: []string{"徒步", "爬山", "hiking", "leo núi", "trail run"}},
		{ID: "interest/pets", Parent: "interest", Name: Names{ZH: "宠物", VI: "Thú cưng", EN: "Pets"}, Keywords: []string{"宠物", "pet", "thú cưng"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for text, want := range map[string]string{
		"周末去爬山":                   "interest/outdoor/hiking",
		"Sunday hiking trip":      "interest/outdoor/hiking",
		"hôm nay leo núi Tam Đảo": "interest/outdoor/hiking",
		"my new TRAIL RUN shoes":  "interest/outdoor/hiking",
	} {
		if got := tx.Match(text); len(got) != 1 || got[0] != want {
			t.Errorf("%q → %v, want %s", text, got, want)
		}
	}
	if got := tx.Match("I bought a carpet"); len(got) != 0 {
		t.Errorf("'pet' must not match inside 'carpet': %v", got)
	}
	exp := tx.Expand([]string{"interest/outdoor/hiking"})
	if exp["interest/outdoor/hiking"] != 1 || exp["interest/outdoor"] != 0.5 || exp["interest"] != 0.25 {
		t.Errorf("ancestors are halved each level: %v", exp)
	}
	if tx.Label("interest/outdoor/hiking") != "徒步" || tx.Label("nope") != "nope" {
		t.Error("labels fall back to the id")
	}
	if got := fmt.Sprint(tx.Size()); got != "4" {
		t.Errorf("size %s", got)
	}
	_ = strings.TrimSpace
}
