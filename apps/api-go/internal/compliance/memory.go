package compliance

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

// MemoryRepository is the in-memory implementation of
// Repository, used by service tests and the default server
// when no Postgres is configured. It is safe for concurrent
// use.
type MemoryRepository struct {
	mu      sync.Mutex
	rows    []*KillSwitch
	nowFunc func() time.Time
}

func NewMemoryRepository(nowFunc func() time.Time) *MemoryRepository {
	if nowFunc == nil {
		nowFunc = time.Now
	}
	return &MemoryRepository{rows: nil, nowFunc: nowFunc}
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
	return "ks_" + hex.EncodeToString(b[:])
}

// GetActive returns the KILLED row for the category, or
// ErrNotFound. Does not run the expiry sweep — the service
// layer does that on every public read.
func (r *MemoryRepository) GetActive(ctx context.Context, category Category) (*KillSwitch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range r.rows {
		if row.Category == category && row.Status == StatusKilled {
			return cloneKillSwitch(row), nil
		}
	}
	return nil, ErrNotFound
}

// Kill inserts a new KILLED row for the category. If a
// previous KILLED row exists, it is flipped to REARMED in the
// same call (no transaction needed because we hold the mutex
// for the whole operation).
func (r *MemoryRepository) Kill(ctx context.Context, category Category, reason, setBy string, expiresAt *time.Time, now time.Time) (*KillSwitch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Flip any existing KILLED row to REARMED. We do this
	// first so the audit trail captures the supersession in
	// time order: REARMED (older) -> KILLED (newer).
	for _, row := range r.rows {
		if row.Category == category && row.Status == StatusKilled {
			row.Status = StatusRearmed
			setter := setBy
			row.RearmedBy = &setter
			rearmedAt := now
			row.RearmedAt = &rearmedAt
		}
	}
	row := &KillSwitch{
		ID:        r.newID(),
		Category:  category,
		Status:    StatusKilled,
		Reason:    reason,
		SetBy:     setBy,
		SetAt:     now,
		ExpiresAt: expiresAt,
	}
	r.rows = append(r.rows, row)
	return cloneKillSwitch(row), nil
}

// Rearm flips the KILLED row for the category to REARMED.
// Returns ErrNotFound if no KILLED row exists.
func (r *MemoryRepository) Rearm(ctx context.Context, category Category, rearmedBy string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	flipped := false
	for _, row := range r.rows {
		if row.Category == category && row.Status == StatusKilled {
			row.Status = StatusRearmed
			setter := rearmedBy
			row.RearmedBy = &setter
			rearmedAt := now
			row.RearmedAt = &rearmedAt
			flipped = true
		}
	}
	if !flipped {
		return ErrNotFound
	}
	return nil
}

// ExpireOverdue flips every KILLED row whose expires_at has
// passed to REARMED. Returns the count.
func (r *MemoryRepository) ExpireOverdue(ctx context.Context, now time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, row := range r.rows {
		if row.Status == StatusKilled && row.ExpiresAt != nil && !now.Before(*row.ExpiresAt) {
			row.Status = StatusRearmed
			rearmedAt := now
			row.RearmedAt = &rearmedAt
			count++
		}
	}
	return count, nil
}

// ListAll returns every row (KILLED and REARMED), newest
// first.
func (r *MemoryRepository) ListAll(ctx context.Context) ([]*KillSwitch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*KillSwitch, 0, len(r.rows))
	for _, row := range r.rows {
		out = append(out, cloneKillSwitch(row))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].SetAt.After(out[j].SetAt)
	})
	return out, nil
}

func cloneKillSwitch(k *KillSwitch) *KillSwitch {
	cp := *k
	if k.ExpiresAt != nil {
		t := *k.ExpiresAt
		cp.ExpiresAt = &t
	}
	if k.RearmedBy != nil {
		s := *k.RearmedBy
		cp.RearmedBy = &s
	}
	if k.RearmedAt != nil {
		t := *k.RearmedAt
		cp.RearmedAt = &t
	}
	return &cp
}
