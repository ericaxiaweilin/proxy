package outbox

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
)

type failingDelivery struct{}

func (failingDelivery) Deliver(context.Context, event.DomainEvent) error {
	return errors.New("downstream unavailable")
}

func TestWorkerClaimsAndAcknowledgesMessages(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	e := event.New("TaskDraftCreated", "TaskDraft", "draft_1", 1, "org_1", "corr_1", "cmd_1", now, nil)
	if err := repository.Publish(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	worker := Worker{Repository: repository, Delivery: LogDelivery{}, WorkerID: "worker-a", Clock: func() time.Time { return now }}
	processed, err := worker.RunOnce(context.Background())
	if err != nil || processed != 1 {
		t.Fatalf("worker result processed=%d err=%v", processed, err)
	}
	snapshot := repository.Snapshot()
	if len(snapshot) != 1 || snapshot[0].Status != "SENT" || snapshot[0].Attempts != 1 {
		t.Fatalf("unexpected outbox state: %#v", snapshot)
	}
}

func TestWorkerBacksOffAndDeadLettersAfterMaxAttempts(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	e := event.New("TaskDraftCreated", "TaskDraft", "draft_1", 1, "org_1", "corr_1", "cmd_1", now, nil)
	if err := repository.Publish(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	worker := Worker{Repository: repository, Delivery: failingDelivery{}, WorkerID: "worker-a", MaxAttempts: 1, Clock: func() time.Time { return now }}
	if _, err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	snapshot := repository.Snapshot()
	if len(snapshot) != 1 || snapshot[0].Status != "DEAD_LETTER" || snapshot[0].LastError == "" {
		t.Fatalf("unexpected dead letter state: %#v", snapshot)
	}
}

func TestWorkerRetriesFailedMessagesWhenBackoffExpires(t *testing.T) {
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	repository := NewMemoryRepository()
	e := event.New("TaskDraftCreated", "TaskDraft", "draft_1", 1, "org_1", "corr_1", "cmd_1", now, nil)
	if err := repository.Publish(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	failedWorker := Worker{Repository: repository, Delivery: failingDelivery{}, WorkerID: "worker-a", MaxAttempts: 3, Clock: func() time.Time { return now }}
	if _, err := failedWorker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	message := repository.Snapshot()[0]
	if message.Status != "FAILED" || !message.AvailableAt.After(now) {
		t.Fatalf("expected retryable failed message, got %#v", message)
	}
	messageAvailableAt := message.AvailableAt
	successWorker := Worker{Repository: repository, Delivery: LogDelivery{}, WorkerID: "worker-b", Clock: func() time.Time { return messageAvailableAt }}
	processed, err := successWorker.RunOnce(context.Background())
	if err != nil || processed != 1 {
		t.Fatalf("expected retry to process message, processed=%d err=%v", processed, err)
	}
	if repository.Snapshot()[0].Status != "SENT" {
		t.Fatalf("expected retried message to be sent, got %#v", repository.Snapshot()[0])
	}
}
