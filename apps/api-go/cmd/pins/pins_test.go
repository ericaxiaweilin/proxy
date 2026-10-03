package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func writeSample(t *testing.T, path string) error {
	t.Helper()
	return os.WriteFile(path, []byte(strings.Join([]string{
		"#!/bin/bash",
		"set -u",
		"}",
		"",
		`echo "  FAIL [SAMPLE-001] gone"`,
		`exit 1`,
	}, "\n")), 0o644)
}

// These tests exist because the runner was ported out of a python script, and the
// two things that make it correct are invisible in the output: `$LINENO` must equal
// the ORIGINAL line number, and a subset run must not invent failures. Every test
// below pins one of the invariants that a naive rewrite breaks.

func TestCodeLinesKeepsEveryLineAndBlanksQuotedKeywords(t *testing.T) {
	src := strings.Join([]string{
		`echo start`,
		`if grep -cF 'if (lastSearchRef.current !== "") return;' a.ts; then`,
		`  echo "  A: PASS"`,
		`fi # fi in a trailing comment`,
		`msg="first line \`,
		`second line"`,
		`echo done`,
	}, "\n")

	got := codeLines(src)
	// 1:1 is the whole point: a merged line re-attributes every later failure.
	if len(got) != 7 {
		t.Fatalf("code/line mapping drifted: got %d lines, want 7\n%q", len(got), got)
	}
	if n := countOpens(got[1]); n != 1 {
		t.Errorf("line 2 keyword count = %d, want 1 (the quoted `if` must not count)", n)
	}
	if n := countCloses(got[3]); n != 1 {
		t.Errorf("line 4 close count = %d, want 1 (`fi` before the comment)", n)
	}
	if strings.Contains(got[2], "PASS") {
		t.Errorf("string contents survived blanking: %q", got[2])
	}
	// The backslash-newline continuation must NOT merge two source lines, and the
	// quoted text is blanked on purpose (that is how the `if` stops counting).
	if strings.Contains(got[5], "second") || strings.Contains(got[5], "line") {
		t.Errorf("line 6 kept quoted content: %q", got[5])
	}
	if strings.Contains(got[4], "first line") {
		t.Errorf("continuation line kept quoted content: %q", got[4])
	}
}

func TestKeywordBoundaryDoesNotMatchInsideWords(t *testing.T) {
	// The python regexes had (?<![\w-]) / (?![\w-]); RE2 has no look-around, so this
	// is the explicit replacement. Getting it wrong miscounts depth and truncates
	// blocks mid-step.
	cases := []struct {
		line string
		want int
	}{
		{`notify_users`, 0},
		{`for_each_item`, 0},
		{`a-if-b`, 0},
		{`endif`, 0},
		{`if [ -f x ]; then`, 1},
		{`x if y`, 1},
		{`case "$1" in`, 1},
		{`done`, 1},
	}
	for _, c := range cases {
		if n := countKeywords(c.line, []string{"if", "for", "case", "done"}); n != c.want {
			t.Errorf("countKeywords(%q) = %d, want %d", c.line, n, c.want)
		}
	}
}

func TestSegmentSplitsPrologueAndSteps(t *testing.T) {
	lines := strings.Split(strings.Join([]string{
		`#!/bin/bash`,
		`set -u`,
		`require_test() {`,
		`  echo ok`,
		`}`,
		``,
		`if [ -f a.go ]; then`,
		`  echo "A: PASS"`,
		`else`,
		`  echo "A: FAIL"`,
		`  exit 1`,
		`fi`,
		``,
		`go test ./x/ || exit $?`,
		`echo "loose line"`,
	}, "\n"), "\n")

	prologueEnd, steps, err := segment(lines)
	if err != nil {
		t.Fatal(err)
	}
	if prologueEnd != 4 {
		t.Errorf("prologueEnd = %d, want 4 (the first top-level `}`)", prologueEnd)
	}
	if len(steps) != 3 {
		t.Fatalf("steps = %d, want 3: %+v", len(steps), steps)
	}
	// Leading blank lines belong to the step that follows them.
	if steps[1].start != 12 {
		t.Errorf("step 1 starts at %d, want 12 (blank line folded into the next step)", steps[1].start)
	}
	if steps[1].end < 11 {
		t.Errorf("step 1 ended at %d, before its `fi`", steps[1].end)
	}
}

func TestTempScriptNeverMovesALineNumber(t *testing.T) {
	lines := strings.Split(strings.Join([]string{
		`#!/bin/bash`,
		`set -u`,
		`cd "$(dirname "$0")/.."`,
		`echo kept`,
		``,
		`exit 1`,
	}, "\n"), "\n")

	out := tempScript(lines, []span{{0, 3}}, "/tmp/repo", true)
	got := strings.Split(out, "\n")
	// +1 is the appended TOTAL-FAILURES line, which must sit past the real script.
	if len(got) != len(lines)+1 {
		t.Fatalf("line count %d, want %d — skipped steps must be blanked, not dropped",
			len(got), len(lines)+1)
	}
	if got[2] != `cd "/tmp/repo"` {
		t.Errorf("cd rewrite failed: %q", got[2])
	}
	if got[1] != "set -u; _FAILED=0" {
		t.Errorf("set -u neutralisation: %q", got[1])
	}
	if strings.TrimSpace(got[5]) != "" {
		t.Errorf("a skipped step survived: %q", got[5])
	}
	if got[len(got)-1] != `echo ">>> TOTAL-FAILURES=$_FAILED"` {
		t.Errorf("total line not appended last: %q", got[len(got)-1])
	}
}

func TestNeutralisedRunReportsTheOriginalLineNumbers(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not available")
	}

	lines := strings.Split(strings.Join([]string{
		`#!/bin/bash`,
		`set -u`,
		`echo "before"`,
		`if true; then`,
		`  exit 1`,
		`fi`,
		`echo "middle"`,
		`false || exit $?`,
		`echo "after"`,
	}, "\n"), "\n")

	// Keep everything, neutralised.
	out := tempScript(lines, []span{{0, len(lines) - 1}}, ".", true)
	rc, stdout, _ := runScript(t.TempDir(), out)
	// A neutralised run must NOT exit early — that is the entire reason this tool
	// replaced the bare script (one failure used to hide the other 834 assertions).
	if rc != 0 {
		t.Errorf("neutralised run exited %d; something still stops the script early", rc)
	}
	if !strings.Contains(stdout, "after") {
		t.Fatalf("the script died before its last line, so later pins were never run:\n%s", stdout)
	}
	markers := collectMarkers(stdout)
	if len(markers) != 2 {
		t.Fatalf("markers = %d (%+v), want 2 — both fail forms must be caught", len(markers), markers)
	}
	// The `#!` line counts: `bash -c` would report 4 and 7 here, and a report off by
	// one sends you to edit the wrong pin.
	if markers[0].lineno != 5 || markers[0].kind != "PIN" {
		t.Errorf("first marker = %+v, want PIN@5", markers[0])
	}
	if markers[1].lineno != 8 || markers[1].kind != "TEST" {
		t.Errorf("second marker = %+v, want TEST@8", markers[1])
	}
	if !strings.Contains(stdout, ">>> TOTAL-FAILURES=2") {
		t.Errorf("TOTAL-FAILURES missing, the run stopped early: %q", stdout)
	}

	// The other half of the proof: without neutralisation the script exits at the
	// first failure and the second marker never exists.
	rc2, stdout2, _ := runScript(t.TempDir(),
		tempScript(lines, []span{{0, len(lines) - 1}}, ".", false))
	if rc2 == 0 {
		t.Error("un-neutralised run should still fail — the injection is real")
	}
	if len(collectMarkers(stdout2)) != 0 || strings.Contains(stdout2, "after") {
		t.Errorf("expected the raw script to stop at the first failure, got:\n%s", stdout2)
	}
}

func TestStaticFailureMetaReadsTheMessageFromSource(t *testing.T) {
	lines := strings.Split(strings.Join([]string{
		`echo something`,
		`  echo "the feed has no media" >&2`,
		`  exit 1`,
		`go test ./cmd/pins/ || exit $?`,
	}, "\n"), "\n")

	meta := staticFailureMeta(lines)
	if m := meta[3]; m.kind != "PIN" || !strings.Contains(m.message, "no media") {
		t.Errorf("PIN meta = %+v, want the >&2 echo above the exit", m)
	}
	if m := meta[4]; m.kind != "TEST" || m.message != "go test ./cmd/pins/" {
		t.Errorf("TEST meta = %+v", m)
	}
	c := cleanMessage(`echo "  A: FAIL - x"  >&2`)
	if strings.Contains(c, "echo") || strings.Contains(c, ">&2") || strings.Contains(c, `"`) {
		t.Errorf("cleanMessage left shell syntax in the report: %q", c)
	}
	if !strings.Contains(c, "A: FAIL - x") {
		t.Errorf("cleanMessage lost the message: %q", c)
	}
	// Two adjacent quoted fragments join with ONE space, not `"" ` garbage.
	if got := cleanMessage(`echo "part one" "part two" >&2`); got != "part one part two" {
		t.Errorf("join = %q, want %q", got, "part one part two")
	}
}

func TestIndexStepCollectsIDsFromBothShapes(t *testing.T) {
	st := indexStep(strings.Join([]string{
		`echo "  FAIL [ORDER-X-001] snapshot missing"`,
		`require_test "AUTH-DOB-BOUNDS-001" apps/api-go/internal/auth/limits.ts`,
	}, "\n"))
	joined := strings.Join(st.IDs, " ")
	for _, want := range []string{"ORDER-X-001", "AUTH-DOB-BOUNDS-001"} {
		if !strings.Contains(joined, want) {
			t.Errorf("IDs = %v, missing %s", st.IDs, want)
		}
	}
	if !strings.Contains(strings.Join(st.Paths, " "), "apps/api-go/internal/auth/limits.ts") {
		t.Errorf("Paths = %v", st.Paths)
	}

	// A quoted ID with no require_test in the step is prose, not an ID.
	plain := indexStep(`echo "the WEATHER-REPORT format is fine"`)
	if len(plain.IDs) != 0 {
		t.Errorf("quoted prose harvested as an ID: %v", plain.IDs)
	}
}

func TestAssignNameRejectsComparisons(t *testing.T) {
	cases := []struct{ line, want string }{
		{`x=y`, `x`},
		{`  _FAILED=0`, `_FAILED`},
		{`x==y`, ``},
		{`x="$y"`, `x`},
		{`if x; then`, ``},
		{`1foo=bar`, ``},
	}
	for _, c := range cases {
		if got := assignName(c.line); got != c.want {
			t.Errorf("assignName(%q) = %q, want %q", c.line, got, c.want)
		}
	}
}

func TestGoPackagePathsResolveRelativeToTheModule(t *testing.T) {
	st := indexStep(`go test ./cmd/pins/ && go vet ./internal/media`)
	got := strings.Join(st.Paths, " ")
	for _, want := range []string{"apps/api-go/cmd/pins", "apps/api-go/internal/media"} {
		if !strings.Contains(got, want) {
			t.Errorf("Paths = %q, want %s", got, want)
		}
	}
}

func TestCoversWorksInBothDirections(t *testing.T) {
	// The pin script references some things as a directory and others as a file.
	if !covers("apps/api-go/cmd/pins", "apps/api-go/cmd/pins/run.go") {
		t.Error("indexed directory must cover a changed file inside it")
	}
	if !covers("apps/api-go/cmd/pins/run.go", "apps/api-go/cmd/pins") {
		t.Error("changed file must cover an indexed directory under it")
	}
	if covers("apps/api-go/cmd/pins", "apps/api-go/cmd/pinsx") {
		t.Error("prefix match without a path separator must not count")
	}
}

func TestDepClosureAddsOnlyEarlierAssigners(t *testing.T) {
	steps := []stepIndex{
		{Assigns: []string{"scene"}},
		{Reads: []string{"scene"}},
		{Assigns: []string{"late"}},
		{Reads: []string{"late"}},
	}
	sel := depClosure(steps, map[int]struct{}{1: {}, 3: {}})
	if _, ok := sel[0]; !ok {
		t.Error("step 0 assigns `scene` read by step 1 — a subset run would die on set -u")
	}
	if _, ok := sel[2]; !ok {
		t.Error("step 2 assigns `late` read by step 3")
	}
	// Selecting step 3 alone must not drag in step 0 (unrelated variable).
	solo := depClosure(steps, map[int]struct{}{3: {}})
	if len(solo) != 2 {
		t.Errorf("closure = %v, want {2,3}", sortedKeys(solo))
	}
	// A step that reads a variable assigned only LATER must not pull backwards past it.
	oneWay := []stepIndex{{Reads: []string{"x"}}, {Assigns: []string{"x"}}}
	if got := depClosure(oneWay, map[int]struct{}{0: {}}); len(got) != 1 {
		t.Errorf("backwards-only closure violated: %v", sortedKeys(got))
	}
}

func TestDepClosurePullsEveryAssignerOfAnAccumulatedCounter(t *testing.T) {
	// The shape the TOOLCHAIN-NO-PYTHON gate really has: initialise, increment in
	// several skipped steps, then assert the count is never zero. Keeping only the
	// first assigner gave `n=0` plus the final test and none of the increments — a
	// false "the scanner read nothing" red.
	steps := []stepIndex{
		{Assigns: []string{"n"}},     // 0: n=0
		{Assigns: []string{"n"}},     // 1: n=$((n + hits))
		{Assigns: []string{"other"}}, // 2: unrelated
		{Assigns: []string{"n"}},     // 3: n=$((n + more))
		{Reads: []string{"n"}},       // 4: [ "$n" -eq 0 ] && fail
	}
	got := depClosure(steps, map[int]struct{}{4: {}})
	for _, want := range []int{0, 1, 3} {
		if _, ok := got[want]; !ok {
			t.Errorf("step %d assigns `n` and must be included; closure = %v", want, sortedKeys(got))
		}
	}
	if _, ok := got[2]; ok {
		t.Errorf("step 2 is unrelated to `n` and must stay out; closure = %v", sortedKeys(got))
	}
}

func TestPrologueCoversHelperDefinitionsAfterTheFirstBrace(t *testing.T) {
	lines := strings.Split(strings.Join([]string{
		`#!/bin/bash`, // 1
		`set -u`,      // 2
		`# (the real script's cd is covered by TestTempScriptNeverMovesALineNumber)`, // 3
		`gatecheck() {`,              // 4
		`  echo gc`,                  // 5
		`}`,                          // 6  ← the old rule stopped here
		``,                           // 7
		`require_test() {`,           // 8
		`  if [ -f "$4" ]; then`,     // 9
		`    echo "    $1: PASS"`,    // 10
		`  else`,                     // 11
		`    echo "  FAIL [$1]" >&2`, // 12
		`    return 1`,               // 13
		`  fi`,                       // 14
		`}`,                          // 15
		``,                           // 16
		`# a real assertion step`,    // 17
		`require_test "X-001" ./p "TestY" file.go || exit $?`, // 18
	}, "\n"), "\n")

	prologueEnd, steps, err := segment(lines)
	if err != nil {
		t.Fatal(err)
	}
	// Stopping at line 6 is what made every narrowed run blank out `require_test` and
	// report "command not found" as a failing pin.
	if prologueEnd != 14 {
		t.Fatalf("prologueEnd = %d (line %d), want 14 (line 15, require_test's closing brace)",
			prologueEnd, prologueEnd+1)
	}
	if len(steps) != 1 {
		t.Fatalf("steps = %d (%+v), want 1: the comment + the calling step", len(steps), steps)
	}
	// 0-based: line 16 (blank) through line 18 (the call).
	if steps[0].start != 15 || steps[0].end != 17 {
		t.Errorf("the calling step = %+v, want 15-17", steps[0])
	}

	// End to end: run ONLY the calling step plus the prologue and it must work.
	out := tempScript(lines, []span{{0, prologueEnd}, {steps[0].start, steps[0].end}}, ".", true)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/file.go", []byte("package p\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, stdout, stderr := runScript(dir, out)
	if strings.Contains(stdout+stderr, "command not found") {
		t.Fatalf("the helper was blanked out of the subset run:\n%s\n%s", stdout, stderr)
	}
	if !strings.Contains(stdout, "X-001: PASS") {
		t.Errorf("the selected step never ran:\n%s\n%s", stdout, stderr)
	}
}

func TestSelectStepsSeparatesUntargetableAndUncovered(t *testing.T) {
	index := pinIndex{Steps: []stepIndex{
		{Paths: []string{"apps/api-go/cmd/pins/run.go"}},
		{Paths: nil},
		{Paths: []string{"apps/mobile/src/me.tsx"}},
	}}
	sel, untargetable, uncovered := selectSteps(index,
		[]string{"apps/api-go/cmd/pins/run.go", "docs/x.md"})
	if len(sel) != 1 || sel[0] != 0 {
		t.Errorf("selected = %v, want [0]", sel)
	}
	if len(untargetable) != 1 || untargetable[0] != 1 {
		t.Errorf("untargetable = %v, want [1]", untargetable)
	}
	if len(uncovered) != 1 || uncovered[0] != "docs/x.md" {
		t.Errorf("uncovered = %v, want [docs/x.md] — silence here is a coverage hole", uncovered)
	}
}

func TestBuildIndexCacheIsKeyedToSegmenterVersion(t *testing.T) {
	dir := t.TempDir()
	script := dir + "/pins.sh"
	if err := writeSample(t, script); err != nil {
		t.Fatal(err)
	}
	first, err := buildIndex(script)
	if err != nil {
		t.Fatal(err)
	}
	if first.SegmenterVer != segmenterVersion {
		t.Fatalf("index built with version %d, want %d", first.SegmenterVer, segmenterVersion)
	}
	second, err := buildIndex(script)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Steps) != len(first.Steps) {
		t.Errorf("cached index disagrees: %d steps vs %d", len(second.Steps), len(first.Steps))
	}
}
