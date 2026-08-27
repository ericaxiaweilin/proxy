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

func (r *NotificationRepository) CreateInboxItem(ctx context.Context, item notification.InboxItem) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO notification.inbox_items
			(id, recipient_id, type, title, body, deep_link, read, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		item.ID, item.RecipientID, item.Type, item.Title, item.Body, nullableString(item.DeepLink), item.Read, item.CreatedAt,
	)
	return err
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
	var items []notification.InboxItem
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

// nullableString returns nil for empty strings so PG treats them as NULL
// (and the schema allows NULL deep_link).
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var _ notification.Repository = (*NotificationRepository)(nil)
