package command

import (
	"context"
	"errors"
	"sync"
)

var ErrIdempotencyNotOwned = errors.New("idempotency record is not owned by this request")

type IdempotencyDecision string

const (
	IdempotencyClaimed    IdempotencyDecision = "CLAIMED"
	IdempotencyReplay     IdempotencyDecision = "REPLAY"
	IdempotencyConflict   IdempotencyDecision = "CONFLICT"
	IdempotencyInProgress IdempotencyDecision = "IN_PROGRESS"
)

type IdempotencyRecord struct {
	Fingerprint string
	Result      Result
}

// IdempotencyStore owns the claim/complete boundary for externally retryable
// commands. Implementations must make Begin atomic across API instances.
type IdempotencyStore interface {
	Begin(ctx context.Context, scope, key, fingerprint string) (IdempotencyDecision, *IdempotencyRecord, error)
	Complete(ctx context.Context, scope, key string, record IdempotencyRecord) error
}

type MemoryIdempotencyStore struct {
	mu       sync.Mutex
	records  map[string]IdempotencyRecord
	inflight map[string]string
}

func NewMemoryIdempotencyStore() *MemoryIdempotencyStore {
	return &MemoryIdempotencyStore{
		records:  make(map[string]IdempotencyRecord),
		inflight: make(map[string]string),
	}
}

func (s *MemoryIdempotencyStore) Begin(_ context.Context, scope, key, fingerprint string) (IdempotencyDecision, *IdempotencyRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	storeKey := idempotencyStoreKey(scope, key)

	if record, exists := s.records[storeKey]; exists {
		if record.Fingerprint != fingerprint {
			return IdempotencyConflict, nil, nil
		}
		copy := record
		return IdempotencyReplay, &copy, nil
	}
	if current, exists := s.inflight[storeKey]; exists {
		if current != fingerprint {
			return IdempotencyConflict, nil, nil
		}
		return IdempotencyInProgress, nil, nil
	}
	s.inflight[storeKey] = fingerprint
	return IdempotencyClaimed, nil, nil
}

func (s *MemoryIdempotencyStore) Complete(_ context.Context, scope, key string, record IdempotencyRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	storeKey := idempotencyStoreKey(scope, key)
	if current, exists := s.inflight[storeKey]; !exists || current != record.Fingerprint {
		return ErrIdempotencyNotOwned
	}
	delete(s.inflight, storeKey)
	s.records[storeKey] = record
	return nil
}

func idempotencyStoreKey(scope, key string) string {
	return scope + "\x00" + key
}
