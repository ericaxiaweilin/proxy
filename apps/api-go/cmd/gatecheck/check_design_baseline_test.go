package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The design-baseline gate exists because comparing an enum against a literal
// makes a typo equal "check disabled". These tests pin that the typo is RED for
// both declared enums, that a missing field reads `undefined` instead of
// silently passing, and that the gate's own source stays baseline-sensitive
// after the port off scripts/check-design-baseline.mjs.

func fixtureJSON(t *testing.T, body string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(body), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestStatusTypoIsRedForBothEnums(t *testing.T) {
	manifest := `{"screenReferences":[
	  {"scope":"home","status":"ACTIVE_SCREEN_REFERENSE","file":"a.html"},
	  {"scope":"feed","status":"FUNCTIONAL_REFERENCE"}]}`
	joined := strings.Join(baselineRules(t.TempDir(), fixtureJSON(t, manifest)), "\n")
	for _, want := range []string{
		`screenReferences[0].status is not a known status: "ACTIVE_SCREEN_REFERENSE" — expected one of ACTIVE_SCREEN_REFERENCE, ACTIVE_IMPLEMENTATION_REFERENCE, FUNCTIONAL_REFERENCE_ONLY`,
		`screenReferences[1].status is not a known status: "FUNCTIONAL_REFERENCE" — expected one of`,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("typo status did not fail red, wanted %q in:\n%s", want, joined)
		}
	}

	contracts := `{"contracts":[{"scope":"home","reference":"a.md","status":"PARTL","implementationFiles":["a.md"]}]}`
	joined = strings.Join(contractRules(t.TempDir(), nil, fixtureJSON(t, contracts)), "\n")
	if !strings.Contains(joined, `contract home has unknown status: "PARTL" — expected one of PARTIAL, SCAFFOLD_ONLY, IMPLEMENTED`) {
		t.Errorf("typo contract status did not fail red:\n%s", joined)
	}
}

func TestAbsentFieldsReadAsUndefinedNotPass(t *testing.T) {
	joined := strings.Join(baselineRules(t.TempDir(), map[string]any{}), "\n")
	for _, want := range []string{
		"baselineRevision must be a positive integer",
		`schemaVersion is not a known schema: undefined — expected one of 1`,
		`global.status is not a known status: undefined — expected one of ACTIVE`,
		`updatedAt must be a YYYY-MM-DD date: undefined`,
		`integration.workspaceMode is not a known mode: undefined`,
		`integration.externalAgentMode is not a known mode: undefined`,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing field was not reported as %q:\n%s", want, joined)
		}
	}
}

func TestKnownGapIsRequiredForEveryUnimplementedStatus(t *testing.T) {
	manifest := `{"screenReferences":[{"scope":"home","status":"ACTIVE_SCREEN_REFERENCE","file":"a.md"}]}`
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.md"), []byte("# a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	contracts := `{"contracts":[{"scope":"home","reference":"a.md","status":"SCAFFOLD_ONLY","implementationFiles":["a.md"]}]}`
	joined := strings.Join(contractRules(root, fixtureJSON(t, manifest), fixtureJSON(t, contracts)), "\n")
	if !strings.Contains(joined, "contract home must describe its gap (status SCAFFOLD_ONLY)") {
		t.Errorf("SCAFFOLD_ONLY without knownGap passed:\n%s", joined)
	}
	// IMPLEMENTED is the only status excused from describing a gap.
	implemented := `{"contracts":[{"scope":"home","reference":"a.md","status":"IMPLEMENTED","implementationFiles":["a.md"]}]}`
	joined = strings.Join(contractRules(root, fixtureJSON(t, manifest), fixtureJSON(t, implemented)), "\n")
	if strings.Contains(joined, "must describe its gap") {
		t.Errorf("IMPLEMENTED should not need a knownGap:\n%s", joined)
	}
}

func TestActiveScopeWithoutContractIsRed(t *testing.T) {
	manifest := `{"screenReferences":[{"scope":"home","status":"ACTIVE_SCREEN_REFERENCE","file":"a.md"}]}`
	joined := strings.Join(contractRules(t.TempDir(), fixtureJSON(t, manifest), map[string]any{}), "\n")
	if !strings.Contains(joined, "active scope has no implementation contract: home") {
		t.Errorf("missing contract passed:\n%s", joined)
	}
}

// gitRepoRoot makes a throwaway repository so the git-backed half of the gate is
// tested without touching the integration workspace.
func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func gitRepoRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	gitIn(t, root, "init", "-q")
	gitIn(t, root, "-c", "user.email=t@example.invalid", "-c", "user.name=fixture", "commit", "-q", "--allow-empty", "-m", "base")
	return root
}

func TestEditingTheGateItselfNeedsAcknowledgement(t *testing.T) {
	root := gitRepoRoot(t)
	// implementationFiles may only name real files: a missing one is its own
	// error and would hide which rule fired.
	implementation := filepath.Join(root, "apps/mobile/src/feed.tsx")
	if err := os.MkdirAll(filepath.Dir(implementation), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(implementation, []byte("export const x = 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	contracts := `{"contracts":[{"scope":"feed","reference":"a.md","status":"IMPLEMENTED","implementationFiles":["apps/mobile/src/feed.tsx"]}]}`
	if err := os.MkdirAll(filepath.Dir(filepath.Join(root, implementationContractsRel)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, implementationContractsRel), []byte(contracts), 0o644); err != nil {
		t.Fatal(err)
	}

	// stage the gate's own source with no baseline / changelog alongside it
	self := filepath.Join(root, designBaselineSelfRel)
	if err := os.MkdirAll(filepath.Dir(self), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(self, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", "--", designBaselineSelfRel)

	joined := strings.Join(errorsOr(gitBackedRules(root, filepath.Join(root, implementationContractsRel),
		fixtureJSON(t, contracts))), "\n")
	if !strings.Contains(joined, "baseline-sensitive implementation changed without design acknowledgement: "+designBaselineSelfRel) {
		t.Fatalf("editing the gate stayed unguarded after the mjs port:\n%s", joined)
	}
}

func TestRealBaselineStillPasses(t *testing.T) {
	root := repoRootForTest(t)
	if err := designBaseline(root, nil); err != nil {
		t.Fatalf("the committed baseline must stay green, got:\n%v", err)
	}
}

func errorsOr(errs []string, err error) []string {
	if err != nil {
		return []string{err.Error()}
	}
	return errs
}
