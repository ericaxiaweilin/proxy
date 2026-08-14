package outbox

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrMessageNotClaimed = errors.New("outbox message is not claimed by this worker")
	ErrMessageNotFound   = errors.New("outbox message not found")
)

type Message struct {
	Event       event.DomainEvent
	Status      string
	Attempts    int
	AvailableAt time.Time
	LastError   string
}

// Repository owns the durable outbox lifecycle. Claim/ack operations are
// designed for a worker process and are independent from downstream delivery.
type Repository interface {
	event.Publisher
	Claim(ctx context.Context, workerID string, limit int, now time.Time) ([]Message, error)
	MarkSent(ctx context.Context, workerID, eventID string, sentAt time.Time) error
	MarkFailed(ctx context.Context, workerID, eventID, reason string, nextAttemptAt time.Time, deadLetter bool) error
}

type memoryRecord struct {
	message Message
	worker  string
}

type MemoryRepository struct {
	mu       sync.Mutex
	messages map[string]memoryRecord
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{messages: make(map[string]memoryRecord)}
}

func (r *MemoryRepository) Publish(_ context.Context, e event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.messages[e.EventID]; exists {
		return nil
	}
	r.messages[e.EventID] = memoryRecord{message: Message{Event: e, Status: "PENDING", AvailableAt: e.OccurredAt}}
	return nil
}

func (r *MemoryRepository) Claim(_ context.Context, workerID string, limit int, now time.Time) ([]Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if limit <= 0 {
		return []Message{}, nil
	}
	result := make([]Message, 0, limit)
	for eventID, record := range r.messages {
		if len(result) >= limit || (record.message.Status != "PENDING" && record.message.Status != "FAILED") || record.message.AvailableAt.After(now) {
			continue
		}
		record.message.Status = "PROCESSING"
		record.message.Attempts++
		record.worker = workerID
		r.messages[eventID] = record
		result = append(result, record.message)
	}
	return result, nil
}

func (r *MemoryRepository) MarkSent(_ context.Context, workerID, eventID string, sentAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, exists := r.messages[eventID]
	if !exists {
		return ErrMessageNotFound
	}
	if record.worker != workerID || record.message.Status != "PROCESSING" {
		return ErrMessageNotClaimed
	}
	record.message.Status = "SENT"
	_ = sentAt
	r.messages[eventID] = record
	return nil
}

func (r *MemoryRepository) MarkFailed(_ context.Context, workerID, eventID, reason string, nextAttemptAt time.Time, deadLetter bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, exists := r.messages[eventID]
	if !exists {
		return ErrMessageNotFound
	}
	if record.worker != workerID || record.message.Status != "PROCESSING" {
		return ErrMessageNotClaimed
	}
	record.message.LastError = reason
	record.message.AvailableAt = nextAttemptAt.UTC()
	if deadLetter {
		record.message.Status = "DEAD_LETTER"
	} else {
		record.message.Status = "FAILED"
	}
	r.messages[eventID] = record
	return nil
}

func (r *MemoryRepository) Snapshot() []Message {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Message, 0, len(r.messages))
	for _, record := range r.messages {
		result = append(result, record.message)
	}
	return result
}
