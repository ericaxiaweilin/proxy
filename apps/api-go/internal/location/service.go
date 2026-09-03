// Package location also owns the command-service layer for
// location-consent commands. The HTTP layer in
// apps/api-go/internal/api and the mobile client talk to the
// service via the standard command.Envelope / command.Result
// shape, so the wire protocol is consistent with the rest of
// the system (privacy, identity, etc.).
//
// Three commands are exposed:
//
//   - GetLocationConsentStatus: returns the user's current
//     consent (or 'NONE' if none). Also runs the expiry sweep so
//     a row that timed out between reads is reported as EXPIRED
//     rather than GRANTED.
//   - GrantLocationConsent: opts the user in. Body carries
//     durationSeconds (0 = default).
//   - RevokeLocationConsent: opts the user out. The body is
//     empty; the auth context tells us who.
package location

import (
	"context"
	"encoding/json"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Service is the command-service entry point. It is wired into
// the command router in apps/api-go/internal/api alongside the
// identity service; the router is responsible for picking the
// right service based on command type.
type Service struct {
	repo Repository
	// nowFunc is injectable for tests. Defaults to time.Now.
	nowFunc func() time.Time
}

// NewService returns a Service backed by the given repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo, nowFunc: time.Now}
}

// SetNowFunc overrides the clock. Intended for tests only.
func (s *Service) SetNowFunc(f func() time.Time) {
	s.nowFunc = f
}

func (s *Service) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

// Supports reports whether the service handles the given command
// type. The router uses this to dispatch.
func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "GetLocationConsentStatus", "GrantLocationConsent", "RevokeLocationConsent":
		return true
	default:
		return false
	}
}

// HandleContext dispatches a command envelope to the right
// handler. The envelope's Actor.ID is the user the consent is
// scoped to; the auth context supplies client_ip and user_agent.
func (s *Service) HandleContext(ctx context.Context, envelope command.Envelope) command.Result {
	switch envelope.CommandType {
	case "GetLocationConsentStatus":
		return s.getStatus(ctx, envelope)
	case "GrantLocationConsent":
		return s.grant(ctx, envelope)
	case "RevokeLocationConsent":
		return s.revoke(ctx, envelope)
	default:
		return command.Rejected(envelope, "UNKNOWN_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "location.unknown_command", nil)
	}
}

// ConsentStatus is the body the service returns for
// GetLocationConsentStatus. status is one of NONE, GRANTED,
// REVOKED, EXPIRED. expiresAt and remainingSeconds are zero when
// status is NONE.
type ConsentStatus struct {
	Kind             string `json:"kind"`
	Status           string `json:"status"`
	GrantedAt        string `json:"grantedAt,omitempty"`
	ExpiresAt        string `json:"expiresAt,omitempty"`
	RemainingSeconds int    `json:"remainingSeconds"`
	LastUsedAt       string `json:"lastUsedAt,omitempty"`
	DurationSeconds  int    `json:"durationSeconds"`
}

func (s *Service) getStatus(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return command.Rejected(envelope, "AUTH_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "location.auth_required", nil)
	}
	now := s.now()
	// Run the expiry sweep first so we never report GRANTED for
	// a row whose expires_at is in the past. The sweep is
	// idempotent.
	if _, err := s.repo.ExpireOverdue(ctx, now); err != nil {
		return command.Rejected(envelope, "LOCATION_CONSENT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "location.consent_read_failed", nil)
	}
	active, err := s.repo.GetActive(ctx, userID, KindPreciseGPS)
	if err != nil {
		// ErrConsentNotFound is not an error condition for the
		// status endpoint; we report NONE.
		body := ConsentStatus{
			Kind:             string(KindPreciseGPS),
			Status:           "NONE",
			RemainingSeconds: 0,
		}
		return acceptedWithBody(envelope, "location.consent_status", body)
	}
	body := ConsentStatus{
		Kind:             string(active.Kind),
		Status:           string(active.Status),
		GrantedAt:        active.GrantedAt.UTC().Format(time.RFC3339),
		ExpiresAt:        active.ExpiresAt.UTC().Format(time.RFC3339),
		RemainingSeconds: int(active.Remaining(now).Seconds()),
		DurationSeconds:  active.DurationSeconds,
	}
	if active.LastUsedAt != nil {
		body.LastUsedAt = active.LastUsedAt.UTC().Format(time.RFC3339)
	}
	return acceptedWithBody(envelope, "location.consent_status", body)
}

// GrantPayload is the body for GrantLocationConsent. Only
// durationSeconds is read; other fields are reserved for future
// versions (e.g. a one-tap "always allow for this session" flag).
type GrantPayload struct {
	DurationSeconds int `json:"durationSeconds"`
}

func (s *Service) grant(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return command.Rejected(envelope, "AUTH_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "location.auth_required", nil)
	}
	duration := time.Duration(intFromPayload(envelope.Payload, "durationSeconds")) * time.Second
	if err := ValidateDuration(duration); err != nil {
		return command.Rejected(envelope, "INVALID_LOCATION_CONSENT_DURATION", "VALIDATION", "AFTER_USER_ACTION", "location.invalid_consent_duration", map[string]any{
			"allowedMinutes": []int{int(AllowedDurations[0].Minutes()), int(AllowedDurations[1].Minutes())},
		})
	}
	if duration == 0 {
		duration = DefaultDuration
	}
	ip := envelope.AuthContextIP()
	ua := envelope.AuthContextUA()
	now := s.now()
	row, err := s.repo.Grant(ctx, userID, KindPreciseGPS, duration, ip, ua, now)
	if err != nil {
		return command.Rejected(envelope, "LOCATION_CONSENT_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "location.consent_write_failed", nil)
	}
	body := ConsentStatus{
		Kind:             string(row.Kind),
		Status:           string(row.Status),
		GrantedAt:        row.GrantedAt.UTC().Format(time.RFC3339),
		ExpiresAt:        row.ExpiresAt.UTC().Format(time.RFC3339),
		RemainingSeconds: int(row.Remaining(now).Seconds()),
		DurationSeconds:  row.DurationSeconds,
	}
	return acceptedWithBody(envelope, "location.consent_granted", body)
}

func (s *Service) revoke(ctx context.Context, envelope command.Envelope) command.Result {
	userID := envelope.Actor.ID
	if userID == "" {
		return command.Rejected(envelope, "AUTH_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "location.auth_required", nil)
	}
	flipped, err := s.repo.Revoke(ctx, userID, KindPreciseGPS, s.now())
	if err != nil {
		return command.Rejected(envelope, "LOCATION_CONSENT_REVOKE_FAILED", "INTERNAL", "SAFE_RETRY", "location.consent_revoke_failed", nil)
	}
	body := map[string]any{
		"kind":      string(KindPreciseGPS),
		"status":    "REVOKED",
		"wasActive": flipped,
	}
	return acceptedWithBody(envelope, "location.consent_revoked", body)
}

// acceptedWithBody wraps command.Accepted with a typed body. The
// command.Accepted helper takes a string aggregateID, so we
// always pass "LocationConsent" and pin the per-call data into
// Result.Body. The HTTP layer renders Body verbatim.
func acceptedWithBody(envelope command.Envelope, state string, body any) command.Result {
	result := command.Accepted(envelope, "LocationConsent", envelope.Actor.ID, 1, state, []string{})
	// Convert body via a JSON round-trip so the on-wire shape
	// matches what the mobile client expects. We use map[string]any
	// because Result.Body is typed that way; structs and maps are
	// both acceptable on the wire.
	result.Body = toBodyMap(body)
	return result
}

// toBodyMap turns a typed struct (or map) into a map[string]any.
// We round-trip through encoding/json so the field tags
// (json:"...") are the source of truth for the wire shape and
// numbers stay as float64, which is what the JSON encoder
// produces on the way out and what the mobile client expects
// on the way in. This is the same trick identity.Service uses
// for its consent payloads.
func toBodyMap(body any) map[string]any {
	if body == nil {
		return nil
	}
	if m, ok := body.(map[string]any); ok {
		return m
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

// intFromPayload reads an int field out of the envelope payload
// map. The command layer already JSON-decoded the payload, so we
// only need a type assertion. Returns 0 if the key is missing or
// the value is not an int.
func intFromPayload(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	v, ok := payload[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}
