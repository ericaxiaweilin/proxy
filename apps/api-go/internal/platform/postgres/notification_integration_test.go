package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/notification"
)

// TestNotificationPostgresRoundTrip exercises the M7 device + inbox flow
// against real PostgreSQL. M7 acceptance: device token lifecycle + duplicate
// push callback dedupe (ON CONFLICT updates the same row, not a new one) +
// inbox unread/read filter + cross-recipient isolation.
func TestNotificationPostgresRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)
	svc := notification.NewWithRepository(repo)

	run := time.Now().UnixNano()
	userID := "user_notif_pg_" + itoa(run)
	deviceID := "device_notif_pg_" + itoa(run)

	// 1. Register a device token.
	r := svc.HandleContext(ctx, notificationEnvelope("RegisterDeviceToken", map[string]any{
		"deviceId": deviceID, "platform": "IOS", "token": "apns_token_v1",
	}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("RegisterDeviceToken: outcome=%s err=%+v", r.Outcome, r.Error)
	}

	// 2. Registering the same (user, device) again must NOT create a new
	// row — it must upsert the same primary key (M7 dedupe acceptance).
	r = svc.HandleContext(ctx, notificationEnvelope("RegisterDeviceToken", map[string]any{
		"deviceId": deviceID, "platform": "IOS", "token": "apns_token_v2",
	}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("second RegisterDeviceToken: %+v", r.Error)
	}
	var rowCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notification.device_tokens
		WHERE user_account_id=$1 AND device_id=$2`, userID, deviceID).Scan(&rowCount); err != nil {
		t.Fatalf("count device_tokens: %v", err)
	}
	if rowCount != 1 {
		t.Fatalf("ON CONFLICT must dedupe to 1 row, got %d", rowCount)
	}

	// 3. The token must reflect the latest write.
	got, err := repo.GetDeviceToken(ctx, userID, deviceID)
	if err != nil {
		t.Fatalf("GetDeviceToken: %v", err)
	}
	if got.Token != "apns_token_v2" {
		t.Fatalf("upsert did not update token, got %q", got.Token)
	}

	// 4. Send 3 inbox items to this user, 1 to a different user.
	otherUser := "user_notif_pg_other_" + itoa(run)
	for i := 0; i < 3; i++ {
		r = svc.HandleContext(ctx, notificationEnvelope("SendInboxNotification", map[string]any{
			"recipientId": userID, "type": "ORDER_UPDATE",
			"title": "Order update", "body": "your order status changed",
			"deepLink": "proxy://orders/" + itoa(int64(i)),
		}, "ops_001"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("SendInboxNotification[%d]: %+v", i, r.Error)
		}
	}
	r = svc.HandleContext(ctx, notificationEnvelope("SendInboxNotification", map[string]any{
		"recipientId": otherUser, "type": "ORDER_UPDATE",
		"title": "Other", "body": "should not be visible to userID",
	}, "ops_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SendInboxNotification(other): %+v", r.Error)
	}

	// 5. ListInbox for userID must return exactly the 3 we sent, in
	// deterministic order (newest first by created_at DESC).
	items, err := repo.ListInbox(ctx, userID, false)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0].CreatedAt.Before(items[1].CreatedAt) {
		t.Fatalf("ListInbox not sorted DESC by created_at")
	}
	// Cross-tenant: the other user's item must NOT leak in.
	for _, it := range items {
		if it.RecipientID != userID {
			t.Fatalf("cross-tenant leak: %+v", it)
		}
	}

	// 6. Mark one of them read; unreadOnly must now skip it.
	first := items[0]
	if err := repo.MarkRead(ctx, first.ID, userID); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	unread, err := repo.ListInbox(ctx, userID, true)
	if err != nil {
		t.Fatalf("ListInbox(unread): %v", err)
	}
	if len(unread) != 2 {
		t.Fatalf("unreadOnly must return 2, got %d", len(unread))
	}
	for _, it := range unread {
		if it.Read {
			t.Fatalf("unreadOnly returned a read item: %+v", it)
		}
	}

	// 7. Cross-tenant MarkRead must NOT mark the row (different recipient).
	if err := repo.MarkRead(ctx, first.ID, "wrong_recipient"); err == nil {
		t.Fatalf("cross-tenant MarkRead must return an error")
	}
	got, _ = repo.GetDeviceToken(ctx, userID, deviceID)
	_ = got
	items, _ = repo.ListInbox(ctx, userID, false)
	if !items[0].Read {
		t.Fatalf("cross-tenant MarkRead must not have flipped read flag")
	}

	// 8. The deep_link that we never wrote must come back NULL (nullable).
	r = svc.HandleContext(ctx, notificationEnvelope("SendInboxNotification", map[string]any{
		"recipientId": userID, "type": "TIP", "title": "Tip", "body": "no link",
	}, "ops_001"))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SendInboxNotification(no link): %+v", r.Error)
	}
	items, _ = repo.ListInbox(ctx, userID, false)
	noLink := items[0]
	if noLink.DeepLink != "" {
		t.Fatalf("missing deep link must come back empty, got %q", noLink.DeepLink)
	}

	// 9. ResolveDeepLink is a pure validator (no IO) but the service
	// must still accept the legitimate case and reject an empty link.
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{
		"deepLink": "proxy://orders/abc",
	}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ResolveDeepLink: %+v", r.Error)
	}
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{}, userID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("empty deep link must be REJECTED, got %s", r.Outcome)
	}

	// cleanup
	if _, err := pool.Exec(ctx, `DELETE FROM notification.inbox_items WHERE recipient_id IN ($1,$2)`, userID, otherUser); err != nil {
		t.Fatalf("cleanup inbox: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM notification.device_tokens WHERE user_account_id=$1`, userID); err != nil {
		t.Fatalf("cleanup device: %v", err)
	}
}

func notificationEnvelope(commandType string, payload map[string]any, actorID string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_notif_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Target:         command.Target{Type: "Notification", ID: actorID},
		IdempotencyKey: "test_notif_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_notif_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}
