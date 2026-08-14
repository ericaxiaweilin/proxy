package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/outbox"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
)

type unavailableDelivery struct{}

func (unavailableDelivery) Deliver(context.Context, event.DomainEvent) error {
	return fmt.Errorf("outbox delivery provider is not configured")
}

type logDelivery struct{}

func (logDelivery) Deliver(_ context.Context, e event.DomainEvent) error {
	log.Printf("outbox event delivered in local log mode: event_id=%s type=%s aggregate=%s/%s", e.EventID, e.EventType, e.AggregateType, e.AggregateID)
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Println("proxy worker requires DATABASE_URL; no durable outbox configured")
		return
	}
	pollContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	pool, err := postgres.Open(pollContext, databaseURL)
	cancel()
	if err != nil {
		log.Fatalf("open postgres: %v", err)
	}
	defer pool.Close()

	workerID := os.Getenv("WORKER_ID")
	if workerID == "" {
		workerID, _ = os.Hostname()
	}
	delivery := outbox.Delivery(unavailableDelivery{})
	if os.Getenv("OUTBOX_DELIVERY") == "log" {
		delivery = logDelivery{}
	}
	worker := outbox.Worker{
		Repository:  postgres.NewOutboxRepository(pool),
		Delivery:    delivery,
		WorkerID:    workerID,
		BatchSize:   50,
		MaxAttempts: 10,
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	log.Printf("proxy worker listening worker_id=%s", workerID)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			processed, runErr := worker.RunOnce(ctx)
			if runErr != nil {
				log.Printf("outbox poll failed: %v", runErr)
				continue
			}
			if processed > 0 {
				log.Printf("outbox batch delivered: count=%d", processed)
			}
		}
	}
}
