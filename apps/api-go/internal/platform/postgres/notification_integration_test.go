package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

// MERCHANT-CREATOR-NOTIFY-001（2026-10-05 查通知管线时挖出的真 bug）：
// DeactivateDeviceToken 退役被 APNs/FCM 判死的令牌时写 status='INACTIVE'，
// 而 021 建表的 CHECK 只允许 ACTIVE/REVOKED/EXPIRED ⇒ 每次退役都撞约束失败。
// 失败在 push.go 里被静默忽略（那是"瞬时故障别退役令牌"的取舍），于是失效令牌
// 永远留在 ACTIVE 里，每次推送都白跑一遍死令牌 —— 一开推送就会显形。
//
// 为什么这条只能在真 PG 上钉：内存仓储写 INACTIVE 永远成功，只有真约束会红。
// migration 172 把 INACTIVE 补进 CHECK；这条钉住"退役能落库 + 落库后不再被
// ListDeviceTokens 选中"，这样以后谁再改这个字面量会立刻红。
func TestDeactivateDeviceTokenPersistsInactiveStatus(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)
	run := time.Now().UnixNano()
	userID := "user_notif_deact_" + itoa(run)
	deviceID := "device_notif_deact_" + itoa(run)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notification.device_tokens WHERE user_account_id=$1`, userID)
	})

	tok := notification.DeviceToken{
		ID: "dtok_notif_deact_" + itoa(run), UserAccountID: userID, DeviceID: deviceID,
		Platform: "IOS", Token: "apns_token_deact", Status: "ACTIVE", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := repo.UpsertDeviceToken(ctx, tok); err != nil {
		t.Fatalf("seed device token: %v", err)
	}
	// 173 之后退役要带 UserAccountID：设备令牌按 user_account_id 做 RLS 隔离，
	// 没有用户账号就声明不了作用域，DB 会拒（fail-closed）。
	if err := repo.DeactivateDeviceToken(ctx, tok); err != nil {
		t.Fatalf("DeactivateDeviceToken must persist (schema CHECK must allow INACTIVE): %v", err)
	}
	got, err := repo.GetDeviceToken(ctx, userID, deviceID)
	if err != nil {
		t.Fatalf("GetDeviceToken: %v", err)
	}
	if got.Status != "INACTIVE" {
		t.Fatalf("retired token status = %q, want INACTIVE", got.Status)
	}
	// 退役后不该再出现在推送目标里，否则每次推送都白跑死令牌。
	tokens, err := repo.ListDeviceTokens(ctx, userID)
	if err != nil {
		t.Fatalf("ListDeviceTokens: %v", err)
	}
	for _, tok := range tokens {
		if tok.ID == got.ID {
			t.Fatalf("retired token must not be listed for push, got %+v", tok)
		}
	}
}

// MERCHANT-CREATOR-NOTIFY-001（migrations/173）：收件箱隔离下沉到 DB。
//
// **必须用非超级用户角色实测** —— 超级用户绕过所有权限检查，只测超级用户等于
// 什么都没测（migration 112 记的就是这个坑：临时集群是 initdb -U proxy 建的，
// 那个 proxy 是超级用户，于是 RLS 在测试里永远是摆设）。做法和
// order_role_integration_test.go 一致：本次运行建一个临时非超级用户角色，
// GRANT proxy TO 它（policy 是 TO proxy，成员角色按 pg_has_role 匹配），
// 再 SET LOCAL ROLE 切过去 —— 于是 current_user 是非超级用户，RLS 真的生效。
func TestNotificationInboxRLSIsolatesRecipients(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()
	scratch := "notif_rls_" + itoa(run)
	owner := "user_rls_owner_" + itoa(run)
	stranger := "user_rls_stranger_" + itoa(run)
	itemID := "inbox_rls_" + itoa(run)

	if _, err := pool.Exec(ctx, `CREATE ROLE `+scratch+` NOLOGIN NOSUPERUSER`); err != nil {
		t.Skipf("cannot create scratch role (needs CREATEROLE): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DROP OWNED BY `+scratch)
		_, _ = pool.Exec(ctx, `DROP ROLE IF EXISTS `+scratch)
	})
	if _, err := pool.Exec(ctx, `GRANT `+"proxy"+` TO `+scratch); err != nil {
		t.Fatalf("grant proxy role to scratch: %v", err)
	}
	// 种子数据由超级用户写（测试自己这次创建的行，run 后缀 + Cleanup）。
	if _, err := pool.Exec(ctx, `
		INSERT INTO notification.inbox_items (id,recipient_id,type,title,body,deep_link,read,created_at)
		VALUES ($1,$2,'Probe','owner 的通知','body',NULL,false,now())`, itemID, owner); err != nil {
		t.Fatalf("seed inbox item: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notification.inbox_items WHERE id=$1`, itemID)
	})

	asScratch := func(t *testing.T, fn func(tx pgx.Tx)) {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SET LOCAL ROLE `+scratch); err != nil {
			t.Fatal(err)
		}
		fn(tx)
	}

	// ① 没声明作用域 ⇒ 读 0 行。**fail-closed 是刻意的**：漏设 GUC 的症状要是
	//    「0 行」而不是「静默看到全部」，否则漏设就等于越权。
	asScratch(t, func(tx pgx.Tx) {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM notification.inbox_items`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("without proxy.recipient_id the inbox must read 0 rows, got %d — fail-closed is broken", n)
		}
	})

	// ② 声明成别人 ⇒ 读 0 行。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, stranger); err != nil {
			t.Fatal(err)
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM notification.inbox_items`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("recipient %s must not see %s's inbox, got %d rows", stranger, owner, n)
		}
	})

	// ③ 声明成自己 ⇒ 只看得到自己的那一条。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, owner); err != nil {
			t.Fatal(err)
		}
		var n int
		var gotRecipient string
		if err := tx.QueryRow(ctx, `SELECT count(*), min(recipient_id) FROM notification.inbox_items`).Scan(&n, &gotRecipient); err != nil {
			t.Fatal(err)
		}
		if n != 1 || gotRecipient != owner {
			t.Fatalf("own inbox must be visible and nobody else's: rows=%d recipient=%s", n, gotRecipient)
		}
	})

	// ④ 声明成自己，也不能往别人收件箱塞东西（伪造平台通知的那条路）。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, stranger); err != nil {
			t.Fatal(err)
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO notification.inbox_items (id,recipient_id,type,title,body,deep_link,read,created_at)
			VALUES ($1,$2,'Probe','伪造的系统通知','body',NULL,false,now())`, "inbox_rls_forged_"+itoa(run), owner)
		if err == nil {
			t.Fatal("inserting into another recipient's inbox must be rejected by RLS")
		}
	})

	// ⑤ DELETE 一律不给（173 REVOKE）：仓库铁律是「数据永不按代码删除」。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM notification.inbox_items WHERE id=$1`, itemID); err == nil {
			t.Fatal("DELETE must be denied on inbox_items")
		}
	})

	// ⑥ 投递事实不可改（标题/正文/深链）—— 各自一个事务：被拒的语句会让整个
	//    事务进入 aborted，后面的话都变成 25P02，那不是我们想验的东西。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `UPDATE notification.inbox_items SET title='改写了' WHERE id=$1`, itemID); err == nil {
			t.Fatal("rewriting an already-delivered notification body must be denied")
		}
	})

	// ⑦ 自己标已读必须仍然可以（否则 173 把「已读」功能一起关掉了）。
	asScratch(t, func(tx pgx.Tx) {
		if _, err := tx.Exec(ctx, `SELECT set_config('proxy.recipient_id', $1, true)`, owner); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `UPDATE notification.inbox_items SET read=TRUE WHERE id=$1`, itemID); err != nil {
			t.Fatalf("marking own notification read must be allowed: %v", err)
		}
		var read bool
		if err := tx.QueryRow(ctx, `SELECT read FROM notification.inbox_items WHERE id=$1`, itemID).Scan(&read); err != nil {
			t.Fatal(err)
		}
		if !read {
			t.Fatal("read=TRUE must actually land")
		}
	})
}

// 173 的作用域是**事务级**（set_config(..., true)）—— 借出去的那条连接回到池子时
// 不得还带着「这是给 user_A 查的」。这个测试只靠观察连接池行为就够：跑完一次
// ListInbox 之后，在一个**没设过 GUC 的查询**里读 current_setting，必须是空。
func TestNotificationScopeDoesNotLeakAcrossPooledConnections(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)
	recipient := "user_scope_leak_" + itoa(time.Now().UnixNano())

	if _, err := repo.ListInbox(ctx, recipient, false); err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	// 复用池里的连接，但这个查询本身没声明任何作用域。
	var scope string
	if err := pool.QueryRow(ctx, `SELECT coalesce(current_setting('proxy.recipient_id', true), '')`).Scan(&scope); err != nil {
		t.Fatal(err)
	}
	if scope != "" {
		t.Fatalf("notification scope leaked to a pooled connection: proxy.recipient_id=%q", scope)
	}
}

// 空收件人必须在**碰数据库之前**就被拒：否则 policy 判 NULL，报出来的是
// 「读 0 行 / 写被拒」这种看不出原因的错误。
func TestNotificationRejectsEmptyScopeBeforeQuerying(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewNotificationRepository(pool)
	if _, err := repo.ListInbox(ctx, "", false); err == nil {
		t.Fatal("an empty recipient must be rejected")
	}
	if err := repo.MarkRead(ctx, "inbox_x", "  "); err == nil {
		t.Fatal("a blank recipient must be rejected")
	}
}

// MERCHANT-CREATOR-NOTIFY-001（173）：账户删除那一步要 DELETE device_tokens，
// 而那张表按 user_account_id 开了 FORCE RLS。
//
// 为什么单独钉：症状极坏 —— 不声明作用域时 DELETE 一行都删不掉，
// RowsAffected=0、receipt.PushTokens=0，函数却**照样返回 nil**。于是
// 「设备已删除」被记成成功，而平台继续往一台已注销账号的设备推消息。
// 而且上面那个既有测试（PushTokens==1）是在**超级用户**连接上跑的，RLS 被绕过，
// 它压根看不见这个问题 —— 这就是必须用非超级用户角色实测的原因。
//
// 做法：另开一个池，用 `options=-c role=<scratch>` 让连接**一上来就是**
// 非超级用户角色（EraseCrossAggregateIdentity 内部自己 Begin，没人能替它
// 包一层 SET LOCAL ROLE）。
func TestEraseAccountStillDeletesPushTokensUnderRLS(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())
	scratch := "notif_erase_" + run
	userID := "xagg_rls_" + run

	if _, err := pool.Exec(ctx, `CREATE ROLE `+scratch+` NOLOGIN NOSUPERUSER`); err != nil {
		t.Skipf("cannot create scratch role (needs CREATEROLE): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DROP OWNED BY `+scratch)
		_, _ = pool.Exec(ctx, `DROP ROLE IF EXISTS `+scratch)
	})
	if _, err := pool.Exec(ctx, `GRANT `+"proxy"+` TO `+scratch); err != nil {
		t.Fatalf("grant proxy role to scratch: %v", err)
	}

	// 种子：身份行 + 一个推送令牌（超级用户写；清理也用超级用户）。
	f := newCrossAggregateFixture(run)
	f.userID = userID
	seedCrossAggregateCopies(t, ctx, f)
	t.Cleanup(func() { cleanupCrossAggregateFixture(t, f) })

	// 非超级用户池：连接建立时就带上 role。
	dsn := pool.Config().ConnConfig.Copy()
	dsn.RuntimeParams["role"] = scratch
	cfg, err := pgxpool.ParseConfig(dsn.ConnString())
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["role"] = scratch
	scoped, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("scoped pool: %v", err)
	}
	defer scoped.Close()

	var isSuper bool
	if err := scoped.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&isSuper); err != nil {
		t.Fatalf("probe current role: %v", err)
	}
	if isSuper {
		t.Fatal("the scoped pool must not be a superuser, otherwise this test proves nothing")
	}

	// 先钉住种子真的在：否则「删掉了 0 行因为本来就没有」会被当成通过。
	var seeded int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification.device_tokens WHERE user_account_id=$1`, userID).Scan(&seeded); err != nil {
		t.Fatal(err)
	}
	if seeded != 1 {
		t.Fatalf("fixture must seed exactly 1 push token, got %d", seeded)
	}

	receipt, err := NewIdentityRepository(scoped).EraseCrossAggregateIdentity(ctx, userID)
	if err != nil {
		t.Fatalf("EraseCrossAggregateIdentity must succeed: %v", err)
	}
	if receipt.PushTokens != 1 {
		t.Fatalf("receipt.PushTokens = %d — the RLS-scoped DELETE deleted nothing while still reporting success", receipt.PushTokens)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification.device_tokens WHERE user_account_id=$1`, userID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d push token(s) survived account erasure", left)
	}
}

// MERCHANT-CREATOR-NOTIFY-001（173）：开一个**非超级用户**角色的连接池。
//
// 为什么非要这么费劲：仓库自己的集成测试跑在 initdb -U proxy 建的临时集群上，
// 那个 proxy 是**超级用户**，而超级用户绕过所有权限与 RLS —— 也就是说
// 「Repository 的 withRecipient/set_config 写对了没有」「policy 拦没拦住」
// 这两件事，常规测试**一件都验不到**（migration 112 记的就是这个坑）。
//
// 角色策略沿用 order_role_integration_test.go：临时 NOLOGIN 非超级用户角色 +
// GRANT proxy（policy 是 TO proxy，成员按 pg_has_role 匹配）+ Cleanup 回收。
func requireNonSuperuserPool(t *testing.T, pool *pgxpool.Pool, roleSuffix string) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	role := "notif_nonsuper_" + roleSuffix + "_" + itoa(time.Now().UnixNano())
	if _, err := pool.Exec(ctx, `CREATE ROLE `+role+` NOLOGIN NOSUPERUSER`); err != nil {
		t.Skipf("cannot create scratch role (needs CREATEROLE): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DROP OWNED BY `+role)
		_, _ = pool.Exec(ctx, `DROP ROLE IF EXISTS `+role)
	})
	if _, err := pool.Exec(ctx, `GRANT `+"proxy"+` TO `+role); err != nil {
		t.Fatalf("grant proxy role to scratch role: %v", err)
	}
	cfg, err := pgxpool.ParseConfig(pool.Config().ConnString())
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	// 连接一建立就是这个非超级用户角色。必须用连接参数而不是 SET LOCAL ROLE：
	// Repository 的每个方法自己 Begin，谁也替它包事务。
	cfg.ConnConfig.RuntimeParams["role"] = role
	scoped, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("scoped pool: %v", err)
	}
	t.Cleanup(scoped.Close)
	var isSuper bool
	if err := scoped.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&isSuper); err != nil {
		t.Fatalf("probe current role: %v", err)
	}
	if isSuper {
		t.Fatal("scoped pool must not be superuser, otherwise every assertion below is vacuous")
	}
	return scoped
}

// Repository 的方法在**非超级用户**连接上必须照样能用 —— 这条验的是
// withRecipient / withUserAccount 的 GUC 键名和 set_config 真的对。
//
// 没有它的话：GUC 键名写错一个字母 ⇒ 每次调用都读 0 行 / 写被拒，而**所有
// 常规测试照样全绿**（超级用户绕过 RLS），故障要等到真部署才显形。
func TestNotificationRepositoryWorksOnNonSuperuserConnection(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	scoped := requireNonSuperuserPool(t, pool, "repo")
	run := itoa(time.Now().UnixNano())
	recipient := "user_nonsuper_" + run
	other := "user_nonsuper_other_" + run
	repo := NewNotificationRepository(scoped)

	// 先用超级用户种两行：一行给 recipient，一行给别人。
	seed := func(id, who string) {
		if _, err := pool.Exec(ctx, `
			INSERT INTO notification.inbox_items (id,recipient_id,type,title,body,deep_link,read,created_at)
			VALUES ($1,$2,'Probe','t','b',NULL,false,now())`, id, who); err != nil {
			t.Fatalf("seed inbox item: %v", err)
		}
	}
	seed("inbox_ns_own_"+run, recipient)
	seed("inbox_ns_other_"+run, other)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notification.inbox_items WHERE id = ANY($1)`, []string{"inbox_ns_own_" + run, "inbox_ns_other_" + run})
	})

	items, err := repo.ListInbox(ctx, recipient, false)
	if err != nil {
		t.Fatalf("ListInbox on a non-superuser connection must work: %v", err)
	}
	if len(items) != 1 || items[0].RecipientID != recipient {
		t.Fatalf("ListInbox must return exactly this recipient's row, got %+v", items)
	}

	// 写入自己的收件箱（管线的工作面）：必须成功。
	created, err := repo.InsertInboxItemOnce(ctx, notification.InboxItem{
		ID: "inbox_ns_new_" + run, RecipientID: recipient, Type: "Probe", Title: "新通知", CreatedAt: time.Now().UTC(),
	})
	if err != nil || !created {
		t.Fatalf("InsertInboxItemOnce must succeed on a non-superuser connection: created=%v err=%v", created, err)
	}

	// 幂等：同一个 id 再来一次必须 created=false（管线靠这个不重复推送）。
	created, err = repo.InsertInboxItemOnce(ctx, notification.InboxItem{
		ID: "inbox_ns_new_" + run, RecipientID: recipient, Type: "Probe", Title: "新通知", CreatedAt: time.Now().UTC(),
	})
	if err != nil || created {
		t.Fatalf("replay must report created=false, got created=%v err=%v", created, err)
	}

	// 标已读 + 深链归属，两者都走同一条 GUC 路径。
	if err := repo.MarkRead(ctx, "inbox_ns_new_"+run, recipient); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	owns, err := repo.HasInboxDeepLink(ctx, recipient, "/probe/ns/"+run)
	if err != nil {
		t.Fatalf("HasInboxDeepLink: %v", err)
	}
	if owns {
		t.Fatal("a deep link nobody was sent must not count as owned")
	}

	// 设备令牌：同一套机制的另一张表。
	tok := notification.DeviceToken{
		ID: "dtok_ns_" + run, UserAccountID: recipient, DeviceID: "dev_ns_" + run,
		Platform: "IOS", Token: "apns_ns", Status: "ACTIVE", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := repo.UpsertDeviceToken(ctx, tok); err != nil {
		t.Fatalf("UpsertDeviceToken: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM notification.device_tokens WHERE id=$1`, tok.ID) })
	tokens, err := repo.ListDeviceTokens(ctx, recipient)
	if err != nil || len(tokens) != 1 {
		t.Fatalf("ListDeviceTokens must return the token, got %d err=%v", len(tokens), err)
	}
	// 退役：173 之后必须带 UserAccountID 才声明得了作用域。
	if err := repo.DeactivateDeviceToken(ctx, tok); err != nil {
		t.Fatalf("DeactivateDeviceToken: %v", err)
	}
	tokens, err = repo.ListDeviceTokens(ctx, recipient)
	if err != nil {
		t.Fatal(err)
	}
	if len(tokens) != 0 {
		t.Fatalf("a retired token must not remain a push target, got %d", len(tokens))
	}
}
