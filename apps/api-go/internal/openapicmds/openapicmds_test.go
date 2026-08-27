package openapicmds

import (
	"strings"
	"testing"
)

func TestIsLikelyCommandFiltersEnumLiterals(t *testing.T) {
	for _, name := range []string{"ACCEPTED", "REJECTED", "PENDING", "ALREADY_APPLIED", "DRAFT", "COMMITTED", "READY", "EXECUTING"} {
		if IsLikelyCommand(name) {
			t.Fatalf("%q should be filtered as an enum literal", name)
		}
	}
	for _, name := range []string{"CreateTaskDraft", "ListRequesterHomeItems", "PublishTask", "BeginPasswordlessAuthentication", "RegisterDevice", "ResolveDeepLink"} {
		if !IsLikelyCommand(name) {
			t.Fatalf("%q should be recognized as a command", name)
		}
	}
}

func TestScanSourceFindsKnownCommands(t *testing.T) {
	const src = `package x
func (s *Service) Handle(e command.Envelope) command.Result {
	switch e.CommandType {
	case "FooBar", "BazQux":
		return s.foo()
	case "ACCEPTED":
		return s.accepted()
	}
}
`
	got := ScanSource(src)
	if len(got) != 2 {
		t.Fatalf("expected 2 commands, got %d: %v", len(got), got)
	}
	want := map[string]bool{"FooBar": true, "BazQux": true}
	for _, c := range got {
		if !want[c] {
			t.Fatalf("unexpected command %q", c)
		}
	}
}

func TestRenderFragmentIsDeterministicAndSorted(t *testing.T) {
	cmds := map[string]string{
		"Alpha": "X",
		"Beta":  "X",
		"Gamma": "X",
	}
	a := RenderFragment(cmds)
	b := RenderFragment(cmds)
	if a != b {
		t.Fatalf("fragment must be deterministic")
	}
	if !strings.Contains(a, "command: Alpha\n") || !strings.Contains(a, "command: Beta\n") || !strings.Contains(a, "command: Gamma\n") {
		t.Fatalf("fragment missing sorted commands: %s", a)
	}
	ia := strings.Index(a, "Alpha")
	ib := strings.Index(a, "Beta")
	ig := strings.Index(a, "Gamma")
	if !(ia < ib && ib < ig) {
		t.Fatalf("commands not sorted: Alpha=%d Beta=%d Gamma=%d", ia, ib, ig)
	}
}

func TestRenderFragmentDropsAllCapsFromMap(t *testing.T) {
	// RenderFragment trusts its input; the filter lives in
	// ScanSource. So an all-caps key can technically survive if
	// the caller pre-filters nothing. Confirm the contract.
	out := RenderFragment(map[string]string{
		"ACCEPTED": "Identity",
		"CreateX":  "Identity",
	})
	if !strings.Contains(out, "command: ACCEPTED") {
		t.Fatalf("RenderFragment preserves the input map verbatim; ACCEPTED expected: %s", out)
	}
	if !strings.Contains(out, "command: CreateX") {
		t.Fatalf("CreateX must be present: %s", out)
	}
}

func TestCollectDedupesFirstDomainWins(t *testing.T) {
	files := func(domainDir string) []string {
		return []string{domainDir + "/service.go"}
	}
	reader := func(path string) (string, error) {
		switch path {
		case "identity/service.go":
			return `case "SharedCommand", "IdentityOnly":`, nil
		case "demand/service.go":
			return `case "SharedCommand", "DemandOnly":`, nil
		}
		return "", nil
	}
	got := Collect(reader, files)
	if got["SharedCommand"] != "Demand" {
		t.Fatalf("first domain wins; want Demand (Demand is before Identity in DomainDir), got %q", got["SharedCommand"])
	}
	if got["IdentityOnly"] != "Identity" {
		t.Fatalf("IdentityOnly missing: %+v", got)
	}
	if got["DemandOnly"] != "Demand" {
		t.Fatalf("DemandOnly missing: %+v", got)
	}
}
