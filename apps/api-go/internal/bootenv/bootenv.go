// Package bootenv validates the env the api-go binary expects to see
// in a production deployment. It never fatals: a fresh dev box is
// still useful. Instead it returns a list of human-readable warnings
// the binary logs at startup so an SRE triaging a misconfigured prod
// instance sees them on the first lines of journalctl.
//
// The intent matches the audit gate #6 contract: "production login,
// admission, funding, notification, and downstream event delivery
// providers must be configured." See apps/api-go/PRODUCTION.md for
// the canonical reference of every variable checked here.
package bootenv

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Getenv is the indirection used to look up environment variables.
// Tests override it to capture the prod-shaped env without touching
// the process environment.
var Getenv = os.Getenv

// Warnings returns the list of env-mismatch warnings for the current
// process. Order is stable so tests can assert exact membership.
func Warnings() []string {
	var warnings []string
	// DATABASE_URL: production SHOULD set it; without it the API
	// serves from in-memory stores (single process, no recovery).
	if Getenv("DATABASE_URL") == "" {
		warnings = append(warnings, "DATABASE_URL is unset; using in-memory stores (dev/test only, no data survives restart)")
	}
	// Login provider. LOGIN-PROVIDER-BOOT-001: an EMPTY PROXY_LOGIN_PROVIDER
	// does not degrade to "simulated" — cmd/api's wire_providers.go treats
	// unset the same as an unrecognized mode and refuses to boot (previously
	// it silently fell back to a fail-closed provider that rejected every
	// OTP request, which is the actual mechanism behind the recurring
	// "验证码服务尚未配置" reports). This warning must never claim the empty
	// case is "simulated" — that wording is what made the fail-closed state
	// look like a working dev mode in the boot log.
	mode := Getenv("PROXY_LOGIN_PROVIDER")
	if mode == "" {
		warnings = append(warnings, "PROXY_LOGIN_PROVIDER is unset; the API will refuse to boot (fail-closed, not simulated) — set it to \"simulated\", \"smtp\", \"sms\", or \"production\"")
	} else if mode == "simulated" {
		warnings = append(warnings, "PROXY_LOGIN_PROVIDER=\"simulated\" is dev-only; configure PROXY_SMTP_HOST (or PROXY_SMS_URL) for production")
	}
	// Operator gate: empty = every privileged command is rejected.
	// This is fail-closed by design but we surface it as a warning
	// so the operator knows the consequences.
	if Getenv("PROXY_OPERATOR_PRINCIPALS") == "" {
		warnings = append(warnings, "PROXY_OPERATOR_PRINCIPALS is unset; privileged commands (capability review, contribution moderation, payout, media readiness override) are all rejected")
	}
	// ModelStack: any one missing -> Experience Runtime falls back
	// to deterministic stubs.
	if Getenv("MODELSTACK_CONTROL_PLANE_URL") == "" || Getenv("MODELSTACK_GATEWAY_URL") == "" || Getenv("MODELSTACK_GATEWAY_API_KEY") == "" {
		warnings = append(warnings, "MODELSTACK_* is partially or fully unset; Experience Runtime / Market Intelligence Console will fall back to deterministic stubs (no model-routed rankings)")
	}
	// Object storage: media upload and playback degrade to a local
	// filesystem sink. Acceptable in dev, never in prod.
	if Getenv("OBJECT_STORAGE_ENDPOINT") == "" {
		warnings = append(warnings, "OBJECT_STORAGE_ENDPOINT is unset; media uploads will use the local filesystem sink (no CDN, no bucket lifecycle)")
	}
	if value := Getenv("PROXY_TRUST_CLOUDFLARE_IP"); value == "1" || value == "true" || value == "yes" || value == "on" {
		warnings = append(warnings, "PROXY_TRUST_CLOUDFLARE_IP is enabled; the origin must reject direct public traffic before CF-Connecting-IP can be trusted")
	}
	if value := Getenv("PROXY_DB_MAX_CONNS"); value != "" {
		if n, err := parseInt32(value); err != nil || n < 1 || n > 200 {
			warnings = append(warnings, fmt.Sprintf("PROXY_DB_MAX_CONNS=%q is out of range 1-200; using safe default 20", value))
		}
	}
	if value := Getenv("PROXY_DB_MIN_CONNS"); value != "" {
		if n, err := parseInt32(value); err != nil || n < 0 {
			warnings = append(warnings, fmt.Sprintf("PROXY_DB_MIN_CONNS=%q is invalid; using safe default", value))
		} else if maxStr := Getenv("PROXY_DB_MAX_CONNS"); maxStr != "" {
			if maxVal, err := parseInt32(maxStr); err == nil && n > maxVal {
				warnings = append(warnings, fmt.Sprintf("PROXY_DB_MIN_CONNS=%q exceeds PROXY_DB_MAX_CONNS=%q; using safe default", value, maxStr))
			}
		}
	}
	if value := Getenv("PROXY_MIN_APP_VERSION"); value != "" && !isValidSemver(value) {
		warnings = append(warnings, fmt.Sprintf("PROXY_MIN_APP_VERSION=%q is not a valid semver (expected e.g. 1.0.0); version enforcement will be best-effort", value))
	}
	return warnings
}

func parseInt32(s string) (int32, error) {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 32)
	if err != nil {
		return 0, err
	}
	return int32(n), nil
}

func isValidSemver(s string) bool {
	s = strings.TrimSpace(strings.TrimPrefix(s, "v"))
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
		for _, ch := range p {
			if ch < '0' || ch > '9' {
				return false
			}
		}
	}
	return true
}
