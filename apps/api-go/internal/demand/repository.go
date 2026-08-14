package demand

import (
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrDraftNotFound   = errors.New("task draft not found")
	ErrVersionConflict = errors.New("task draft version conflict")
)

// Repository is the canonical persistence boundary for Demand aggregates.
// Implementations must enforce expectedVersion atomically on update.
type Repository interface {
	CreateDraft(ctx context.Context, draft TaskDraft) error
	GetDraft(ctx context.Context, id string) (TaskDraft, error)
	UpdateDraft(ctx context.Context, draft TaskDraft, expectedVersion int) error
	Snapshot(ctx context.Context) ([]TaskDraft, error)
}

// TransactionalRepository is implemented by stores that can commit the
// aggregate mutation and its outbox event in one database transaction.
type TransactionalRepository interface {
	Repository
	CreateDraftAndPublish(ctx context.Context, draft TaskDraft, domainEvents []event.DomainEvent) error
	UpdateDraftAndPublish(ctx context.Context, draft TaskDraft, expectedVersion int, domainEvents []event.DomainEvent) error
}

type MemoryRepository struct {
	mu     sync.Mutex
	drafts map[string]TaskDraft
	events []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{drafts: make(map[string]TaskDraft)}
}

func (r *MemoryRepository) CreateDraft(_ context.Context, draft TaskDraft) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.drafts[draft.ID]; exists {
		return errors.New("task draft already exists")
	}
	r.drafts[draft.ID] = cloneDraft(draft)
	return nil
}

func (r *MemoryRepository) CreateDraftAndPublish(_ context.Context, draft TaskDraft, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.drafts[draft.ID]; exists {
		return errors.New("task draft already exists")
	}
	r.drafts[draft.ID] = cloneDraft(draft)
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetDraft(_ context.Context, id string) (TaskDraft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	draft, exists := r.drafts[id]
	if !exists {
		return TaskDraft{}, ErrDraftNotFound
	}
	return cloneDraft(draft), nil
}

func (r *MemoryRepository) UpdateDraft(_ context.Context, draft TaskDraft, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.drafts[draft.ID]
	if !exists {
		return ErrDraftNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.drafts[draft.ID] = cloneDraft(draft)
	return nil
}

func (r *MemoryRepository) UpdateDraftAndPublish(_ context.Context, draft TaskDraft, expectedVersion int, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.drafts[draft.ID]
	if !exists {
		return ErrDraftNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.drafts[draft.ID] = cloneDraft(draft)
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) Events() []event.DomainEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]event.DomainEvent, len(r.events))
	copy(result, r.events)
	return result
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]TaskDraft, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]TaskDraft, 0, len(r.drafts))
	for _, draft := range r.drafts {
		result = append(result, cloneDraft(draft))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}
