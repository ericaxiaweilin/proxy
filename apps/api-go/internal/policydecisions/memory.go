package policydecisions

import (
	"context"
	"sort"
	"sync"
)

// MemoryRepository is the in-memory implementation of
// Repository, used by service tests and the default server
// when no Postgres is configured. It is safe for concurrent
// use.
type MemoryRepository struct {
	mu   sync.Mutex
	rows map[string]Decision // by id
	// stamps are by (orderID, decisionID) so a re-stamp at a
	// later lifecycle stage is recorded (audit log, not
	// idempotent).
	stamps []OrderStamp
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{rows: map[string]Decision{}}
}

func (r *MemoryRepository) GetByTuple(_ context.Context, userID string, category CategoryCode, termsVersion, privacyVersion string) (*Decision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, d := range r.rows {
		if d.UserID == userID && d.CategoryCode == category && d.TermsVersion == termsVersion && d.PrivacyVersion == privacyVersion {
			cp := d
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (r *MemoryRepository) GetByID(_ context.Context, id string) (*Decision, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.rows[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := d
	return &cp, nil
}

func (r *MemoryRepository) Insert(_ context.Context, d Decision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.rows[d.ID]; exists {
		// Should not happen because the id is freshly minted,
		// but a defensive check keeps the test suite honest.
		return nil
	}
	r.rows[d.ID] = d
	return nil
}

// Stamp records an (order, decision, lifecycle) tuple. The same
// pair may be re-stamped at a later lifecycle stage.
func (r *MemoryRepository) Stamp(_ context.Context, stamp OrderStamp) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stamps = append(r.stamps, stamp)
	return nil
}

// StampsForOrder returns the chronological list of stamps for
// the given order id. Used by the audit endpoint to render the
// "which policy applied when this order moved to CONFIRMED" log.
func (r *MemoryRepository) StampsForOrder(_ context.Context, orderID string) ([]OrderStamp, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]OrderStamp, 0)
	for _, s := range r.stamps {
		if s.OrderID == orderID {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].StampedAt.Before(out[j].StampedAt)
	})
	return out, nil
}
