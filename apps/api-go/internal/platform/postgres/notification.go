package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/notification"
)

// NotificationRepository 持久化 M7 Inbox/Notification/Device (DeviceToken /
// InboxItem)。schema 见 021_inbox_notification.sql。
type NotificationRepository struct {
	pool *pgxpool.Pool
}

func NewNotificationRepository(pool *pgxpool.Pool) *NotificationRepository {
	return &NotificationRepository{pool: pool}
}

var ErrNotifDeviceNotFound = errors.New("device token not found")
var ErrNotifInboxNotFound = errors.New("inbox item not found")

func (r *NotificationRepository) UpsertDeviceToken(ctx context.Context, t notification.DeviceToken) error {
	// UNIQUE (user_account_id, device_id) lets us ON CONFLICT update the
	// token + status + updated_at without churning the row id.
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO notification.device_tokens
			(id, user_account_id, device_id, platform, token, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_account_id, device_id) DO UPDATE SET
			platform = EXCLUDED.platform,
			token = EXCLUDED.token,
			status = EXCLUDED.status,
			updated_at = EXCLUDED.updated_at`,
		t.ID, t.UserAccountID, t.DeviceID, t.Platform, t.Token, t.Status, t.CreatedAt, t.UpdatedAt,
	)
	return err
}

func (r *NotificationRepository) GetDeviceToken(ctx context.Context, userAccountID, deviceID string) (notification.DeviceToken, error) {
	row := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT id, user_account_id, device_id, platform, token, status, created_at, updated_at
		FROM notification.device_tokens
		WHERE user_account_id=$1 AND device_id=$2`, userAccountID, deviceID)
	var t notification.DeviceToken
	if err := row.Scan(&t.ID, &t.UserAccountID, &t.DeviceID, &t.Platform, &t.Token, &t.Status, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return notification.DeviceToken{}, fmt.Errorf("%w: %v", ErrNotifDeviceNotFound, err)
	}
	return t, nil
}

// InsertInboxItemOnce 幂等写一行 inbox：主键已存在 ⇒ 什么都不做并返回
// created=false。
//
// 这个 ON CONFLICT 以前只存在于 cmd/worker/main.go 的直连 SQL 里
// （"bypass service to avoid auth"），命令那条路径用的是随机 id + 无脑
// INSERT ⇒ 同一语义两处实现。现在它是 Repository 接口的唯一 inbox 写侧，
// 两条生产者都经过这里。
//
// 返回 RowsAffected()==1 而不是「err == nil」：那正是管线判断要不要推送
// 的依据。写成 `return true, err` 会让重放也推送（用户收到两条一样的）。
// ListDeviceTokens 取一个用户所有 ACTIVE 的设备令牌 —— 这是推送的**取目标口**。
//
// 以前只有 GetDeviceToken(userAccountID, deviceID)，那要求调用方先知道 deviceID；
// 而推送这一侧只知道**收件人**。缺这个方法，PushProvider 就没法把「一条通知」
// 变成「推到哪台设备」—— 推送一直是空壳，根子在这里，不在发送代码。
//
// 只取 status='ACTIVE'：登出/卸载留下的行保留是为了审计，但拿去推只会换来
// APNs/FCM 的 Unregistered 回执，然后我们会误以为「推成功了」。
//
// 和 ListInbox 一样**必须返回非 nil 空切片**（NOTIF-EMPTY-LIST-001）。
func (r *NotificationRepository) ListDeviceTokens(ctx context.Context, userAccountID string) ([]notification.DeviceToken, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT id, user_account_id, device_id, platform, token, status, created_at, updated_at
		FROM notification.device_tokens
		WHERE user_account_id=$1 AND status='ACTIVE'
		ORDER BY updated_at DESC`, userAccountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := []notification.DeviceToken{}
	for rows.Next() {
		var t notification.DeviceToken
		if err := rows.Scan(&t.ID, &t.UserAccountID, &t.DeviceID, &t.Platform, &t.Token, &t.Status, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, rows.Err()
}

// DeactivateDeviceToken 退役一个 APNs/FCM 明确告知失效的令牌。
//
// 只改 status，不删行：留痕是为了审计（「这台设备什么时候不再收推送」本身是
// 有用的信息），而且 UpsertDeviceToken 的 ON CONFLICT 会在用户重新登录时
// 把同一 (user, device) 的行重新置回 ACTIVE。
func (r *NotificationRepository) DeactivateDeviceToken(ctx context.Context, tokenID string) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE notification.device_tokens SET status='INACTIVE', updated_at=now()
		WHERE id=$1 AND status<>'INACTIVE'`, tokenID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: id=%s", ErrNotifDeviceNotFound, tokenID)
	}
	return nil
}

func (r *NotificationRepository) InsertInboxItemOnce(ctx context.Context, item notification.InboxItem) (bool, error) {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO notification.inbox_items
			(id, recipient_id, type, title, body, deep_link, read, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (id) DO NOTHING`,
		item.ID, item.RecipientID, item.Type, item.Title, item.Body, nullableString(item.DeepLink), item.Read, item.CreatedAt,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *NotificationRepository) ListInbox(ctx context.Context, recipientID string, unreadOnly bool) ([]notification.InboxItem, error) {
	// unreadOnly is honored by the in-memory path; PG should too so the
	// two paths stay in lockstep on shape.
	sqlStr := `
		SELECT id, recipient_id, type, title, body, deep_link, read, created_at
		FROM notification.inbox_items
		WHERE recipient_id=$1`
	if unreadOnly {
		sqlStr += ` AND read = FALSE`
	}
	sqlStr += ` ORDER BY created_at DESC`
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, sqlStr, recipientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// NOTIF-EMPTY-LIST-001：**必须**初始化成非 nil 的空切片，不能留 nil。
	//
	// 这里返回 nil 时，上层 `listInbox` 把它塞进
	// `map[string]any{"items": items}`，而 `json.Marshal` 把 nil 切片序列化成
	// **`null`** 而不是 `[]`。客户端（notification-client.ts）读的是
	// `Array.isArray(body.items)` —— `null` 过不了这关，于是**收件箱为空**的
	// 用户看到的是「通知没取到，下拉重试」这个**加载失败**态，而不是空态。
	// 现网只有 2 个收件人（business_001 / user_0377fe95…）有行，其余全部命中
	// 这条 —— 也就是说这个 bug 对绝大多数用户都是 100% 复现的。
	//
	// 空列表和「没有列表」不是一回事：前者是数据，后者是协议破损。
	items := []notification.InboxItem{}
	for rows.Next() {
		var item notification.InboxItem
		var deepLink *string
		if err := rows.Scan(&item.ID, &item.RecipientID, &item.Type, &item.Title, &item.Body, &deepLink, &item.Read, &item.CreatedAt); err != nil {
			return nil, err
		}
		if deepLink != nil {
			item.DeepLink = *deepLink
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *NotificationRepository) MarkRead(ctx context.Context, itemID, recipientID string) error {
	tag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE notification.inbox_items SET read = TRUE
		WHERE id=$1 AND recipient_id=$2`, itemID, recipientID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: id=%s recipient=%s", ErrNotifInboxNotFound, itemID, recipientID)
	}
	return nil
}

// HasInboxDeepLink 回答「这条深链是不是发给我的」—— ResolveDeepLink 的归属校验。
//
// EXISTS 而不是 COUNT(*)：只关心有没有，让 PG 在第一行就停下来。
// recipient_id 和 deep_link 都在 WHERE 里 —— 少了任何一个都会变成
// 「谁的链接都能过」（漏 recipient）或「随便什么链接都过」（漏 deep_link）。
func (r *NotificationRepository) HasInboxDeepLink(ctx context.Context, recipientID, deepLink string) (bool, error) {
	if recipientID == "" || deepLink == "" {
		// 空串不能互相匹配：否则「没登录」等于「拥有所有无深链的通知」。
		return false, nil
	}
	var exists bool
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM notification.inbox_items
			WHERE recipient_id=$1 AND deep_link=$2
		)`, recipientID, deepLink).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// nullableString returns nil for empty strings so PG treats them as NULL
// (and the schema allows NULL deep_link).
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var _ notification.Repository = (*NotificationRepository)(nil)
