package notification

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type DeviceToken struct {
	ID            string    `json:"id"`
	UserAccountID string    `json:"userAccountId"`
	DeviceID      string    `json:"deviceId"`
	Platform      string    `json:"platform"`
	Token         string    `json:"token"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type InboxItem struct {
	ID          string    `json:"id"`
	RecipientID string    `json:"recipientId"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	DeepLink    string    `json:"deepLink,omitempty"`
	Read        bool      `json:"read"`
	CreatedAt   time.Time `json:"createdAt"`
	// ExpiresAt 是这一条**读件箱**的回收时刻（migration 176，90 天保留期）。
	//
	// 不进 JSON：它是保留期元数据，不是用户看得到的事实。
	//
	// 收件箱以前只增不减（现在库里 926 行），而 ListInbox 会把它全量返回给客户端 ——
	// 没有期限就是必然撑爆，只是时间问题。
	ExpiresAt time.Time `json:"-"`
}

// InboxRetention 是读件箱保留期。
//
// 90 天，比会话消息的 30 天长：通知是**平台说过的话**，已读之后仍可能是用户
// 回看事实的依据（「我的专属折扣当时是多少」）；会话消息 30 天后归档是社交流的
// 常识，收件箱不是。
//
// 被回收的只是读件箱这一条，事实本身（订单、内容任务、邀约）在业务表里不动。
const InboxRetention = 90 * 24 * time.Hour

// InboxPage 是一页收件箱 + 下一页游标（MERCHANT-CREATOR-NOTIFY-001）。
//
// 为什么现在就需要分页：ListInbox 以前**一次全量返回**，客户端一次全拉。
// 实况（2026-10-05 本地库）已经 926 行且只增 —— 一年后打开 App 是几百条，
// 一次请求拉完，弱网下首屏直接卡住。这不是「可能发生」，是没有任何机制阻止它。
//
// Cursor 是**不透明**的（base64 的 created_at+id），不是 offset：offset 在
// 「边读边有新通知进来」时会漏行或重复行，而收件箱恰恰一直在长。
type InboxPage struct {
	Items      []InboxItem `json:"items"`
	NextCursor string      `json:"nextCursor,omitempty"`
	// UnreadTotal 是**全部**未读数，不受当前页/过滤影响。
	//
	// 为什么必须有它：铃铛角标以前是前端数当前列表算出来的
	// （badgeText(unreadCount(inboxItems))）。有了分页之后那个数字会被页大小
	// 封顶 —— 角标显示「20」而真实未读是 300，这是**假数字**，而假数字比旧数字
	// 危险（用户据此判断「我有没有漏看消息」）。仓库里已经因为同类问题写过
	// 「宁可显示一个旧数字，也不显示一个假的 0」。这个字段让它重新变成真数字。
	UnreadTotal int `json:"unreadTotal"`
}

// DefaultInboxPageSize 是没有显式 limit 时的页大小。
//
// 20 是按「通知中心一屏大约能放下这么多条」定的。上限 50：客户端一次请求
// 不该能把服务端拖成一次全表扫描。
const DefaultInboxPageSize = 20
const MaxInboxPageSize = 50

type Repository interface {
	UpsertDeviceToken(ctx context.Context, t DeviceToken) error
	GetDeviceToken(ctx context.Context, userAccountID, deviceID string) (DeviceToken, error)
	// ListDeviceTokens 取一个用户**所有可推送**的设备令牌。
	//
	// 推送要按**收件人**找设备，而以前只有 GetDeviceToken(userAccountID, deviceID)
	// —— 那要求调用方先知道 deviceID，而推送这一侧恰恰不知道（它只知道收件人）。
	// 缺这个方法，PushProvider 就没有任何办法把「一条通知」变成「推到哪台设备」，
	// 这正是推送一直是空壳的结构原因：不是没写发送代码，是**根本没有取目标的口**。
	//
	// 只返回 status='ACTIVE' 的行：登出/卸载的令牌留在表里是为了审计，
	// 拿它们去推只会换来 APNs/FCM 的 Unregistered 回执。
	ListDeviceTokens(ctx context.Context, userAccountID string) ([]DeviceToken, error)
	// DeactivateDeviceToken 把 APNs/FCM 明确告知失效的令牌标成 INACTIVE。
	//
	// 收整个 DeviceToken 而不是只给 tokenID：migration 173 之后设备令牌按
	// user_account_id 做 RLS 隔离，没有用户账号就没法声明「我这次是为哪个
	// 用户账号操作」，DB 会直接拒（fail-closed）。
	//
	// 用户卸载 / 换机之后，那条令牌**永远**推不通。不退役的话每次推送都为它
	// 白跑一趟，日志里堆满「apns status=410」，而没有任何一步会去修它。
	// 这是把「推送失败」从噪音变成动作的那一步。
	DeactivateDeviceToken(ctx context.Context, token DeviceToken) error
	// InsertInboxItemOnce 写一行 inbox，并回答「这次是不是真的新增」。
	//
	// 返回值不是装饰：管线靠它决定推不推送（见 pipeline.go 的 Emit）。
	// 幂等靠**主键**实现 —— item.ID 由 Notification.DedupeKey 确定性推出，
	// 所以重放同一个 key 会撞主键 ⇒ created=false ⇒ 不二次推送。
	//
	// ⚠️ 两个实现（本文件的 MemoryRepository 与
	// platform/postgres/notification.go 的 NotificationRepository）必须
	// 回答一致。以前这里是个只会无脑 INSERT 的 CreateInboxItem，
	// worker 那条路径自己在 SQL 里写 ON CONFLICT —— 同一个语义两处实现，
	// 迟早会分叉。
	InsertInboxItemOnce(ctx context.Context, item InboxItem) (bool, error)
	// ListInbox 取一页。cursor 为空表示第一页。返回值必须是非 nil 空切片
	// （NOTIF-EMPTY-LIST-001：nil 会被 json.Marshal 变成 null，客户端就把它
	// 当成「协议破损」而不是「空收件箱」）。
	ListInbox(ctx context.Context, recipientID string, unreadOnly bool, limit int, cursor string) (InboxPage, error)
	MarkRead(ctx context.Context, itemID, recipientID string) error
	// HasInboxDeepLink 回答「这条深链是不是**发给我的**」。
	//
	// 这是 ResolveDeepLink 的归属校验，不是可有可无的优化：深链只被投递给
	// 事件指定的收件人，所以「它在我自己的收件箱里」≈「它被发给了我」。
	// 没有这一步，这个命令就是一台**枚举预言机** —— 任何人拿它逐个试
	// `/offers/off_xxx` 就能问出「这条链接存在吗」，也能把任意路由塞给客户端去跳。
	//
	// 用 EXISTS 单查而不是把整个收件箱拉回来过滤：导航是用户点一下就走的热路径，
	// 收件箱是会一直长的。
	HasInboxDeepLink(ctx context.Context, recipientID, deepLink string) (bool, error)
}

type MemoryRepository struct {
	mu      sync.Mutex
	devices map[string]DeviceToken
	inbox   map[string]InboxItem
	events  []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{devices: make(map[string]DeviceToken), inbox: make(map[string]InboxItem)}
}
func (r *MemoryRepository) UpsertDeviceToken(_ context.Context, t DeviceToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.devices[t.UserAccountID+"|"+t.DeviceID] = t
	return nil
}
func (r *MemoryRepository) GetDeviceToken(_ context.Context, userAccountID, deviceID string) (DeviceToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.devices[userAccountID+"|"+deviceID]
	if !ok {
		return DeviceToken{}, errors.New("device not found")
	}
	return t, nil
}
func (r *MemoryRepository) ListDeviceTokens(_ context.Context, userAccountID string) ([]DeviceToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// 和 PG 那条路一样：**初始化成非 nil**，空结果返回 []。
	// nil 切片经 json.Marshal 会变 null，客户端 Array.isArray 过不了
	// （NOTIF-EMPTY-LIST-001 就是这么来的）。
	result := []DeviceToken{}
	for _, t := range r.devices {
		if t.UserAccountID == userAccountID && t.Status == "ACTIVE" {
			result = append(result, t)
		}
	}
	return result, nil
}
func (r *MemoryRepository) DeactivateDeviceToken(_ context.Context, token DeviceToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, t := range r.devices {
		if t.ID == token.ID {
			t.Status = "INACTIVE"
			r.devices[key] = t
			return nil
		}
	}
	return errors.New("device token not found")
}
func (r *MemoryRepository) InsertInboxItemOnce(_ context.Context, item InboxItem) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.inbox[item.ID]; exists {
		return false, nil
	}
	r.inbox[item.ID] = item
	return true, nil
}
func (r *MemoryRepository) ListInbox(_ context.Context, recipientID string, unreadOnly bool, limit int, cursor string) (InboxPage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	matched := []InboxItem{}
	for _, item := range r.inbox {
		if item.RecipientID != recipientID {
			continue
		}
		if unreadOnly && item.Read {
			continue
		}
		matched = append(matched, item)
	}
	// 与 PG 实现同序：最新在前，(created_at, id) 稳定打破同刻并列。
	sort.SliceStable(matched, func(i, j int) bool {
		if !matched[i].CreatedAt.Equal(matched[j].CreatedAt) {
			return matched[i].CreatedAt.After(matched[j].CreatedAt)
		}
		return matched[i].ID > matched[j].ID
	})
	after, hasCursor := decodeInboxCursor(cursor)
	if hasCursor {
		kept := matched[:0]
		for _, item := range matched {
			if inboxItemIsOlderThan(item, after) {
				kept = append(kept, item)
			}
		}
		matched = kept
	}
	page, next := PaginateInbox(matched, limit)
	unreadTotal := 0
	for _, item := range matched {
		if !item.Read {
			unreadTotal++
		}
	}
	return InboxPage{Items: page, NextCursor: next, UnreadTotal: unreadTotal}, nil
}

// paginateInbox 切一页并算出下一页游标。两个实现共用，保证形状一致。
//
// 边界：limit<=0 用 DefaultInboxPageSize，超上限夹到 MaxInboxPageSize ——
// 客户端传 limit=10000 时不该让它变成一次全表扫描。
// PaginateInbox 切一页并算出下一页游标。**两个 Repository 实现共用这一份**。
func PaginateInbox(sortedDesc []InboxItem, limit int) ([]InboxItem, string) {
	if limit <= 0 {
		limit = DefaultInboxPageSize
	}
	if limit > MaxInboxPageSize {
		limit = MaxInboxPageSize
	}
	if len(sortedDesc) <= limit {
		// 非 nil 空切片：nil 会被序列化成 null（NOTIF-EMPTY-LIST-001）
		return sortedDesc, ""
	}
	page := sortedDesc[:limit]
	last := page[len(page)-1]
	return page, EncodeInboxCursor(last.CreatedAt, last.ID)
}

// inboxItemIsOlderThan 判断 item 是否严格位于游标之后（更旧）。
// 相等即视为「已返回过」—— 同一刻的项靠 id 打破并列，游标要能精确续上。
func inboxItemIsOlderThan(item InboxItem, cursor inboxCursor) bool {
	if !item.CreatedAt.Equal(cursor.createdAt) {
		return item.CreatedAt.Before(cursor.createdAt)
	}
	return item.ID < cursor.id
}

type inboxCursor struct {
	createdAt time.Time
	id        string
}

// EncodeInboxCursor 把 (created_at, id) 编成不透明游标。
//
// 游标编码放在领域包里而不是各自实现一遍：游标是**契约**（PG 与内存实现必须
// 互相认出对方的游标，否则换实现就翻不了页），各写一份早晚会分叉。
func EncodeInboxCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "\n" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeInboxCursor 解不出就当「没有游标」（从头开始）—— 一个坏游标不该让
// 整个收件箱打不开，那比多返回几行糟得多。客户端也能靠 nextCursor 的存在与否
// 判断要不要翻页，不依赖游标内容。
// DecodeInboxCursor 解不出就返回 ok=false（调用方当「从头开始」）。
func DecodeInboxCursor(cursor string) (time.Time, string, bool) {
	c, ok := decodeInboxCursor(cursor)
	return c.createdAt, c.id, ok
}

func decodeInboxCursor(cursor string) (inboxCursor, bool) {
	if strings.TrimSpace(cursor) == "" {
		return inboxCursor{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return inboxCursor{}, false
	}
	parts := strings.SplitN(string(raw), "\n", 2)
	if len(parts) != 2 {
		return inboxCursor{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return inboxCursor{}, false
	}
	return inboxCursor{createdAt: ts.UTC(), id: parts[1]}, true
}

func (r *MemoryRepository) MarkRead(_ context.Context, itemID, recipientID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.inbox[itemID]
	if !ok || item.RecipientID != recipientID {
		return errors.New("inbox not found")
	}
	item.Read = true
	r.inbox[itemID] = item
	return nil
}
func (r *MemoryRepository) HasInboxDeepLink(_ context.Context, recipientID, deepLink string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if recipientID == "" || deepLink == "" {
		// 空收件人不能命中任何东西。少了这一条，两个空串会互相匹配，
		// 于是「没登录」就成了「拥有所有无深链的通知」。
		return false, nil
	}
	for _, item := range r.inbox {
		if item.RecipientID == recipientID && item.DeepLink == deepLink {
			return true, nil
		}
	}
	return false, nil
}

type PushProvider interface {
	Push(ctx context.Context, item InboxItem) error
}

type LogPushProvider struct{}

func (LogPushProvider) Push(_ context.Context, item InboxItem) error {
	log.Printf("notification push: recipient=%s type=%s title=%q deepLink=%q", item.RecipientID, item.Type, item.Title, item.DeepLink)
	return nil
}

type Service struct {
	mu       sync.Mutex
	repo     Repository
	pipeline *Pipeline
	clock    clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }

// NewWithRepository 不配推送通道 ⇒ 走 LogPushProvider（只记日志）。
func NewWithRepository(repo Repository) *Service {
	return newService(repo, LogPushProvider{})
}

// NewWithPushProvider 用调用方给的推送通道。
//
// ⚠️ 传 nil 现在是**真的关掉推送**，不再兜成 LogPushProvider。
// 以前这里是 `if push == nil { push = LogPushProvider{} }`，于是
// configuredNotificationPush() 在 NOTIFICATION_PUSH=off 时返回的 nil
// 被当场换成 LogPushProvider —— 那个开关**从来没生效过**，关掉它的
// 部署照样在往日志里推。要「默认有推送」请用 NewWithRepository。
func NewWithPushProvider(repo Repository, push PushProvider) *Service {
	return newService(repo, push)
}

func newService(repo Repository, push PushProvider) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	c := clock.System{}
	// Service 与 Pipeline 共用同一个 repo 和同一个时钟：管线是写侧，
	// Service 是命令面，两者看到的必须是同一份数据。
	return &Service{repo: repo, pipeline: NewPipelineWithClock(repo, push, c), clock: c}
}

// Pipeline 暴露写侧，供命令面之外的调用方（如 worker 的接线）复用同一条管线。
func (s *Service) Pipeline() *Pipeline { return s.pipeline }
func (s *Service) Supports(t string) bool {
	switch t {
	case "RegisterDeviceToken", "SendInboxNotification", "ListInbox", "MarkInboxRead", "ResolveDeepLink":
		return true
	}
	return false
}
func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "RegisterDeviceToken":
		return s.registerDevice(ctx, e)
	case "SendInboxNotification":
		return s.sendInbox(ctx, e)
	case "ListInbox":
		return s.listInbox(ctx, e)
	case "MarkInboxRead":
		return s.markRead(ctx, e)
	case "ResolveDeepLink":
		return s.resolveDeepLink(ctx, e)
	default:
		return command.Rejected(e, "NOTIF_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "notif.unsupported", nil)
	}
}

func (s *Service) registerDevice(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		DeviceID string `json:"deviceId"`
		Platform string `json:"platform"`
		Token    string `json:"token"`
	}
	if !decode(e.Payload, &p) || p.DeviceID == "" || p.Token == "" {
		return command.Rejected(e, "INVALID_DEVICE", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_device", nil)
	}
	if p.Platform == "" {
		p.Platform = "IOS"
	}
	now := s.clock.Now().UTC()
	token := DeviceToken{ID: newID("dt_"), UserAccountID: e.Actor.ID, DeviceID: p.DeviceID, Platform: p.Platform, Token: p.Token, Status: "ACTIVE", CreatedAt: now, UpdatedAt: now}
	_ = s.repo.UpsertDeviceToken(ctx, token)
	ev := event.New("DeviceTokenRegistered", "DeviceToken", token.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"deviceId": p.DeviceID})
	return command.Accepted(e, "DeviceToken", token.ID, 1, token.Status, []string{ev.EventID})
}

// sendInbox 是 SendInboxNotification 命令的处理器 —— 它现在只是管线的一个**调用方**，
// 不再是第二条写路径。
//
// 改之前这里是 `repo.CreateInboxItem` + 手工 `push.Push`，和 worker 那条直连 SQL
// 各写各的。现在两条路径都落到 Pipeline.Emit，差别只剩幂等键。
//
// 顺带修掉的一个真洞：这条命令以前**不幂等**。它用的是随机 item id，所以
// 同一个 idempotencyKey 重试一次就多一行 —— 对一个 operator 后台口来说，
// 重试是常态（超时重发）。现在 DedupeKey 取命令 id，重试撞主键，不新增也不重推。
func (s *Service) sendInbox(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		RecipientID string `json:"recipientId"`
		Type        string `json:"type"`
		Title       string `json:"title"`
		Body        string `json:"body"`
		DeepLink    string `json:"deepLink"`
	}
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_INBOX", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_inbox", nil)
	}
	// Deep link must be opaque, not leak D4/D5
	if len(p.DeepLink) > 512 {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	// 幂等键优先用 idempotencyKey（「这一次逻辑请求」的语义），缺失才退回
	// CommandID。两者都空时 DedupeKey 为空 ⇒ 管线退回随机 id（不幂等），
	// 这只会发生在手搓 envelope 的测试里。
	dedupe := e.IdempotencyKey
	if dedupe == "" {
		dedupe = e.CommandID
	}
	item, created, err := s.pipeline.Emit(ctx, Notification{
		RecipientID: p.RecipientID,
		Type:        p.Type,
		Title:       p.Title,
		Body:        p.Body,
		DeepLink:    p.DeepLink,
		DedupeKey:   CommandDedupeKey(dedupe),
	})
	if err != nil {
		if errors.Is(err, ErrNotificationRecipientRequired) || errors.Is(err, ErrNotificationTitleRequired) {
			return command.Rejected(e, "INVALID_INBOX", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_inbox", nil)
		}
		return command.Rejected(e, "INBOX_WRITE_FAILED", "INTERNAL", "AFTER_USER_ACTION", "notif.write_failed", nil)
	}
	// 幂等命中（created=false）**不再发域事件** —— 事件是「发生了一件事」的记录，
	// 重试不是第二件事。落库那一行仍然返回，调用方拿到的 inboxId 是对的。
	var events []event.DomainEvent
	if created {
		events = []event.DomainEvent{event.New("InboxItemCreated", "InboxItem", item.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, item.CreatedAt, map[string]any{"recipientId": item.RecipientID, "type": item.Type})}
	}
	return acceptedWithPayload(e, "InboxItem", item.ID, 1, "CREATED", map[string]any{
		"inboxId":  item.ID,
		"deepLink": item.DeepLink,
		// created=false = 这次是幂等重放，不是新的一条。
		"created": created,
	}, events)
}

// listInboxPayload 是 ListInbox 的入参。limit/cursor 都可选（MERCHANT-CREATOR-NOTIFY-001）。
type listInboxPayload struct {
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor"`
	// UnreadOnly 一直存在但客户端从没传过 —— 保留，因为「只看未读」是通知中心
	// 的常规视图，而未读数是要在列表上显示的。
	UnreadOnly bool `json:"unreadOnly"`
}

func (s *Service) listInbox(ctx context.Context, e command.Envelope) command.Result {
	recipientID := e.Principal.ID
	var p listInboxPayload
	// 解析失败不拒：limit/cursor 都是可选的增强，不该因为客户端多传一个
	// 未知字段就打不开收件箱。decode 只在 payload 里找不到已知字段时返回 false。
	if raw := e.Payload; raw != nil {
		if v, has := raw["limit"]; has {
			if n, isNum := v.(float64); isNum {
				p.Limit = int(n)
			}
		}
		if v, has := raw["cursor"].(string); has {
			p.Cursor = v
		}
		if v, has := raw["unreadOnly"].(bool); has {
			p.UnreadOnly = v
		}
	}
	if p.Limit < 0 {
		p.Limit = 0
	}
	page, err := s.repo.ListInbox(ctx, recipientID, p.UnreadOnly, p.Limit, p.Cursor)
	if err != nil {
		return command.Rejected(e, "INBOX_READ_FAILED", "INTERNAL", "SAFE_RETRY", "notification.inbox_read_failed", nil)
	}
	// NOTIF-EMPTY-LIST-001：空收件箱**必须**编码成 `[]`，不是 `null`。
	//
	// 这是命令面的契约，不是某一个 Repository 的私事：`json.Marshal` 把 nil 切片
	// 写成 `null`，而客户端读的是 `Array.isArray(body.items)` —— `null` 会让
	// **收件箱为空**的用户看到「通知没取到，下拉重试」的失败态。
	// PG 那个实现原来正是返回 nil（已单独修），但只修那一处等于把契约挂在
	// 某一个实现的自觉上；这里再兜一层，换第三个 Repository 也不会复发。
	if page.Items == nil {
		page.Items = []InboxItem{}
	}
	return acceptedWithPayload(e, "Inbox", recipientID, 1, "LISTED", map[string]any{
		"items":       page.Items,
		"nextCursor":  page.NextCursor,
		"hasMore":     page.NextCursor != "",
		"unreadTotal": page.UnreadTotal,
	}, nil)
}

func (s *Service) markRead(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		InboxID string `json:"inboxId"`
	}
	if !decode(e.Payload, &p) || p.InboxID == "" {
		p.InboxID = e.Target.ID
		if p.InboxID == "" {
			return command.Rejected(e, "INVALID_MARK_READ", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_mark_read", nil)
		}
	}
	if err := s.repo.MarkRead(ctx, p.InboxID, e.Principal.ID); err != nil {
		return command.Rejected(e, "INBOX_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "notif.inbox_not_found", nil)
	}
	ev := event.New("InboxItemRead", "InboxItem", p.InboxID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), nil)
	return command.Accepted(e, "InboxItem", p.InboxID, 1, "READ", []string{ev.EventID})
}

// deepLinkPrefixes 是**允许**跳转的站内路由前缀白名单。
//
// 它和 cmd/worker/main.go 的 inboxForEvent 是一对：那边**生产**什么深链，
// 这边就**只认**什么深链。不在这张表里的一律拒绝 —— 客户端路由表里没有的
// 路径跳过去就是白屏，而 `javascript:` / `//evil.com` 这类伪装成「相对路径」
// 的东西更糟。加新的深链类型时两边一起加，别只加生产者。
// /market/<opportunityId>：MARKET-SELECT-NOTIFY-001（被选中 / 被邀请报名的通知点开就是那张单）。
var deepLinkPrefixes = []string{"/tasks/", "/offers/", "/orders/", "/vouchers/", "/invitations/", "/market/"}

// deepLinkScheme 是 app 自己的 URL scheme（apps/mobile/app.json 的 "scheme": "proxy"）。
//
// 同一个目标有两种合法写法，**都必须认**：
//
//	/offers/off_1          ← worker 生产、库里存的（站内路由路径）
//	proxy://offers/off_1   ← 通知被点开时原生层给的（app scheme + 路径）
//
// 少认一种就是「收到通知点不开」：库里的数据是第一种，而原生层交上来的是第二种。
var deepLinkScheme = "proxy://"

// canonicalDeepLink 把上面两种写法归一成站内路径；认不出来就返回 ""。
//
// 归一之后再判形状、再查归属、再回给客户端 —— 三处必须看**同一个**字符串，
// 否则会出现「形状检查过的是 A、查库用的是 B」这种自己跟自己对不上的状态。
func canonicalDeepLink(link string) string {
	if strings.HasPrefix(link, deepLinkScheme) {
		rest := strings.TrimPrefix(link, deepLinkScheme)
		if rest == "" {
			return ""
		}
		return "/" + rest
	}
	return link
}

// isResolvableDeepLink 只做**形状**判断（是不是我们自己的站内路径）。
// 归属判断是另一件事，必须查库（见下面的 HasInboxDeepLink）。
func isResolvableDeepLink(link string) bool {
	link = canonicalDeepLink(link)
	if link == "" || len(link) > 512 {
		return false
	}
	// 必须是**单**斜杠开头的站内路径。`//host` 是协议相对 URL，浏览器会
	// 拿它当外站地址；`/\host` 是同一个东西的 Windows 变体。
	if !strings.HasPrefix(link, "/") || strings.HasPrefix(link, "//") || strings.HasPrefix(link, "/\\") {
		return false
	}
	// 反斜杠、空白和控制字符：路径里出现它们说明这不是一个普通路径，
	// 而是想绕过上面那几条检查的构造物。
	for _, r := range link {
		if r == '\\' || r < 0x20 || r == 0x7f || r == ' ' {
			return false
		}
	}
	// `..` 段：`/offers/../../admin` 形状上像我们自己的路径，实际指向别处。
	// 客户端路由不该收到这种东西，所以在这里就断掉。
	for _, segment := range strings.Split(link, "/") {
		if segment == ".." || segment == "." {
			return false
		}
	}
	for _, prefix := range deepLinkPrefixes {
		if strings.HasPrefix(link, prefix) && len(link) > len(prefix) {
			return true
		}
	}
	return false
}

// resolveDeepLink 把 inbox 里的一条深链变成「可以跳」的判定。
//
// 改之前这里是：
//
//	// Simulate permission check: if link contains order/offer, ensure recipient
//	// owns it (simplified: allow)
//	return acceptedWithPayload(..., "resolved": true, nil)
//
// 也就是**任何**非空字符串都返回 resolved=true。那不是「简化」，那是没有校验：
//
//  1. 归属：谁都能拿它当**枚举预言机**，逐个试 `/offers/off_xxx` 来问
//     「这条链接存在吗」。现在这条链接必须出现在**调用者自己的**收件箱里。
//  2. 形状：以前 `javascript:alert(1)`、`//evil.com/x` 也算「格式合法」。
//     现在只认站内白名单前缀（isResolvableDeepLink）。
//
// 归属这一层的边界要说清楚：它证明的是「这条链接被投递给过我」，不是
// 「这个资源归我」。资源级的 ACL 属于各自领域（offer/order/task 的读口），
// 深链只是个路由，真正的门在目标页面的数据接口上。
func (s *Service) resolveDeepLink(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		DeepLink string `json:"deepLink"`
	}
	if !decode(e.Payload, &p) || p.DeepLink == "" {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	if !isResolvableDeepLink(p.DeepLink) {
		return command.Rejected(e, "INVALID_DEEPLINK", "VALIDATION", "AFTER_USER_ACTION", "notif.invalid_deeplink", nil)
	}
	// 归一之后**只认**这一个字符串：查库用它，回给客户端的也用它。
	// 回原样会让客户端拿到 `proxy://offers/x` 这种它自己没法路由的形式。
	link := canonicalDeepLink(p.DeepLink)
	// 归属用 Principal 而不是 Actor：ListInbox / MarkRead 用的都是 Principal，
	// 而收件箱的行是按同一个 id 写的。用另一个字段会出现「列表里有、跳转说不是你的」
	// 这种自己跟自己对不上的状态。
	recipientID := e.Principal.ID
	if recipientID == "" {
		recipientID = e.Actor.ID
	}
	owned, err := s.repo.HasInboxDeepLink(ctx, recipientID, link)
	if err != nil {
		return command.Rejected(e, "DEEPLINK_LOOKUP_FAILED", "INTERNAL", "AFTER_USER_ACTION", "notif.deeplink_lookup_failed", nil)
	}
	if !owned {
		return command.Rejected(e, "DEEPLINK_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "notif.deeplink_not_owned", nil)
	}
	return acceptedWithPayload(e, "DeepLink", link, 1, "RESOLVED", map[string]any{"deepLink": link, "resolved": true}, nil)
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func newID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + "fallback"
}
func acceptedWithPayload(e command.Envelope, typ, id string, version int, state string, payload map[string]any, events []event.DomainEvent) command.Result {
	r := command.Accepted(e, typ, id, version, state, eventRefs(events))
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}
func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}
