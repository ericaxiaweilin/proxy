package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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

// MERCHANT-CREATOR-NOTIFY-001：收件箱/令牌的隔离下沉到 DB（migration 173）。
//
// 021 建表之后，收件箱的隔离**只**存在于下面每个方法自带的 WHERE 里。那是自觉：
// 任何新写的 SQL、任何漏掉 recipient_id 的查询、任何绕过 Repository 的脚本，
// 都能读到别人的收件箱 —— 而收件箱装的是「订单已成立」「收到 Offer」这类
// **平台自己说的话**，读到别人的不只是隐私，还等于拿到一条可被当成可信的正文。
//
// 173 之后 DB 会问「你这次是为哪个收件人操作」，问法是事务级 GUC
// proxy.recipient_id。**所有**访问必须走下面两个 helper，别再直接
// queryerForContext(...).Query —— 那样会拿不到 GUC，policy 判 NULL：
// 读 0 行、写被拒（fail-closed，刻意如此：漏设 GUC 的症状要是 0 行，
// 那它至少不会静默变成越权）。
func (r *NotificationRepository) withRecipient(ctx context.Context, recipientID string, fn func(q sqlQueryer) error) error {
	if strings.TrimSpace(recipientID) == "" {
		return fmt.Errorf("%w: recipient_id 不能为空（否则 policy 判 NULL，读 0 行 / 写被拒）", ErrNotifInboxNotFound)
	}
	return r.withScoped(ctx, "proxy.recipient_id", recipientID, fn)
}

func (r *NotificationRepository) withUserAccount(ctx context.Context, userAccountID string, fn func(q sqlQueryer) error) error {
	if strings.TrimSpace(userAccountID) == "" {
		return fmt.Errorf("%w: user_account_id 不能为空（否则 policy 判 NULL，读 0 行 / 写被拒）", ErrNotifDeviceNotFound)
	}
	return r.withScoped(ctx, "proxy.user_account_id", userAccountID, fn)
}

// withScoped 声明作用域 GUC 再干活。
//
// 走仓库既有的 runInTransaction：调用方已经开着事务时直接复用（不嵌套），
// 否则自己开一个。set_config 第三个参数 true = **事务级**（等价 SET LOCAL）：
// 连接还回池子时作用域自动消失，不会把「这是给 user_A 查的」漏给下一个
// 借用同一条连接的人。
//
// 用 set_config 而不是 SET LOCAL ... = ：键名来自调用点（两个 helper 的固定值），
// 值走绑定参数；SET LOCAL 不接受绑定参数。
func (r *NotificationRepository) withScoped(ctx context.Context, key, value string, fn func(q sqlQueryer) error) error {
	return runInTransaction(ctx, r.pool, func(txCtx context.Context, _ pgx.Tx) error {
		if _, err := queryerForContext(txCtx, r.pool).Exec(txCtx, `SELECT set_config($1, $2, true)`, key, value); err != nil {
			return fmt.Errorf("declare notification scope %s: %w", key, err)
		}
		return fn(queryerForContext(txCtx, r.pool))
	})
}

func (r *NotificationRepository) UpsertDeviceToken(ctx context.Context, t notification.DeviceToken) error {
	// UNIQUE (user_account_id, device_id) lets us ON CONFLICT update the
	// token + status + updated_at without churning the row id.
	return r.withUserAccount(ctx, t.UserAccountID, func(q sqlQueryer) error {
		_, err := q.Exec(ctx, `
		INSERT INTO notification.device_tokens
			(id, user_account_id, device_id, platform, token, status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (user_account_id, device_id) DO UPDATE SET
			token = EXCLUDED.token,
			status = EXCLUDED.status,
			updated_at = EXCLUDED.updated_at`,
			t.ID, t.UserAccountID, t.DeviceID, t.Platform, t.Token, t.Status, t.CreatedAt, t.UpdatedAt,
		)
		return err
	})
}

func (r *NotificationRepository) GetDeviceToken(ctx context.Context, userAccountID, deviceID string) (notification.DeviceToken, error) {
	var t notification.DeviceToken
	err := r.withUserAccount(ctx, userAccountID, func(q sqlQueryer) error {
		return q.QueryRow(ctx, `
		SELECT id, user_account_id, device_id, platform, token, status, created_at, updated_at
		FROM notification.device_tokens
		WHERE user_account_id=$1 AND device_id=$2`, userAccountID, deviceID).
			Scan(&t.ID, &t.UserAccountID, &t.DeviceID, &t.Platform, &t.Token, &t.Status, &t.CreatedAt, &t.UpdatedAt)
	})
	if err != nil {
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
	tokens := []notification.DeviceToken{}
	err := r.withUserAccount(ctx, userAccountID, func(q sqlQueryer) error {
		rows, err := q.Query(ctx, `
		SELECT id, user_account_id, device_id, platform, token, status, created_at, updated_at
		FROM notification.device_tokens
		WHERE user_account_id=$1 AND status='ACTIVE'
		ORDER BY updated_at DESC`, userAccountID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t notification.DeviceToken
			if err := rows.Scan(&t.ID, &t.UserAccountID, &t.DeviceID, &t.Platform, &t.Token, &t.Status, &t.CreatedAt, &t.UpdatedAt); err != nil {
				return err
			}
			tokens = append(tokens, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return tokens, nil
}

// DeactivateDeviceToken 退役一个 APNs/FCM 明确告知失效的令牌。
//
// 只改 status，不删行：留痕是为了审计（「这台设备什么时候不再收推送」本身是
// 有用的信息），而且 UpsertDeviceToken 的 ON CONFLICT 会在用户重新登录时
// 把同一 (user, device) 的行重新置回 ACTIVE。
func (r *NotificationRepository) DeactivateDeviceToken(ctx context.Context, token notification.DeviceToken) error {
	// WHERE 里带 user_account_id：作用域 GUC 之外再钉一道 —— 只凭 tokenID
	// 去改别人的行，即便 GUC 声明对了也不该成立。
	return r.withUserAccount(ctx, token.UserAccountID, func(q sqlQueryer) error {
		tag, err := q.Exec(ctx, `
		UPDATE notification.device_tokens SET status='INACTIVE', updated_at=now()
		WHERE id=$1 AND user_account_id=$2 AND status<>'INACTIVE'`, token.ID, token.UserAccountID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: id=%s user=%s", ErrNotifDeviceNotFound, token.ID, token.UserAccountID)
		}
		return nil
	})
}

func (r *NotificationRepository) InsertInboxItemOnce(ctx context.Context, item notification.InboxItem) (bool, error) {
	// 作用域是**这条通知自己的收件人**：outbox worker 一次处理一批事件、
	// 每个事件一个收件人，声明跟着收件人走。
	var tag interface{ RowsAffected() int64 }
	err := r.withRecipient(ctx, item.RecipientID, func(q sqlQueryer) error {
		t, err := q.Exec(ctx, `
		INSERT INTO notification.inbox_items
			(id, recipient_id, type, title, body, deep_link, read, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (id) DO NOTHING`,
			item.ID, item.RecipientID, item.Type, item.Title, item.Body, nullableString(item.DeepLink), item.Read, item.CreatedAt,
		)
		if err != nil {
			return err
		}
		tag = t
		return nil
	})
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ListInbox 取一页。排序与分页规则必须与内存实现**逐条一致**（NOTIF-EMPTY-LIST-001
// 的同类要求）：(created_at DESC, id DESC)，游标是 (created_at, id) 而不是 offset。
//
// 为什么不用 offset：offset 在「边读边有新通知进来」时会漏行或重复行，而收件箱
// 一直在长。游标续在「严格更旧」的位置上，同刻的项靠 id 打破并列。
//
// 只返回**未过期**的（migration 176）：已过期的等 sweeper 回收，在被回收之前
// 也不该出现在用户面前。
func (r *NotificationRepository) ListInbox(ctx context.Context, recipientID string, unreadOnly bool, limit int, cursor string) (notification.InboxPage, error) {
	sqlStr := `
		SELECT id, recipient_id, type, title, body, deep_link, read, created_at
		FROM notification.inbox_items
		WHERE recipient_id=$1
		  AND expires_at > now()`
	args := []any{recipientID}
	if unreadOnly {
		sqlStr += ` AND read = FALSE`
	}
	if afterAt, afterID, hasCursor := notification.DecodeInboxCursor(cursor); hasCursor {
		// (created_at, id) 的字典序比较：PostgreSQL 支持 row 比较。
		sqlStr += ` AND (created_at, id) < ($2, $3)`
		args = append(args, afterAt, afterID)
	}
	// 多取一条用来判断「还有没有下一页」，而不是再发一次 count 查询。
	sqlStr += ` ORDER BY created_at DESC, id DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, notification.MaxInboxPageSize+1)

	// NOTIF-EMPTY-LIST-001：**必须**初始化成非 nil 的空切片，不能留 nil。
	//
	// 这里返回 nil 时，上层 `listInbox` 把它塞进
	// `map[string]any{"items": items}`，而 `json.Marshal` 把 nil 切片序列化成
	// **`null`** 而不是 `[]`。客户端（notification-client.ts）读的是
	// `Array.isArray(body.items)` —— `null` 过不了这关，于是**收件箱为空**的
	// 用户看到的是「通知没取到，下拉重试」这个**加载失败**态，而不是空态。
	//
	// 空列表和「没有列表」不是一回事：前者是数据，后者是协议破损。
	items := []notification.InboxItem{}
	pageLimit := limit
	if pageLimit <= 0 {
		pageLimit = notification.DefaultInboxPageSize
	}
	if pageLimit > notification.MaxInboxPageSize {
		pageLimit = notification.MaxInboxPageSize
	}
	var next string
	err := r.withRecipient(ctx, recipientID, func(q sqlQueryer) error {
		rows, err := q.Query(ctx, sqlStr, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item notification.InboxItem
			var deepLink *string
			if err := rows.Scan(&item.ID, &item.RecipientID, &item.Type, &item.Title, &item.Body, &deepLink, &item.Read, &item.CreatedAt); err != nil {
				return err
			}
			if deepLink != nil {
				item.DeepLink = *deepLink
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return notification.InboxPage{}, err
	}
	// 多取的那一条只是探针，不进响应。切页逻辑与内存实现共用同一份。
	items, next = notification.PaginateInbox(items, pageLimit)

	// 未读总数：与分页/游标/过滤**无关**，因为铃铛角标要的是「我一共漏看多少」。
	unreadTotal := 0
	if err := r.withRecipient(ctx, recipientID, func(q sqlQueryer) error {
		return q.QueryRow(ctx, `
			SELECT count(*) FROM notification.inbox_items
			WHERE recipient_id=$1 AND read = FALSE AND expires_at > now()`, recipientID).Scan(&unreadTotal)
	}); err != nil {
		return notification.InboxPage{}, err
	}
	return notification.InboxPage{Items: items, NextCursor: next, UnreadTotal: unreadTotal}, nil
}

// PurgeExpiredInboxItems 回收已过期的读件箱（migration 176，90 天保留期）。
//
// 这是仓库铁律里明确列出的 infra GC 例外（和 conversation.PurgeExpiredMessages
// 同一个模式：固定期限 + sweeper + 日志）。被删的**只是读件箱**，事实本身
// （订单、内容任务、邀约）在业务表里不动。
//
// 返回删掉的行数，交给 worker 打日志 —— 一个静默的 GC 是没法运维的。
func (r *NotificationRepository) PurgeExpiredInboxItems(ctx context.Context, now time.Time) (int64, error) {
	// 走超级用户/表属主之外的路径不行：inbox_items 上有 FORCE RLS，而这个
	// 回收动作**不属于任何收件人**。所以它必须绕开 RLS —— 用表属主身份 +
	// 事务级关掉 RLS，而不是靠给某个用户开权限。
	//
	// 为什么不设 proxy.recipient_id：这属于「平台级回收」，把它伪装成某个
	// 用户的操作正是 RLS 要防的那类事（审计日志里会显示成某个用户在删数据）。
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `ALTER TABLE notification.inbox_items DISABLE ROW LEVEL SECURITY`); err != nil {
		return 0, fmt.Errorf("inbox gc: cannot disable row level security (is this role the table owner?): %w", err)
	}
	tag, err := tx.Exec(ctx, `DELETE FROM notification.inbox_items WHERE expires_at <= $1`, now)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `ALTER TABLE notification.inbox_items ENABLE ROW LEVEL SECURITY`); err != nil {
		return 0, fmt.Errorf("inbox gc: failed to re-enable row level security: %w", err)
	}
	if _, err := tx.Exec(ctx, `ALTER TABLE notification.inbox_items FORCE ROW LEVEL SECURITY`); err != nil {
		return 0, fmt.Errorf("inbox gc: failed to restore FORCE row level security: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *NotificationRepository) MarkRead(ctx context.Context, itemID, recipientID string) error {
	// 173 只授权了 read 一个列的 UPDATE：把「读自己的通知」与「改别人通知的内容」
	// 分成两件权限，而不是只靠调用方记得加 WHERE。
	return r.withRecipient(ctx, recipientID, func(q sqlQueryer) error {
		tag, err := q.Exec(ctx, `
		UPDATE notification.inbox_items SET read = TRUE
		WHERE id=$1 AND recipient_id=$2`, itemID, recipientID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: id=%s recipient=%s", ErrNotifInboxNotFound, itemID, recipientID)
		}
		return nil
	})
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
	// EXISTS 而不是 COUNT(*)：只关心有没有，让 PG 在第一行就停下来。
	// recipient_id 和 deep_link 都在 WHERE 里 —— 少了任何一个都会变成
	// 「谁的链接都能过」（漏 recipient）或「随便什么链接都过」（漏 deep_link）。
	var exists bool
	err := r.withRecipient(ctx, recipientID, func(q sqlQueryer) error {
		return q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM notification.inbox_items
			WHERE recipient_id=$1 AND deep_link=$2
		)`, recipientID, deepLink).Scan(&exists)
	})
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
