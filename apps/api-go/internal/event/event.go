package event

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// DomainEvent is the server-side representation of the shared DomainEvent
// contract. It is deliberately transport-neutral so modules can publish to an
// in-process outbox in tests or to PostgreSQL in deployed environments.
type DomainEvent struct {
	EventID          string         `json:"eventId"`
	EventType        string         `json:"eventType"`
	EventVersion     int            `json:"eventVersion"`
	AggregateType    string         `json:"aggregateType"`
	AggregateID      string         `json:"aggregateId"`
	AggregateVersion int            `json:"aggregateVersion"`
	PrincipalID      string         `json:"principalId"`
	OccurredAt       time.Time      `json:"occurredAt"`
	CorrelationID    string         `json:"correlationId"`
	CausationID      string         `json:"causationId,omitempty"`
	Payload          map[string]any `json:"payload"`
}

func (e DomainEvent) MarshalPayload() ([]byte, error) {
	if e.Payload == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(e.Payload)
}

// Publisher is the narrow boundary used by domain modules. The first
// implementation is an append-only outbox; delivery is intentionally kept out
// of the request path.
type Publisher interface {
	Publish(ctx context.Context, e DomainEvent) error
}

type NoopPublisher struct{}

func (NoopPublisher) Publish(context.Context, DomainEvent) error { return nil }

// MemoryPublisher is useful for domain tests and local development. A copy is
// stored on publish so callers cannot mutate an already-recorded event.
type MemoryPublisher struct {
	mu     sync.Mutex
	events []DomainEvent
}

func NewMemoryPublisher() *MemoryPublisher { return &MemoryPublisher{} }

func (p *MemoryPublisher) Publish(_ context.Context, e DomainEvent) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, clone(e))
	return nil
}

func (p *MemoryPublisher) Events() []DomainEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := make([]DomainEvent, len(p.events))
	for i, e := range p.events {
		result[i] = clone(e)
	}
	return result
}

func NewID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err == nil {
		// Event IDs remain UUID-shaped because the foundation migration uses a
		// UUID primary key for the event itself.
		raw[6] = (raw[6] & 0x0f) | 0x40
		raw[8] = (raw[8] & 0x3f) | 0x80
		encoded := hex.EncodeToString(raw[:])
		return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
	}
	return "00000000-0000-4000-8000-" + hex.EncodeToString(raw[0:6])
}

func New(eventType, aggregateType, aggregateID string, aggregateVersion int, principalID, correlationID, causationID string, occurredAt time.Time, payload map[string]any) DomainEvent {
	return DomainEvent{
		EventID:          NewID(),
		EventType:        eventType,
		EventVersion:     1,
		AggregateType:    aggregateType,
		AggregateID:      aggregateID,
		AggregateVersion: aggregateVersion,
		PrincipalID:      principalID,
		OccurredAt:       occurredAt.UTC(),
		CorrelationID:    correlationID,
		CausationID:      causationID,
		Payload:          cloneMap(payload),
	}
}

func clone(e DomainEvent) DomainEvent {
	e.Payload = cloneMap(e.Payload)
	return e
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
