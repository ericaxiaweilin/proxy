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
	//
	// 深链用**站内路径**（`/orders/N`）—— 那是 cmd/worker/main.go 的
	// inboxForEvent 真正生产的形状，也是现网 notification.inbox_items
	// 里唯一存在的形状。以前这里写的是 `proxy://orders/N`，那是 app 的
	// URL scheme 被误当成了深链格式：没有任何生产者会产出它，而
	// ResolveDeepLink 现在按形状白名单校验，于是这条夹具先红了。
	// （`proxy://` 写法仍然被接受，见第 9 步。）
	otherUser := "user_notif_pg_other_" + itoa(run)
	otherLink := "/orders/ord_other_" + itoa(run)
	for i := 0; i < 3; i++ {
		r = svc.HandleContext(ctx, notificationEnvelope("SendInboxNotification", map[string]any{
			"recipientId": userID, "type": "ORDER_UPDATE",
			"title": "Order update", "body": "your order status changed",
			"deepLink": "/orders/ord_" + itoa(int64(i)) + "_" + itoa(run),
		}, "ops_001"))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("SendInboxNotification[%d]: %+v", i, r.Error)
		}
	}
	r = svc.HandleContext(ctx, notificationEnvelope("SendInboxNotification", map[string]any{
		"recipientId": otherUser, "type": "ORDER_UPDATE",
		"title": "Other", "body": "should not be visible to userID",
		"deepLink": otherLink,
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

	// 9. ResolveDeepLink 现在**要查库**了（NOTIF-DEEPLINK-001）：它以前是
	// `simplified: allow` 的纯格式校验，任何非空字符串都放行 —— 那等于一台
	// 枚举预言机（谁都能逐个试 /offers/off_xxx 问「这条链接存在吗」）。
	// 现在这条链接必须出现在**调用者自己的**收件箱里。
	//
	// 用第 4 步真的写进去的那条链接（`/orders/...`，worker 生产的形状），
	// 而不是手搓的假形状 —— 否则测的是「假数据能不能过」。
	var mine string
	if err := pool.QueryRow(ctx, `
		SELECT deep_link FROM notification.inbox_items
		WHERE recipient_id=$1 AND deep_link IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`, userID).Scan(&mine); err != nil {
		t.Fatalf("pick a real deep link: %v", err)
	}
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{
		"deepLink": mine,
	}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ResolveDeepLink(%s): %+v", mine, r.Error)
	}
	// 站内路径和 app scheme 两种写法指向同一条链接，必须都认。
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{
		"deepLink": "proxy://" + strings.TrimPrefix(mine, "/"),
	}, userID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ResolveDeepLink(app scheme %s): %+v", mine, r.Error)
	}
	// 别人的链接：这条是投给 otherUser 的，userID 来问必须被拒。
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{
		"deepLink": otherLink,
	}, userID))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "DEEPLINK_NOT_OWNED" {
		t.Fatalf("别的收件人的深链必须被拒，got outcome=%s err=%+v", r.Outcome, r.Error)
	}
	// 不存在于任何人收件箱里的链接：形状合法也要被拒。
	r = svc.HandleContext(ctx, notificationEnvelope("ResolveDeepLink", map[string]any{
		"deepLink": "/offers/off_never_delivered",
	}, userID))
	if r.Outcome != "REJECTED" || r.Error == nil || r.Error.ErrorCode != "DEEPLINK_NOT_OWNED" {
		t.Fatalf("没人收到过的深链必须被拒，got outcome=%s err=%+v", r.Outcome, r.Error)
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

// NOTIF-PIPELINE-001：幂等是**主键**给的，不是调用方的自觉。
//
// 这一条只能在真 PG 上钉：内存仓的 InsertInboxItemOnce 是一个 map 查询，
// 而这里是 `ON CONFLICT (id) DO NOTHING` + RowsAffected。两个实现必须
// 回答一致（接口注释里写死了这条），但它们的失败方式完全不同 ——
// 内存仓写错会返回 false，PG 写错会**抛 duplicate key 错误**。
//
// 这个 ON CONFLICT 以前只存在于 cmd/worker/main.go 的直连 SQL 里；
// 命令那条路径用随机 id + 无脑 INSERT。现在两条生产者共用这一处。
func TestNotificationInboxInsertIsIdempotent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)

	run := time.Now().UnixNano()
	recipient := "user_notif_idem_" + itoa(run)
	item := notification.InboxItem{
		ID:          "inbox_idem_" + itoa(run),
		RecipientID: recipient,
		Type:        "OfferCreated",
		Title:       "收到 Offer",
		Body:        "客户已发 Offer",
		DeepLink:    "/offers/off_1",
		CreatedAt:   time.Now().UTC(),
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM notification.inbox_items WHERE recipient_id=$1`, recipient)
	})

	created, err := repo.InsertInboxItemOnce(ctx, item)
	if err != nil || !created {
		t.Fatalf("first insert: created=%v err=%v", created, err)
	}
	// 重放：同一个 id 再写一次。**不能报错**（那不是失败，是幂等命中），
	// 而且必须明确回答 created=false —— 管线靠它决定不二次推送。
	created, err = repo.InsertInboxItemOnce(ctx, item)
	if err != nil {
		t.Fatalf("replay must not error, got %v", err)
	}
	if created {
		t.Fatal("replay must report created=false, otherwise the user gets a duplicate push")
	}

	var rows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM notification.inbox_items WHERE recipient_id=$1`, recipient).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 1 {
		t.Fatalf("replay must not add a row, got %d", rows)
	}
}

// NOTIF-DEEPLINK-001（PG 侧）：归属查询必须**按收件人**过滤。
//
// 这条只能在真 PG 上钉：SQL 里的 `WHERE recipient_id=$1 AND deep_link=$2`
// 是 ResolveDeepLink 唯一的归属依据，而内存仓那条路走的是 Go 循环 ——
// 单元测试碰不到这段 SQL。把 recipient_id 那一半删掉，SQL 仍然合法、
// 仍然返回结果，只是**谁的链接都能过**。这种洞在内存实现上完全看不见。
func TestNotificationHasInboxDeepLinkIsScopedToTheRecipient(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)

	run := time.Now().UnixNano()
	owner := "user_deeplink_owner_" + itoa(run)
	stranger := "user_deeplink_stranger_" + itoa(run)
	link := "/offers/off_" + itoa(run)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM notification.inbox_items WHERE recipient_id IN ($1,$2)`, owner, stranger)
	})

	if _, err := repo.InsertInboxItemOnce(ctx, notification.InboxItem{
		ID: "inbox_dl_" + itoa(run), RecipientID: owner, Type: "OfferCreated",
		Title: "收到 Offer", Body: "客户已发 Offer", DeepLink: link, CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := repo.HasInboxDeepLink(ctx, owner, link)
	if err != nil || !got {
		t.Fatalf("收件人本人必须命中: got=%v err=%v", got, err)
	}
	// 同一串文本、换个收件人 ⇒ 必须不命中。
	got, err = repo.HasInboxDeepLink(ctx, stranger, link)
	if err != nil {
		t.Fatalf("stranger lookup: %v", err)
	}
	if got {
		t.Fatal("深链归属必须按收件人过滤：别人的链接不能命中")
	}
	// 收件人对、链接不对 ⇒ 不命中。
	got, err = repo.HasInboxDeepLink(ctx, owner, "/offers/off_never")
	if err != nil {
		t.Fatalf("wrong link lookup: %v", err)
	}
	if got {
		t.Fatal("没人收到过的链接不能命中")
	}
	// 空串不能互相匹配。
	got, err = repo.HasInboxDeepLink(ctx, "", "")
	if err != nil {
		t.Fatalf("blank lookup: %v", err)
	}
	if got {
		t.Fatal("两个空串绝不能互相匹配")
	}
}

// NOTIF-EMPTY-LIST-001：空收件箱必须序列化成 `[]`，不是 `null`。
//
// 这条 bug 在设备上表现为「通知没取到，下拉重试」—— 一个**加载失败**态，
// 而真相是「这个用户还没有任何通知」。链路是：
//
//	PG ListInbox 返回 nil 切片 → listInbox 塞进 map{"items": nil}
//	→ json.Marshal 把 nil 切片写成 `null`（不是 `[]`）
//	→ 客户端 `Array.isArray(body.items)` 为 false → throw "inbox malformed"
//	→ 面板显示失败态。
//
// 现网只有 business_001 与 user_0377fe95… 两个收件人有行（845 行全在这两个名下），
// 所以**其余所有用户都 100% 命中**。而集成测试永远有 3 条数据，从来碰不到这条 ——
// 这就是它一直没被发现的原因：断言「有条目时形状对」测不出「没条目时形状错」。
//
// 必须走**真 PG**：内存仓的 ListInbox 是 `result := []InboxItem{}` 初始化的，
// 从第一天起就返回 `[]`，所以这条 bug 只在 PG 那条路上存在。
func TestNotificationEmptyInboxSerialisesAsArrayNotNull(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)
	svc := notification.NewWithRepository(repo)

	// 一个**确定没有任何行**的收件人。用纳秒时间戳保证它不可能是别人造出来的。
	recipient := "user_notif_empty_" + itoa(time.Now().UnixNano())

	items, err := repo.ListInbox(ctx, recipient, false)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if items == nil {
		t.Fatal("PG ListInbox must return an empty slice, not nil — nil marshals to `null` and the client throws")
	}
	if len(items) != 0 {
		t.Fatalf("expected an empty inbox for %s, got %d rows", recipient, len(items))
	}

	r := svc.HandleContext(ctx, notificationEnvelope("ListInbox", map[string]any{}, recipient))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListInbox: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	if strings.Contains(r.OperationRef, `"items":null`) {
		t.Fatalf("operationRef carries items:null — an empty inbox must be [] (client does Array.isArray): %s", r.OperationRef)
	}
	if !strings.Contains(r.OperationRef, `"items":[]`) {
		t.Fatalf("operationRef must carry an empty array, got: %s", r.OperationRef)
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
