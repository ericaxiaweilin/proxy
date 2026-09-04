package jurisdiction

import (
	"context"
	"sync"
)

// MemoryRepository is the in-memory implementation of
// Repository. Used by tests and the dev server; the
// Postgres implementation is a follow-up. The schema
// (user_jurisdiction) is created in migration 067.
type MemoryRepository struct {
	mu    sync.Mutex
	store map[string]UserJurisdiction
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{store: map[string]UserJurisdiction{}}
}

func (r *MemoryRepository) Get(_ context.Context, userID string) (*UserJurisdiction, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row, ok := r.store[userID]
	if !ok {
		return nil, ErrNotFound
	}
	cp := row
	return &cp, nil
}

func (r *MemoryRepository) Upsert(_ context.Context, row UserJurisdiction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.store[row.UserID] = row
	return nil
}
