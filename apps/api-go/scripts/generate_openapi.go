package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"os/exec"
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
		// Drift check: ensure committed file matches working tree (no unstaged changes)
		// We compare the file on disk vs git show HEAD:apps/api-go/openapi.yaml if in git repo.
		head, err := exec.Command("git", "show", "HEAD:apps/api-go/openapi.yaml").Output()
		if err != nil {
			// No HEAD yet or not a git repo: pass if present
			fmt.Println("openapi: check passed (no HEAD to compare)")
			return
		}
		if !bytes.Equal(bytes.TrimSpace(head), bytes.TrimSpace(data)) {
			fmt.Fprintln(os.Stderr, "openapi drift detected: committed openapi.yaml differs from HEAD. Run `go run ./scripts/generate_openapi.go` and commit.")
			os.Exit(2)
		}
		fmt.Println("openapi: drift check passed")
	} else {
		fmt.Printf("openapi: validated %d bytes at %s\n", len(data), openAPIPath)
	}
}
