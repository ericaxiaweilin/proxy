package compliance

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

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

func newTestService(t *testing.T) (*Service, *fixedClock) {
	t.Helper()
	clock := &fixedClock{}
	repo := NewMemoryRepository(clock.now)
	svc := NewService(repo)
	svc.SetNowFunc(clock.now)
	return svc, clock
}

func TestNormalizeCategoryAcceptsAllAllowed(t *testing.T) {
	for _, c := range AllowedCategories {
		got, err := NormalizeCategory(string(c))
		if err != nil {
			t.Fatalf("NormalizeCategory(%q) err=%v", c, err)
		}
		if got != c {
			t.Fatalf("NormalizeCategory(%q) = %q, want %q", c, got, c)
		}
	}
}

func TestNormalizeCategoryRejectsUnknown(t *testing.T) {
	_, err := NormalizeCategory("NOT_A_CATEGORY")
	if err == nil {
		t.Fatalf("expected error for unknown category")
	}
}

func TestNormalizeCategoryCaseInsensitive(t *testing.T) {
	got, err := NormalizeCategory("ai_media")
	if err != nil {
		t.Fatalf("case-insensitive match should succeed: %v", err)
	}
	if got != CategoryAIMedia {
		t.Fatalf("expected AI_MEDIA, got %q", got)
	}
}

func TestKillRequiresReason(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.Kill(context.Background(), CategoryAIMedia, "   ", "operator_1", nil)
	if err == nil {
		t.Fatalf("expected error for blank reason")
	}
}

func TestKillRejectsPastExpiry(t *testing.T) {
	svc, clock := newTestService(t)
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	past := time.Date(2026, 9, 4, 9, 0, 0, 0, time.UTC)
	_, err := svc.Kill(context.Background(), CategoryAIMedia, "test", "operator_1", &past)
	if err == nil {
		t.Fatalf("expected error for past expires_at")
	}
}

func TestKillAndIsEnabled(t *testing.T) {
	svc, _ := newTestService(t)
	// Initially enabled
	if !svc.IsEnabled(context.Background(), CategoryAIMedia) {
		t.Fatalf("expected AI_MEDIA enabled by default")
	}
	// Kill it
	_, err := svc.Kill(context.Background(), CategoryAIMedia, "AI law incident", "operator_1", nil)
	if err != nil {
		t.Fatalf("Kill err=%v", err)
	}
	if svc.IsEnabled(context.Background(), CategoryAIMedia) {
		t.Fatalf("expected AI_MEDIA disabled after Kill")
	}
	// Other categories still enabled
	if !svc.IsEnabled(context.Background(), CategoryMarketplace) {
		t.Fatalf("MARKETPLACE should be unaffected by AI_MEDIA kill")
	}
}

func TestRearmReEnablesCategory(t *testing.T) {
	svc, _ := newTestService(t)
	_, _ = svc.Kill(context.Background(), CategoryMarketplace, "incident", "operator_1", nil)
	if svc.IsEnabled(context.Background(), CategoryMarketplace) {
		t.Fatalf("MARKETPLACE should be killed")
	}
	if err := svc.Rearm(context.Background(), CategoryMarketplace, "operator_2"); err != nil {
		t.Fatalf("Rearm err=%v", err)
	}
	if !svc.IsEnabled(context.Background(), CategoryMarketplace) {
		t.Fatalf("MARKETPLACE should be re-enabled after Rearm")
	}
}

func TestRearmWithoutActiveReturnsNotFound(t *testing.T) {
	svc, _ := newTestService(t)
	err := svc.Rearm(context.Background(), CategoryGlobal, "operator_1")
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestExpiryRearmsAutomatically(t *testing.T) {
	svc, clock := newTestService(t)
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	expire := time.Date(2026, 9, 4, 11, 0, 0, 0, time.UTC)
	_, err := svc.Kill(context.Background(), CategoryAIMedia, "temp outage", "operator_1", &expire)
	if err != nil {
		t.Fatalf("Kill err=%v", err)
	}
	if svc.IsEnabled(context.Background(), CategoryAIMedia) {
		t.Fatalf("expected AI_MEDIA killed at T0")
	}
	// Advance past expiry
	clock.set(time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC))
	if !svc.IsEnabled(context.Background(), CategoryAIMedia) {
		t.Fatalf("expected AI_MEDIA re-enabled after expiry")
	}
}

func TestGlobalStatusReturnsAllActive(t *testing.T) {
	svc, _ := newTestService(t)
	_, _ = svc.Kill(context.Background(), CategoryAIMedia, "AI incident", "operator_1", nil)
	_, _ = svc.Kill(context.Background(), CategoryMarketplace, "Payment outage", "operator_2", nil)
	status, err := svc.GlobalStatus(context.Background())
	if err != nil {
		t.Fatalf("GlobalStatus err=%v", err)
	}
	if len(status) != 2 {
		t.Fatalf("expected 2 active switches, got %d", len(status))
	}
	ai, ok := status["AI_MEDIA"]
	if !ok {
		t.Fatalf("expected AI_MEDIA in status map")
	}
	if !strings.Contains(ai.Reason, "AI") {
		t.Fatalf("AI_MEDIA reason lost: %q", ai.Reason)
	}
}

func TestReKillSupersedesPrevious(t *testing.T) {
	svc, clock := newTestService(t)
	clock.set(time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC))
	first, _ := svc.Kill(context.Background(), CategoryGlobal, "first", "operator_1", nil)
	clock.set(time.Date(2026, 9, 4, 10, 0, 1, 0, time.UTC))
	second, _ := svc.Kill(context.Background(), CategoryGlobal, "second", "operator_2", nil)
	if first.ID == second.ID {
		t.Fatalf("expected different IDs for re-kill, both = %q", first.ID)
	}
	history, _ := svc.ListHistory(context.Background())
	if len(history) != 2 {
		t.Fatalf("expected 2 history rows, got %d", len(history))
	}
	if history[0].Status != StatusKilled {
		t.Fatalf("expected newest row KILLED, got %s", history[0].Status)
	}
	if history[1].Status != StatusRearmed {
		t.Fatalf("expected superseded row REARMED, got %s", history[1].Status)
	}
}

func TestListHistoryNewestFirst(t *testing.T) {
	svc, _ := newTestService(t)
	_, _ = svc.Kill(context.Background(), CategoryAIMedia, "first", "operator_1", nil)
	_, _ = svc.Kill(context.Background(), CategoryMarketplace, "second", "operator_2", nil)
	history, _ := svc.ListHistory(context.Background())
	if len(history) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(history))
	}
	if history[0].SetAt.Before(history[1].SetAt) {
		t.Fatalf("expected newest first; got %v then %v", history[0].SetAt, history[1].SetAt)
	}
}

func TestActiveMethodOnStruct(t *testing.T) {
	now := time.Now()
	killed := &KillSwitch{Status: StatusKilled}
	rearmed := &KillSwitch{Status: StatusRearmed}
	if !killed.Active() {
		t.Fatalf("killed switch should be active")
	}
	if rearmed.Active() {
		t.Fatalf("rearmed switch should not be active")
	}
	var nilSwitch *KillSwitch
	if nilSwitch.Active() {
		t.Fatalf("nil switch should not be active")
	}
	_ = now
}
