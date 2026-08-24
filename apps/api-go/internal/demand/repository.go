package demand

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrDraftNotFound   = errors.New("task draft not found")
	ErrVersionConflict = errors.New("task draft version conflict")
)

// Task is the canonical committed Demand aggregate. It is 1:1 with a
// TaskDraft after PublishTask succeeds; TaskSlots are stored in their own
// table but also kept as JSONB snapshot on the draft for backward reads.
type Task struct {
	ID                 string            `json:"id"`
	DraftID            string            `json:"draftId"`
	OwnerUserAccountID string            `json:"ownerUserAccountId"`
	Principal          command.Principal `json:"principal"`
	Lifecycle          string            `json:"lifecycle"`
	Version            int               `json:"version"`
	SourceInput        string            `json:"sourceInput"`
	Changes            map[string]any    `json:"changes"`
	Slots              []TaskSlot        `json:"slots"`
	CreatedAt          time.Time         `json:"createdAt"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

// Repository is the canonical persistence boundary for Demand aggregates.
// Implementations must enforce expectedVersion atomically on update.
type Repository interface {
	CreateDraft(ctx context.Context, draft TaskDraft) error
	GetDraft(ctx context.Context, id string) (TaskDraft, error)
	UpdateDraft(ctx context.Context, draft TaskDraft, expectedVersion int) error
	Snapshot(ctx context.Context) ([]TaskDraft, error)
	// Canonical read boundary for committed Tasks.
	GetTask(ctx context.Context, id string) (Task, error)
	ListTaskSlots(ctx context.Context, taskID string) ([]TaskSlot, error)
}

// TransactionalRepository is implemented by stores that can commit the
// aggregate mutation and its outbox event in one database transaction.
type TransactionalRepository interface {
	Repository
	CreateDraftAndPublish(ctx context.Context, draft TaskDraft, domainEvents []event.DomainEvent) error
	UpdateDraftAndPublish(ctx context.Context, draft TaskDraft, expectedVersion int, domainEvents []event.DomainEvent) error
	PublishTaskAndCreateCanonical(ctx context.Context, draft TaskDraft, expectedVersion int, slots []TaskSlot, domainEvents []event.DomainEvent) error
}

type MemoryRepository struct {
	mu        sync.Mutex
	drafts    map[string]TaskDraft
	tasks     map[string]Task
	taskSlots map[string][]TaskSlot
	events    []event.DomainEvent
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

func (r *MemoryRepository) PublishTaskAndCreateCanonical(ctx context.Context, draft TaskDraft, expectedVersion int, slots []TaskSlot, domainEvents []event.DomainEvent) error {
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
	if r.tasks == nil {
		r.tasks = make(map[string]Task)
	}
	if r.taskSlots == nil {
		r.taskSlots = make(map[string][]TaskSlot)
	}
	task := Task{
		ID: draft.ID, DraftID: draft.ID, OwnerUserAccountID: draft.OwnerUserAccountID,
		Principal: draft.Principal, Lifecycle: draft.Lifecycle, Version: draft.Version,
		SourceInput: draft.SourceInput, Changes: cloneMap(draft.Changes),
		Slots: append([]TaskSlot{}, slots...), CreatedAt: draft.UpdatedAt, UpdatedAt: draft.UpdatedAt,
	}
	r.tasks[task.ID] = task
	cloned := append([]TaskSlot{}, slots...)
	r.taskSlots[task.ID] = cloned
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetTask(_ context.Context, id string) (Task, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.tasks == nil {
		return Task{}, ErrDraftNotFound
	}
	task, ok := r.tasks[id]
	if !ok {
		return Task{}, ErrDraftNotFound
	}
	cloned := task
	cloned.Changes = cloneMap(task.Changes)
	cloned.Slots = append([]TaskSlot{}, task.Slots...)
	return cloned, nil
}

func (r *MemoryRepository) ListTaskSlots(_ context.Context, taskID string) ([]TaskSlot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.taskSlots == nil {
		return nil, nil
	}
	slots, ok := r.taskSlots[taskID]
	if !ok {
		return []TaskSlot{}, nil
	}
	return append([]TaskSlot{}, slots...), nil
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	out := make(map[string]any, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
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
