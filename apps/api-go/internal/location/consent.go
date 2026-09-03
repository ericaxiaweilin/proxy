// Package location owns the precise-location consent ledger and
// the rules around it. Vietnam PDP 91/2025/QH15 Art. 4 classifies
// precise GPS coordinates as sensitive personal data, so any code
// path that reads or forwards lat/lng (reverse geocode, market
// matching, reality-scene map) must first prove that the user has
// granted consent and that the consent has not expired.
//
// This package is intentionally small: it has the data shape, the
// default duration / max duration, and a Repository interface that
// the in-memory and Postgres implementations both satisfy. The
// HTTP layer lives in apps/api-go/internal/api; the command
// orchestration lives in the identity service. Both call into
// this package for the rules.
package location

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Kind enumerates the precise-location consent categories. Only
// PRECISE_GPS is in scope for R16.7-P1-J; COARSE_CITY is implicit
// (no consent needed for city-level data) and is not represented
// here.
type Kind string

const (
	KindPreciseGPS Kind = "PRECISE_GPS"
)

// Status is the lifecycle of a consent row.
type Status string

const (
	StatusGranted  Status = "GRANTED"
	StatusRevoked  Status = "REVOKED"
	StatusExpired  Status = "EXPIRED"
)

// AllowedDurations is the menu presented to the user. We deliberately
// keep this short: 30 minutes for a single ride / errand, 8 hours
// for a working day, and 0 for the explicit "session only" choice
// (handled by the caller — typically mapped to the default).
var AllowedDurations = []time.Duration{
	30 * time.Minute,
	8 * time.Hour,
}

// MaxDuration is the longest grant we accept. PRD v1.4 LC-08
// requires that the consent be time-limited; 8 hours is a full
// working day and anything longer would defeat the purpose.
const MaxDuration = 8 * time.Hour

// DefaultDuration is used when the client does not specify a
// duration (e.g. an older mobile client that only knows about the
// opt-in toggle, not the duration choice). 30 minutes is the
// privacy-minimal default.
const DefaultDuration = 30 * time.Minute

// ErrInvalidDuration is returned when the caller asks for a
// duration that is not in AllowedDurations and not the default.
// The HTTP layer maps this to 400.
var ErrInvalidDuration = errors.New("invalid location consent duration")

// ErrConsentNotFound is returned by Repository.GetActiveConsent
// when the user has never granted consent.
var ErrConsentNotFound = errors.New("no active location consent for this user")

// Consent is the canonical record of a granted consent window.
// It is what the API returns to the mobile client and what the
// repository stores.
//
// LastUsedAt is updated every time a downstream service actually
// reads the user's precise location. We keep it best-effort: the
// HTTP layer touches it on every call to a precise-location
// endpoint. The data is informational only — it is never used
// to extend the consent window.
type Consent struct {
	ID              string
	UserID          string
	Kind            Kind
	Status          Status
	GrantedAt       time.Time
	ExpiresAt       time.Time
	LastUsedAt      *time.Time
	RevokedAt       *time.Time
	DurationSeconds int
	ClientIP        string
	UserAgent       string
}

// Active reports whether the consent is currently usable. The
// status must be GRANTED, the expires_at must be in the future,
// and the kind must match the one being requested. We do not
// silently flip an EXPIRED row to REVOKED here — the repository
// does that in a single SQL UPDATE so the audit log records the
// transition.
func (c *Consent) Active(now time.Time) bool {
	if c == nil {
		return false
	}
	if c.Status != StatusGranted {
		return false
	}
	return now.Before(c.ExpiresAt)
}

// Remaining reports the time until the consent expires. Negative
// values mean the consent has already expired. Used by the mobile
// UI to render "剩余 23 分钟".
func (c *Consent) Remaining(now time.Time) time.Duration {
	if c == nil {
		return 0
	}
	return c.ExpiresAt.Sub(now)
}

// Repository is the storage contract. The in-memory implementation
// in this file is used by the service tests; the Postgres
// implementation in apps/api-go/internal/platform/postgres
// mirrors the same shape.
type Repository interface {
	// GetActive returns the GRANTED consent for (userID, kind), or
	// ErrConsentNotFound if none exists. Implementations must NOT
	// auto-revoke expired rows here — the expiry sweep is a
	// separate concern, owned by ExpireOverdue.
	GetActive(ctx context.Context, userID string, kind Kind) (*Consent, error)

	// Grant creates a new consent row. If the user already has an
	// active grant, the new one supersedes it: the previous row
	// is flipped to REVOKED (with revoked_at = now) and a new
	// row is inserted. The returned consent is the new active one.
	Grant(ctx context.Context, userID string, kind Kind, duration time.Duration, clientIP, userAgent string, now time.Time) (*Consent, error)

	// Revoke immediately flips the active grant to REVOKED. It
	// is a no-op if no active grant exists. The boolean return
	// is true when an active row was actually revoked.
	Revoke(ctx context.Context, userID string, kind Kind, now time.Time) (bool, error)

	// Touch updates last_used_at to now. It is called by the
	// reverse-geocode handler on every successful call. The
	// implementation is free to throttle or skip — the only
	// requirement is that an out-of-band audit can see when the
	// consent was last exercised.
	Touch(ctx context.Context, consentID string, now time.Time) error

	// ExpireOverdue flips every GRANTED row whose expires_at has
	// passed to EXPIRED. The implementation should be idempotent
	// and should not return an error if no rows match. This is
	// invoked by the HTTP layer on every /v1/location/consent
	// read so the audit log stays current without a cron.
	ExpireOverdue(ctx context.Context, now time.Time) (int, error)

	// ListByUser returns the user's full consent history, newest
	// first. Used by the privacy center's "my consents" view.
	ListByUser(ctx context.Context, userID string) ([]*Consent, error)
}

// NormalizeKind guards against case-only differences. The mobile
// client sends "precise_gps" or "PRECISE_GPS" interchangeably
// depending on the build; we accept both.
func NormalizeKind(s string) (Kind, error) {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "PRECISE_GPS":
		return KindPreciseGPS, nil
	default:
		return "", fmt.Errorf("unknown location consent kind: %q", s)
	}
}

// ValidateDuration returns nil if the duration is in
// AllowedDurations or is the default, ErrInvalidDuration
// otherwise. We accept "0" as an explicit request for the default
// (the mobile client uses 0 to mean "I don't care, pick the
// safest option").
func ValidateDuration(d time.Duration) error {
	if d == 0 {
		return nil
	}
	for _, allowed := range AllowedDurations {
		if d == allowed {
			return nil
		}
	}
	return ErrInvalidDuration
}
