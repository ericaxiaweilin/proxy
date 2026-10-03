package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func init() { checks["design-baseline"] = designBaseline }

// designBaseline is the port of scripts/check-design-baseline.mjs. It reads the
// two declared-truth files (docs/design/CURRENT_BASELINE.json and
// IMPLEMENTATION_CONTRACTS.json) and fails on everything they claim but the
// repository does not deliver.
//
// The port keeps the JS error strings verbatim, including `undefined`/`null`
// rendering: DESIGN-STATUS-ENUM-001 exists because comparing an enum against a
// typo'd literal silently disables the check, so the messages are the evidence
// that the comparison happened.

const (
	baselineManifestRel        = "docs/design/CURRENT_BASELINE.json"
	implementationContractsRel = "docs/design/IMPLEMENTATION_CONTRACTS.json"
	baselineChangelogRel       = "docs/design/BASELINE_CHANGELOG.md"
	// GUARD-SELF-SENSITIVE-001: the gate's own source is baseline-sensitive, so
	// emptying a check here needs the same design acknowledgement as touching an
	// implementation file. The mjs original named itself; this names the Go file
	// that now holds the logic.
	designBaselineSelfRel = "apps/api-go/cmd/gatecheck/check_design_baseline.go"
)

// The declared enums. Adding a status means editing this list — a deliberate
// decision, which is the whole point of the check.
var (
	screenReferenceStatuses = []string{"ACTIVE_SCREEN_REFERENCE", "ACTIVE_IMPLEMENTATION_REFERENCE", "FUNCTIONAL_REFERENCE_ONLY"}
	contractStatuses        = []string{"PARTIAL", "SCAFFOLD_ONLY", "IMPLEMENTED"}
	schemaVersions          = []float64{1}
	globalStatuses          = []string{"ACTIVE"}
	workspaceModes          = []string{"SINGLE_WRITER", "MULTI_WRITER"}
	externalAgentModes      = []string{"ISOLATED_WORKTREE"}
)

var (
	dateOnlyRE       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	archivePathRE    = regexp.MustCompile(`(^|/)archive/`)
	archivedRefRE    = regexp.MustCompile(`docs/design/archive|archive/prototypes`)
	unnamedPreviewRE = regexp.MustCompile(`(?i)^preview \(\d+\)\.html$`)
)

func designBaseline(root string, _ []string) error {
	var errs []string
	manifestPath := filepath.Join(root, baselineManifestRel)
	contractsPath := filepath.Join(root, implementationContractsRel)

	var manifest map[string]any
	if !fileExists(manifestPath) {
		errs = append(errs, "missing "+baselineManifestRel)
	} else {
		body, err := os.ReadFile(manifestPath)
		if err != nil {
			return toolError{code: 1, msg: "Design baseline check failed: cannot read " + baselineManifestRel + ": " + err.Error()}
		}
		if err := json.Unmarshal(body, &manifest); err != nil {
			return toolError{code: 1, msg: "Design baseline check failed: " + baselineManifestRel + " is not valid JSON: " + err.Error()}
		}
		errs = append(errs, baselineRules(root, manifest)...)
	}

	var contracts map[string]any
	if !fileExists(contractsPath) {
		errs = append(errs, "missing "+implementationContractsRel)
	} else {
		body, err := os.ReadFile(contractsPath)
		if err != nil {
			return toolError{code: 1, msg: "Design baseline check failed: cannot read " + implementationContractsRel + ": " + err.Error()}
		}
		if err := json.Unmarshal(body, &contracts); err != nil {
			return toolError{code: 1, msg: "Design baseline check failed: " + implementationContractsRel + " is not valid JSON: " + err.Error()}
		}
		errs = append(errs, contractRules(root, manifest, contracts)...)
	}

	gitErrs, err := gitBackedRules(root, contractsPath, contracts)
	if err != nil {
		errs = append(errs, err.Error())
	} else {
		errs = append(errs, gitErrs...)
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return toolError{code: 1, msg: "Design baseline check failed: cannot read the repository root: " + err.Error()}
	}
	for _, entry := range entries {
		if unnamedPreviewRE.MatchString(entry.Name()) {
			errs = append(errs, "unnamed preview must be versioned and filed under docs/design: "+entry.Name())
		}
	}

	if len(errs) > 0 {
		return toolError{code: 1, msg: "Design baseline check failed:\n- " + strings.Join(errs, "\n- ")}
	}
	fmt.Println("Design baseline check passed.")
	return nil
}

// baselineRules checks CURRENT_BASELINE.json: the declared enums, the fields
// that used to be written and never read, and every path the baseline names.
func baselineRules(root string, manifest map[string]any) []string {
	var errs []string

	rev, _ := jsonDig(manifest, "baselineRevision")
	if !isJsInteger(rev) || jsNum(rev) < 1 {
		errs = append(errs, "baselineRevision must be a positive integer")
	}

	if v, ok := jsonDig(manifest, "schemaVersion"); !inNumbers(v, ok, schemaVersions) {
		errs = append(errs, fmt.Sprintf("schemaVersion is not a known schema: %s — expected one of %s",
			stringifyValue(v, ok), joinNumbers(schemaVersions)))
	}
	if v, ok := jsonDig(manifest, "global", "status"); !inStrings(v, ok, globalStatuses) {
		errs = append(errs, fmt.Sprintf("global.status is not a known status: %s — expected one of %s",
			stringifyValue(v, ok), strings.Join(globalStatuses, ", ")))
	}
	if v, ok := jsonDig(manifest, "updatedAt"); !isDateValue(v) || !parsableDate(jsonStr(v)) {
		errs = append(errs, fmt.Sprintf("updatedAt must be a YYYY-MM-DD date: %s", stringifyValue(v, ok)))
	}
	if v, ok := jsonDig(manifest, "integration", "workspaceMode"); !inStrings(v, ok, workspaceModes) {
		errs = append(errs, fmt.Sprintf("integration.workspaceMode is not a known mode: %s — expected one of %s",
			stringifyValue(v, ok), strings.Join(workspaceModes, ", ")))
	}
	if v, ok := jsonDig(manifest, "integration", "externalAgentMode"); !inStrings(v, ok, externalAgentModes) {
		errs = append(errs, fmt.Sprintf("integration.externalAgentMode is not a known mode: %s — expected one of %s",
			stringifyValue(v, ok), strings.Join(externalAgentModes, ", ")))
	}

	// RECOVERY-TAG-EXISTS-001: an empty or absent tag means "not declared"; once
	// declared it must resolve, otherwise the recovery plan is silently empty.
	tag, _ := jsonDig(manifest, "integration", "recoveryBaselineTag")
	recoveryTag := jsonStr(tag)
	if recoveryTag != "" {
		if _, err := gitRun(root, "rev-parse", "-q", "--verify", "refs/tags/"+recoveryTag); err != nil {
			errs = append(errs, "integration.recoveryBaselineTag does not resolve to a tag: "+recoveryTag)
		}
	}

	// BASELINE-PATH-ROT-001: every path the baseline declares must exist, and the
	// message names the field that rotted rather than just the file.
	declared := [][2]string{
		{"global.designSystem", jsonStr(must(jsonDig(manifest, "global", "designSystem")))},
		{"global.visualReference", jsonStr(must(jsonDig(manifest, "global", "visualReference")))},
		{"production.iconRegistry", jsonStr(must(jsonDig(manifest, "production", "iconRegistry")))},
		{"production.theme", jsonStr(must(jsonDig(manifest, "production", "theme")))},
		{"production.uiFoundation", jsonStr(must(jsonDig(manifest, "production", "uiFoundation")))},
		{"production.uiFoundationContract", jsonStr(must(jsonDig(manifest, "production", "uiFoundationContract")))},
		{"integration.policy", jsonStr(must(jsonDig(manifest, "integration", "policy")))},
	}

	refs := jsonArray(must(jsonDig(manifest, "screenReferences")))
	for index, item := range refs {
		entry := jsonObject(item)
		if v, ok := jsonDig(entry, "status"); !inStrings(v, ok, screenReferenceStatuses) {
			errs = append(errs, fmt.Sprintf("screenReferences[%d].status is not a known status: %s — expected one of %s",
				index, stringifyValue(v, ok), strings.Join(screenReferenceStatuses, ", ")))
		}
		declared = append(declared, [2]string{fmt.Sprintf("screenReferences[%d].file", index), jsonStr(must(jsonDig(entry, "file")))})
		declared = append(declared, [2]string{fmt.Sprintf("screenReferences[%d].implementationBaseline", index), jsonStr(must(jsonDig(entry, "implementationBaseline")))})
		if v, present := jsonDig(entry, "version"); present {
			s, isString := v.(string)
			if !isString || strings.TrimSpace(s) == "" {
				errs = append(errs, fmt.Sprintf("screenReferences[%d].version must be a non-empty string when present", index))
			}
		}
		// SOURCE-MOCKUP-PATH-001: sourceMockups[] records in-repo paths for the
		// prototypes, so a reference stops being an unverifiable sentence.
		for mockupIndex, mockup := range jsonArray(must(jsonDig(entry, "sourceMockups"))) {
			declared = append(declared, [2]string{
				fmt.Sprintf("screenReferences[%d].sourceMockups[%d]", index, mockupIndex), jsonStr(mockup)})
		}
	}
	for index, item := range jsonArray(must(jsonDig(manifest, "legacy"))) {
		if s, ok := item.(string); ok {
			declared = append(declared, [2]string{fmt.Sprintf("legacy[%d]", index), s})
		}
	}

	for _, pair := range declared {
		if pair[1] == "" {
			continue
		}
		if !fileExists(resolveIn(root, pair[1])) {
			errs = append(errs, pair[0]+" does not exist: "+pair[1])
		}
	}

	for _, item := range refs {
		entry := jsonObject(item)
		if jsonStr(must(jsonDig(entry, "status"))) == "ACTIVE_SCREEN_REFERENCE" &&
			archivePathRE.MatchString(jsonStr(must(jsonDig(entry, "file")))) {
			errs = append(errs, "active screen reference cannot point into archive: "+jsonStr(must(jsonDig(entry, "scope"))))
		}
	}

	errs = append(errs, revisionRules(root, manifest, refs)...)
	return errs
}

// revisionRules compares the working file against HEAD: baselineRevision may not
// regress, and an ACTIVE scope may not disappear or downgrade without a bump.
// No HEAD version means nothing comparable (the field's first introduction).
func revisionRules(root string, manifest map[string]any, refs []any) []string {
	var errs []string
	body, err := gitRun(root, "show", "HEAD:"+baselineManifestRel)
	if err != nil {
		return nil
	}
	var previous map[string]any
	if err := json.Unmarshal([]byte(body), &previous); err != nil {
		return nil
	}
	currentRev, _ := jsonDig(manifest, "baselineRevision")
	prevRev, _ := jsonDig(previous, "baselineRevision")
	if jsNum(currentRev) < jsNum(prevRev) {
		errs = append(errs, fmt.Sprintf("baselineRevision regressed from %s to %s",
			looseValue(prevRev, true), looseValue(currentRev, true)))
	}

	currentByScope := map[string]map[string]any{}
	for _, item := range refs {
		entry := jsonObject(item)
		currentByScope[jsonStr(must(jsonDig(entry, "scope")))] = entry
	}
	for _, item := range jsonArray(must(jsonDig(previous, "screenReferences"))) {
		old := jsonObject(item)
		if jsonStr(must(jsonDig(old, "status"))) != "ACTIVE_SCREEN_REFERENCE" {
			continue
		}
		scope := jsonStr(must(jsonDig(old, "scope")))
		current, found := currentByScope[scope]
		if !found {
			errs = append(errs, "active scope was removed: "+scope)
			continue
		}
		if jsonStr(must(jsonDig(current, "status"))) != "ACTIVE_SCREEN_REFERENCE" && jsNum(currentRev) == jsNum(prevRev) {
			errs = append(errs, "active scope was downgraded without a baseline revision: "+scope)
		}
	}
	return errs
}

// contractRules checks IMPLEMENTATION_CONTRACTS.json against the baseline and
// against the files that actually exist.
func contractRules(root string, manifest map[string]any, contracts map[string]any) []string {
	var errs []string
	contractList := jsonArray(must(jsonDig(contracts, "contracts")))

	activeScopes := []string{}
	seenActive := map[string]bool{}
	for _, item := range jsonArray(must(jsonDig(manifest, "screenReferences"))) {
		entry := jsonObject(item)
		if jsonStr(must(jsonDig(entry, "status"))) != "ACTIVE_SCREEN_REFERENCE" {
			continue
		}
		scope := jsonStr(must(jsonDig(entry, "scope")))
		if !seenActive[scope] {
			seenActive[scope] = true
			activeScopes = append(activeScopes, scope)
		}
	}

	contractScopes := map[string]bool{}
	for _, item := range contractList {
		contract := jsonObject(item)
		scope := jsonStr(must(jsonDig(contract, "scope")))
		contractScopes[scope] = true

		reference := jsonStr(must(jsonDig(contract, "reference")))
		if reference == "" || archivePathRE.MatchString(reference) {
			errs = append(errs, "contract "+scope+" has invalid reference")
		} else if !fileExists(resolveIn(root, reference)) {
			errs = append(errs, "contract "+scope+" reference does not exist: "+reference)
		}
		files := append(jsonArray(must(jsonDig(contract, "implementationFiles"))),
			jsonArray(must(jsonDig(contract, "evidenceFiles")))...)
		for _, file := range files {
			name := jsonStr(file)
			if !fileExists(resolveIn(root, name)) {
				errs = append(errs, "contract "+scope+" file does not exist: "+name)
			}
		}
		if v, ok := jsonDig(contract, "status"); !inStrings(v, ok, contractStatuses) {
			errs = append(errs, fmt.Sprintf("contract %s has unknown status: %s — expected one of %s",
				scope, stringifyValue(v, ok), strings.Join(contractStatuses, ", ")))
		}
		// Any status short of IMPLEMENTED has to say what is missing, so
		// SCAFFOLD_ONLY cannot leave knownGap blank.
		status, _ := jsonDig(contract, "status")
		gap, gapPresent := jsonDig(contract, "knownGap")
		if jsonStr(status) != "IMPLEMENTED" && !jsTruthy(gap, gapPresent) {
			errs = append(errs, "contract "+scope+" must describe its gap (status "+looseValue(status, true)+")")
		}
	}

	for _, scope := range activeScopes {
		if !contractScopes[scope] {
			errs = append(errs, "active scope has no implementation contract: "+scope)
		}
	}
	return errs
}

// gitBackedRules is the part that reads the index: production sources must not
// reference archived designs, and baseline-sensitive files may not change
// without the baseline + changelog in the same staged set.
//
// DESIGN-BASELINE-DELETED-001: a tracked file that is deleted in the work tree
// cannot reference anything, so it is skipped — deleting a file is normal work,
// and reporting it as baseline drift would mislabel it. The contract existence
// checks above still catch a missing baseline file.
func gitBackedRules(root, contractsPath string, contracts map[string]any) ([]string, error) {
	var errs []string

	productionFiles, err := gitLines(root, "ls-files", "apps/mobile/src")
	if err != nil {
		return nil, fmt.Errorf("unable to evaluate git-backed baseline rules: %w", err)
	}
	deletedList, err := gitLines(root, "ls-files", "--deleted", "apps/mobile/src")
	if err != nil {
		return nil, fmt.Errorf("unable to evaluate git-backed baseline rules: %w", err)
	}
	deleted := map[string]bool{}
	for _, file := range deletedList {
		deleted[file] = true
	}
	for _, file := range productionFiles {
		if deleted[file] {
			continue
		}
		body, err := read(root, file)
		if err != nil {
			return nil, fmt.Errorf("unable to evaluate git-backed baseline rules: %w", err)
		}
		if archivedRefRE.MatchString(body) {
			errs = append(errs, "production source references archived design: "+file)
		}
	}

	staged, err := gitLines(root, "diff", "--cached", "--name-only")
	if err != nil {
		return nil, fmt.Errorf("unable to evaluate git-backed baseline rules: %w", err)
	}
	if fileExists(contractsPath) && len(staged) > 0 {
		sensitive := map[string]bool{designBaselineSelfRel: true}
		for _, item := range jsonArray(must(jsonDig(contracts, "contracts"))) {
			for _, file := range jsonArray(must(jsonDig(jsonObject(item), "implementationFiles"))) {
				sensitive[jsonStr(file)] = true
			}
		}
		var touched []string
		for _, file := range staged {
			if sensitive[file] {
				touched = append(touched, file)
			}
		}
		acknowledgement := false
		hasChangelog := false
		for _, file := range staged {
			if file == baselineManifestRel || file == implementationContractsRel {
				acknowledgement = true
			}
			if file == baselineChangelogRel {
				hasChangelog = true
			}
		}
		acknowledgement = acknowledgement && hasChangelog
		if len(touched) > 0 && !acknowledgement {
			errs = append(errs, "baseline-sensitive implementation changed without design acknowledgement: "+strings.Join(touched, ", "))
		}
	}
	return errs, nil
}

func gitLines(root string, args ...string) ([]string, error) {
	out, err := gitRun(root, args...)
	if err != nil {
		return nil, err
	}
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines, nil
}

func resolveIn(root, path string) string {
	if path == "" {
		return ""
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(root, path)
}

// ---- JSON access, with JavaScript's absent/null distinction ----

func must(v any, _ bool) any { return v }

func jsonDig(v any, keys ...string) (any, bool) {
	current := v
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		next, present := object[key]
		if !present {
			return nil, false
		}
		current = next
	}
	return current, true
}

func jsonObject(v any) map[string]any {
	if object, ok := v.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func jsonArray(v any) []any {
	if items, ok := v.([]any); ok {
		return items
	}
	return nil
}

func jsonStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func jsNum(v any) float64 {
	if n, ok := v.(float64); ok {
		return n
	}
	return math.NaN()
}

func isJsInteger(v any) bool {
	n, ok := v.(float64)
	return ok && !math.IsInf(n, 0) && !math.IsNaN(n) && math.Trunc(n) == n
}

func inStrings(v any, present bool, allowed []string) bool {
	s, ok := v.(string)
	if !ok || !present {
		return false
	}
	for _, candidate := range allowed {
		if candidate == s {
			return true
		}
	}
	return false
}

func inNumbers(v any, present bool, allowed []float64) bool {
	n, ok := v.(float64)
	if !ok || !present {
		return false
	}
	for _, candidate := range allowed {
		if candidate == n {
			return true
		}
	}
	return false
}

func joinNumbers(values []float64) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, formatJsNumber(value))
	}
	return strings.Join(parts, ", ")
}

func parsableDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func isDateValue(v any) bool {
	s, ok := v.(string)
	return ok && dateOnlyRE.MatchString(s) && parsableDate(s)
}

func jsTruthy(v any, present bool) bool {
	if !present || v == nil {
		return false
	}
	switch value := v.(type) {
	case bool:
		return value
	case string:
		return value != ""
	case float64:
		return value != 0 && !math.IsNaN(value)
	default:
		return true
	}
}

// stringifyValue renders a value the way JSON.stringify + template interpolation
// did: an absent field reads `undefined`, a JSON null reads `null`.
func stringifyValue(v any, present bool) string {
	if !present {
		return "undefined"
	}
	body, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(body)
}

// looseValue renders String(value) — unquoted — the way the mjs templates did.
func looseValue(v any, present bool) string {
	if !present {
		return "undefined"
	}
	switch value := v.(type) {
	case nil:
		return "null"
	case string:
		return value
	case bool:
		return strconv.FormatBool(value)
	case float64:
		return formatJsNumber(value)
	default:
		body, err := json.Marshal(value)
		if err != nil {
			return fmt.Sprintf("%v", value)
		}
		return string(body)
	}
}

// formatJsNumber matches JS's number→string, which trims the trailing ".0" that
// Go's %v keeps for a float64 holding an integer.
func formatJsNumber(n float64) string {
	if n == math.Trunc(n) && !math.IsInf(n, 0) && math.Abs(n) < 1e21 {
		return strconv.FormatInt(int64(n), 10)
	}
	return strconv.FormatFloat(n, 'g', -1, 64)
}
