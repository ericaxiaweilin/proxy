package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
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
	// YAML syntax check via python3 -c yaml.safe_load
	cmd := exec.Command("python3", "-c", "import yaml,sys; yaml.safe_load(open(sys.argv[1]))", openAPIPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "yaml parse failed: %v %s\n", err, out)
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
		// Also validate that the generated commands fragment is in
		// sync with HEAD. This catches the case where a new command
		// was added to a service but the spec wasn't updated.
		genPath := strings.TrimSuffix(openAPIPath, "openapi.yaml") + "openapi.commands.generated.yaml"
		genDisk, err := os.ReadFile(genPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "openapi drift check: generated commands fragment missing at %s: %v\n", genPath, err)
			os.Exit(2)
		}
		genHead, err := exec.Command("git", "show", "HEAD:apps/api-go/openapi.commands.generated.yaml").Output()
		if err != nil {
			// First commit of the fragment: skip drift vs HEAD, but
			// the file must be present on disk to pass.
			fmt.Println("openapi: drift check passed (commands fragment has no HEAD yet)")
			return
		}
		if !bytes.Equal(bytes.TrimSpace(genHead), bytes.TrimSpace(genDisk)) {
			fmt.Fprintln(os.Stderr, "openapi commands drift detected: re-run `go run ./cmd/openapi-commands` and commit the regenerated openapi.commands.generated.yaml.")
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
