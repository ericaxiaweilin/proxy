// Package openapicmds enumerates every command type the api-go
// backend can dispatch, by scanning the `case "X"` arms inside each
// domain service's HandleContext switch. The result is rendered as a
// YAML fragment consumed by the openapi drift check (see
// scripts/generate_openapi.go -check).
//
// Why scanning rather than reflection: a domain service might
// implement HandleContext with a long switch over commandType, or
// delegate to other service sub-objects. The "case X" sentinel is the
// single canonical place where a command type appears in code, and
// the only place where new commands get added. Drift detection here
// is therefore a strict superset of reflection-based discovery.
package openapicmds

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// DomainDir pairs a domain's service directory name (in
// apps/api-go/internal) with the public domain name used in the
// generated fragment. The order here is purely cosmetic; it does
// not affect drift detection.
var DomainDir = []struct {
	Dir  string
	Name string
}{
	{"activity", "Activity"},
	{"benefit", "Benefit"},
	{"business", "Business"},
	{"citycompanion", "CityCompanion"},
	{"contribution", "Contribution"},
	{"conversation", "Conversation"},
	{"demand", "Demand"},
	{"engagement", "Engagement"},
	{"experience", "Experience"},
	{"fulfillment", "Fulfillment"},
	{"growth", "Growth"},
	{"identity", "Identity"},
	{"localcontext", "LocalContext"},
	{"localnet", "LocalNet"},
	{"location", "Location"},
	{"marketplace", "Marketplace"},
	{"media", "Media"},
	{"moderation", "Moderation"},
	{"notification", "Notification"},
	{"outcome", "Outcome"},
	{"payment", "Payment"},
	{"profile", "Profile"},
	{"rating", "Rating"},
	{"realityscene", "RealityScene"},
	{"relationship", "Relationship"},
	{"safety", "Safety"},
	{"scene", "Scene"},
	{"scenereview", "SceneReview"},
	{"socialspace", "SocialSpace"},
	{"storeonboarding", "StoreOnboarding"},
	{"supply", "Supply"},
	{"voucher", "Voucher"},
	{"wallet", "Wallet"},
}

// 漏登记的代价（2026-09-14 实测，OPENAPI-DOMAIN-001）：域不在这个清单里，
// 生成器就永远不看它 —— 于是它的命令**能 dispatch、跑得好好的，却不在契约里**，
// 而漂移检查照样绿：它比对的是「重新生成 vs 已提交」，两边缺的是同一个命令。
// 这次一并补回 benefit / location / marketplace / profile / realityscene /
// relationship 六个域（共 37 条命令），它们都接在 command_dispatch.go 上，
// 只是从 fb9e377 引入漂移检查起就没人回头登记过。
// 防复发不靠记性：见 scripts/check-regression-contracts.sh 的 OPENAPI-DOMAIN-001。

// casePattern matches every quoted identifier that appears in a
// `case "X", "Y", "Z":` arm. We require the line to begin with
// `case` (allowing leading whitespace) so we don't pick up random
// string literals that happen to look like command names.
var casePattern = regexp.MustCompile(`(?m)^\s*case\s+(?:"[A-Z][a-zA-Z0-9]+"(?:\s*,\s*"[A-Z][a-zA-Z0-9]+")*)`)
var quotedIdent = regexp.MustCompile(`"([A-Z][a-zA-Z0-9]+)"`)

// Command captures a single (command, domain) pair discovered by
// scanning the source.
type Command struct {
	Command string
	Domain  string
}

// IsLikelyCommand filters case-labels that are clearly not commands.
// We accept CamelCase identifiers and reject all-caps enum literals
// (ACCEPTED, REJECTED, PENDING, ...) that appear in state-machine
// branches.
func IsLikelyCommand(name string) bool {
	if name == "" {
		return false
	}
	allUpper := true
	for _, c := range name {
		if c >= 'a' && c <= 'z' {
			allUpper = false
			break
		}
	}
	if allUpper {
		return false
	}
	switch name {
	case "OK", "Yes", "No", "True", "False", "Empty", "Set", "Get":
		return false
	}
	return true
}

// ScanSource returns the unique command-shaped case-labels in src.
func ScanSource(src string) []string {
	matches := casePattern.FindAllString(src, -1)
	seen := make(map[string]bool)
	out := make([]string, 0, len(matches))
	for _, arm := range matches {
		for _, id := range quotedIdent.FindAllStringSubmatch(arm, -1) {
			name := id[1]
			if !IsLikelyCommand(name) {
				continue
			}
			if !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
	}
	return out
}

// Collect walks every domain service file under internal/<dir>/ and
// returns the (command, domain) map. The first domain wins on
// collisions (cross-domain commands are not expected in this
// codebase; if they ever appear, a domain should disambiguate at
// dispatch time).
func Collect(fileReader func(path string) (string, error), files func(domainDir string) []string) map[string]string {
	commands := make(map[string]string)
	for _, d := range DomainDir {
		for _, f := range files(d.Dir) {
			src, err := fileReader(f)
			if err != nil {
				continue
			}
			for _, c := range ScanSource(src) {
				if _, ok := commands[c]; !ok {
					commands[c] = d.Name
				}
			}
		}
	}
	return commands
}

// RenderFragment produces the YAML fragment from a (command, domain)
// map. Output is sorted alphabetically so re-runs are byte-identical
// to the committed file (a prerequisite for drift detection).
func RenderFragment(commands map[string]string) string {
	keys := make([]string, 0, len(commands))
	for k := range commands {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	sb.WriteString("# AUTOGENERATED — do not edit by hand.\n")
	sb.WriteString("# Regenerate with: go run ./cmd/openapi-commands\n")
	sb.WriteString("# Drift check with: go run ./cmd/openapi-commands -check\n")
	sb.WriteString("#\n")
	sb.WriteString("# This file enumerates every command type the api-go server\n")
	sb.WriteString("# can dispatch, by scanning the `case \"X\"` arms in every\n")
	sb.WriteString("# domain service's HandleContext switch. Adding a new command\n")
	sb.WriteString("# without updating this file fails the drift check at CI.\n")
	sb.WriteString("commands:\n")
	for _, k := range keys {
		fmt.Fprintf(&sb, "  - command: %s\n", k)
		fmt.Fprintf(&sb, "    domain: %s\n", commands[k])
	}
	return sb.String()
}
