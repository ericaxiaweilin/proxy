package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/proxy-app/proxy-api/internal/accountstatus"
	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/guidance"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/identitytier"
	"github.com/proxy-app/proxy-api/internal/incentive"
	"github.com/proxy-app/proxy-api/internal/media"
	"github.com/proxy-app/proxy-api/internal/notification"
	"github.com/proxy-app/proxy-api/internal/outbox"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
	"github.com/proxy-app/proxy-api/internal/tagging"
	"github.com/proxy-app/proxy-api/internal/treasure"
	"github.com/proxy-app/proxy-api/internal/weather"
	"github.com/proxy-app/proxy-api/internal/weatherwatch"
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
	// postAuthor：帖子作者是谁（评论 / 转发事件的 payload 里没有收件人，要回库查）。nil = 这两类通知不发。
	postAuthor func(ctx context.Context, postID string) (string, error)
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
	if !ok && (e.EventType == "PostReplied" || e.EventType == "PostReposted") {
		// 社交互动通知（评论 / 转发）：收件人是帖子作者；自己评论自己的帖子不通知。
		if d.postAuthor == nil {
			return nil
		}
		author, err := d.postAuthor(ctx, e.AggregateID)
		if err != nil {
			return err
		}
		recipient, title, body, deepLink, ok = socialInteractionInbox(e, author)
	}
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
		DedupeKey:   dedupeKeyFor(e, recipient),
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
	// ⚠️ OfferCreated 收件人是 notifyPrincipalId（creator 的 user account id），
	// **不是** agentId —— agentId 不是任何会话的 principal，投过去等于没投，
	// 而 Offer 有 5 分钟时效、订单照样创建、没有任何报错。
	//
	// SlotOfferCreated 是另一个域（localnet/task 档位报价），它发的 payload 里
	// 没有 notifyPrincipalId ⇒ 这两条**不投**。宁可少通知也不写一行没人读的记录；
	// 要接的话得先给那个域也加上解析（见 notification.AgentInboxResolver）。
	case "OfferCreated", "SlotOfferCreated":
		creator := payloadString("notifyPrincipalId")
		if creator == "" {
			return "", "", "", "", false
		}
		return creator, "收到 Offer", "客户已发 Offer，5分钟内有效", "/offers/" + e.AggregateID, true
	// 真实事件名是 OrderCreatedFromOffer（Aggregate 是 order，所以 /orders/<ord_…> 是对的）。
	// 别再加回 "OrderCreated" / "OfferAccepted" —— 见函数头注释第 3、4 条。
	case "AppealDecisionRecorded":
		// ORDER-DISPUTE-001：申诉有结果了。
		//
		// 这条通知之前根本不存在 —— 整条申诉链不产生任何领域事件，所以运营复核完，
		// 提交申诉的用户**永远**不知道结果。一件没有回音的事，人就不会有第二次。
		//
		// 只说结论，不复述 note：那是运营的内部措辞，不该出现在用户推送里。
		decided := "你的申诉有新结果"
		if payloadString("decision") == "REJECTED" {
			decided = "你的申诉未通过"
		} else {
			decided = "你的申诉已受理"
		}
		return fallbackRecipient(""), "申诉结果", decided, "/appeals/" + e.AggregateID, true
	case "ReportDispositionRecorded":
		// ORDER-DISPUTE-001：举报被处理了。
		//
		// 举报提交是**同步**拿得到回执的，但处置是运营之后做的 —— 不通知的话，
		// 用户会默认「举报被忽略了」，而那比明确告诉他「不成立」更伤。所以
		// DISMISS（不成立）同样要发。
		outcome := "你举报的事已有处理结果"
		if strings.EqualFold(payloadString("outcome"), "NO_ACTION") || strings.EqualFold(payloadString("action"), "DISMISS") {
			outcome = "你举报的事经核查未成立"
		}
		return fallbackRecipient(""), "举报结果", outcome, "/reports/" + e.AggregateID, true
	case "OrderCreatedFromOffer":
		return fallbackRecipient(""), "订单已成立", orderCancellationNotice(e.Payload), "/orders/" + e.AggregateID, true
	case "PostReplied", "PostReposted":
		// 收件人（帖子作者）不在 payload 里，要回库查——由 createInboxForEvent 通过 postAuthor 解析后
		// 走 socialInteractionInbox。这里只声明「它是被映射的」，纯映射层返回 ok=false。
		return "", "", "", "", false
	case "ProfileFollowed":
		// 有人关注了你。收件人是 followeeId；payload 里没有就不发（不猜）。
		followee := payloadString("followeeId")
		if followee == "" || followee == payloadString("followerId") {
			return "", "", "", "", false
		}
		return followee, "有人关注了你", "去看看对方的主页", "/profiles/" + payloadString("followerId"), true
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
	// CONTENT-TASK-001：商家「催一下」/ 审核结果 → 投给 creator。
	//
	// ⚠️ 收件人是 payload.**notifyPrincipalId**（creator 的 user account id），
	// **不是** payload.agentId。agentId 不是任何会话的 principal（本地库 121 个
	// creator，0 个的 agent_id 是 user account），拿它当收件人的通知会正确落进
	// inbox_items 然后永远没人读到。
	//
	// **这里刻意不回退到 agentId**：以前就是回退过去的，于是这两条通知一直在
	// 写一行没人读的记录。缺 notifyPrincipalId ⇒ 不投（映射层回 ok=false）。
	case "ContentTaskNudged":
		creator := payloadString("notifyPrincipalId")
		if creator == "" {
			return "", "", "", "", false
		}
		body := "商家在等你的内容稿件"
		if payloadString("stage") == "AWAITING" {
			body = "商家在等你回复内容合作邀请"
		}
		return creator, "商家提醒了你", body, "", true
	case "ContentDraftReviewed":
		creator := payloadString("notifyPrincipalId")
		if creator == "" {
			return "", "", "", "", false
		}
		if payloadString("decision") == "APPROVE" {
			return creator, "稿件审核通过", "可以发布了，发完记得贴上各平台链接", "", true
		}
		return creator, "稿件被打回", "商家写了修改意见，改好后可重新提交", "", true

		// ── MERCHANT-CREATOR-NOTIFY-001：商家↔creator 的往来 ──────────────────
		//
		// 这一整段以前**一个 case 都没有**：supply 域发的 CollabInvitationCreated /
		// CollabInvitationResponded / MerchantCreatorPromo* / Promo* 全都落在
		// default → ok=false → 安静跳过。商家发了活单、creator 没人知道；creator
		// 还了价，商家没人知道。事件是齐的，映射是空的，中间那一层没人写。
		//

	// MARKET-FAST-001：快速发单里平台替发单方选中了她。不告诉她，她就不知道要在 5 分钟内确认，
	// 代选会一个接一个超时。收件人是 notifyPrincipalId（报名人的用户账号），不回退。
	//
	// MARKET-SELECT-NOTIFY-001：发单方**自己**选的人也走这一条（byPlatform=false）：没有 5 分钟限时，
	// 文案不能吓她。两种都带 /market/<机会> 深链，点开就是要确认的那张单。
	case "MarketApplicationSelected":
		if who, ok := merchantCreatorRecipient(); ok {
			link := marketDeepLink(payloadString("opportunityId"))
			if byPlatform, _ := e.Payload["byPlatform"].(bool); byPlatform {
				return who, "你被选中了", "发单方选了你，5 分钟内确认就成单；超时会换下一位", link, true
			}
			return who, "你被选中了", "发单方选了你，去确认就成单", link, true
		}
		return "", "", "", "", false
	// MARKET-INVITE-001：快速发单迟迟没人报名，按撮合排名邀请附近合适的人。
	case "MarketOpportunityInvited":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "附近有个单适合你", "有人在你附近发了单，去市场看看要不要报名", marketDeepLink(payloadString("opportunityId")), true
		}
		return "", "", "", "", false
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

	// ── 定向邀请与需求成形（MERCHANT-CREATOR-NOTIFY-001）─────────────────
	//
	// 收件人是 payload.notifyPrincipalId。缺它就不投，绝不回退 actor。
	case "TopicInviteCreated":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "有人找你聊一个话题", "去看看对方想聊什么", "", true
		}
		return "", "", "", "", false
	case "NeedConfirmedFromConversation":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "需求确认下来了", "对方把一条需求确认了，去看看能不能接", "", true
		}
		return "", "", "", "", false

	// ── 同城伴游（MERCHANT-CREATOR-NOTIFY-001）─────────────────────────
	//
	// 收件人是 payload.notifyPrincipalId（citycompanion 侧算好的对手方，agent id
	// 已经解析成 user account）。缺它就不投 —— 绝不回退 actor。
	//
	// CityCompanionNeedCreated 刻意**不**映射：它是「向所有可接单的 creator 广播」，
	// 而「谁该收到、以什么频率、最多能有多少个接收方」是产品决定，不是实现细节。
	// 没有偏好/限流机制之前发广播等于骚扰。理由记在 eventsPendingNotificationDecision。
	case "CityCompanionConfirmed":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "有人接了你的单", "对方已确认，去看看报价和包含项", "", true
		}
		return "", "", "", "", false
	case "CityCompanionRouteGenerated":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "路线已生成", "去看看这次安排的路线", "", true
		}
		return "", "", "", "", false
	case "CityCompanionRouteAccepted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "对方接受了路线", "可以按这条路线出发了", "", true
		}
		return "", "", "", "", false
	case "CityCompanionCompleted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "这单完成了", "去给对方一个评价吧", "", true
		}
		return "", "", "", "", false

	// ── 订单履约（MERCHANT-CREATOR-NOTIFY-001）─────────────────────────
	//
	// 收件人 = payload.notifyPrincipalId（订单对手方的**可投递** id，去掉 actor），
	// 由 fulfillment 侧按人生成（一个订单两方 ⇒ 两条事件；收件箱的幂等 id 由事件 id
	// 推出来，同一个 key 给两个收件人会在主键上撞车）。
	// 没有 notifyPrincipalId ⇒ 不投，**绝不**回退到 actor —— 那是「回声」。
	case "OrderCancelled":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "订单已取消", orderCancelledNotice, "", true
		}
		return "", "", "", "", false
	case "OrderCheckedIn":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "对方已到达", "打卡了，可以开始履约", "", true
		}
		return "", "", "", "", false
	case "ExecutionStarted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "订单开始履约", "订单已进入执行阶段", "", true
		}
		return "", "", "", "", false
	case "EvidenceSubmitted":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "对方提交了履约凭证", "去核对一下", "", true
		}
		return "", "", "", "", false
	case "SatisfactionRecorded":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "对方评价了这次合作", "去看看对方怎么说", "", true
		}
		return "", "", "", "", false
	case "CooperationConfirmed":
		if who, ok := merchantCreatorRecipient(); ok {
			return who, "合作已达成", "订单已确认，可以开始准备了", "", true
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

// 取消原因**不回显**。
//
// payload 里的 reason 是对方写的一句自由文本（fulfillment 侧只把空值兜成
// "user-cancelled"）。把它回显进通知有两个问题：一行放不下；二是通知是「平台
// 自己说话的渠道」，把别人的原话挂在平台名下既不体面，也可能带不该在通知里
// 出现的内容。对方想知道细节，点进订单看 —— 那里有完整记录和理由。
const orderCancelledNotice = "对方取消了这次订单，详情看订单页"

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
	inboxDelivery := businessInboxDelivery{inner: deduped, producer: inboxPipeline, missed: &inboxMissed, missedLogged: &inboxMissedLogged,
		postAuthor: func(ctx context.Context, postID string) (string, error) {
			var author string
			err := pool.QueryRow(ctx, `SELECT author_id FROM localnet.posts WHERE id = $1 AND author_type = 'USER'`, postID).Scan(&author)
			if errors.Is(err, pgx.ErrNoRows) {
				return "", nil
			}
			return author, err
		}}
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
	// TAG-SYSTEM-001：用户标签每小时按事件重算（派生数据，可整表重来；同意撤回的下一轮就清掉）。
	tagStore := tagging.NewPostgres(pool)
	recomputeTags(ctx, tagStore)
	tagTicker := time.NewTicker(time.Hour)
	defer tagTicker.Stop()
	// 引导推送（发第一条动态 / 发第一个需求）：每种对每个人终身最多一次，窗口错开，被限制的账号不推。
	nudger := nudgeEmitter{pipeline: inboxPipeline}
	nudgeSource := guidance.NewPostgres(pool)
	accountGate := &accountstatus.Service{Store: accountstatus.NewPostgres(pool)}
	nudgeTicker := time.NewTicker(time.Hour)
	defer nudgeTicker.Stop()
	runNudges := func() {
		sent, err := guidance.RunNudges(ctx, nudgeSource, nudger, func(c context.Context, id string) bool {
			lvl, err := accountGate.LevelOf(c, id)
			return err != nil || lvl != "" // 读不出来也不推：引导推送不是必须的，宁可少推
		}, time.Now().UTC(), 200)
		if err != nil {
			log.Printf("nudges failed: %v", err)
			return
		}
		log.Printf("nudges: sent=%v", sent)
	}
	runNudges()
	// 激励发放（券 / 成长值，没有现金）：每 5 分钟一轮；规则默认不生效，运营打开才发。
	incentiveStore := incentive.NewPostgres(pool)
	benefitSvc := benefit.NewService(postgres.NewBenefitRepository(pool))
	incentiveClaimer := benefitClaimer{svc: benefitSvc}
	incentiveNotifier := incentiveNotifier{pipeline: inboxPipeline}
	incentiveTicker := time.NewTicker(5 * time.Minute)
	defer incentiveTicker.Stop()
	tierStore := identitytier.NewPostgres(pool)
	// WEATHER-001：见面前一天遇雨提醒（每 30 分钟一轮；同一场活动同一个人只提醒一次）。
	weatherSvc := &weather.Service{Provider: weather.METNorway{UserAgent: weather.UserAgentFromEnv()}, Cyclones: weather.GDACS{}}
	weatherSource := weatherwatch.NewPostgres(pool)
	weatherTicker := time.NewTicker(30 * time.Minute)
	defer weatherTicker.Stop()
	runWeather := func() {
		n, err := weatherwatch.Run(ctx, weatherSource, weatherSvc, weatherNotifier{pipeline: inboxPipeline}, time.Now().UTC())
		if err != nil {
			log.Printf("weather alerts failed: %v", err)
		} else if n > 0 {
			log.Printf("weather alerts: sent=%d", n)
		}
	}
	runWeather()
	// TREASURE-001：给每个咖啡店场景保持一个活箱子（每 15 分钟补；收掉到期 / 开空的）。
	treasureStore := treasure.NewPostgres(pool)
	treasureTicker := time.NewTicker(15 * time.Minute)
	defer treasureTicker.Stop()
	runTreasure := func() {
		if n, err := treasureStore.Spawn(ctx, time.Now().UTC()); err != nil {
			log.Printf("treasure spawn failed: %v", err)
		} else if n > 0 {
			log.Printf("treasure: spawned=%d", n)
		}
	}
	runTreasure()
	runIncentives := func() {
		// 先把用户已经做成的事折成积分（固定规则，幂等），再按分数发奖励活动。
		if n, err := tierStore.CollectProvider(ctx, time.Now().UTC()); err != nil {
			log.Printf("provider points failed: %v", err)
		} else if n > 0 {
			log.Printf("provider points: credited=%d", n)
		}
		if n, err := tierStore.CollectMerchant(ctx, time.Now().UTC()); err != nil {
			log.Printf("merchant points failed: %v", err)
		} else if n > 0 {
			log.Printf("merchant points: credited=%d", n)
		}
		if n, err := tierStore.CollectUser(ctx, time.Now().UTC()); err != nil {
			log.Printf("identity points failed: %v", err)
		} else if n > 0 {
			log.Printf("identity points: credited=%d", n)
		}
		n, err := incentive.RunGrants(ctx, incentiveStore, incentiveClaimer, incentiveNotifier, func(c context.Context, id string) bool {
			lvl, err := accountGate.LevelOf(c, id)
			return err != nil || lvl != "" // 被限制或读不出来：不发
		}, time.Now().UTC(), 100, func() string { return "ig_" + strconv.FormatInt(time.Now().UnixNano(), 36) })
		if err != nil {
			log.Printf("incentives failed: %v", err)
			return
		}
		if n > 0 {
			log.Printf("incentives: granted=%d", n)
		}
	}
	runIncentives()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	log.Printf("proxy worker listening worker_id=%s media_store=%s", workerID, mediaStoreDir)
	for {
		select {
		case <-ctx.Done():
			return
		case <-weatherTicker.C:
			runWeather()
		case <-treasureTicker.C:
			runTreasure()
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
		case <-incentiveTicker.C:
			runIncentives()
		case <-nudgeTicker.C:
			runNudges()
		case <-tagTicker.C:
			recomputeTags(ctx, tagStore)
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

// recomputeTags 重算所有人的用户标签；失败只记日志（派生数据，下个小时再来）。
func recomputeTags(ctx context.Context, store *tagging.Postgres) {
	// 先清掉窗口外的位置观测（多留 7 天缓冲），再重算。
	if pruned, err := store.PruneOlderThan(ctx, time.Now().UTC().Add(-tagging.Window-7*24*time.Hour)); err != nil {
		log.Printf("tag prune failed: %v", err)
	} else if pruned > 0 {
		log.Printf("tag prune: coarse_locations=%d", pruned)
	}
	n, err := tagging.Recompute(ctx, store, time.Now().UTC())
	if err != nil {
		log.Printf("tag recompute failed: %v", err)
		return
	}
	log.Printf("tag recompute: users_with_tags=%d rule=%s", n, tagging.RuleVersion)
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

// orderCancellationNotice 讲订单成立时的取消窗口，只说**真的能兑现**的事。
//
// 用户 2026-10-05：「下单要提醒交易后不能退款，因为真人服务 怎么退」。
//
// 这段文案之前是「真人服务，确认后不能退款」，而那时后端允许取消一个 CONFIRMED
// 的订单 —— app 在说自己做不到的事，正是这一整轮在消灭的「看起来像事实、其实不是」。
// 取消窗口规则（ORDER-CANCEL-WINDOW-001）落地后，payload 里带了算好的 cancelUntil /
// cancelWindow，于是可以报一个真的截止点：
//
//	提前预约（距离约定执行时间 ≥12h）→ 开工前 12 小时内不能取消
//	临期下单（<12h）                 → 下单后 5 分钟内可取消
//	取不到执行时间                    → 同上（按最紧的窗口，不编一个日期）
//
// 「我什么时候之前还能反悔」比一句「不能退款」有用：后者只会让人吵架。
//
// ⚠️ 两件待办，需要设计基线 / 产品口径，不在这里凭空发明：
//
//	· 确认弹窗那一层的告知 —— CURRENT_BASELINE.json 对订单确认零规定；
//	· 订单没有任何纠纷/申诉路径，真出了纠纷（creator 放鸽子、买家失联），
//	  用户除了「在窗口内取消」之外没有别的 recourse。
func orderCancellationNotice(payload map[string]any) string {
	switch payloadText(payload, "cancelWindow") {
	case "planned":
		return "真人服务，开工前 12 小时内不能取消"
	case "last-minute", "unknown-scheduled-time":
		return "真人服务，下单后 5 分钟内可取消"
	default:
		// payload 里没有 cancelWindow = 老事件（规则上线前发出的）或别处构造的事件。
		// 宁可说保守的那句，也不要编一个截止点。
		return "真人服务，开工前可取消，开工后不能退款"
	}
}

// payloadText 读 payload 里的字符串字段。inboxForEvent 里有一个同样作用但闭包在
// 局部的版本；这个是包级的，好让 orderCancellationNotice 这种独立函数也能用。
func payloadText(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	v, _ := payload[key].(string)
	return v
}

// marketDeepLink 是市场单的站内深链；没有机会 id 就不给链接（点开只标已读），不拼一个打不开的路径。
func marketDeepLink(opportunityID string) string {
	if opportunityID == "" {
		return ""
	}
	return "/market/" + opportunityID
}

// socialInteractionInbox：评论 / 转发通知。收件人 = 帖子作者；作者就是动作发起人时不通知。
// 评论正文不放进通知（可能很长、也可能是不想在锁屏上露出的内容），只说发生了什么。
func socialInteractionInbox(e event.DomainEvent, author string) (recipient, title, body, deepLink string, ok bool) {
	if author == "" || author == e.PrincipalID {
		return "", "", "", "", false
	}
	switch e.EventType {
	case "PostReplied":
		return author, "有人评论了你的动态", "点开看看他说了什么", "/posts/" + e.AggregateID, true
	case "PostReposted":
		return author, "有人转发了你的动态", "你的内容被更多人看到了", "/posts/" + e.AggregateID, true
	}
	return "", "", "", "", false
}

// dedupeKeyFor：默认一个事件一条通知（outbox 重放不会重复）。评论 / 转发是高频互动：同一个人、同一篇帖子、
// 同一种互动，一天只通知一次——设置里的「互动通知」开关还不存在，这是它存在之前的节流。
func dedupeKeyFor(e event.DomainEvent, recipient string) string {
	if e.EventType == "PostReplied" || e.EventType == "PostReposted" {
		return "social:" + e.EventType + ":" + e.AggregateID + ":" + recipient + ":" + e.OccurredAt.UTC().Format("2006-01-02")
	}
	return notification.EventDedupeKey(e.EventID)
}

// nudgeEmitter 把引导推送接到通知管线。DedupeKey 含用户和推送种类：同一种推送对同一个人终身只会落一行。
// weatherNotifier 发天气提醒；同一场活动同一个人只发一次（去重键）。不带深链：App 里没有活动深链的落点。
type weatherNotifier struct{ pipeline notification.Producer }

func (w weatherNotifier) Notify(ctx context.Context, userID, meetingID, title, body string) error {
	_, _, err := w.pipeline.Emit(ctx, notification.Notification{
		RecipientID: userID, Type: "WEATHER_ALERT", Title: title, Body: body,
		DedupeKey: "weather:" + meetingID + ":" + userID,
	})
	return err
}

type nudgeEmitter struct{ pipeline notification.Producer }

func (n nudgeEmitter) Nudge(ctx context.Context, userID, key, title, body, target string) error {
	_, _, err := n.pipeline.Emit(ctx, notification.Notification{
		RecipientID: userID, Type: "NUDGE_" + key, Title: title, Body: body,
		DeepLink: "/nudge/" + target, DedupeKey: "nudge:" + key + ":" + userID,
	})
	return err
}

// benefitClaimer 替用户领一份福利（走 benefit 域自己的资格 / 容量检查）。
type benefitClaimer struct{ svc *benefit.Service }

func (b benefitClaimer) Claim(ctx context.Context, userID, campaignID, benefitID string) (string, incentive.ClaimOutcome, string, error) {
	res := b.svc.HandleClaimBenefit(ctx, command.Envelope{
		CommandType: "ClaimBenefit", CommandID: "inc-" + userID + "-" + benefitID, IdempotencyKey: "inc-" + userID + "-" + benefitID,
		Actor: command.Actor{Type: "USER", ID: userID}, Principal: command.Principal{Type: "INDIVIDUAL", ID: userID},
		Payload: map[string]any{"campaignId": campaignID, "benefitId": benefitID},
	})
	if res.Error == nil {
		id, _ := res.Body["claimId"].(string)
		return id, incentive.ClaimOK, "", nil
	}
	switch res.Error.ErrorCode {
	case "ELIGIBILITY_FAILED":
		return "", incentive.ClaimFinal, res.Error.ErrorCode, nil // 这个人就是领不了：记下来，不再试
	case "CAPACITY_EXHAUSTED", "CAMPAIGN_NOT_ACTIVE", "CAMPAIGN_NOT_FOUND":
		return "", incentive.ClaimTransient, res.Error.ErrorCode, nil // 补上名额 / 打开活动后再试
	}
	return "", incentive.ClaimTransient, res.Error.ErrorCode, nil
}

// incentiveNotifier 告诉用户拿到了东西。DedupeKey 含规则和用户：同一条规则对同一个人只有一条通知。
type incentiveNotifier struct{ pipeline notification.Producer }

func (n incentiveNotifier) Granted(ctx context.Context, userID, ruleID, label string, points int) error {
	title, body := "你有一份新福利", label
	if points > 0 {
		title, body = "成长值 +"+strconv.Itoa(points), label
	}
	_, _, err := n.pipeline.Emit(ctx, notification.Notification{
		RecipientID: userID, Type: "INCENTIVE_GRANTED", Title: title, Body: body,
		DeepLink: "", DedupeKey: "incentive:" + ruleID + ":" + userID,
	})
	return err
}
