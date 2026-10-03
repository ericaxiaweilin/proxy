// Command pins runs the regression tripwires in
// scripts/check-regression-contracts.sh without its "stop at the first failure"
// behaviour, and can restrict the run to the steps that reference the files you
// changed.
//
// It is the port of scripts/pins.py. The Python is gone because the stack has no
// Python (TOOLCHAIN-NO-PYTHON-001); everything the Python file recorded as a hard
// lesson is carried over here and covered by pins_test.go:
//
//   - the code-line view must stay 1:1 with the source, or every reported line
//     number is wrong (`grep -cF 'if (lastSearchRef.current !== "") return;'` really
//     does appear in the pin script, so naive keyword counting is wrong);
//   - skipped steps are blanked, never dropped, because the failure report is keyed
//     on $LINENO;
//   - the assembled script runs as a FILE: `bash -c` drops the `#!` line from the
//     LINENO count, which would attribute every failure to the wrong pin;
//   - a subset run must pull in the steps that assign the variables it reads, or
//     `set -u` reports a healthy pin as red.
//
// Two deliberate divergences from the Python:
//   - Python had a `--quiet` flag that was parsed, threaded into cmd_changed, and
//     never read. It is not carried over — a flag that does nothing is how a runner
//     starts lying about what it ran.
//   - The prologue now also covers the helper functions defined right after it.
//     Python's prologue stopped at the first top-level `}`, so a narrowed run blanked
//     `require_test`'s definition and reported `command not found` as a failed pin.
//
// usage:
//
//	go -C apps/api-go run ./cmd/pins --list
//	go -C apps/api-go run ./cmd/pins --step 412
//	go -C apps/api-go run ./cmd/pins --changed [--base REF] [--only PATTERN]
//	go -C apps/api-go run ./cmd/pins --all [--only PATTERN]
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// segmenterVersion must be bumped whenever the segmentation or indexing rules
// change: the index cache filename and the stored version both come from it, and a
// stale cache would silently feed the old step boundaries to the new runner.
//
//	4 = the Python runner
//	5 = the Go port (RE2-safe keyword scanning, no rule change)
//	6 = helpers moved into the prologue, so a narrowed run no longer blanks the
//	    `require_test` definition its selected step calls
//	7 = variable names are no longer lowercase-only, so depClosure can see the gate's
//	    uppercase locals (`UI=`, `MH_B=0`, …) instead of letting a narrowed run die on
//	    `set -u` with "unbound variable"
const segmenterVersion = 7

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	fs := flag.NewFlagSet("pins", flag.ContinueOnError)
	var (
		changed  = fs.Bool("changed", false, "run only the steps referencing files you changed")
		all      = fs.Bool("all", false, "run every step; report every failure in one pass")
		list     = fs.Bool("list", false, "print the step index")
		stepN    = fs.Int("step", -1, "run step N only")
		base     = fs.String("base", "", "git ref to diff against (--changed)")
		only     = fs.String("only", "", "only steps whose PIN-ID or referenced path contains PATTERN")
		script   = fs.String("script", "", "run a different pin script (default: the repo's)")
		failFast = fs.Bool("fail-fast", false, "--changed: stop at the first failure (default reports all)")
		verbose  = fs.Bool("verbose", false, "--changed: also dump the raw pin-script output")
	)
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: pins --list | --step N | --all [--only PATTERN] | --changed [--base REF] [--only PATTERN] [--fail-fast] [--verbose]")
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	picked := 0
	for _, f := range []*bool{changed, all, list} {
		if *f {
			picked++
		}
	}
	if *stepN >= 0 {
		picked++
	}
	if picked != 1 {
		fs.Usage()
		return 2
	}

	root := repoRoot()
	if _, err := exec.LookPath("bash"); err != nil {
		// The whole tool is "run the pin script and read its markers". Without bash
		// that is not a red pin, it is a run that never happened — say so instead.
		fmt.Fprintln(os.Stderr, "pins: bash not found")
		return 2
	}
	pinScript := filepath.Join(root, "scripts", "check-regression-contracts.sh")
	if *script != "" {
		abs, err := filepath.Abs(*script)
		if err != nil {
			fmt.Fprintf(os.Stderr, "pins: %s: %v\n", *script, err)
			return 2
		}
		pinScript = abs
	}
	if _, err := os.Stat(pinScript); err != nil {
		fmt.Fprintf(os.Stderr, "pins: %s not found\n", pinScript)
		return 2
	}

	index, err := buildIndex(pinScript)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pins:", err)
		return 1
	}

	switch {
	case *list:
		return cmdList(root, pinScript, index)
	case *all:
		return cmdAll(root, pinScript, index, *only)
	case *stepN >= 0:
		return cmdStep(root, pinScript, index, *stepN)
	}
	return cmdChanged(root, pinScript, index, *base, *only, *failFast, *verbose)
}

// repoRoot walks up from the working directory to the repository root so the tool
// works from the repo root or from apps/api-go (the `go -C` shape).
func repoRoot() string {
	for _, key := range []string{"PROXY_ROOT", "REPO_ROOT"} {
		if root := os.Getenv(key); root != "" {
			// An override that does not actually contain the pin script must not be
			// trusted: pointing this at the stale /work/kake copy would run *that*
			// tree's 14k lines of tripwires and report them as this repo's result —
			// the "silently tests the other tree" failure AGENTS.md forbids.
			if _, err := os.Stat(filepath.Join(root, "scripts", "check-regression-contracts.sh")); err == nil {
				return root
			}
			fmt.Fprintf(os.Stderr, "pins: ignoring %s=%s (no scripts/check-regression-contracts.sh there)\n", key, root)
		}
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "scripts", "check-regression-contracts.sh")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return wd
		}
	}
}
