package localnet

import "testing"

func TestCanonicalCityKey_ChineseLabels(t *testing.T) {
	cases := map[string]string{
		"河内":   "hanoi",
		"胡志明市": "hcmc",
		"岘港":   "danang",
	}
	for input, want := range cases {
		got := canonicalCityKey(input)
		if got != want {
			t.Fatalf("canonicalCityKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCanonicalCityKey_EnglishAliases(t *testing.T) {
	cases := map[string]string{
		"hn":     "hanoi",
		"Hanoi":  "hanoi",
		"HANOI":  "hanoi",
		"hcmc":   "hcmc",
		"HCM":    "hcmc",
		"Saigon": "hcmc",
		"danang": "danang",
		"Da Nang": "danang",
	}
	for input, want := range cases {
		got := canonicalCityKey(input)
		if got != want {
			t.Fatalf("canonicalCityKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestCanonicalCityKey_EmptyAndUnknown(t *testing.T) {
	cases := map[string]string{
		"":        "",
		"   ":     "",
		"Atlantis": "",
		"河外":      "",
		"London":   "",
	}
	for input, want := range cases {
		got := canonicalCityKey(input)
		if got != want {
			t.Fatalf("canonicalCityKey(%q) = %q, want %q", input, got, want)
		}
	}
}

// R15.22 critical regression: viewer "河内" + post "hn" must match.
func TestCanonicalCityKey_ViewerPostCrossAlias(t *testing.T) {
	if canonicalCityKey("河内") != canonicalCityKey("hn") {
		t.Fatal("viewer '河内' and historical 'hn' must produce same canonical key")
	}
	if canonicalCityKey("河内") != canonicalCityKey("Hanoi") {
		t.Fatal("viewer '河内' and historical 'Hanoi' must produce same canonical key")
	}
	if canonicalCityKey("胡志明市") != canonicalCityKey("HCM") {
		t.Fatal("viewer '胡志明市' and historical 'HCM' must produce same canonical key")
	}
}
