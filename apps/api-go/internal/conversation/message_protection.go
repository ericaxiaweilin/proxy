// Package: conversation — Message.Protection sub-aggregate.
//
// WHAT THIS IS
//   Per-message anti-leak controls aligned with the Proxy chat RFC v0.1
//   (docs/design/references/Proxy_Chat_Aligned_With_LotusChat_v0.1.md §3).
//   The lotus pattern is per-conversation toggles; we do per-message so a
//   pimp can lock down a single sensitive image while keeping the rest of
//   the chat scannable.
//
// THE FOUR KNOBS
//   1. Forwardable:    if false, server refuses forward attempts with
//                      PROTECTION_VIOLATION
//   2. ScreenshotWarn: if true, server records ScreenshotDetected events
//                      and emits a SECURITY_ALERT to the sender
//   3. ViewLimit + ViewCount: ephemeral — server returns
//                      VIEW_LIMIT_EXCEEDED after N reads by the recipient
//   4. TTLDuration + ExpiresAt: server returns MESSAGE_EXPIRED after the
//                      wall-clock cutoff
//
// DEFAULTS (RFC §3.3)
//   Per-message defaults are computed by DefaultProtectionFor. The values
//   are deliberately conservative for DM, permissive for GROUP.
//
// NOT IN THIS FILE
//   - The TTL sweeper (worker, separate concern)
//   - Object-store purging (media pipeline owns this)
//   - Screenshot detection on device (RN-side, see apps/mobile)
package conversation

import (
	"errors"
	"time"
)

// MessageProtection is the per-message anti-leak envelope. See RFC §3.2.
type MessageProtection struct {
	// Forwardable: false means server refuses re-send / forward commands.
	Forwardable bool `json:"forwardable"`

	// Copyable: false means the client should disable text selection.
	// Server cannot enforce; the field exists so the client can render
	// the right UI.
	Copyable bool `json:"copyable"`

	// ScreenshotProtected: iOS hint only. The RN side uses this to
	// overlay a privacy mask on the media viewer. Server side is
	// advisory; Android can use FLAG_SECURE for hard blocking but that
	// is device-side, not enforced by the API.
	ScreenshotProtected bool `json:"screenshotProtected"`

	// ScreenshotWarn: if true, when the recipient's device fires a
	// ScreenshotDetected event, the server publishes SECURITY_ALERT
	// back to the sender. This is the "对方截图了我立刻知道" behavior
	// from the RFC.
	ScreenshotWarn bool `json:"screenshotWarn"`

	// ViewLimit: 0 means unlimited. When > 0, the recipient's Nth read
	// flips the message to expired on the server. Sender's view always
	// succeeds.
	ViewLimit int `json:"viewLimit,omitempty"`

	// ViewCount: monotonically incremented each time a non-sender
	// participant reads the message. Persisted alongside the message.
	ViewCount int `json:"viewCount"`

	// TTLDuration: convenience field. The server canonicalizes it into
	// ExpiresAt. Not returned to clients.
	TTLDuration time.Duration `json:"-"`

	// ExpiresAt: wall-clock cutoff. The server returns MESSAGE_EXPIRED
	// for any read after this point.
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`

	// EndToEndEncrypted is always true in the current architecture
	// (transport TLS + at-rest KMS). The client renders the 🔒 badge.
	EndToEndEncrypted bool `json:"endToEndEncrypted"`
}

// IsExpiredAt reports whether the message is past its expiration.
func (p MessageProtection) IsExpiredAt(now time.Time) bool {
	if p.ExpiresAt == nil {
		return false
	}
	return !now.Before(*p.ExpiresAt)
}

// ViewLimitExceeded reports whether the view count has reached the limit.
func (p MessageProtection) ViewLimitExceeded() bool {
	return p.ViewLimit > 0 && p.ViewCount >= p.ViewLimit
}

// DefaultProtectionFor returns the per-type defaults from RFC §3.3.
// The caller (SendMessage command) layers the user's overrides on top.
//
//   TEXT (DM)        : no forward, screenshot warn, unlimited views, 30d TTL
//   IMAGE (DM)       : no forward, screenshot warn, 3 views, 30d TTL
//   VIDEO (DM)       : no forward, screenshot warn, 1 view, 30d TTL
//   LOCATION (DM)    : no forward, screenshot warn, 1 view, 1h TTL
//   TEXT (GROUP)     : forwardable, no screenshot warn, unlimited views, 30d TTL
//   IMAGE (GROUP)    : forwardable, screenshot warn, unlimited views, 30d TTL
//
// SYSTEM_CONTEXT and STRUCTURED_SUGGESTION are server-generated, so their
// protection is a no-op (forwardable, no warn, no view limit, no TTL).
func DefaultProtectionFor(messageType, conversationType string) MessageProtection {
	now := time.Now().UTC()
	in30d := now.Add(30 * 24 * time.Hour)
	in1h := now.Add(time.Hour)
	switch messageType {
	case "TEXT":
		if conversationType == "GROUP" {
			return MessageProtection{
				Forwardable:        true,
				Copyable:           true,
				ScreenshotWarn:     false,
				ExpiresAt:          &in30d,
				EndToEndEncrypted:  true,
			}
		}
		return MessageProtection{
			Forwardable:        false,
			Copyable:           false,
			ScreenshotWarn:     true,
			ExpiresAt:          &in30d,
			EndToEndEncrypted:  true,
		}
	case "IMAGE":
		if conversationType == "GROUP" {
			return MessageProtection{
				Forwardable:        true,
				Copyable:           false,
				ScreenshotWarn:     true,
				ExpiresAt:          &in30d,
				EndToEndEncrypted:  true,
			}
		}
		return MessageProtection{
			Forwardable:        false,
			Copyable:           false,
			ScreenshotProtected: true,
			ScreenshotWarn:     true,
			ViewLimit:          3,
			ExpiresAt:          &in30d,
			EndToEndEncrypted:  true,
		}
	case "VIDEO":
		// RFC defines VIDEO for DM. Group video uses IMAGE protection.
		return MessageProtection{
			Forwardable:        false,
			Copyable:           false,
			ScreenshotProtected: true,
			ScreenshotWarn:     true,
			ViewLimit:          1,
			ExpiresAt:          &in30d,
			EndToEndEncrypted:  true,
		}
	case "LOCATION":
		return MessageProtection{
			Forwardable:        false,
			Copyable:           false,
			ScreenshotProtected: true,
			ScreenshotWarn:     true,
			ViewLimit:          1,
			ExpiresAt:          &in1h,
			EndToEndEncrypted:  true,
		}
	case "SYSTEM_CONTEXT", "STRUCTURED_SUGGESTION":
		// Server-generated. Always forwardable, never expires.
		return MessageProtection{
			Forwardable:        true,
			Copyable:           true,
			ScreenshotWarn:     false,
			EndToEndEncrypted:  false,
		}
	}
	// Unknown — fail closed: no forward, warn, 30d.
	return MessageProtection{
		Forwardable:        false,
		ScreenshotWarn:     true,
		ExpiresAt:          &in30d,
		EndToEndEncrypted:  true,
	}
}

// ProtectionOverride is the user-controlled layer. The caller (SendMessage
// command) merges this on top of DefaultProtectionFor.
//
// Validation rules (enforced by Apply):
//   - ViewLimit must be in [0, 100] (0 = unlimited)
//   - TTLDuration must be in [0, 365 days]
//   - If ForwardableOverride is non-nil, the boolean applies (no
//     validation — user is explicit)
type ProtectionOverride struct {
	Forwardable *bool          `json:"forwardable,omitempty"`
	Copyable    *bool          `json:"copyable,omitempty"`
	Warn        *bool          `json:"warn,omitempty"`
	ViewLimit   *int           `json:"viewLimit,omitempty"`
	TTL         *time.Duration `json:"ttlSeconds,omitempty"` // seconds for JSON
}

// AsDuration is a helper to read TTL as time.Duration.
func (o ProtectionOverride) TTLAsDuration() time.Duration {
	if o.TTL == nil {
		return 0
	}
	return *o.TTL
}

var (
	ErrProtectionViewLimitOutOfRange = errors.New("view limit out of range [0,100]")
	ErrProtectionTTLOutOfRange       = errors.New("ttl out of range [0,365d]")
)

// Apply layers the override on top of the base protection. It mutates
// and returns a copy. Validation errors are returned, never panic.
//
// `now` must be supplied by the caller so test code can use a
// deterministic clock. In production this is s.clock.Now().UTC().
func Apply(base MessageProtection, override ProtectionOverride, now time.Time) (MessageProtection, error) {
	out := base
	if override.Forwardable != nil {
		out.Forwardable = *override.Forwardable
	}
	if override.Copyable != nil {
		out.Copyable = *override.Copyable
	}
	if override.Warn != nil {
		out.ScreenshotWarn = *override.Warn
	}
	if override.ViewLimit != nil {
		v := *override.ViewLimit
		if v < 0 || v > 100 {
			return MessageProtection{}, ErrProtectionViewLimitOutOfRange
		}
		out.ViewLimit = v
	}
	if override.TTL != nil {
		d := *override.TTL
		if d < 0 || d > 365*24*time.Hour {
			return MessageProtection{}, ErrProtectionTTLOutOfRange
		}
		exp := now.Add(d)
		out.ExpiresAt = &exp
	}
	return out, nil
}
