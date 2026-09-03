package location

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// fixedClock returns a time.Time the caller controls. Tests
// advance the clock by reassigning the field directly, which
// keeps the Service.now() indirection simple.
type fixedClock struct {
	t atomic.Pointer[time.Time]
}

func (c *fixedClock) now() time.Time {
	if p := c.t.Load(); p != nil {
		return *p
	}
	return time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
}

func (c *fixedClock) set(t time.Time) { c.t.Store(&t) }

func newTestService(t *testing.T) (*Service, *fixedClock, *MemoryRepository) {
	t.Helper()
	clock := &fixedClock{}
	repo := NewMemoryRepository(clock.now)
	svc := NewService(repo)
	svc.SetNowFunc(clock.now)
	return svc, clock, repo
}

func envelopeFor(userID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: userID},
		Principal:      command.Principal{Type: "USER", ID: userID},
		AuthContext: map[string]any{
			"clientIp":  "10.0.0.1",
			"userAgent": "location-service-test/1.0",
		},
		RequestedAt: time.Now().UTC().Format(time.RFC3339),
		Payload:     payload,
	}
}

func TestGetStatus_NoneWhenNeverGranted(t *testing.T) {
	svc, _, _ := newTestService(t)
	result := svc.HandleContext(context.Background(), envelopeFor("user_a", "GetLocationConsentStatus", nil))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (err=%v)", result.Outcome, result.Error)
	}
	if status, _ := result.Body["status"].(string); status != "NONE" {
		t.Fatalf("expected status NONE, got %q", status)
	}
}

func TestGrantThenStatusIsGranted(t *testing.T) {
	svc, clock, _ := newTestService(t)
	userID := "user_b"
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))

	grant := svc.HandleContext(context.Background(), envelopeFor(userID, "GrantLocationConsent", map[string]any{
		"durationSeconds": 1800, // 30 min
	}))
	if grant.Outcome != "ACCEPTED" {
		t.Fatalf("grant expected ACCEPTED, got %s err=%v", grant.Outcome, grant.Error)
	}
	if status, _ := grant.Body["status"].(string); status != "GRANTED" {
		t.Fatalf("grant body status expected GRANTED, got %q", status)
	}
	if got, _ := grant.Body["durationSeconds"].(float64); got != 1800 {
		t.Fatalf("grant body durationSeconds expected 1800, got %v", grant.Body["durationSeconds"])
	}

	status := svc.HandleContext(context.Background(), envelopeFor(userID, "GetLocationConsentStatus", nil))
	if status, _ := status.Body["status"].(string); status != "GRANTED" {
		t.Fatalf("status expected GRANTED, got %q", status)
	}
}

func TestGrantRejectsInvalidDuration(t *testing.T) {
	svc, _, _ := newTestService(t)
	envelope := envelopeFor("user_c", "GrantLocationConsent", map[string]any{
		"durationSeconds": 120, // not in allowed set
	})
	result := svc.HandleContext(context.Background(), envelope)
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "INVALID_LOCATION_CONSENT_DURATION" {
		t.Fatalf("expected code INVALID_LOCATION_CONSENT_DURATION, got %+v", result.Error)
	}
}

func TestGrantDefaultDurationIs30Min(t *testing.T) {
	svc, clock, _ := newTestService(t)
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	result := svc.HandleContext(context.Background(), envelopeFor("user_d", "GrantLocationConsent", map[string]any{}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("grant expected ACCEPTED, got %s err=%v", result.Outcome, result.Error)
	}
	if got, _ := result.Body["durationSeconds"].(float64); got != float64((30 * time.Minute).Seconds()) {
		t.Fatalf("default duration expected 1800s, got %v", result.Body["durationSeconds"])
	}
}

func TestRevokeStopsFutureStatus(t *testing.T) {
	svc, _, _ := newTestService(t)
	userID := "user_e"
	// Grant
	svc.HandleContext(context.Background(), envelopeFor(userID, "GrantLocationConsent", map[string]any{
		"durationSeconds": 1800,
	}))
	// Revoke
	rev := svc.HandleContext(context.Background(), envelopeFor(userID, "RevokeLocationConsent", nil))
	if rev.Outcome != "ACCEPTED" {
		t.Fatalf("revoke expected ACCEPTED, got %s", rev.Outcome)
	}
	if wasActive, _ := rev.Body["wasActive"].(bool); !wasActive {
		t.Fatalf("expected wasActive=true, got %v", rev.Body["wasActive"])
	}
	// Subsequent status
	status := svc.HandleContext(context.Background(), envelopeFor(userID, "GetLocationConsentStatus", nil))
	if got, _ := status.Body["status"].(string); got != "NONE" {
		t.Fatalf("expected NONE after revoke, got %q", got)
	}
}

func TestRevokeWithoutActiveGrantIsNoop(t *testing.T) {
	svc, _, _ := newTestService(t)
	rev := svc.HandleContext(context.Background(), envelopeFor("user_f", "RevokeLocationConsent", nil))
	if rev.Outcome != "ACCEPTED" {
		t.Fatalf("revoke expected ACCEPTED, got %s", rev.Outcome)
	}
	if wasActive, _ := rev.Body["wasActive"].(bool); wasActive {
		t.Fatalf("expected wasActive=false, got %v", rev.Body["wasActive"])
	}
}

func TestExpirySweepMarksOldGrantsAsExpired(t *testing.T) {
	svc, clock, _ := newTestService(t)
	userID := "user_g"
	// Grant at T0 with 30 min
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	svc.HandleContext(context.Background(), envelopeFor(userID, "GrantLocationConsent", map[string]any{
		"durationSeconds": 1800,
	}))
	// Advance clock past expiry
	clock.set(time.Date(2026, 9, 4, 11, 0, 0, 0, time.UTC))
	status := svc.HandleContext(context.Background(), envelopeFor(userID, "GetLocationConsentStatus", nil))
	if got, _ := status.Body["status"].(string); got != "NONE" {
		t.Fatalf("expected NONE after expiry sweep, got %q (body=%+v)", got, status.Body)
	}
}

func TestRegrantSupersedesPrevious(t *testing.T) {
	svc, clock, _ := newTestService(t)
	userID := "user_h"
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	first := svc.HandleContext(context.Background(), envelopeFor(userID, "GrantLocationConsent", map[string]any{
		"durationSeconds": 1800,
	}))
	firstID, _ := first.Body["kind"].(string)
	if firstID == "" {
		t.Fatalf("expected non-empty kind in grant body, got %+v", first.Body)
	}
	// Re-grant with 8h
	clock.set(time.Date(2026, 9, 4, 10, 30, 0, 0, time.UTC))
	second := svc.HandleContext(context.Background(), envelopeFor(userID, "GrantLocationConsent", map[string]any{
		"durationSeconds": 28800,
	}))
	if got, _ := second.Body["durationSeconds"].(float64); got != 28800 {
		t.Fatalf("re-grant expected 28800s, got %v", second.Body["durationSeconds"])
	}
	// History should contain both rows
	rows, err := svc.repo.ListByUser(context.Background(), userID)
	if err != nil {
		t.Fatalf("ListByUser err: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 history rows, got %d", len(rows))
	}
	if rows[0].Status != StatusGranted {
		t.Fatalf("expected newest row GRANTED, got %s", rows[0].Status)
	}
	if rows[1].Status != StatusRevoked {
		t.Fatalf("expected superseded row REVOKED, got %s", rows[1].Status)
	}
}

func TestAuthRequiredBlocksAnonymousCommands(t *testing.T) {
	svc, _, _ := newTestService(t)
	// Envelope with no Actor.ID
	envelope := command.Envelope{
		CommandID:   "cmd_test",
		CommandType: "GetLocationConsentStatus",
		Actor:       command.Actor{Type: "ANONYMOUS", ID: ""},
		Principal:   command.Principal{Type: "ANONYMOUS", ID: ""},
	}
	result := svc.HandleContext(context.Background(), envelope)
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED for anonymous, got %s", result.Outcome)
	}
	if result.Error == nil || result.Error.ErrorCode != "AUTH_REQUIRED" {
		t.Fatalf("expected AUTH_REQUIRED, got %+v", result.Error)
	}
}

func TestUnknownCommandIsRejected(t *testing.T) {
	svc, _, _ := newTestService(t)
	result := svc.HandleContext(context.Background(), envelopeFor("user_i", "NotARealCommand", nil))
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", result.Outcome)
	}
}

func TestSupportsReportsCorrectCommandTypes(t *testing.T) {
	svc, _, _ := newTestService(t)
	for _, ct := range []string{"GetLocationConsentStatus", "GrantLocationConsent", "RevokeLocationConsent"} {
		if !svc.Supports(ct) {
			t.Fatalf("expected Supports(%q) = true", ct)
		}
	}
	if svc.Supports("RandomCommand") {
		t.Fatalf("expected Supports(\"RandomCommand\") = false")
	}
}

func TestAuthorizeClaimsContainClientIPAndUserAgent(t *testing.T) {
	// This test is the audit gate: every grant must store the
	// client IP and user agent from the envelope. The privacy
	// officer (you) should be able to grep the table for any
	// user's grant history and see exactly which device
	// requested each one.
	svc, _, _ := newTestService(t)
	envelope := envelopeFor("user_audit", "GrantLocationConsent", map[string]any{
		"durationSeconds": 1800,
	})
	envelope.AuthContext = map[string]any{
		"clientIp":  "203.0.113.42",
		"userAgent": "iOS/1.0 test-runner",
	}
	result := svc.HandleContext(context.Background(), envelope)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s", result.Outcome)
	}
	// Pull the row back and assert
	rows, err := svc.repo.ListByUser(context.Background(), "user_audit")
	if err != nil {
		t.Fatalf("ListByUser err: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].ClientIP != "203.0.113.42" {
		t.Fatalf("expected ClientIP 203.0.113.42, got %q", rows[0].ClientIP)
	}
	if !strings.Contains(rows[0].UserAgent, "iOS/1.0") {
		t.Fatalf("expected UserAgent to contain iOS/1.0, got %q", rows[0].UserAgent)
	}
}
