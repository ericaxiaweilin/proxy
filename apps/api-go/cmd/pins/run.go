package main

import (
	"bytes"
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

	// One mask over the whole text, then sliced per line: `exit` inside an awk program or
	// inside a comment must survive untouched, and only a whole-text state machine knows
	// where the quotes and comments are.
	var masks [][]byte
	if neutralise {
		masks = lineMasks(lines)
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
			if strings.TrimSpace(l) == "set -u" {
				out = append(out, "set -u; _FAILED=0")
				continue
			}
			out = append(out, neutraliseExits(l, masks[i]))
			continue
		}
		out = append(out, l)
	}
	if neutralise {
		// Appended past the end, so it cannot shift any real line number. `:-0` because a
		// script with no `set -u` line never gets the `_FAILED=0` init, and an empty
		// trailer reads as "no trailer at all" — which auditRun scores as an aborted run.
		out = append(out, `echo ">>> TOTAL-FAILURES=${_FAILED:-0}"`)
	}
	return strings.Join(out, "\n")
}

var exitWord = []byte("exit")

// neutraliseExits rewrites every failure-path `exit` on ONE line into a marker that bumps
// _FAILED and prints `>>> PIN-FAIL@$LINENO` (or TEST-FAIL for the `|| exit $?` test idiom),
// so a step reports all of its failures instead of stopping at the first. The line count
// never changes, which is what keeps $LINENO equal to the original line number.
//
// Before this, only two shapes were recognised: a line that was exactly `exit 1`, and one
// containing `|| exit $?`. The gate's dominant hand-written idiom is neither — it is
// `[ "$X_B" -eq 0 ] || exit 1` (22 of them) plus inline `; exit 1; fi`. Those really
// exited, so no marker was ever printed and the runner reported "PASS — no selected pin
// failed". Measured 2026-10-03: MERCHANT-HOME-001 was red on a clean HEAD and every
// subset run called it a pass. Inherited verbatim from the Python runner; the port was
// faithful, including to the hole.
func neutraliseExits(line string, mask []byte) string {
	spans := exitSpans(line, mask)
	if len(spans) == 0 {
		return line
	}
	b := []byte(line)
	var out strings.Builder
	at := 0
	for _, sp := range spans {
		out.Write(b[at:sp.start])
		fmt.Fprintf(&out, `{ _FAILED=$(( ${_FAILED:-0} + 1 )); echo ">>> %s-FAIL@$LINENO"; }`, sp.kind)
		at = sp.end
	}
	out.Write(b[at:])
	return out.String()
}

// exitSpan is one failure-path `exit` token: the byte range it occupies and the marker it
// becomes. `exit 0` never produces a span — a success exit is not a failure, and rewriting
// it would turn a clean early return into a reported pin failure.
type exitSpan struct {
	start, end int
	arg        string
	kind       string
}

// exitSpans is the single authority on which `exit` tokens a line contains and what each
// one means. Both the neutraliser (which rewrites them) and staticFailureMeta (which
// explains them) go through it, so the two can never disagree about which lines emit a
// marker — a disagreement there is precisely the false green this file exists to prevent.
func exitSpans(line string, mask []byte) []exitSpan {
	b := []byte(line)
	var spans []exitSpan
	for i := 0; i < len(b); {
		if !isExitToken(b, mask, i) {
			i++
			continue
		}
		j := i + len(exitWord)
		for j < len(b) && (b[j] == ' ' || b[j] == '\t') {
			j++
		}
		argEnd := j
		for argEnd < len(b) && (isWordByte(b[argEnd]) || b[argEnd] == '$' || b[argEnd] == '?') {
			argEnd++
		}
		arg := string(b[j:argEnd])
		if arg != "0" {
			kind := "PIN"
			if arg == "$?" && strings.HasSuffix(strings.TrimRight(string(b[:i]), " \t"), "||") {
				// `require_test ... || exit $?` — what failed is a test, not the pin.
				kind = "TEST"
			}
			spans = append(spans, exitSpan{start: i, end: argEnd, arg: arg, kind: kind})
		}
		i = argEnd
		if i == len(b) {
			break
		}
	}
	return spans
}

// isExitToken reports whether an `exit` keyword starts at i and sits in code position.
func isExitToken(b, mask []byte, i int) bool {
	if i+len(exitWord) > len(b) || !bytes.Equal(b[i:i+len(exitWord)], exitWord) {
		return false
	}
	if !isKeywordBoundary(b, i, i+len(exitWord)) {
		return false
	}
	for k := i; k < i+len(exitWord); k++ {
		if mask[k] == 0 {
			return false
		}
	}
	return true
}

// lineMasks slices a whole-text codeMask into one per line. The mask has to be computed
// over the whole text: whether a byte is inside a quote or a comment depends on lines
// above it (a single-quoted awk program spans many).
func lineMasks(lines []string) [][]byte {
	m := codeMask(strings.Join(lines, "\n"))
	mask := make([]byte, len(m))
	for i, code := range m {
		if code {
			mask[i] = 1
		}
	}
	out := make([][]byte, len(lines))
	off := 0
	for i, l := range lines {
		out[i] = mask[off : off+len(l)]
		off += len(l) + 1
	}
	return out
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
	masks := lineMasks(lines)
	for i, l := range lines {
		n := i + 1
		spans := exitSpans(l, masks[i])
		if len(spans) == 0 {
			continue
		}
		if spans[0].kind == "TEST" {
			// The line names the test that failed; keep everything except the exit itself.
			meta[n] = failureMeta{kind: "TEST",
				message: strings.TrimSpace(strings.ReplaceAll(strings.TrimSpace(l), "|| exit $?", ""))}
			continue
		}
		var msg []string
		for j := i - 1; j >= 0 && len(msg) < 3; {
			prev := strings.TrimSpace(lines[j])
			if strings.HasPrefix(prev, "echo ") && strings.Contains(prev, ">&2") {
				msg = append([]string{prev}, msg...)
				j--
				continue
			}
			if prev == "" || strings.HasPrefix(prev, "#") || isStructuralNoise(prev) {
				j--
				continue
			}
			break
		}
		// The block's PIN-IDs come first: with the `[ "$X_B" -eq 0 ] || exit 1` idiom the
		// echoes are spread over the whole block, so "which pin went red" is the part a
		// human needs and the echoed text is only best-effort context.
		ids := pinIDsNear(lines, i)
		message := strings.Join(msg, " ")
		switch {
		case len(ids) > 0 && message != "":
			message = strings.Join(firstN(ids, 4), ", ") + " — " + message
		case len(ids) > 0:
			message = strings.Join(firstN(ids, 4), ", ")
		case message == "":
			message = "(no message)"
		}
		meta[n] = failureMeta{kind: "PIN", message: message}
	}
	return meta
}

// isStructuralNoise recognises the lines that sit between a block's `echo ... >&2` and its
// own `[ "$X_B" -eq 0 ] || exit 1`. Without it the backward walk stops at the first `fi`
// and every such pin reports "(no message)" — which is what the gate's dominant idiom
// did, so the report named a line number and nothing a human could act on.
func isStructuralNoise(trimmed string) bool {
	switch trimmed {
	case "fi", "done", "esac", "}", "else", "then", "{", ";;", "esac;":
		return true
	}
	// `elif ...; then`, a bare `MH_B=1`, or `case`/`if` openers that only wrap the echoes.
	if strings.HasPrefix(trimmed, "elif ") || strings.HasPrefix(trimmed, "else ") {
		return true
	}
	if len(trimmed) < 40 && strings.Contains(trimmed, "=") &&
		!strings.ContainsAny(trimmed, " ;|&") && !strings.HasPrefix(trimmed, "echo") {
		return true
	}
	return false
}

// pinIDsNear collects the PIN-IDs a failing block can belong to, walking back over the
// block's own `FAIL [X]` echoes. Used when the echoes are not adjacent to the exit, so the
// report can still say which pin went red instead of only pointing at a line.
var failIDRe = regexp.MustCompile(`FAIL \[([A-Z0-9][A-Z0-9a-z./-]*)\]`)

func pinIDsNear(lines []string, at int) []string {
	seen := map[string]bool{}
	var ids []string
	for j := at - 1; j >= 0 && j > at-60; j-- {
		for _, m := range failIDRe.FindAllStringSubmatch(lines[j], -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				ids = append(ids, m[1])
			}
		}
		// A previous block's success echo or exit ends the walk: past that, the IDs
		// belong to a different pin.
		if strings.Contains(lines[j], ": PASS") || strings.Contains(lines[j], "exit") {
			break
		}
	}
	return ids
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
	rc, out, errOut := runScript(root, tempScript(lines, ranges, root, true))

	markers := collectMarkers(out)
	total := ""
	if m := totalRe.FindStringSubmatch(out); m != nil {
		total = m[1]
	}
	trusted, why := auditRun(rc, out, markers)
	if total == "" {
		// Never silently substitute the marker count: that is exactly how an aborted step
		// used to read as "0 failures". Show the real state and let the verdict fail.
		total = fmt.Sprintf("%d (trailer missing — run aborted)", len(markers))
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

	if !trusted {
		fmt.Printf("  NOT A PASS — %s.\n", why)
		fmt.Println("  Treat this run as red: an aborted step proves nothing about the pins after it.")
		printEmittedFailures(out, errOut)
		printAbortTail(out, errOut)
		return 1
	}
	if len(markers) == 0 {
		fmt.Println("  ALL PINS PASS.")
		return 0
	}
	reportFailures(markers, index, meta)
	printEmittedFailures(out, errOut)
	fmt.Printf("  %d failing assertion(s). Fix all of them before re-running the gate.\n", len(markers))
	return 1
}

var failHeadRe = regexp.MustCompile(`^\s*FAIL\b`)

// emittedFailures returns the FAIL blocks the pin script itself printed, with their
// indented continuation lines. The report is keyed on markers, but the script's own text is
// the ground truth about WHAT failed — and in a non-verbose run nothing else surfaces it,
// so a report without this says "line 14008 went red" and leaves the reader to go dig.
func emittedFailures(out, errOut string) []string {
	var res []string
	for _, src := range []string{out, errOut} {
		lines := strings.Split(src, "\n")
		for i := 0; i < len(lines); i++ {
			if !failHeadRe.MatchString(lines[i]) {
				continue
			}
			block := []string{strings.TrimRight(lines[i], " \t")}
			j := i + 1
			for ; j < len(lines); j++ {
				// Continuation lines are indented deeper than the head and carry no verdict.
				if !strings.HasPrefix(lines[j], "        ") || failHeadRe.MatchString(lines[j]) ||
					strings.Contains(lines[j], ": PASS") {
					break
				}
				block = append(block, strings.TrimRight(lines[j], " \t"))
			}
			res = append(res, strings.Join(block, "\n"))
			i = j - 1
		}
	}
	return res
}

// printEmittedFailures shows the gate's own words under a heading, deduplicated: the same
// block can print a FAIL line and then a marker, and both belong to one failure.
func printEmittedFailures(out, errOut string) {
	blocks := emittedFailures(out, errOut)
	if len(blocks) == 0 {
		return
	}
	seen := map[string]bool{}
	fmt.Println("  what the gate printed:")
	for _, b := range blocks {
		if seen[b] {
			continue
		}
		seen[b] = true
		for _, l := range strings.Split(b, "\n") {
			fmt.Printf("    %s\n", strings.TrimSpace(l))
		}
	}
	fmt.Println()
}

// printAbortTail shows why a run died when the trailer never printed. Without it the
// verdict says "not a pass" and the reader still has to re-run by hand to find out that
// bash hit an unbound variable three thousand lines in.
func printAbortTail(out, errOut string) {
	lines := strings.Split(strings.TrimRight(out+"\n"+errOut, "\n"), "\n")
	if len(lines) == 0 {
		return
	}
	if len(lines) > 15 {
		lines = lines[len(lines)-15:]
	}
	fmt.Println("  last output before it died:")
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			continue
		}
		fmt.Printf("    %s\n", l)
	}
	fmt.Println()
}

// auditRun cross-checks the three things a neutralised run must agree on before its
// "nothing failed" can be believed.
//
// Markers alone are not enough, and that is not a theoretical worry: an `exit` the
// neutraliser missed really terminates the step, prints no marker, and used to be scored
// as a pass. So the trailer is required (its absence proves the script aborted), its
// count must equal the number of attributed markers (a failure that cannot be pinned to a
// line is still a failure), and the process must have exited 0. Any disagreement is
// reported as a failure — a false green is the one thing this tool must never emit,
// because "the gate said pass" gets cited as evidence.
func auditRun(rc int, out string, markers []marker) (bool, string) {
	m := totalRe.FindStringSubmatch(out)
	if m == nil {
		return false, fmt.Sprintf("the run never printed its `>>> TOTAL-FAILURES` trailer (exit %d) — "+
			"a step aborted instead of reporting, so the %d marker(s) collected are not the whole story",
			rc, len(markers))
	}
	var total int
	fmt.Sscanf(m[1], "%d", &total)
	if total != len(markers) {
		return false, fmt.Sprintf("the run counted %d failure(s) but only %d carried a line marker — "+
			"at least one failure cannot be attributed to a pin", total, len(markers))
	}
	if rc != 0 {
		return false, fmt.Sprintf("the run exited %d while reporting %d failure(s)", rc, total)
	}
	return true, ""
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

	trusted, why := auditRun(rc, out, markers)
	failed := 0
	switch {
	case !trusted:
		fmt.Printf("  NOT A PASS — %s.\n", why)
		fmt.Println("  Treat this run as red: an aborted step proves nothing about the pins after it.")
		printEmittedFailures(out, errOut)
		printAbortTail(out, errOut)
		failed = 1
	case len(markers) > 0:
		reportFailures(markers, index, staticFailureMeta(lines))
		printEmittedFailures(out, errOut)
		fmt.Printf("  %d failing assertion(s) among the pins that cover your change.\n", len(markers))
		failed = 1
	default:
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
	return failed
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
	// The dependency closure is not optional here either. `--step N` runs the step under
	// `set -u`, and most steps read a variable assigned by a neighbouring setup step
	// (`UI=`, `MH_B=0`, …). Without the closure the step dies on "unbound variable" —
	// the tool inventing a failure about a pin that is actually fine.
	picked := depClosure(index.Steps, map[int]struct{}{n: {}})
	ranges := []span{{0, index.PrologueEnd - 1}}
	for _, i := range sortedKeys(picked) {
		ranges = append(ranges, span{index.Steps[i].Start - 1, index.Steps[i].End - 1})
	}
	text := tempScript(lines, ranges, root, false)
	fmt.Printf("--- step #%d  lines %d-%d  %s ---\n", n, st.Start, st.End, strings.Join(st.IDs, ", "))
	if len(picked) > 1 {
		fmt.Printf("--- (+%d step(s) from the dependency closure: they assign what this step reads) ---\n",
			len(picked)-1)
	}
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
