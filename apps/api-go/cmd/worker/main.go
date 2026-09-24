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
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/identity"
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
	recipient, title, body, deepLink, ok := inboxForEvent(e)
	if !ok {
		return nil
	}
	// Direct PG insert to notification.inbox_items (bypass service to avoid auth)
	_, err := d.pool.Exec(ctx, `
		INSERT INTO notification.inbox_items (id, recipient_id, type, title, body, deep_link, read, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,false,now()) ON CONFLICT (id) DO NOTHING`,
		"inbox_"+e.EventID, recipient, e.EventType, title, body, deepLink)
	return err
}

// NOTIF-INVITE-OFFER-001: 事件→收件人的纯映射（可单测）。修过两处真洞：
//
//  1. SlotOfferCreated 以前按 PrincipalID 投递 —— 发起 offer 的是 requester，
//     5 分钟内必须行动的是 agent(payload.agentId)，等于把信送给了发信人自己。
//     现在按 agentId 投，缺失才回退 PrincipalID。
//  2. InvitationCreated / InvitationResponded 以前根本不在 switch 里 ——
//     被邀方和邀约方都收不到任何东西。现在按 inviteeId / hostId 投。
//
// 其余分支与原来一字不差（TaskPublished 等仍按 PrincipalID）。未知事件返回
// ok=false，安静跳过 —— worker 的 best-effort 语义不变。
func inboxForEvent(e event.DomainEvent) (recipient, title, body, deepLink string, ok bool) {
	payloadString := func(key string) string {
		if e.Payload == nil {
			return ""
		}
		v, _ := e.Payload[key].(string)
		return v
	}
	// 和原来一致的兜底：Principal 为空才拿 AggregateID。
	fallbackRecipient := func(want string) string {
		if want != "" {
			return want
		}
		if e.PrincipalID != "" {
			return e.PrincipalID
		}
		return e.AggregateID
	}
	switch e.EventType {
	case "TaskPublished":
		return fallbackRecipient(""), "需求已发布", "你的需求已进入撮合", "/tasks/" + e.AggregateID, true
	case "TaskSlotsCreated":
		return "", "", "", "", false // skip noisy
	case "OfferCreated", "SlotOfferCreated":
		return fallbackRecipient(payloadString("agentId")), "收到 Offer", "客户已发 Offer，5分钟内有效", "/offers/" + e.AggregateID, true
	case "OrderCreated", "OfferAccepted":
		return fallbackRecipient(""), "订单已成立", "已生成订单，可打卡", "/orders/" + e.AggregateID, true
	case "VoucherRedeemed", "VoucherSettled":
		return fallbackRecipient(""), "凭证动态", e.EventType, "/vouchers/" + e.AggregateID, true
	case "InvitationCreated":
		return fallbackRecipient(payloadString("inviteeId")), "收到场景邀请", "有人邀请你一起去场景看看", "/invitations/" + e.AggregateID, true
	case "InvitationResponded":
		decision := payloadString("decision")
		reply := "对方回复了你的邀请"
		if decision == "ACCEPTED" {
			reply = "对方接受了你的邀请，可以约时间了"
		} else if decision == "DECLINED" {
			reply = "对方拒绝了你的邀请"
		} else if decision == "ASK" {
			reply = "对方想先问问细节再决定"
		}
		return fallbackRecipient(payloadString("hostId")), "邀请有回复了", reply, "/invitations/" + e.AggregateID, true
	default:
		return "", "", "", "", false
	}
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
	// LC-15 (Vietnam PDP 91/2025/QH15 Art. 32): the erasure executor.
	// Until this wiring existed, POST /v1/privacy/delete wrote a
	// 'received' row that nothing ever acted on, while the app promised
	// permanent deletion in 30 days. The same hourly tick now drives
	// received -> in_progress (24h) -> erased (30d).
	privacyService := identity.NewWithRepositoryAndClock(postgres.NewIdentityRepository(pool), nil)
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
	sweepPrivacyDeletions(ctx, privacyService)
	// GRAVITY-001: 引力状态（spec §6-§7 / §21）启动时算一次，之后每小时重算。
	gravityStore := gravity.NewPostgres(pool)
	recomputeGravity(ctx, gravityStore)
	gravityTicker := time.NewTicker(time.Hour)
	defer gravityTicker.Stop()

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
		case <-gravityTicker.C:
			recomputeGravity(ctx, gravityStore)
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
			sweepPrivacyDeletions(ctx, privacyService)
		}
	}
}

// recomputeGravity 重算所有人的引力状态；失败只记日志（派生数据，下个小时再来）。
func recomputeGravity(ctx context.Context, store gravity.Store) {
	n, err := gravity.Recompute(ctx, store, time.Now().UTC())
	if err != nil {
		log.Printf("gravity recompute failed: %v", err)
		return
	}
	log.Printf("gravity recompute: states=%d model=%s", n, gravity.ModelVersion)
}

// sweepPrivacyDeletions runs one LC-15 pass and logs what it did. Kept
// out of the select body so the startup pass and the hourly pass share
// exactly one code path — a startup-only or tick-only regression would
// otherwise be invisible.
func sweepPrivacyDeletions(ctx context.Context, svc *identity.Service) {
	outcomes, err := svc.SweepPrivacyDeletions(ctx, time.Now().UTC())
	if err != nil {
		log.Printf("privacy deletion sweep failed: %v", err)
	}
	for _, outcome := range outcomes {
		switch outcome.Action {
		case identity.PrivacySweepAcknowledged:
			log.Printf("privacy deletion acknowledged: request=%s user=%s", outcome.RequestID, outcome.UserID)
		case identity.PrivacySweepErased:
			log.Printf("privacy deletion erased: request=%s user=%s rows=%d external=%s",
				outcome.RequestID, outcome.UserID, outcome.Erased.Total(), outcome.External.Summary())
		}
	}
}
