package bootenv

import (
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
		"DATABASE_URL":               "postgres://u:p@h:5432/d",
		"PROXY_LOGIN_PROVIDER":       "smtp",
		"PROXY_SMTP_HOST":            "smtp.example.com",
		"PROXY_OPERATOR_PRINCIPALS":  "prin_alice,prin_bob",
		"MODELSTACK_CONTROL_PLANE_URL": "http://cp:14041",
		"MODELSTACK_GATEWAY_URL":       "http://gw:14042",
		"MODELSTACK_GATEWAY_API_KEY":   "secret",
		"OBJECT_STORAGE_ENDPOINT":    "https://s3.example.com",
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

func TestDefaultModeReturnsSimulatedForEmpty(t *testing.T) {
	if got := defaultMode(""); got != "simulated" {
		t.Fatalf("empty mode should map to simulated, got %q", got)
	}
	if got := defaultMode("smtp"); got != "smtp" {
		t.Fatalf("non-empty mode should round-trip, got %q", got)
	}
}
