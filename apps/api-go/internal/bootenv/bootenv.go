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
	// Login provider: PROXY_LOGIN_PROVIDER defaults to "simulated"
	// which is dev-only. In prod the operator must set SMTP or SMS
	// env so a real challenge is delivered.
	mode := Getenv("PROXY_LOGIN_PROVIDER")
	if mode == "" || mode == "simulated" {
		warnings = append(warnings, fmt.Sprintf("PROXY_LOGIN_PROVIDER=%q is dev-only; configure PROXY_SMTP_HOST (or PROXY_SMS_URL) for production", defaultMode(mode)))
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
	return warnings
}

func defaultMode(mode string) string {
	if mode == "" {
		return "simulated"
	}
	return mode
}
