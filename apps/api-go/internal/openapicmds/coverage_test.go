package openapicmds

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
)

// OPENAPI-COMMAND-COVERAGE-001.
//
// `go run ./cmd/openapi-commands -check` cannot catch a missing command.
// It compares the committed YAML against a FRESH RUN OF THE SAME SCANNER, so
// whatever the scanner cannot see, it cannot miss: the two sides are short of
// the very same entry and the check is green all the way down.
//
// That is exactly what happened twice:
//   - OPENAPI-DOMAIN-001 (2026-09-14): seven domains were absent from
//     DomainDir, so 25 commands dispatched fine and appeared nowhere.
//   - this one: realityscene WAS registered, but dispatched five of its eight
//     commands with `if e.CommandType == "X"` and a map lookup instead of
//     `case "X":`. The scanner only matches lines starting with `case`.
//
// So this test does not go through the scanner at all. It reads each domain's
// `Supports()` — the set the dispatcher will actually route — and asserts every
// one of those names is present in what the scanner published. A command that
// is supported but not published is a half-wire: the server answers it, every
// unit test is green, and no consumer can ever discover it from the contract.

var supportsFuncPattern = regexp.MustCompile(`(?m)^func\s*\(\s*\w*\s*\*?Service\s*\)\s*Supports\s*\([^)]*\)\s*bool\s*\{`)
var supportsQuotedPattern = regexp.MustCompile(`"([A-Z][A-Za-z0-9]+)"`)

// supportedCommands returns every CamelCase string literal in the body of a
// domain service's `Supports()`. Both shapes used in this repo are covered:
// `switch t { case "A", "B": }` and `return t == "A" || t == "B"`.
func supportedCommands(src string) []string {
	var out []string
	for _, m := range supportsFuncPattern.FindAllStringSubmatchIndex(src, -1) {
		body := braceBody(src, m[1])
		for _, q := range supportsQuotedPattern.FindAllStringSubmatch(body, -1) {
			out = append(out, q[1])
		}
	}
	return out
}

// braceBody returns the text between the opening brace at open (exclusive) and
// its matching close brace (exclusive).
func braceBody(src string, open int) string {
	depth := 0
	for i := open - 1; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return src[open:i]
			}
		}
	}
	return src[open:]
}

func repoRootForTest(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(filepath.Join(dir, "apps", "api-go", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("could not find the monorepo root above the openapicmds package")
	return ""
}

func TestEverySupportedCommandIsPublished(t *testing.T) {
	root := repoRootForTest(t)
	internalDir := filepath.Join(root, "apps", "api-go", "internal")

	reader := func(path string) (string, error) {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	files := func(domainDir string) []string {
		candidate := filepath.Join(internalDir, domainDir, "service.go")
		if _, err := os.Stat(candidate); err != nil {
			return nil
		}
		return []string{candidate}
	}
	published := Collect(reader, files)

	// Positive controls: a walker that silently inspects nothing would
	// otherwise report success. These must fail loudly instead.
	if len(published) < 200 {
		t.Fatalf("scanner only published %d commands across %d domains — "+
			"this test is not looking at the real tree, so it proves nothing",
			len(published), len(DomainDir))
	}

	// Walk the DIRECTORIES ON DISK, not DomainDir.
	//
	// Iterating DomainDir here would reproduce the very bug this test exists
	// to catch: `Collect` also iterates DomainDir, so a domain that fell out of
	// the registry would be skipped by both loops and the test would stay green
	// while its commands vanished from the contract. Verified by injection —
	// that version really did stay green.
	entries, err := os.ReadDir(internalDir)
	if err != nil {
		t.Fatalf("read internal dir: %v", err)
	}
	checked := 0
	var missing []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		src, err := reader(filepath.Join(internalDir, entry.Name(), "service.go"))
		if err != nil {
			continue
		}
		checked++
		for _, name := range supportedCommands(src) {
			if !IsLikelyCommand(name) {
				continue
			}
			if _, ok := published[name]; !ok {
				missing = append(missing, entry.Name()+" "+name)
			}
		}
	}
	if checked < 20 {
		t.Fatalf("only inspected %d of %d domain services — this test proves nothing",
			checked, len(DomainDir))
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("%d command(s) the dispatcher routes never reach the OpenAPI contract:\n  %v\n"+
			"They dispatch fine and every unit test stays green; the drift check cannot see them "+
			"either. Dispatch them from a `case \"X\":` arm (see internal/realityscene/service.go).",
			len(missing), missing)
	}
}

// TestRealitySceneCommandsAllReachTheContract is the named regression for the
// bug this block was written for. It is redundant with the generic test above
// ON PURPOSE: the generic one says "something is missing", this one names the
// five that went missing, so the failure is readable in CI.
func TestRealitySceneCommandsAllReachTheContract(t *testing.T) {
	root := repoRootForTest(t)
	src, err := os.ReadFile(filepath.Join(root, "apps", "api-go", "internal", "realityscene", "service.go"))
	if err != nil {
		t.Fatalf("read realityscene service: %v", err)
	}
	want := []string{
		"ListMyRealitySceneState",
		"SetRealitySceneSaved",
		"SetRealityScenePlanned",
		"SetPrivateRealitySceneVisited",
		"SetRealitySceneCheckIn",
		"ProposeRealityScene",
		"ConfirmRealitySceneProposal",
		"ListRealitySceneProposals",
	}
	found := make(map[string]bool)
	for _, n := range supportedCommands(string(src)) {
		found[n] = true
	}
	for _, n := range want {
		if !found[n] {
			t.Fatalf("realityscene no longer supports %s — the Supports() contract changed", n)
		}
	}
	// And each one must be reachable by the scanner, i.e. dispatched from a
	// `case` arm rather than an `if` or a map lookup.
	scanned := make(map[string]bool)
	for _, n := range ScanSource(string(src)) {
		scanned[n] = true
	}
	for _, n := range want {
		if !scanned[n] {
			t.Fatalf("%s is supported but the scanner cannot see it — dispatch it from a "+
				"`case \"%s\":` arm, not `if e.CommandType == \"%s\"`", n, n, n)
		}
	}
}
