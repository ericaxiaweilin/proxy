package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type failureMeta struct {
	kind    string
	message string
}

// tempScript assembles a runnable script in which $LINENO equals the ORIGINAL line
// number. Two invariants, both load-bearing:
//
//   - Skipped steps are replaced with BLANK lines, never dropped. The failure report
//     is keyed on $LINENO, so dropping lines silently re-attributes every failure to
//     some unrelated step (the first version dropped them, and `--only X` reported
//     failures from a completely different pin).
//   - The neutraliser never adds or removes a line, which is why `_FAILED=0` is
//     appended to the existing `set -u` line instead of getting its own.
func tempScript(lines []string, keepRanges []span, repo string, neutralise bool) string {
	keep := map[int]struct{}{}
	for _, r := range keepRanges {
		for i := r.start; i <= r.end; i++ {
			keep[i] = struct{}{}
		}
	}

	out := make([]string, 0, len(lines)+1)
	for i, l := range lines {
		if _, ok := keep[i]; !ok {
			out = append(out, "")
			continue
		}
		// The script normally does `cd "$(dirname "$0")/.."`; in a temp file $0 is the
		// temp path, so pin the absolute repo root instead.
		if strings.Contains(l, `cd "$(dirname "$0")/.."`) {
			out = append(out, fmt.Sprintf("cd %q", repo))
			continue
		}
		if neutralise {
			switch {
			case strings.TrimSpace(l) == "exit 1":
				out = append(out, `{ _FAILED=$(( ${_FAILED:-0} + 1 )); echo ">>> PIN-FAIL@$LINENO"; }`)
				continue
			case strings.Contains(l, "|| exit $?"):
				out = append(out, strings.ReplaceAll(l, "|| exit $?",
					`|| { _FAILED=$(( ${_FAILED:-0} + 1 )); echo ">>> TEST-FAIL@$LINENO"; }`))
				continue
			case strings.TrimSpace(l) == "set -u":
				out = append(out, "set -u; _FAILED=0")
				continue
			}
		}
		out = append(out, l)
	}
	if neutralise {
		// Appended past the end, so it cannot shift any real line number.
		out = append(out, `echo ">>> TOTAL-FAILURES=$_FAILED"`)
	}
	return strings.Join(out, "\n")
}

// runScript runs the assembled script as a FILE, not via `bash -c`. This matters for
// the correctness of the whole tool: `bash -c` drops the `#!` line from the LINENO
// count, so every failure would be reported one line early — and a report that is off
// by one is worse than no report, because it sends you to edit the wrong pin. The
// gate runs the script as a file, so this also matches how it actually executes.
func runScript(root, text string) (int, string, string) {
	f, err := os.CreateTemp("", "pins-*.sh")
	if err != nil {
		return 1, "", err.Error()
	}
	path := f.Name()
	defer os.Remove(path)
	if _, err := f.WriteString(text); err != nil {
		f.Close()
		return 1, "", err.Error()
	}
	if err := f.Close(); err != nil {
		return 1, "", err.Error()
	}

	cmd := exec.Command("bash", path)
	cmd.Dir = root
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	code := 0
	if runErr != nil {
		var exit *exec.ExitError
		if asErr, ok := runErr.(*exec.ExitError); ok {
			exit = asErr
			code = exit.ExitCode()
		} else {
			return 1, stdout.String(), stderr.String() + "\n" + runErr.Error()
		}
	}
	return code, stdout.String(), stderr.String()
}

// staticFailureMeta maps each `exit` line number to its message using the SOURCE,
// not the output. Pairing FAIL text with a failure by reading interleaved
// stdout/stderr is fragile because of buffering; reading it out of the source is
// deterministic.
func staticFailureMeta(lines []string) map[int]failureMeta {
	meta := map[int]failureMeta{}
	for i, l := range lines {
		n := i + 1
		s := strings.TrimSpace(l)
		switch {
		case s == "exit 1":
			var msg []string
			for j := i - 1; j >= 0; {
				prev := strings.TrimSpace(lines[j])
				if strings.HasPrefix(prev, "echo ") && strings.Contains(prev, ">&2") {
					msg = append([]string{prev}, msg...)
					j--
					continue
				}
				if prev == "" || strings.HasPrefix(prev, "#") {
					j--
					continue
				}
				break
			}
			message := strings.Join(msg, " ")
			if message == "" {
				message = "(no message)"
			}
			meta[n] = failureMeta{kind: "PIN", message: message}
		case strings.Contains(l, "|| exit $?"):
			meta[n] = failureMeta{kind: "TEST",
				message: strings.TrimSpace(strings.ReplaceAll(s, "|| exit $?", ""))}
		}
	}
	return meta
}

var (
	echoRe     = regexp.MustCompile(`^echo\s+`)
	redirRe    = regexp.MustCompile(`\s*>&2\s*$`)
	twoQuoteRe = regexp.MustCompile(`"\s*"`)
	spaceRe    = regexp.MustCompile(`\s+`)
	passRe     = regexp.MustCompile(`:\s*PASS\b`)
	markerRe   = regexp.MustCompile(`>>> (PIN|TEST)-FAIL@(\d+)`)
	totalRe    = regexp.MustCompile(`>>> TOTAL-FAILURES=(\d+)`)
)

func cleanMessage(m string) string {
	m = echoRe.ReplaceAllString(m, "")
	m = redirRe.ReplaceAllString(m, "")
	m = strings.TrimSpace(m)
	m = strings.Trim(m, `"`)
	m = strings.Trim(m, "'")
	m = twoQuoteRe.ReplaceAllString(m, " ")
	return spaceRe.ReplaceAllString(m, " ")
}

type marker struct {
	lineno int
	kind   string
}

func collectMarkers(out string) []marker {
	var out2 []marker
	for _, line := range strings.Split(out, "\n") {
		if m := markerRe.FindStringSubmatch(line); m != nil {
			var n int
			fmt.Sscanf(m[2], "%d", &n)
			out2 = append(out2, marker{lineno: n, kind: m[1]})
		}
	}
	return out2
}

func reportFailures(markers []marker, index pinIndex, meta map[int]failureMeta) {
	for _, mk := range markers {
		var found *stepIndex
		for i := range index.Steps {
			if index.Steps[i].Start <= mk.lineno && mk.lineno <= index.Steps[i].End {
				found = &index.Steps[i]
				break
			}
		}
		ids := "(no PIN-ID)"
		where := "?"
		if found != nil {
			if len(found.IDs) > 0 {
				ids = strings.Join(firstN(found.IDs, 3), ", ")
			}
			where = fmt.Sprintf("lines %d-%d", found.Start, found.End)
		}
		fmt.Printf("  FAIL  %-4s @%-6d %-16s %s\n", mk.kind, mk.lineno, where, ids)
		if m, ok := meta[mk.lineno]; ok && m.message != "" {
			c := cleanMessage(m.message)
			if len(c) > 150 {
				c = c[:150]
			}
			fmt.Printf("        %s\n", c)
		}
		if found != nil && len(found.Paths) > 0 {
			fmt.Printf("        touches: %s\n", strings.Join(firstN(found.Paths, 3), ", "))
		}
		fmt.Println()
	}
}

func firstN(in []string, n int) []string {
	if len(in) < n {
		return in
	}
	return in[:n]
}

func cmdAll(root, pinScript string, index pinIndex, only string) int {
	raw, err := os.ReadFile(pinScript)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pins:", err)
		return 1
	}
	lines := strings.Split(string(raw), "\n")
	meta := staticFailureMeta(lines)

	chosen := index.Steps
	if only != "" {
		picked := map[int]struct{}{}
		for i, s := range index.Steps {
			if stepMatches(s, only) {
				picked[i] = struct{}{}
			}
		}
		picked = depClosure(index.Steps, picked)
		chosen = nil
		for _, i := range sortedKeys(picked) {
			chosen = append(chosen, index.Steps[i])
		}
	}

	ranges := []span{{0, index.PrologueEnd - 1}}
	for _, s := range chosen {
		ranges = append(ranges, span{s.Start - 1, s.End - 1})
	}
	_, out, errOut := runScript(root, tempScript(lines, ranges, root, true))

	markers := collectMarkers(out)
	total := ""
	if m := totalRe.FindStringSubmatch(out); m != nil {
		total = m[1]
	}
	if total == "" {
		total = fmt.Sprintf("%d", len(markers))
	}
	passes := len(passRe.FindAllString(out+errOut, -1))

	fmt.Println(strings.Repeat("=", 78))
	fmt.Println("pins --all   (every step, no early exit)")
	fmt.Println(strings.Repeat("=", 78))
	// The ABSOLUTE path, not the repo-relative one the Python printed: "which worktree
	// did these 2251 steps come from" must not be a question you can ask.
	fmt.Printf("  pin script : %s  (%d lines, %d steps)\n",
		pinScript, index.Lines, len(index.Steps))
	if only != "" {
		fmt.Printf("  filtered   : --only %s  -> %d step(s)\n", only, len(chosen))
	}
	fmt.Printf("  assertions : %d PASS lines emitted\n", passes)
	fmt.Printf("  failures   : %s\n", total)
	fmt.Println()

	if len(markers) == 0 {
		fmt.Println("  ALL PINS PASS.")
		return 0
	}
	reportFailures(markers, index, meta)
	fmt.Printf("  %d failing assertion(s). Fix all of them before re-running the gate.\n", len(markers))
	return 1
}

func cmdChanged(root, pinScript string, index pinIndex, base, only string, failFast, verbose bool) int {
	files := changedFiles(root, base)
	if len(files) == 0 {
		fmt.Println("pins --changed: no changed files (worktree clean) — nothing to run.")
		return 0
	}

	selected, untargetable, uncovered := selectSteps(index, files)
	if only != "" {
		narrow := map[int]struct{}{}
		for _, i := range selected {
			if stepMatches(index.Steps[i], only) {
				narrow[i] = struct{}{}
			}
		}
		selected = sortedKeys(depClosure(index.Steps, narrow))
	}

	fmt.Println(strings.Repeat("=", 78))
	fmt.Println("pins --changed   (only the pins that reference your files)")
	fmt.Println(strings.Repeat("=", 78))
	// Absolute, so "which worktree ran these pins" is never a question.
	fmt.Printf("  pin script  : %s\n", pinScript)
	fmt.Printf("  changed files : %d\n", len(files))
	for _, f := range firstN(files, 20) {
		fmt.Printf("    - %s\n", f)
	}
	if len(files) > 20 {
		fmt.Printf("    ... and %d more\n", len(files)-20)
	}
	fmt.Println()

	if len(selected) == 0 {
		fmt.Println("  No pin references any changed file.")
		if len(untargetable) > 0 {
			fmt.Printf("  (%d step(s) reference no file at all — run `--all` to include them.)\n",
				len(untargetable))
		}
		return 0
	}

	fmt.Printf("  selected %d of %d steps:\n", len(selected), len(index.Steps))
	for _, i := range selected {
		st := index.Steps[i]
		ids := "(no PIN-ID)"
		if len(st.IDs) > 0 {
			ids = strings.Join(firstN(st.IDs, 2), ", ")
		}
		fmt.Printf("    #%-4d lines %d-%-6d %s\n", i, st.Start, st.End, ids)
	}
	fmt.Println()

	raw, err := os.ReadFile(pinScript)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pins:", err)
		return 1
	}
	lines := strings.Split(string(raw), "\n")
	ranges := []span{{0, index.PrologueEnd - 1}}
	for _, i := range selected {
		ranges = append(ranges, span{index.Steps[i].Start - 1, index.Steps[i].End - 1})
	}
	rc, out, errOut := runScript(root, tempScript(lines, ranges, root, !failFast))

	if failFast {
		// Neutralised by default, because the pin script exits at the FIRST failure and
		// a fail-fast run therefore reports one broken pin and hides the rest — the
		// exact problem this tool exists to remove. --fail-fast opts back into that.
		fmt.Print(out)
		fmt.Fprint(os.Stderr, errOut)
		if rc != 0 {
			fmt.Printf("\n  FAILED (exit %d). --fail-fast stopped at the first failure; "+
				"the remaining selected steps did NOT run.\n", rc)
		} else {
			fmt.Printf("\n  PASS — %d step(s) run.\n", len(selected))
		}
		if len(uncovered) > 0 {
			fmt.Printf("  ⚠ no pin references: %s\n", strings.Join(firstN(uncovered, 10), ", "))
		}
		return rc
	}

	markers := collectMarkers(out)
	passes := len(passRe.FindAllString(out+errOut, -1))
	if verbose {
		fmt.Print(out)
		fmt.Fprint(os.Stderr, errOut)
	}
	fmt.Printf("  %d PASS line(s) emitted from %d selected step(s).\n\n", passes, len(selected))

	if len(markers) > 0 {
		reportFailures(markers, index, staticFailureMeta(lines))
		fmt.Printf("  %d failing assertion(s) among the pins that cover your change.\n", len(markers))
	} else {
		fmt.Println("  PASS — no selected pin failed.")
	}

	if len(untargetable) > 0 {
		fmt.Printf("  note: %d step(s) reference no file and were skipped; `--all` includes them.\n",
			len(untargetable))
	}
	if len(uncovered) > 0 {
		fmt.Printf("  ⚠ no pin references: %s\n", strings.Join(firstN(uncovered, 10), ", "))
		if len(uncovered) > 10 {
			fmt.Printf("    ... and %d more\n", len(uncovered)-10)
		}
		fmt.Println("    (that is a coverage hole, not a pass.)")
	}
	if len(markers) > 0 {
		return 1
	}
	return 0
}

// relTo prints the pin script the way a human names it in this repo — relative to
// the worktree root — so the report lines match what `--changed` diffs against.
func relTo(root, path string) string {
	if r, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(r, "..") {
		return r
	}
	return path
}

func cmdList(root, pinScript string, index pinIndex) int {
	fmt.Printf("%d steps in %s\n", len(index.Steps), relTo(root, pinScript))
	fmt.Printf("prologue: lines 1-%d\n", index.PrologueEnd)
	for i, st := range index.Steps {
		ids := ""
		if len(st.IDs) > 0 {
			ids = strings.Join(firstN(st.IDs, 2), ", ")
		}
		paths := "(no file ref)"
		if len(st.Paths) > 0 {
			paths = strings.Join(firstN(st.Paths, 2), ", ")
		}
		fmt.Printf("  #%-4d %6d-%-6d %-40s %s\n", i, st.Start, st.End, ids, paths)
	}
	return 0
}

func cmdStep(root, pinScript string, index pinIndex, n int) int {
	if n < 0 || n >= len(index.Steps) {
		fmt.Fprintf(os.Stderr, "step %d out of range (0..%d)\n", n, len(index.Steps)-1)
		return 2
	}
	st := index.Steps[n]
	raw, err := os.ReadFile(pinScript)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pins:", err)
		return 1
	}
	lines := strings.Split(string(raw), "\n")
	text := tempScript(lines, []span{{0, index.PrologueEnd - 1}, {st.Start - 1, st.End - 1}}, root, false)
	fmt.Printf("--- step #%d  lines %d-%d  %s ---\n", n, st.Start, st.End, strings.Join(st.IDs, ", "))
	// Same rule as --all/--changed: a run that could be cited as evidence says which
	// tree it came from.
	fmt.Printf("--- from %s ---\n", pinScript)
	rc, out, errOut := runScript(root, text)
	fmt.Print(out)
	fmt.Fprint(os.Stderr, errOut)
	fmt.Printf("--- exit %d ---\n", rc)
	return rc
}

// sortInts keeps the import used even if the ordering helpers move around.
func sortInts(in []int) { sort.Ints(in) }
