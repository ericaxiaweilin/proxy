package rating

import (
	"context"
	"sync"
)

// MemoryRepository is the in-memory Repository for tests and dev-mode boot
// (no DATABASE_URL). Keyed by OrderID so the UNIQUE(order_id) re-rate-
// overwrites behavior matches the Postgres twin exactly.
type MemoryRepository struct {
	mu      sync.Mutex
	byOrder map[string]Rating
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{byOrder: make(map[string]Rating)}
}

func (r *MemoryRepository) Upsert(_ context.Context, rec Rating) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byOrder[rec.OrderID] = rec
	return nil
}

func (r *MemoryRepository) Aggregate(_ context.Context, ratedUserID string) (float64, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	total := 0
	count := 0
	for _, rec := range r.byOrder {
		if rec.RatedUserID != ratedUserID {
			continue
		}
		total += rec.Stars
		count++
	}
	if count == 0 {
		return 0, 0, nil
	}
	return float64(total) / float64(count), count, nil
}
