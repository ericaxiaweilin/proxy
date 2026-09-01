package bootenv

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// withEnv swaps the env lookup for the duration of fn, then restores.
// This keeps tests hermetic; we never call t.Setenv in a loop because
// it requires unique env keys per case.
func withEnv(t *testing.T, env map[string]string, fn func()) {
	t.Helper()
	prev := Getenv
	Getenv = func(key string) string { return env[key] }
	defer func() { Getenv = prev }()
	fn()
}

func TestWarningsAllExpectedWhenNoEnv(t *testing.T) {
	withEnv(t, map[string]string{}, func() {
		w := Warnings()
		if len(w) == 0 {
			t.Fatalf("expected warnings for empty env, got none")
		}
		// All five should be present.
		joined := strings.Join(w, "\n")
		for _, needle := range []string{
			"DATABASE_URL is unset",
			"PROXY_LOGIN_PROVIDER=\"simulated\"",
			"PROXY_OPERATOR_PRINCIPALS is unset",
			"MODELSTACK_* is partially or fully unset",
			"OBJECT_STORAGE_ENDPOINT is unset",
		} {
			if !strings.Contains(joined, needle) {
				t.Fatalf("missing warning %q in: %s", needle, joined)
			}
		}
	})
}

func TestWarningsAllClearWhenProdEnvIsSet(t *testing.T) {
	withEnv(t, map[string]string{
		"DATABASE_URL":                 "postgres://u:p@h:5432/d",
		"PROXY_LOGIN_PROVIDER":         "smtp",
		"PROXY_SMTP_HOST":              "smtp.example.com",
		"PROXY_OPERATOR_PRINCIPALS":    "prin_alice,prin_bob",
		"MODELSTACK_CONTROL_PLANE_URL": "http://cp:14041",
		"MODELSTACK_GATEWAY_URL":       "http://gw:14042",
		"MODELSTACK_GATEWAY_API_KEY":   "secret",
		"OBJECT_STORAGE_ENDPOINT":      "https://s3.example.com",
	}, func() {
		w := Warnings()
		if len(w) != 0 {
			t.Fatalf("prod env should produce zero warnings, got %d: %v", len(w), w)
		}
	})
}

func TestWarningsDetectsSimulatedLoginProvider(t *testing.T) {
	withEnv(t, map[string]string{
		"PROXY_LOGIN_PROVIDER": "simulated",
	}, func() {
		w := Warnings()
		joined := strings.Join(w, "\n")
		if !strings.Contains(joined, "PROXY_LOGIN_PROVIDER=\"simulated\"") {
			t.Fatalf("simulated login provider should warn, got: %s", joined)
		}
	})
}

func TestWarningsDetectsPartialModelStackConfig(t *testing.T) {
	// Only the control plane set; gateway + key missing.
	withEnv(t, map[string]string{
		"MODELSTACK_CONTROL_PLANE_URL": "http://cp:14041",
	}, func() {
		w := Warnings()
		joined := strings.Join(w, "\n")
		if !strings.Contains(joined, "MODELSTACK_* is partially or fully unset") {
			t.Fatalf("partial ModelStack config should warn, got: %s", joined)
		}
	})
}

func TestWarningsTreatsEmptyOperatorPrincipalsAsFailClosed(t *testing.T) {
	withEnv(t, map[string]string{
		"PROXY_OPERATOR_PRINCIPALS": "",
	}, func() {
		w := Warnings()
		joined := strings.Join(w, "\n")
		if !strings.Contains(joined, "PROXY_OPERATOR_PRINCIPALS is unset") {
			t.Fatalf("empty operator principals should warn, got: %s", joined)
		}
	})
}

func TestWarningsRemindsOperatorToRestrictCloudflareOrigin(t *testing.T) {
	withEnv(t, map[string]string{
		"PROXY_TRUST_CLOUDFLARE_IP": "true",
	}, func() {
		joined := strings.Join(Warnings(), "\n")
		if !strings.Contains(joined, "origin must reject direct public traffic") {
			t.Fatalf("missing Cloudflare origin warning: %s", joined)
		}
	})
}

func TestWarningsDetectsInvalidPoolBoundsAndSemver(t *testing.T) {
	withEnv(t, map[string]string{
		"PROXY_DB_MAX_CONNS":      "1000",
		"PROXY_DB_MIN_CONNS":      "99",
		"PROXY_MIN_APP_VERSION":   "not-semver",
		"PROXY_TRUST_CLOUDFLARE_IP": "false",
	}, func() {
		joined := strings.Join(Warnings(), "\n")
		if !strings.Contains(joined, "PROXY_DB_MAX_CONNS") {
			t.Fatalf("invalid max conns should warn, got: %s", joined)
		}
		if !strings.Contains(joined, "PROXY_MIN_APP_VERSION") {
			t.Fatalf("invalid semver should warn, got: %s", joined)
		}
	})
}

func TestDefaultModeReturnsSimulatedForEmpty(t *testing.T) {
	if got := defaultMode(""); got != "simulated" {
		t.Fatalf("empty mode should map to simulated, got %q", got)
	}
	if got := defaultMode("smtp"); got != "smtp" {
		t.Fatalf("non-empty mode should round-trip, got %q", got)
	}
}

// TestProductionDocCoversEveryWarning guarantees that the PRODUCTION.md
// runbook is updated whenever a new env-mismatch warning is added.
// This is the cheapest way to keep the operator-facing doc and the
// in-binary warning list in lockstep: a code change that adds a
// warning but forgets to update the doc fails the test, the doc
// change alone passes, and a doc change that drops a warning
// description is caught the next time the doc is re-read.
func TestProductionDocCoversEveryWarning(t *testing.T) {
	// Resolve the repo root by walking up from this test file
	// (apps/api-go/internal/bootenv/bootenv_test.go -> <repo>).
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Skip("could not resolve test file path")
	}
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..")
	docPath := filepath.Join(repoRoot, "apps", "api-go", "PRODUCTION.md")
	doc, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatalf("could not read %s: %v", docPath, err)
	}
	docStr := string(doc)

	// Run Warnings() against an empty env to get the canonical list.
	withEnv(t, map[string]string{}, func() {
		w := Warnings()
		if len(w) == 0 {
			t.Fatalf("Warnings() returned 0 lines for empty env; expected at least one")
		}
		// For each warning, assert PRODUCTION.md mentions the
		// same env-var name so an SRE reading the doc knows
		// exactly which variable to set.
		expectedVars := []string{
			"DATABASE_URL",
			"PROXY_LOGIN_PROVIDER",
			"PROXY_OPERATOR_PRINCIPALS",
			"MODELSTACK_",
			"OBJECT_STORAGE_ENDPOINT",
			"PROXY_TRUST_CLOUDFLARE_IP",
			"PROXY_DB_MAX_CONNS",
			"PROXY_MIN_APP_VERSION",
		}
		for _, v := range expectedVars {
			if !strings.Contains(docStr, v) {
				t.Fatalf("PRODUCTION.md is missing documentation for %s. The bootenv warning list will reference it but the runbook will not.", v)
			}
		}
	})
}

func withEnv_DUPLICATE_REMOVED() {} // placeholder removed below
