package scenereview

import (
	"context"
	"sync"
)

// MemoryRepository is the in-memory Repository for tests and dev-mode boot
// (no DATABASE_URL). Keyed by (SceneID, RaterID) so the
// UNIQUE(scene_id, rater_id) re-review-overwrites behavior matches the
// Postgres twin exactly.
type MemoryRepository struct {
	mu    sync.Mutex
	byKey map[[2]string]Review
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{byKey: make(map[[2]string]Review)}
}

func (r *MemoryRepository) Upsert(_ context.Context, rec Review) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byKey[[2]string{rec.SceneID, rec.RaterID}] = rec
	return nil
}

func (r *MemoryRepository) Aggregate(_ context.Context, sceneID string) (float64, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	total := 0
	count := 0
	for key, rec := range r.byKey {
		if key[0] != sceneID {
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
