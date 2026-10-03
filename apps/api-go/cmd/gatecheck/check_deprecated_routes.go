package main

import (
	"fmt"
	"regexp"
	"strings"
)

func init() { checks["deprecated-routes"] = deprecatedRoutes }

// P0 ARCH-01/DEPRECATION-01: the deprecated canonical screens must stay
// unreachable in the shipped build.
func deprecatedRoutes(root string, _ []string) error {
	personalHubBranch, err := regexp.Compile(`if \(subPage\.route === "personalhub"\)`)
	if err != nil {
		return err
	}
	experienceTab, err := regexp.Compile(`EXPERIENCE.*Tab`)
	if err != nil {
		return err
	}

	rules := []struct {
		name            string
		file            string
		mustContain     string
		mustNotMatch    *regexp.Regexp
		regionForbidden []string // scanned only inside the matched branch
		regionMarker    *regexp.Regexp
		regionSize      int
	}{
		{
			name:         "Market API only OPPORTUNITY/ACTIVITY",
			file:         "apps/mobile/src/surfaces/market.tsx",
			mustContain:  "OPPORTUNITY",
			mustNotMatch: experienceTab,
		},
		{
			// The old personal hub rendered a QR of its own; the QR is a
			// storefront/invite surface now (PROFILE-QR-002).
			name:            "Profile no QR in personalhub",
			file:            "apps/mobile/src/surfaces/me.tsx",
			regionMarker:    personalHubBranch,
			regionSize:      5000,
			regionForbidden: []string{"QrCard"},
		},
		{
			name:         "Home no For You",
			file:         "apps/mobile/src/surfaces/home-assistant.tsx",
			mustNotMatch: regexp.MustCompile(`For You`),
		},
	}

	var failures []string
	for _, c := range rules {
		source, err := read(root, c.file)
		if err != nil {
			// A missing file is a failure, not a SKIP: the old Node script
			// printed SKIP and still exited 0, so deleting the screen it was
			// supposed to guard would have passed the gate.
			failures = append(failures, err.Error())
			continue
		}
		if c.mustContain != "" && !strings.Contains(source, c.mustContain) {
			failures = append(failures, fmt.Sprintf("FAIL: %s missing %s", c.name, c.mustContain))
			continue
		}
		if c.mustNotMatch != nil && c.mustNotMatch.MatchString(source) {
			failures = append(failures, fmt.Sprintf("FAIL: %s contains forbidden %s", c.name, c.mustNotMatch.String()))
			continue
		}
		if c.regionMarker != nil {
			loc := c.regionMarker.FindStringIndex(source)
			if loc == nil {
				failures = append(failures, fmt.Sprintf("FAIL: %s — the branch it guards (%s) is gone", c.name, c.regionMarker.String()))
				continue
			}
			end := loc[0] + c.regionSize
			if end > len(source) {
				end = len(source)
			}
			for _, needle := range c.regionForbidden {
				if strings.Contains(source[loc[0]:end], needle) {
					failures = append(failures, fmt.Sprintf("FAIL: %s contains forbidden %s", c.name, needle))
				}
			}
		}
		fmt.Printf("PASS: %s\n", c.name)
	}

	experience, err := read(root, "apps/api-go/internal/experience/service.go")
	if err != nil {
		failures = append(failures, err.Error())
	} else if strings.Contains(experience, "ExperienceInventory") {
		fmt.Println("WARN: ExperienceInventory still referenced — ensure DEPRECATED")
	} else {
		fmt.Println("PASS: ExperienceInventory not created")
	}

	if len(failures) > 0 {
		return fmt.Errorf("deprecated route check failed:\n%s", prefixEach(failures))
	}
	return nil
}

func prefixEach(lines []string) string {
	var out []string
	for _, line := range lines {
		out = append(out, "- "+line)
	}
	return strings.Join(out, "\n")
}
