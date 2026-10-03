package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// stepIndex is what one step of the pin script references. `assigns` / `reads` exist
// so a subset run can pull in the steps that define the variables it uses.
type stepIndex struct {
	Paths   []string `json:"paths"`
	Assigns []string `json:"assigns"`
	Reads   []string `json:"reads"`
	IDs     []string `json:"ids"`
	Start   int      `json:"start"`
	End     int      `json:"end"`
}

type pinIndex struct {
	Hash         string      `json:"hash"`
	Lines        int         `json:"lines"`
	PrologueEnd  int         `json:"prologue_end"`
	Steps        []stepIndex `json:"steps"`
	SegmenterVer int         `json:"segmenter_version"`
}

var (
	pathRe  = regexp.MustCompile(`\b(?:apps|packages|scripts|docs|i18n|contracts)/[A-Za-z0-9_./-]+\.(?:go|ts|tsx|js|jsx|mjs|cjs|py|sh|sql|json|md|ya?ml)\b`)
	goPkgRe = regexp.MustCompile(`\./([A-Za-z0-9_./-]+)`)
	srcRe   = regexp.MustCompile(`\bsrc/[A-Za-z0-9_./-]+\.tsx?\b`)
	varRe   = regexp.MustCompile(`\$\{?([a-z_][a-z0-9_]*)\}?`)
	// IDs appear in two shapes in the pin script: bracketed (`echo "  FAIL [ORDER-X-001]"`)
	// and quoted as the first argument of `require_test "ORDER-X-001" ...`. Missing the
	// second shape leaves most require_test steps showing "(no PIN-ID)".
	idRe       = regexp.MustCompile(`\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,6})\]`)
	quotedIDRe = regexp.MustCompile(`"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,6})"`)
)

func sortedUnique(in map[string]struct{}) []string {
	out := make([]string, 0, len(in))
	for k := range in {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// assignName mirrors `^\s*([a-z_][a-z0-9_]*)=(?!=)` — the trailing lookahead is
// spelled out because RE2 has none.
func assignName(line string) string {
	i := 0
	for i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		i++
	}
	start := i
	if i < len(line) && (line[i] == '_' || (line[i] >= 'a' && line[i] <= 'z')) {
		i++
		for i < len(line) && isWordByte(line[i]) && line[i] != '-' {
			i++
		}
	}
	if i == start || i >= len(line) || line[i] != '=' {
		return ""
	}
	if i+1 < len(line) && line[i+1] == '=' {
		return ""
	}
	return line[start:i]
}

func indexStep(text string) stepIndex {
	paths := map[string]struct{}{}
	for _, m := range pathRe.FindAllString(text, -1) {
		paths[m] = struct{}{}
	}
	for _, m := range goPkgRe.FindAllStringSubmatch(text, -1) {
		paths["apps/api-go/"+strings.TrimRight(m[1], "/")] = struct{}{}
	}
	for _, m := range srcRe.FindAllString(text, -1) {
		paths["apps/mobile/"+m] = struct{}{}
	}

	assigns := map[string]struct{}{}
	reads := map[string]struct{}{}
	for _, line := range strings.Split(text, "\n") {
		if v := assignName(line); v != "" {
			assigns[v] = struct{}{}
		}
		for _, m := range varRe.FindAllStringSubmatch(line, -1) {
			v := m[1]
			if _, owned := assigns[v]; !owned {
				reads[v] = struct{}{}
			}
		}
	}

	ids := map[string]struct{}{}
	for _, m := range idRe.FindAllStringSubmatch(text, -1) {
		ids[m[1]] = struct{}{}
	}
	if strings.Contains(text, "require_test") {
		for _, m := range quotedIDRe.FindAllStringSubmatch(text, -1) {
			ids[m[1]] = struct{}{}
		}
	}

	return stepIndex{Paths: sortedUnique(paths), Assigns: sortedUnique(assigns),
		Reads: sortedUnique(reads), IDs: sortedUnique(ids)}
}

// buildIndex caches by the pin script's sha256 so an edited script is never read
// through a stale index. The cache lives outside the repo: an untracked .json in
// scripts/ would trip the workspace-hygiene step.
func buildIndex(pinScript string) (pinIndex, error) {
	raw, err := os.ReadFile(pinScript)
	if err != nil {
		return pinIndex{}, err
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])[:16]

	home, homeErr := os.UserHomeDir()
	cacheDir := filepath.Join(home, ".cache", "proxy-pins")
	cachePath := filepath.Join(cacheDir, fmt.Sprintf("index-%s-v%d.json", digest, segmenterVersion))
	if homeErr == nil {
		if cached, err := os.ReadFile(cachePath); err == nil {
			var index pinIndex
			if json.Unmarshal(cached, &index) == nil && index.Hash == digest && index.SegmenterVer == segmenterVersion {
				return index, nil
			}
		}
	}

	lines := strings.Split(string(raw), "\n")
	prologueEnd, spans, err := segment(lines)
	if err != nil {
		return pinIndex{}, err
	}
	steps := make([]stepIndex, 0, len(spans))
	for _, s := range spans {
		text := strings.Join(lines[s.start:s.end+1], "\n")
		meta := indexStep(text)
		meta.Start = s.start + 1
		meta.End = s.end + 1
		steps = append(steps, meta)
	}

	index := pinIndex{Hash: digest, Lines: len(lines), PrologueEnd: prologueEnd + 1,
		Steps: steps, SegmenterVer: segmenterVersion}
	if homeErr == nil {
		if err := os.MkdirAll(cacheDir, 0o755); err == nil {
			if blob, err := json.Marshal(index); err == nil {
				_ = os.WriteFile(cachePath, blob, 0o644)
			}
		}
	}
	return index, nil
}

// covers answers "does this indexed path reference this changed file?" in both
// directions, because the pin script references some things as directories
// (`./internal/fulfillment`) and others as files.
func covers(indexed, changed string) bool {
	if indexed == changed {
		return true
	}
	if strings.HasPrefix(changed, strings.TrimRight(indexed, "/")+"/") {
		return true
	}
	if strings.HasPrefix(indexed, strings.TrimRight(changed, "/")+"/") {
		return true
	}
	return false
}

func changedFiles(root, base string) []string {
	cmds := [][]string{
		{"git", "diff", "--name-only", "--diff-filter=d"},
		{"git", "diff", "--name-only", "--cached", "--diff-filter=d"},
		{"git", "ls-files", "--others", "--exclude-standard"},
	}
	if base != "" {
		cmds = append([][]string{{"git", "diff", "--name-only", "--diff-filter=d", base}}, cmds...)
	}
	out := map[string]struct{}{}
	for _, c := range cmds {
		cmd := exec.Command(c[0], c[1:]...)
		cmd.Dir = root
		raw, err := cmd.Output()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(raw), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				out[line] = struct{}{}
			}
		}
	}
	return sortedUnique(out)
}

func stepMatches(st stepIndex, pattern string) bool {
	if pattern == "" {
		return true
	}
	if strings.Contains(strings.Join(st.IDs, " "), pattern) {
		return true
	}
	for _, p := range st.Paths {
		if strings.Contains(p, pattern) {
			return true
		}
	}
	return false
}

// depClosure adds the steps that assign variables the selected steps read. Without
// this a subset run trips `set -u` on a variable whose assignment lives in a skipped
// step, and reports a pin as RED when the pin is perfectly fine — measured
// 2026-09-30 with `--only AUTH-DOB-BOUNDS-001`. A tool that invents failures is as
// useless as one that hides them.
//
// ALL preceding assigners are pulled, not just the first. Counters like
// `_py_scan_files` are initialised in one step and incremented in several more; with
// only the first assigner kept, a `--only TOOLCHAIN-NO-PYTHON` run got `_py_scan_files=0`
// plus the final `[ ... -eq 0 ]` but none of the increments in between, and reported
// "scanned nothing" as a red pin. Measured 2026-10-03: the Python runner did exactly
// the same, so this is the port fixing a bug rather than the port introducing one.
func depClosure(steps []stepIndex, selected map[int]struct{}) map[int]struct{} {
	assigners := map[string][]int{}
	for i, st := range steps {
		for _, v := range st.Assigns {
			assigners[v] = append(assigners[v], i)
		}
	}
	for {
		grew := false
		for _, i := range sortedKeys(selected) {
			for _, v := range steps[i].Reads {
				for _, j := range assigners[v] {
					if j >= i {
						break
					}
					if _, have := selected[j]; !have {
						selected[j] = struct{}{}
						grew = true
					}
				}
			}
		}
		if !grew {
			return selected
		}
	}
}

func sortedKeys(set map[int]struct{}) []int {
	out := make([]int, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

// selectSteps returns (selected step indexes in order, steps that reference no file
// at all, changed files no step references).
func selectSteps(index pinIndex, files []string) ([]int, []int, []string) {
	selected := map[int]struct{}{}
	uncovered := map[string]struct{}{}
	for _, f := range files {
		uncovered[f] = struct{}{}
	}

	for i, st := range index.Steps {
		hit := false
		for _, p := range st.Paths {
			for _, f := range files {
				if covers(p, f) {
					hit = true
					delete(uncovered, f)
				}
			}
		}
		if hit {
			selected[i] = struct{}{}
		}
	}

	selected = depClosure(index.Steps, selected)

	var untargetable []int
	for i, st := range index.Steps {
		if len(st.Paths) == 0 {
			if _, keep := selected[i]; !keep {
				untargetable = append(untargetable, i)
			}
		}
	}
	return sortedKeys(selected), untargetable, sortedUnique(uncovered)
}
