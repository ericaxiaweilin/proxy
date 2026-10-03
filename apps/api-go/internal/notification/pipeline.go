package notification

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// NOTIF-PIPELINE-001 —— 通知只有**一条**写入管线。
//
// 改之前这个域有两条互不相干的写路径，各自只做了一半：
//
//	① outbox worker（cmd/worker/main.go 的 businessInboxDelivery）
//	   直连 SQL INSERT INTO notification.inbox_items，注释写着
//	   "bypass service to avoid auth"。它写的是**全部 845 行真数据**
//	   （OfferCreated 698 / TaskPublished 60 / SlotOfferCreated 43 /
//	   OfferAccepted 42 / OrderCreated 2），但**从来不推送** ——
//	   PushProvider 在那条路径上根本不存在。
//	② 命令 SendInboxNotification（service.go 的 sendInbox）
//	   走 Repository + PushProvider，形态完整，但它是 operator-only 的
//	   后台口，App 侧零调用 —— 也就是说**真实事件一条推送都没发过**。
//
// 所以「用户收到过推送」这件事在这份代码里从来没有发生过，而两条路径
// 各自看起来都是对的。更糟的是它们**会各自漂移**：worker 那条用的是
// "inbox_"+EventID + ON CONFLICT 的幂等 id，命令那条用的是随机 id ——
// 同一个「写一条通知」的动作，两边对「重复投递」的回答完全相反。
//
// 这个文件是那条唯一的管线。两边的差别只剩「谁在什么条件下调用」：
//
//	worker : 事件驱动，DedupeKey = 事件 id（outbox 会重放，必须幂等）
//	command: 人工/后台触发，DedupeKey = 幂等键（重试同一条命令不能写两条）
//
// 幂等是**管线自己的**职责，不再交给调用方记得。判据是 item id 由
// DedupeKey 确定性地推出来：重放同一个 key 得到的 id 相同，撞主键 ⇒
// 不新增行、也不二次推送。

// Notification 是「平台要对某个用户说的一句话」。
// 每个生产者都必须填这个形状 —— 它是两条路径唯一的交汇点，所以两边
// 不可能再在「写了什么」或者「推没推」上分叉。
type Notification struct {
	RecipientID string
	Type        string
	Title       string
	Body        string
	DeepLink    string
	// DedupeKey 让投递幂等。**重放型生产者必须给**：outbox worker 在
	// 投递失败后会重放整批事件，没有这个键，一次重试就是用户 inbox 里
	// 的第二条「订单已成立」。留空则退化成随机 id（只适用于确实只发一次
	// 的调用点）。
	DedupeKey string
}

// ErrNotificationRecipientRequired / ErrNotificationTitleRequired ——
// 收件人和标题是这条管线的**硬前置**，缺一个就拒收。
//
// 以前 sendInbox 校验这两项、worker 那条不校验（它的映射函数自己保证），
// 于是「校验」这件事挂在了某一个调用方的自觉上。收件人为空会写出一行
// **谁都读不到**的通知（ListInbox 按 recipient_id 取），标题为空则是一行
// 没有内容的噪音 —— 两种都是永久垃圾：inbox_items 只增不删。
var (
	ErrNotificationRecipientRequired = errors.New("notification: recipient is required")
	ErrNotificationTitleRequired     = errors.New("notification: title is required")
)

// Producer 是管线的**写侧**接口。cmd/worker 依赖它而不是具体的
// *Pipeline，这样「事件 → 一条通知」的映射可以脱离数据库单测。
type Producer interface {
	// Emit 投递一条通知。返回 (落库的那一行, 这次是否**真的新增**,
	// error)。created=false 表示这条之前已经投过（幂等命中），
	// 调用方**不要**当成失败。
	Emit(ctx context.Context, n Notification) (InboxItem, bool, error)
}

// Pipeline 是 Producer 的唯一实现。
type Pipeline struct {
	repo  Repository
	push  PushProvider
	clock clock.Clock
}

// NewPipeline 建管线。push 传 nil = **不推送**（只落库），这是合法的
// 部署姿态（NOTIFICATION_PUSH=off），不是错误配置。
func NewPipeline(repo Repository, push PushProvider) *Pipeline {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Pipeline{repo: repo, push: push, clock: clock.System{}}
}

// NewPipelineWithClock 只给测试用：让 created_at 可注入。
func NewPipelineWithClock(repo Repository, push PushProvider, c clock.Clock) *Pipeline {
	p := NewPipeline(repo, push)
	if c != nil {
		p.clock = c
	}
	return p
}

// Emit 是这条管线唯一的写入口。顺序是刻意的：
//
//	校验 → 定幂等 id → 落库 → **只有真的新增了才推送**
//
// 「只有新增才推送」是最后那一步的全部理由：outbox 重放同一个事件时，
// 落库会撞主键（无害），但推送没有主键可撞 —— 不看 created 就会给用户
// 推第二条「订单已成立」。推送本身仍是 best-effort（失败不返回错误）：
// 一条通知的推送通道挂了，不该让已经落库的 inbox 行回滚。
func (p *Pipeline) Emit(ctx context.Context, n Notification) (InboxItem, bool, error) {
	recipient := strings.TrimSpace(n.RecipientID)
	if recipient == "" {
		return InboxItem{}, false, ErrNotificationRecipientRequired
	}
	if strings.TrimSpace(n.Title) == "" {
		return InboxItem{}, false, ErrNotificationTitleRequired
	}
	item := InboxItem{
		ID:          inboxItemID(n.DedupeKey),
		RecipientID: recipient,
		Type:        n.Type,
		Title:       n.Title,
		Body:        n.Body,
		DeepLink:    n.DeepLink,
		Read:        false,
		CreatedAt:   p.clock.Now().UTC(),
	}
	created, err := p.insertOnce(ctx, item)
	if err != nil {
		return item, false, err
	}
	if !created {
		// 幂等命中：这一条之前已经投过。**不推送**，也不再改这一行。
		return item, false, nil
	}
	if p.push != nil {
		_ = p.push.Push(ctx, item)
	}
	return item, true, nil
}

// insertOnce 走 Repository 的幂等插入。Repository 的实现必须能回答
// 「这次到底插没插进去」—— 那正是推送去重的依据。
//
// 这里**没有**兜底分支：`Repository` 的 inbox 写侧只有
// InsertInboxItemOnce 这一个方法（原来那个无脑 INSERT 的
// CreateInboxItem 已经删掉）。留一个「不会去重」的兜底就等于留了
// 第二条写路径 —— 而那正是这个文件存在的理由。
func (p *Pipeline) insertOnce(ctx context.Context, item InboxItem) (bool, error) {
	return p.repo.InsertInboxItemOnce(ctx, item)
}

// inboxItemID 由 DedupeKey 确定性推出 item id。
//
// 用 sha256 而不是把 key 拼进 id：key 可能是事件 id / 幂等键，长度和字符集
// 都不受控（事件 id 里有冒号、命令键里有时间戳），直接拼会写出长度不定的
// 主键。定长 32 位十六进制既避开了这个，又让「同一个 key ⇒ 同一个 id」
// 成为一条可以被断言的等式。
//
// DedupeKey 为空时退回随机 id（newID），也就是「这条通知不参与幂等」。
func inboxItemID(dedupeKey string) string {
	if dedupeKey == "" {
		return newID("inbox_")
	}
	sum := sha256.Sum256([]byte(dedupeKey))
	return "inbox_" + hex.EncodeToString(sum[:16])
}

// EventDedupeKey / CommandDedupeKey 是两条生产者各自该用的键。
// 写成函数而不是让调用方自己拼字符串，是因为这两个前缀一旦漂移，
// 幂等就会**静默**失效（id 变了 ⇒ 撞不上主键 ⇒ 重放变两条），
// 而「重放多一条通知」在界面上看起来完全正常。
func EventDedupeKey(eventID string) string     { return "event:" + eventID }
func CommandDedupeKey(commandID string) string { return "command:" + commandID }

// PushProviderFromEnv 是 API 与 worker **共用**的推送通道选择逻辑。
//
// 放在这里而不是 cmd/api/wire_providers.go，是因为 worker 也需要它 ——
// 推送通道是一个部署级决定，不是某个进程的私事。两条路径各判一次
// 就会出现「API 认为推送开着、worker 认为关着」这种没人能看见的分叉。
//
// 返回 nil 表示**关掉推送**（NOTIFICATION_PUSH=off|disabled）。
// 注意 nil 现在真的是 nil：以前 NewWithPushProvider 会把 nil 兜成
// LogPushProvider，于是这个开关**从来没生效过**。
//
// NOTIF-PUSH-001：现在它会在配了凭据时返回真的**设备推送分发器**。
// 三档，且**互相不可混淆**：
//
//	NOTIFICATION_PUSH=off        → nil（完全不推）
//	配了 APNs / FCM 凭据          → PushDispatcher（真的出门推）
//	没配凭据                      → LogPushProvider（只记日志）
//
// 第三档必须在启动日志里说清楚是「没凭据」，不能读起来像「推送已上线」
// —— 那正是上一版的问题：日志说 push，其实一行都没出过这台机器。
func PushProviderFromEnv(getenv func(string) string, tokens DeviceTokenLister) (PushProvider, string) {
	if getenv == nil {
		return LogPushProvider{}, "notification push: no env accessor; logging only"
	}
	if v := strings.TrimSpace(getenv("NOTIFICATION_PUSH")); strings.EqualFold(v, "off") || strings.EqualFold(v, "disabled") {
		return nil, "notification push: disabled (NOTIFICATION_PUSH=off) — inbox stays durable, nothing leaves the device"
	}
	cfg := PushConfigFromEnv(getenv)
	if !cfg.Configured() {
		return LogPushProvider{}, "notification push: " + cfg.Describe()
	}
	dispatcher, err := NewPushDispatcherFromConfig(cfg, tokens)
	if err != nil {
		// 凭据配了但建不起来（文件读不了 / 密钥格式不对）**不能**静默降级成
		// 日志推送 —— 那会让人以为推送已经上线。把原因原样带出去。
		return LogPushProvider{}, "notification push: CONFIGURED BUT UNUSABLE, falling back to logging — " + err.Error()
	}
	return dispatcher, "notification push: " + cfg.Describe()
}

// NewPushDispatcherFromConfig 按配置建真发送器。只有**至少一条**真通道能建起来
// 才算成功；另一条缺失只是那条平台推不了，不构成错误。
func NewPushDispatcherFromConfig(cfg PushConfig, tokens DeviceTokenLister) (*PushDispatcher, error) {
	var ios PushSender
	var android PushSender
	var problems []string
	if cfg.APNsConfigured() {
		sender, err := NewAPNsSenderFromConfig(cfg)
		if err != nil {
			problems = append(problems, err.Error())
		} else {
			ios = sender
		}
	}
	if cfg.FCMConfigured() {
		sender, err := NewFCMSenderFromConfig(cfg)
		if err != nil {
			problems = append(problems, err.Error())
		} else {
			android = sender
		}
	}
	if ios == nil && android == nil {
		return nil, fmt.Errorf("no usable push channel: %s", strings.Join(problems, "; "))
	}
	return NewPushDispatcher(tokens, ios, android), nil
}

// Describe 只给日志用：把「这条管线有没有推送通道」变成一行可读的字。
func (p *Pipeline) Describe() string {
	if p == nil {
		return "notification pipeline: <nil>"
	}
	if p.push == nil {
		return "notification pipeline: push=disabled (inbox still durable)"
	}
	return fmt.Sprintf("notification pipeline: push=%T", p.push)
}
