package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/media"
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

type inboxDedupeDelivery struct {
	inner outbox.Delivery
	inbox *postgres.InboxRepository
}

func (d inboxDedupeDelivery) Deliver(ctx context.Context, e event.DomainEvent) error {
	if d.inbox != nil {
		ok, err := d.inbox.TryProcess(ctx, e.EventID, e.EventType, e.AggregateType, e.AggregateID)
		if err != nil {
			return err
		}
		if !ok {
			log.Printf("outbox inbox dedupe: skip duplicate event_id=%s", e.EventID)
			return nil
		}
	}
	return d.inner.Deliver(ctx, e)
}

type businessInboxDelivery struct {
	inner outbox.Delivery
	pool  *pgxpool.Pool
}

func (d businessInboxDelivery) Deliver(ctx context.Context, e event.DomainEvent) error {
	// Best-effort inbox notification for P0 business events; never fail the outbox batch
	_ = d.createInboxForEvent(ctx, e)
	return d.inner.Deliver(ctx, e)
}

func (d businessInboxDelivery) createInboxForEvent(ctx context.Context, e event.DomainEvent) error {
	// Map domain events to inbox notifications (recipient = actor for now, P0 simple)
	var title, body, deepLink string
	switch e.EventType {
	case "TaskPublished":
		title, body, deepLink = "需求已发布", "你的需求已进入撮合", "/tasks/"+e.AggregateID
	case "TaskSlotsCreated":
		return nil // skip noisy
	case "OfferCreated", "SlotOfferCreated":
		title, body, deepLink = "收到 Offer", "客户已发 Offer，5分钟内有效", "/offers/"+e.AggregateID
	case "OrderCreated", "OfferAccepted":
		title, body, deepLink = "订单已成立", "已生成订单，可打卡", "/orders/"+e.AggregateID
	case "VoucherRedeemed", "VoucherSettled":
		title, body, deepLink = "凭证动态", e.EventType, "/vouchers/"+e.AggregateID
	default:
		return nil
	}
	// Use the event's PrincipalID as recipient (fallback to AggregateID)
	recipient := e.PrincipalID
	if recipient == "" {
		recipient = e.AggregateID
	}
	// Direct PG insert to notification.inbox_items (bypass service to avoid auth)
	_, err := d.pool.Exec(ctx, `
		INSERT INTO notification.inbox_items (id, recipient_id, type, title, body, deep_link, read, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,false,now()) ON CONFLICT (id) DO NOTHING`,
		"inbox_"+e.EventID, recipient, e.EventType, title, body, deepLink)
	return err
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
	baseDelivery := outbox.Delivery(logDelivery{})
	if os.Getenv("OUTBOX_DELIVERY") == "unavailable" {
		baseDelivery = unavailableDelivery{}
	}
	deduped := inboxDedupeDelivery{inner: baseDelivery, inbox: postgres.NewInboxRepository(pool)}
	delivery := outbox.Delivery(businessInboxDelivery{inner: deduped, pool: pool})
	outboxWorker := outbox.Worker{
		Repository:  postgres.NewOutboxRepository(pool),
		Delivery:    delivery,
		WorkerID:    workerID,
		BatchSize:   50,
		MaxAttempts: 10,
	}
	mediaRepository := postgres.NewMediaRepository(pool)
	mediaStoreDir, err := media.ResolveLocalStoreDir(os.Getenv("PROXY_MEDIA_STORE_DIR"))
	if err != nil {
		log.Fatalf("configure media store: %v", err)
	}
	mediaService := media.NewWithDependencies(mediaRepository, media.NewFFmpegProcessor(mediaStoreDir))
	mediaService.SetStoreDir(mediaStoreDir)
	mediaWorker := media.Worker{
		Repository: mediaRepository, Service: mediaService, WorkerID: workerID,
		BatchSize: 4, MaxAttempts: 5,
	}
	// Lotus RFC §5/§1: hourly purge of expired messages + burner identities.
	// Uses partial indexes idx_conversation_messages_expires_at and
	// idx_display_identities_expires; cheap even with large tables.
	conversationRepository := postgres.NewConversationRepository(pool)
	displayIdentityRepository := postgres.NewDisplayIdentityRepository(pool)
	sweeperTicker := time.NewTicker(time.Hour)
	defer sweeperTicker.Stop()
	// Run once on startup so dev restarts immediately clean up stale fixtures.
	if n, err := conversationRepository.PurgeExpiredMessages(ctx, time.Now().UTC()); err != nil {
		log.Printf("conversation sweep startup failed: %v", err)
	} else if n > 0 {
		log.Printf("conversation sweep startup purged: count=%d", n)
	}
	if n, err := displayIdentityRepository.SweepExpiredBurners(ctx, time.Now().UTC()); err != nil {
		log.Printf("burner sweep startup failed: %v", err)
	} else if n > 0 {
		log.Printf("burner sweep startup burned: count=%d", n)
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	log.Printf("proxy worker listening worker_id=%s media_store=%s", workerID, mediaStoreDir)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			processed, runErr := outboxWorker.RunOnce(ctx)
			if runErr != nil {
				log.Printf("outbox poll failed: %v", runErr)
			} else if processed > 0 {
				log.Printf("outbox batch delivered: count=%d", processed)
			}
			mediaProcessed, mediaErr := mediaWorker.RunOnce(ctx)
			if mediaErr != nil {
				log.Printf("media processing poll failed: %v", mediaErr)
				continue
			}
			if mediaProcessed > 0 {
				log.Printf("media processing batch completed: count=%d", mediaProcessed)
			}
		case <-sweeperTicker.C:
			if n, err := conversationRepository.PurgeExpiredMessages(ctx, time.Now().UTC()); err != nil {
				log.Printf("conversation sweep failed: %v", err)
			} else if n > 0 {
				log.Printf("conversation sweep purged: count=%d", n)
			}
			if n, err := displayIdentityRepository.SweepExpiredBurners(ctx, time.Now().UTC()); err != nil {
				log.Printf("burner sweep failed: %v", err)
			} else if n > 0 {
				log.Printf("burner sweep burned: count=%d", n)
			}
		}
	}
}
