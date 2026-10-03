// Command gatecheck runs the repository's source-shape gates: assertions about
// how the current source reads (which branch owns which screen, which baseline
// file still exists, which string must not come back). They replace the Node
// scripts in scripts/*.mjs — the toolchain is Go plus the RN app's own build, so
// the gate itself must not need a JS runtime.
//
// usage: gatecheck <check> [args...]
//
// REPO_ROOT selects the directory the repo-relative paths are read from; it
// defaults to the caller's working directory. A missing file is always a failure
// — "could not read" must never read as "no violations".
package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// checks is the registry; the name is what the gate calls.
var checks = map[string]func(root string, args []string) error{}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: gatecheck <%s>\n", joinNames())
		os.Exit(2)
	}
	name := os.Args[1]
	check, ok := checks[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "gatecheck: unknown check %q (have: %s)\n", name, joinNames())
		os.Exit(2)
	}
	if err := check(repoRoot(), os.Args[2:]); err != nil {
		code := 1
		msg := err.Error()
		if te, ok := err.(toolError); ok {
			code = te.code
		}
		if strings.TrimSpace(msg) != "" {
			fmt.Fprintf(os.Stderr, "%s\n", msg)
		}
		os.Exit(code)
	}
}

// toolError carries the exit code a ported Node script used to pass to
// process.exit(): 1 = gate red, 2 = bad usage, 69 = a required tool is missing.
type toolError struct {
	code int
	msg  string
}

func (e toolError) Error() string { return e.msg }

// iround matches Math.round (half up), which the ported scripts used for sizes.
func iround(v float64) int { return int(math.Floor(v + 0.5)) }

func repoRoot() string {
	if root := os.Getenv("REPO_ROOT"); root != "" {
		return root
	}
	wd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gatecheck: cannot resolve the working directory")
		os.Exit(1)
	}
	return wd
}

// read fails with an error instead of returning empty content, so a moved or
// deleted file is reported rather than silently satisfying the check.
func read(root, rel string) (string, error) {
	body, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		return "", fmt.Errorf("cannot read %s: %w", rel, err)
	}
	return string(body), nil
}

func joinNames() string {
	names := make([]string, 0, len(checks))
	for name := range checks {
		names = append(names, name)
	}
	return fmt.Sprint(names)
}
