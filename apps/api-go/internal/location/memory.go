package location

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

// MemoryRepository is the in-memory implementation of Repository,
// used by service tests and the default server when no Postgres
// is configured. It is safe for concurrent use.
type MemoryRepository struct {
	mu      sync.Mutex
	rows    []*Consent
	nowFunc func() time.Time
}

// NewMemoryRepository returns an empty in-memory consent ledger.
// The nowFunc is injectable so tests can advance the clock
// without time.Sleep.
func NewMemoryRepository(nowFunc func() time.Time) *MemoryRepository {
	if nowFunc == nil {
		nowFunc = time.Now
	}
	return &MemoryRepository{
		rows:    nil,
		nowFunc: nowFunc,
	}
}

func (r *MemoryRepository) now() time.Time {
	if r.nowFunc != nil {
		return r.nowFunc()
	}
	return time.Now()
}

func (r *MemoryRepository) newID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "lconsent_" + hex.EncodeToString(b[:])
}

// GetActive returns the GRANTED consent for (userID, kind), or
// ErrConsentNotFound. It does not auto-expire — call
// ExpireOverdue first if the wall clock has moved.
func (r *MemoryRepository) GetActive(ctx context.Context, userID string, kind Kind) (*Consent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.rows {
		if c.UserID == userID && c.Kind == kind && c.Status == StatusGranted {
			return cloneConsent(c), nil
		}
	}
	return nil, ErrConsentNotFound
}

// Grant creates a new consent row. If the user already has an
// active grant, the previous row is flipped to REVOKED and a new
// row is inserted. The returned consent is the new active one.
func (r *MemoryRepository) Grant(ctx context.Context, userID string, kind Kind, duration time.Duration, clientIP, userAgent string, now time.Time) (*Consent, error) {
	if err := ValidateDuration(duration); err != nil {
		return nil, err
	}
	if duration == 0 {
		duration = DefaultDuration
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	// Flip any existing active grant to REVOKED. We do this first
	// so the audit trail captures the supersession in time order.
	for _, c := range r.rows {
		if c.UserID == userID && c.Kind == kind && c.Status == StatusGranted {
			c.Status = StatusRevoked
			revokedAt := now
			c.RevokedAt = &revokedAt
		}
	}
	row := &Consent{
		ID:              r.newID(),
		UserID:          userID,
		Kind:            kind,
		Status:          StatusGranted,
		GrantedAt:       now,
		ExpiresAt:       now.Add(duration),
		DurationSeconds: int(duration.Seconds()),
		ClientIP:        clientIP,
		UserAgent:       userAgent,
	}
	r.rows = append(r.rows, row)
	return cloneConsent(row), nil
}

// Revoke immediately flips the active grant to REVOKED. The
// boolean return is true when an active row was actually revoked.
func (r *MemoryRepository) Revoke(ctx context.Context, userID string, kind Kind, now time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	flipped := false
	for _, c := range r.rows {
		if c.UserID == userID && c.Kind == kind && c.Status == StatusGranted {
			c.Status = StatusRevoked
			revokedAt := now
			c.RevokedAt = &revokedAt
			flipped = true
		}
	}
	return flipped, nil
}

// Touch updates last_used_at on the given consent row. The
// implementation is throttled: it skips the write if the
// previous last_used_at is within the last 60 seconds, so a busy
// session does not generate a flood of updates.
func (r *MemoryRepository) Touch(ctx context.Context, consentID string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.rows {
		if c.ID == consentID {
			if c.LastUsedAt != nil && now.Sub(*c.LastUsedAt) < 60*time.Second {
				return nil
			}
			t := now
			c.LastUsedAt = &t
			return nil
		}
	}
	return nil
}

// ExpireOverdue flips every GRANTED row whose expires_at has
// passed to EXPIRED. The integer return is the count of rows
// flipped (used by the e2e test to assert the sweep ran).
func (r *MemoryRepository) ExpireOverdue(ctx context.Context, now time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, c := range r.rows {
		if c.Status == StatusGranted && !now.Before(c.ExpiresAt) {
			c.Status = StatusExpired
			revokedAt := now
			c.RevokedAt = &revokedAt
			count++
		}
	}
	return count, nil
}

// ListByUser returns the user's full consent history, newest
// first. Used by the privacy center's "my consents" view to show
// when the user last toggled precise location on / off.
func (r *MemoryRepository) ListByUser(ctx context.Context, userID string) ([]*Consent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*Consent, 0)
	for _, c := range r.rows {
		if c.UserID == userID {
			out = append(out, cloneConsent(c))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].GrantedAt.After(out[j].GrantedAt)
	})
	return out, nil
}

func cloneConsent(c *Consent) *Consent {
	cp := *c
	if c.LastUsedAt != nil {
		t := *c.LastUsedAt
		cp.LastUsedAt = &t
	}
	if c.RevokedAt != nil {
		t := *c.RevokedAt
		cp.RevokedAt = &t
	}
	return &cp
}
