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
	// ReplayedAt / ReplayCount 是**审计**（migration 178）：重放不是抹掉发生过的事。
	ReplayedAt  *time.Time
	ReplayCount int
}

// outbox 状态。集中成常量是因为它们现在出现在三个地方（Claim / MarkFailed /
// Replay），而拼错的字符串不会编译失败 —— 只会在运行时让一条消息永远不被消费。
const (
	StatusPending    = "PENDING"
	StatusProcessing = "PROCESSING"
	StatusSent       = "SENT"
	StatusFailed     = "FAILED"
	StatusDeadLetter = "DEAD_LETTER"
)

// Repository owns the durable outbox lifecycle. Claim/ack operations are
// designed for a worker process and are independent from downstream delivery.
type Repository interface {
	event.Publisher
	Claim(ctx context.Context, workerID string, limit int, now time.Time) ([]Message, error)
	MarkSent(ctx context.Context, workerID, eventID string, sentAt time.Time) error
	MarkFailed(ctx context.Context, workerID, eventID, reason string, nextAttemptAt time.Time, deadLetter bool) error
	// ListDeadLetters 列出死信。deadBefore 之前发生的（olderThan 那一侧）由调用方
	// 用 occurred_at 过滤，这里只按时间窗口取：
	//   · fresh（够新、可以重放）传 now；
	//   · stale（太旧、只报数）传零值表示不限。
	ListDeadLetters(ctx context.Context, freshSince time.Time, limit int) ([]Message, error)
	// Replay 把死信放回 PENDING 让它被重新消费。
	//
	// lastError 原样保留：重放是「再试一次」，不是「抹掉发生过的事」。
	// attempts 清零，否则 Claim 会按旧计数直接再判 DEAD_LETTER。
	Replay(ctx context.Context, eventIDs []string, now time.Time) (int, error)
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

// ListDeadLetters / Replay 在内存仓里的语义必须与 PG 一致：够新的（occurred_at
// 不早于 freshSince）先返回，太旧的（freshSince 传零值则不限）用于报数。
func (r *MemoryRepository) ListDeadLetters(_ context.Context, freshSince time.Time, limit int) ([]Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Message{}
	for _, record := range r.messages {
		if record.message.Status != StatusDeadLetter {
			continue
		}
		if !freshSince.IsZero() && record.message.Event.OccurredAt.Before(freshSince) {
			continue
		}
		out = append(out, record.message)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (r *MemoryRepository) Replay(_ context.Context, eventIDs []string, now time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	replayed := 0
	for _, eventID := range eventIDs {
		record, exists := r.messages[eventID]
		if !exists || record.message.Status != StatusDeadLetter {
			continue
		}
		record.message.Status = StatusPending
		record.message.Attempts = 0
		record.message.AvailableAt = now.UTC()
		record.worker = ""
		// LastError 保留：重放是「再试一次」，不是抹掉发生过的事。
		record.message.ReplayedAt = &now
		record.message.ReplayCount++
		r.messages[eventID] = record
		replayed++
	}
	return replayed, nil
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
