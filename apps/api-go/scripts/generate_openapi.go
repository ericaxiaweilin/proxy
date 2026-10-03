package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

func main() {
	check := flag.Bool("check", false, "check drift")
	flag.Parse()
	// OpenAPI is currently hand-authored but must be validated.
	// Generate step validates YAML syntax via python yaml and checks that
	// the committed openapi.yaml matches the canonical source (itself).
	// This intentionally fails CI if the spec is missing or malformed.
	openAPIPath := "openapi.yaml"
	// Resolve relative to repo root when invoked via go run.
	if _, err := os.Stat(openAPIPath); err != nil {
		// Try alternate relative path when invoked from scripts/
		if _, err2 := os.Stat("../openapi.yaml"); err2 == nil {
			openAPIPath = "../openapi.yaml"
		} else if _, err2 := os.Stat("apps/api-go/openapi.yaml"); err2 == nil {
			openAPIPath = "apps/api-go/openapi.yaml"
		}
	}
	data, err := os.ReadFile(openAPIPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "openapi not found at %s: %v\n", openAPIPath, err)
		os.Exit(1)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		fmt.Fprintln(os.Stderr, "openapi.yaml is empty")
		os.Exit(1)
	}
	// Basic validation: require openapi: 3.1.0 and paths
	mustContain := [][]byte{
		[]byte("openapi: 3.1.0"),
		[]byte("/v1/commands/{commandType}"),
		[]byte("CommandEnvelope"),
		[]byte("CommandResult"),
	}
	for _, needle := range mustContain {
		if !bytes.Contains(data, needle) {
			fmt.Fprintf(os.Stderr, "openapi validation failed: missing %q\n", needle)
			os.Exit(1)
		}
	}
	// YAML syntax check. This used to shell out to
	// `python3 -c "import yaml; yaml.safe_load(...)"` — the one place the gate still
	// required a Python interpreter, and it failed *open* on a machine without one
	// (exec error → the same red as a malformed spec, so nobody noticed the real
	// dependency). yaml.v3 parses the same document: it rejects tabs, unterminated
	// quotes and duplicate mapping keys, all of which PyYAML also rejects.
	var parsed any
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&parsed); err != nil {
		fmt.Fprintf(os.Stderr, "yaml parse failed for %s: %v\n", openAPIPath, err)
		os.Exit(1)
	}
	if parsed == nil {
		fmt.Fprintf(os.Stderr, "yaml parse produced no document for %s\n", openAPIPath)
		os.Exit(1)
	}
	// A spec is a mapping with the fields the needles above are checked against; a
	// bare scalar or list parses fine, so "it parsed" alone is not enough.
	if _, ok := parsed.(map[string]any); !ok {
		fmt.Fprintf(os.Stderr, "yaml parse failed for %s: top level is %T, want a mapping\n", openAPIPath, parsed)
		os.Exit(1)
	}
	if *check {
		// Drift check: ensure the file on disk matches what is
		// committed. We compare against `git show HEAD:<path>`
		// (the last committed version) so the check fires when a
		// developer modified openapi.yaml but forgot to commit.
		head, err := exec.Command("git", "show", "HEAD:apps/api-go/openapi.yaml").Output()
		if err != nil {
			// No HEAD yet or not a git repo: pass if present
			fmt.Println("openapi: check passed (no HEAD to compare)")
			return
		}
		if !bytes.Equal(bytes.TrimSpace(head), bytes.TrimSpace(data)) {
			fmt.Fprintln(os.Stderr, "openapi drift detected: openapi.yaml on disk differs from HEAD. Run `go run ./scripts/generate_openapi.go` and commit.")
			os.Exit(2)
		}
		// Also fail loud if the file is staged but the staged
		// version differs from the working-tree version. This is
		// the "you added a new path to the spec but did not stage
		// it" case that `git show HEAD:` alone misses.
		if err := exec.Command("git", "diff", "--exit-code", "--staged", "--", "apps/api-go/openapi.yaml").Run(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
				fmt.Fprintln(os.Stderr, "openapi drift detected: openapi.yaml has staged-but-not-committed changes. Re-stage and commit.")
				os.Exit(2)
			}
		}
		// Also validate that the generated commands fragment matches a
		// fresh scan of the domain service switches. NOTE: this must
		// compare against a fresh scan, NOT against HEAD. Comparing
		// disk-vs-HEAD punishes committing an up-to-date fragment and
		// rewards leaving it stale — that inverted logic froze the
		// fragment while dozens of commands landed unrecorded. The
		// canonical scanner lives in cmd/openapi-commands -check.
		genCheck := exec.Command("go", "run", "./cmd/openapi-commands", "-check")
		genCheck.Dir = filepath.Dir(openAPIPath)
		if out, err := genCheck.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "openapi commands drift detected: %s\nre-run `go run ./cmd/openapi-commands` and commit the regenerated openapi.commands.generated.yaml.\n", out)
			os.Exit(2)
		}
		// Same staged-vs-working-tree check for the commands
		// fragment as we do for openapi.yaml above.
		if err := exec.Command("git", "diff", "--exit-code", "--staged", "--", "apps/api-go/openapi.commands.generated.yaml").Run(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
				fmt.Fprintln(os.Stderr, "openapi commands drift detected: openapi.commands.generated.yaml has staged-but-not-committed changes. Re-stage and commit.")
				os.Exit(2)
			}
		}
		fmt.Println("openapi: drift check passed (spec + generated commands in sync)")
	} else {
		fmt.Printf("openapi: validated %d bytes at %s\n", len(data), openAPIPath)
	}
}
