package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
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
	// MERCHANT-CREATOR-NOTIFY-001：通知没投出去时，这里逐条 log error
	// （以前是 `_ = d.createInboxForEvent(ctx, e)` —— 失败连日志都没有，
	// 事件照样 MarkSent ⇒ 通知永久丢失、无痕迹）。
	//
	// 逐条 log 是「留痕」，这个计数是「能告警」：log 里翻到一行不代表有人看，
	// 而一行 "inbox notifications failed since_last_tick=N cumulative=N"
	// 可以直接被日志告警规则抓住。
	missed       *atomic.Int64
	missedLogged *atomic.Int64
}

func newBusinessInboxDelivery(inner outbox.Delivery, producer notification.Producer) businessInboxDelivery {
	return businessInboxDelivery{inner: inner, producer: producer, missed: &atomic.Int64{}, missedLogged: &atomic.Int64{}}
}

func (d businessInboxDelivery) Deliver(ctx context.Context, e event.DomainEvent) error {
	// Best-effort inbox notification for P0 business events; never fail the outbox batch.
	//
	// 这个取舍是对的，别改：让一条标题写错的通知把「需求已发布」拖进
	// DEAD_LETTER，是用业务事件的可投递性去换一个本该被挡住的错误。
	// 但**不失败 ≠ 不留痕** —— 失败必须进日志和计数。
	if err := d.createInboxForEvent(ctx, e); err != nil {
		d.noteMissed(e, err)
	}
	return d.inner.Deliver(ctx, e)
}

func (d businessInboxDelivery) noteMissed(e event.DomainEvent, err error) {
	if d.missed != nil {
		d.missed.Add(1)
	}
	log.Printf("notification delivery failed: event_type=%s event_id=%s aggregate=%s/%s err=%v",
		e.EventType, e.EventID, e.AggregateType, e.AggregateID, err)
}

// reportMissedNotifications 返回「自上次上报以来的新增失败数」，并把游标推前。
// 供 tick 循环打一条可告警的心跳行。
//
// 注意别写成 `missed.Add(-missedLogged.Swap(missed.Load()))` —— 那会让
// Swap 把游标设成总数、再用 Add 把总数减回去，计数本身就被改坏了
// （第二次失败就报不出来）。先读总数、只动游标：
func (d businessInboxDelivery) reportMissedNotifications() int64 {
	if d.missed == nil || d.missedLogged == nil {
		return 0
	}
	total := d.missed.Load()
	return total - d.missedLogged.Swap(total)
}

func (d businessInboxDelivery) missedTotal() int64 {
	if d.missed == nil {
		return 0
	}
	return d.missed.Load()
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
//
//	`TestInboxForEventOnlyMapsEventTypesThatAreActuallyEmitted` 扫全仓
//	`event.New("X"` 来钉这件事，加分支前先跑它。
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
	// 收件人一律取 payload.notifyPrincipalId，**不回退到 PrincipalID**：
	// PrincipalID 是 actor，是发信人自己。回退过去等于把「你的活单被还价了」
	// 发给还价那个人（函数头第 1 条教训就是这个）。notifyPrincipalId 为空 =
	// 「不知道该通知谁」（历史行没有这个字段）—— 那就不发，不猜。
	merchantCreatorRecipient := func() (string, bool) {
		who := payloadString("notifyPrincipalId")
		return who, who != ""
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
	// CONTENT-TASK-001：商家「催一下」/ 审核结果 → 投给 creator（payload.agentId）。
	// 没有 agentId 就不投（不回退到发起人 —— 那是商家自己）。
	case "ContentTaskNudged":
		agent := payloadString("agentId")
		if agent == "" {
			return "", "", "", "", false
		}
		body := "商家在等你的内容稿件"
		if payloadString("stage") == "AWAITING" {
			body = "商家在等你回复内容合作邀请"
		}
		return agent, "商家提醒了你", body, "", true
	case "ContentDraftReviewed":
		agent := payloadString("agentId")
		if agent == "" {
			return "", "", "", "", false
		}
		if payloadString("decision") == "APPROVE" {
			return agent, "稿件审核通过", "可以发布了，发完记得贴上各平台链接", "", true
		}
		return agent, "稿件被打回", "商家写了修改意见，改好后可重新提交", "", true

		// ── MERCHANT-CREATOR-NOTIFY-001：商家↔creator 的往来 ──────────────────
		//
		// 这一整段以前**一个 case 都没有**：supply 域发的 CollabInvitationCreated /
		// CollabInvitationResponded / MerchantCreatorPromo* / Promo* 全都落在
		// default → ok=false → 安静跳过。商家发了活单、creator 没人知道；creator
		// 还了价，商家没人知道。事件是齐的，映射是空的，中间那一层没人写。
		//

	case "CollabInvitationCreated":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "收到合作邀约", "有商家向你发来合作邀约，去看看条件", "", true
		}
		return "", "", "", "", false
	case "CollabInvitationResponded":
		if who, ok := merchantCreatorRecipient(); ok {
			// 用 if/else 而不是内层 switch：这个 switch 的 case 标签是 decision
			// 的**值**，不是事件名，而正向门禁
			// （TestInboxForEventOnlyMapsEventTypesThatAreActuallyEmitted）会把
			// switch 里任何 case 标签当成「映射了的事件名」⇒ ACCEPTED/DECLINED/
			// COUNTERED 被判成永不发的事件，门禁直接变红。门禁是对的，别改门禁。
			decision := payloadString("decision")
			if decision == "COUNTERED" {
				return who, "对方还价了", "对方提出了新的合作条件，去看看能不能接受", "", true
			}
			if decision == "ACCEPTED" {
				return who, "合作邀约有回复了", "对方接受了邀约", "", true
			}
			if decision == "DECLINED" {
				return who, "合作邀约有回复了", "对方婉拒了这次邀约", "", true
			}
			return who, "合作邀约有回复了", "对方回复了这次邀约", "", true
		}
		return "", "", "", "", false
	case "CollabInvitationCancelled":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "合作邀约已撤回", "发邀约的商家撤回了这次合作，去看看详情", "", true
		}
		return "", "", "", "", false
	case "MerchantCreatorPromoIssued":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你有专属折扣码了", "这家商家给了你专属折扣，见专属码页", "", true
		}
		return "", "", "", "", false
	case "MerchantCreatorPromoAdjusted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你的专属折扣变了", "商家调整了给你的折扣，报价前先看一眼", "", true
		}
		return "", "", "", "", false
	case "PromoCouponIssued":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你的码发出了优惠券", "有顾客用你的码领到了专属券", "", true
		}
		return "", "", "", "", false
	case "PromoCodeClaimed":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你的码已启用", "专属码已生效，可以开始报价了", "", true
		}
		return "", "", "", "", false
	case "PromoBenefitBound":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你的码配好了优惠", "商家为你的码配好了折扣，现在可以报了", "", true
		}
		return "", "", "", "", false
	case "PromoCodeQuoted":
		// 这一条收件人是**商家**（creator 报码 → 商家要知道自己被报了）。
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "你的码被使用了", "有 creator 用你的码报出了订单", "", true
		}
		return "", "", "", "", false

	case "MeetupProposed":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "有人约你见面", "确认一下时间和地点", "", true
		}
		return "", "", "", "", false
	case "MeetupAccepted":
		if who, ok := merchantCreatorRecipient(); ok {
			if confirmed, _ := e.Payload["confirmed"].(bool); confirmed {
				return who, "见面已约定", "大家都接受了，可以开始准备了", "", true
			}
			// 发起人收到的和同房间其他成员不是同一件事（见 room.go 那条事件）。
			if isProposer, _ := e.Payload["recipientIsProposer"].(bool); isProposer {
				return who, "对方接受了你的见面邀约", "可以开始准备了", "", true
			}
			return who, "有人接受了见面邀约", "", "", true
		}
		return "", "", "", "", false
	case "MeetupNudged":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "发起人在等你回应", "见面邀约还没接受", "", true
		}
		return "", "", "", "", false
	case "MeetupStarted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "见面开始了", "对方已到达", "", true
		}
		return "", "", "", "", false
	case "MeetupCompleted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "见面已结束", "房间已归档，记得互相评价", "", true
		}
		return "", "", "", "", false

	case "FriendRequestSent":
		// 好友请求的收件人就是 payload.targetId（已过 targetAccountExists 校验的
		// user account id），所以这一条**不需要**为了知道收件人去改 schema ——
		// 可推导的收件人就不该落库成事实（对比 174/175 那两列是不得已）。
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "有人加你为好友", "处理一下就能开始聊天了", "", true
		}
		return "", "", "", "", false

	// 深链刻意留空：/collab-invitations/ 和专属码页都不在
	// notification.deepLinkPrefixes 白名单里，而客户端路由表里也没有对应页面 ——
	// 硬塞一个前缀的结果是「点开白屏」。加深链要 allowlist（service.go:385）
	// 和移动端路由（notif-deeplink-route.ts）两边一起加，那是另一件事。
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
	notificationRepository := postgres.NewNotificationRepository(pool)
	inboxRepo := notificationRepository
	pushProvider, pushNote := notification.PushProviderFromEnv(os.Getenv, inboxRepo)
	// MERCHANT-CREATOR-NOTIFY-001：推送失败逐条进日志，再聚合成一条可告警计数。
	// 以前是 `_ = p.push.Push(...)`，落库成功后就再没人知道推送挂了。
	var pushFailures, pushFailuresLogged atomic.Int64
	inboxPipeline := notification.NewPipeline(inboxRepo, pushProvider).OnPushFailure(
		func(item notification.InboxItem, err error) {
			pushFailures.Add(1)
			log.Printf("notification push failed: item=%s recipient=%s type=%s deep_link=%s err=%v",
				item.ID, item.RecipientID, item.Type, item.DeepLink, err)
		})
	var inboxMissed, inboxMissedLogged atomic.Int64
	// 死信数只在变化时上报（见下面那处的注释：每 tick 都刷 = 没有告警）。
	var lastReportedStale atomic.Int64
	inboxDelivery := businessInboxDelivery{inner: deduped, producer: inboxPipeline, missed: &inboxMissed, missedLogged: &inboxMissedLogged}
	log.Printf("%s", inboxPipeline.Describe())
	log.Printf("%s", pushNote)
	delivery := outbox.Delivery(inboxDelivery)
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
			// MERCHANT-CREATOR-NOTIFY-001：通知投递失败不会让这批失败
			// （那是刻意的，见 Deliver），所以**必须有**一条独立的心跳计数 ——
			// 否则「inbox 没写进去 / 推送全挂」只会以逐条 error 的形式存在，
			// 而逐条 log 不会被告警。这一行是给日志告警规则用的。
			if n := inboxDelivery.reportMissedNotifications(); n > 0 {
				log.Printf("WARNING inbox notifications failed: since_last_tick=%d cumulative=%d", n, inboxDelivery.missedTotal())
			}
			// MERCHANT-CREATOR-NOTIFY-001：死信处理。够新的自动重放（重放不会产生
			// 第二条通知 —— 收件箱的幂等 id 由事件 id 推出来）；太旧的只报数。
			// 以前死信是「3 处写、0 处读」，本地库躺着 83 条 8 月的死信没人知道。
			replayed, stale, reapErr := outboxWorker.ReapDeadLetters(ctx, time.Now().UTC())
			switch {
			case reapErr != nil:
				log.Printf("dead letter sweep failed: %v", reapErr)
			case replayed > 0:
				log.Printf("dead letters replayed: count=%d (recent enough to still be meaningful)", replayed)
			}
			// 只在**变化时**打这一行。死信数不变还每秒刷一次，会把告警变成噪音 ——
			// 而一条每秒钟都出现的告警等于没有告警（值班的人第一条就静音了）。
			if int64(stale) != lastReportedStale.Load() {
				previous := lastReportedStale.Swap(int64(stale))
				if stale > 0 {
					log.Printf("WARNING stale dead letters not replayed: count=%d previous=%d "+
						"（补发一条几周前的通知比不补发更糟 —— 那是一条假的新消息；需要人工判断）", stale, previous)
				} else {
					log.Printf("stale dead letters cleared: count=0")
				}
			}
			if n := pushFailuresLogged.Add(pushFailures.Load() - pushFailuresLogged.Load()); n > 0 {
				log.Printf("WARNING notification pushes failed: since_last_tick=%d cumulative=%d", n, pushFailures.Load())
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
			// MERCHANT-CREATOR-NOTIFY-001：收件箱回收（migration 176，90 天保留期）。
			// 不做的话它只增不减（现在 926 行），而 ListInbox 会把它整页整页发给客户端。
			if n, err := notificationRepository.PurgeExpiredInboxItems(ctx, time.Now().UTC()); err != nil {
				log.Printf("inbox gc failed: %v", err)
			} else if n > 0 {
				log.Printf("inbox gc purged: count=%d", n)
			}
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
