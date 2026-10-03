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
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/notification"
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

// businessInboxDelivery 把「事件」翻译成「一条通知」，然后交给**统一管线**。
//
// NOTIF-PIPELINE-001：以前这里是自己写 SQL 的 ——
//
//	INSERT INTO notification.inbox_items (...) VALUES (...)
//	  ON CONFLICT (id) DO NOTHING
//	// Direct PG insert to notification.inbox_items (bypass service to avoid auth)
//
// 那条直连 SQL 是**全部 845 行真数据的唯一来源**，但它只做了「落库」这一半：
// 不推送、不复用 Repository、也不经过任何校验。命令侧那条路径（sendInbox）
// 反过来有推送、没幂等。两条路径各做一半，合起来才是「一条通知该有的样子」。
//
// 现在这里只负责**它真正独有的那件事** —— event → (收件人, 标题, 正文, 深链)
// 的映射（inboxForEvent），写完交给 notification.Producer。
//
// 「bypass service to avoid auth」这个理由不再成立：绕开的是命令层的
// operator 鉴权，而管线（Pipeline）本身不带任何鉴权 —— 鉴权留在命令面，
// 写侧对两个生产者一视同仁。
type businessInboxDelivery struct {
	inner    outbox.Delivery
	producer notification.Producer
}

func (d businessInboxDelivery) Deliver(ctx context.Context, e event.DomainEvent) error {
	// Best-effort inbox notification for P0 business events; never fail the outbox batch
	_ = d.createInboxForEvent(ctx, e)
	return d.inner.Deliver(ctx, e)
}

func (d businessInboxDelivery) createInboxForEvent(ctx context.Context, e event.DomainEvent) error {
	if d.producer == nil {
		return nil
	}
	recipient, title, body, deepLink, ok := inboxForEvent(e)
	if !ok {
		return nil
	}
	// DedupeKey = 事件 id：outbox 投递失败会重放整批，同一个事件必须只落一行、
	// 只推一次。幂等由管线保证（item id 由 key 推出来），这里不再写 ON CONFLICT。
	_, _, err := d.producer.Emit(ctx, notification.Notification{
		RecipientID: recipient,
		Type:        e.EventType,
		Title:       title,
		Body:        body,
		DeepLink:    deepLink,
		DedupeKey:   notification.EventDedupeKey(e.EventID),
	})
	return err
}

// NOTIF-INVITE-OFFER-001: 事件→收件人的纯映射（可单测）。修过四处真洞：
//
//  1. SlotOfferCreated 以前按 PrincipalID 投递 —— 发起 offer 的是 requester，
//     5 分钟内必须行动的是 agent(payload.agentId)，等于把信送给了发信人自己。
//     现在按 agentId 投，缺失才回退 PrincipalID。
//  2. InvitationCreated / InvitationResponded 以前根本不在 switch 里 ——
//     被邀方和邀约方都收不到任何东西。现在按 inviteeId / hostId 投。
//  3. （2026-10-02）两个**永不触发**的分支：`OrderCreated` / `VoucherRedeemed` /
//     `VoucherSettled` 全仓 `event.New(` 里一个生产者都没有 —— 映射写得再对，
//     事件不发生就是零通知。真实事件叫 `OrderCreatedFromOffer`（见下）。
//  4. （2026-10-02）`OfferAccepted` 的深链是错的：它的 Aggregate 是 **offer**
//     （fulfillment/service.go 里 `event.New("OfferAccepted", "Offer", offer.ID, …)`），
//     却和 `OrderCreated` 共用了 `/orders/` + AggregateID ⇒ 发出去的是
//     `/orders/off_…` —— offer id 挂在 orders 前缀下，点进去没有这个资源。
//     现在订单通知只由 `OrderCreatedFromOffer` 出（它的 Aggregate 才是 order），
//     `OfferAccepted` 不再单独发一条（它俩在同一批 domainEvents 里，留着就是
//     同一件事收两条）。
//
// 其余分支与原来一字不差（TaskPublished 等仍按 PrincipalID）。未知事件返回
// ok=false，安静跳过 —— worker 的 best-effort 语义不变。
//
// ⚠️ 这里每一个 case 的**事件名**都必须真的有人发 —— 上面第 3 条就是教训。
//    `TestInboxForEventOnlyMapsEventTypesThatAreActuallyEmitted` 扫全仓
//    `event.New("X"` 来钉这件事，加分支前先跑它。
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
	// 真实事件名是 OrderCreatedFromOffer（Aggregate 是 order，所以 /orders/<ord_…> 是对的）。
	// 别再加回 "OrderCreated" / "OfferAccepted" —— 见函数头注释第 3、4 条。
	case "OrderCreatedFromOffer":
		return fallbackRecipient(""), "订单已成立", "已生成订单，可打卡", "/orders/" + e.AggregateID, true
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
	// NOTIF-PIPELINE-001：通知走**和 API 同一条**管线 —— 同一个 Repository、
	// 同一个推送通道选择逻辑（PushProviderFromEnv，认 NOTIFICATION_PUSH）。
	// 以前 worker 自己写 SQL、API 走 Service，推送通道只有 API 那半知道。
	inboxRepo := postgres.NewNotificationRepository(pool)
	pushProvider, pushNote := notification.PushProviderFromEnv(os.Getenv, inboxRepo)
	inboxPipeline := notification.NewPipeline(inboxRepo, pushProvider)
	log.Printf("%s", inboxPipeline.Describe())
	log.Printf("%s", pushNote)
	delivery := outbox.Delivery(businessInboxDelivery{inner: deduped, producer: inboxPipeline})
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
