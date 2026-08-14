package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
)

type Delivery interface {
	Deliver(ctx context.Context, e event.DomainEvent) error
}

type LogDelivery struct{}

func (LogDelivery) Deliver(_ context.Context, e event.DomainEvent) error {
	return nil
}

type Worker struct {
	Repository  Repository
	Delivery    Delivery
	WorkerID    string
	BatchSize   int
	MaxAttempts int
	Clock       func() time.Time
}

func (w Worker) RunOnce(ctx context.Context) (int, error) {
	if w.Repository == nil || w.Delivery == nil {
		return 0, fmt.Errorf("outbox worker dependencies are not configured")
	}
	if w.WorkerID == "" {
		w.WorkerID = "proxy-worker"
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 50
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 10
	}
	now := time.Now().UTC()
	if w.Clock != nil {
		now = w.Clock().UTC()
	}
	messages, err := w.Repository.Claim(ctx, w.WorkerID, w.BatchSize, now)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, message := range messages {
		if err := w.Delivery.Deliver(ctx, message.Event); err != nil {
			deadLetter := message.Attempts >= w.MaxAttempts
			nextAttemptAt := now.Add(backoff(message.Attempts))
			if markErr := w.Repository.MarkFailed(ctx, w.WorkerID, message.Event.EventID, err.Error(), nextAttemptAt, deadLetter); markErr != nil {
				return processed, markErr
			}
			continue
		}
		if err := w.Repository.MarkSent(ctx, w.WorkerID, message.Event.EventID, now); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Duration(1<<uint(attempt-1)) * time.Second
}
