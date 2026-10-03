package notification

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// NOTIF-PIPELINE-001 —— 管线的行为级钉子。
//
// 这些用例故意**不碰数据库**（走 MemoryRepository）：管线的不变量是
// 「同一个 DedupeKey ⇒ 一行 + 一次推送」，那是逻辑，不是 SQL。SQL 侧的
// ON CONFLICT 由 platform/postgres/notification_integration_test.go 覆盖。
//
// ⚠️ 为什么要单独钉「推送次数」：这条管线之前**两条路径各做一半** ——
// worker 落库不推送、命令推送不幂等。所以「落库正确」和「推送正确」是
// 两个独立的失败面，只断言行数会漏掉「重放推了两条」。

type countingPush struct {
	items []InboxItem
	err   error
}

func (p *countingPush) Push(_ context.Context, item InboxItem) error {
	p.items = append(p.items, item)
	return p.err
}

func newTestPipeline(t *testing.T, push PushProvider) (*Pipeline, *MemoryRepository) {
	t.Helper()
	repo := NewMemoryRepository()
	fixed := clock.NewFixed(time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	return NewPipelineWithClock(repo, push, fixed), repo
}

func TestPipelineEmitWritesOneRowAndPushesOnce(t *testing.T) {
	push := &countingPush{}
	pipeline, repo := newTestPipeline(t, push)

	item, created, err := pipeline.Emit(context.Background(), Notification{
		RecipientID: "user_a", Type: "OrderCreated",
		Title: "订单已成立", Body: "已生成订单，可打卡", DeepLink: "/orders/ord_1",
		DedupeKey: EventDedupeKey("evt_1"),
	})
	if err != nil || !created {
		t.Fatalf("first Emit: created=%v err=%v", created, err)
	}
	if item.ID == "" || item.RecipientID != "user_a" || item.Read {
		t.Fatalf("unexpected item: %+v", item)
	}
	if item.CreatedAt.IsZero() {
		t.Fatal("item must carry the injected clock time, got zero")
	}
	rows, _ := repo.ListInbox(context.Background(), "user_a", false)
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	if len(push.items) != 1 {
		t.Fatalf("want exactly 1 push, got %d", len(push.items))
	}
	if push.items[0].DeepLink != "/orders/ord_1" {
		t.Fatalf("push must carry the deep link, got %q", push.items[0].DeepLink)
	}
}

// 这是整条管线存在的理由：outbox 会**重放**整批事件，重放不能变成第二条通知，
// 更不能变成第二次推送。
func TestPipelineEmitIsIdempotentByDedupeKey(t *testing.T) {
	push := &countingPush{}
	pipeline, repo := newTestPipeline(t, push)
	ctx := context.Background()
	n := Notification{
		RecipientID: "user_a", Type: "OfferCreated", Title: "收到 Offer",
		DedupeKey: EventDedupeKey("evt_replay"),
	}

	first, created, err := pipeline.Emit(ctx, n)
	if err != nil || !created {
		t.Fatalf("first Emit: created=%v err=%v", created, err)
	}
	second, created, err := pipeline.Emit(ctx, n)
	if err != nil {
		t.Fatalf("replay must not error, got %v", err)
	}
	if created {
		t.Fatal("replay must report created=false — otherwise callers cannot tell a retry from a new notification")
	}
	if second.ID != first.ID {
		t.Fatalf("replay must resolve to the same item id: %q vs %q", second.ID, first.ID)
	}
	rows, _ := repo.ListInbox(ctx, "user_a", false)
	if len(rows) != 1 {
		t.Fatalf("replay must not add a row, got %d rows", len(rows))
	}
	if len(push.items) != 1 {
		t.Fatalf("replay must NOT push again — the user would get two identical notifications (got %d)", len(push.items))
	}
}

func TestPipelineEmitDifferentKeysWriteSeparateItems(t *testing.T) {
	push := &countingPush{}
	pipeline, repo := newTestPipeline(t, push)
	ctx := context.Background()

	for _, key := range []string{"evt_a", "evt_b", "evt_c"} {
		if _, created, err := pipeline.Emit(ctx, Notification{
			RecipientID: "user_a", Title: "t", DedupeKey: EventDedupeKey(key),
		}); err != nil || !created {
			t.Fatalf("Emit(%s): created=%v err=%v", key, created, err)
		}
	}
	rows, _ := repo.ListInbox(ctx, "user_a", false)
	if len(rows) != 3 {
		t.Fatalf("three distinct events must be three rows, got %d", len(rows))
	}
	if len(push.items) != 3 {
		t.Fatalf("three distinct events must push three times, got %d", len(push.items))
	}
}

// 缺收件人/标题的通知是永久垃圾（inbox_items 只增不删，收件人为空则谁都读不到），
// 必须在落库**之前**拒掉 —— 断言「一行都没写」而不只是「返回了 error」。
func TestPipelineEmitRejectsIncompleteNotifications(t *testing.T) {
	push := &countingPush{}
	pipeline, repo := newTestPipeline(t, push)
	ctx := context.Background()

	cases := []struct {
		name string
		n    Notification
		want error
	}{
		{"no recipient", Notification{Title: "t", DedupeKey: "k1"}, ErrNotificationRecipientRequired},
		{"blank recipient", Notification{RecipientID: "   ", Title: "t", DedupeKey: "k2"}, ErrNotificationRecipientRequired},
		{"no title", Notification{RecipientID: "user_a", DedupeKey: "k3"}, ErrNotificationTitleRequired},
		{"blank title", Notification{RecipientID: "user_a", Title: "  ", DedupeKey: "k4"}, ErrNotificationTitleRequired},
	}
	for _, tc := range cases {
		if _, created, err := pipeline.Emit(ctx, tc.n); !errors.Is(err, tc.want) || created {
			t.Fatalf("%s: want %v/created=false, got err=%v created=%v", tc.name, tc.want, err, created)
		}
	}
	rows, _ := repo.ListInbox(ctx, "user_a", false)
	if len(rows) != 0 {
		t.Fatalf("rejected notifications must not reach the repository, got %d rows", len(rows))
	}
	if len(push.items) != 0 {
		t.Fatalf("rejected notifications must not push, got %d", len(push.items))
	}
}

// 关掉推送（NOTIFICATION_PUSH=off ⇒ nil provider）不等于关掉通知：
// inbox 行必须照样落库，用户在 App 里还看得到。
func TestPipelineEmitWithoutPushProviderStillPersists(t *testing.T) {
	pipeline, repo := newTestPipeline(t, nil)

	_, created, err := pipeline.Emit(context.Background(), Notification{
		RecipientID: "user_a", Title: "t", DedupeKey: "k",
	})
	if err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	rows, _ := repo.ListInbox(context.Background(), "user_a", false)
	if len(rows) != 1 {
		t.Fatalf("push being disabled must not lose the inbox row, got %d", len(rows))
	}
}

// 推送是 best-effort：通道挂了不能让已经落库的行报错（那样调用方会重试整件事）。
func TestPipelineEmitSurvivesPushFailure(t *testing.T) {
	push := &countingPush{err: errors.New("apns down")}
	pipeline, repo := newTestPipeline(t, push)

	_, created, err := pipeline.Emit(context.Background(), Notification{
		RecipientID: "user_a", Title: "t", DedupeKey: "k",
	})
	if err != nil {
		t.Fatalf("a failing push provider must not fail the emit, got %v", err)
	}
	if !created {
		t.Fatal("the row was written, so created must be true")
	}
	rows, _ := repo.ListInbox(context.Background(), "user_a", false)
	if len(rows) != 1 {
		t.Fatalf("row must survive a push failure, got %d", len(rows))
	}
}

func TestInboxItemIDIsDeterministicAndKeyed(t *testing.T) {
	a := inboxItemID(EventDedupeKey("evt_1"))
	b := inboxItemID(EventDedupeKey("evt_1"))
	c := inboxItemID(EventDedupeKey("evt_2"))
	if a != b {
		t.Fatalf("same dedupe key must yield the same id: %q vs %q", a, b)
	}
	if a == c {
		t.Fatalf("different keys must not collide: %q", a)
	}
	if len(a) != len("inbox_")+32 {
		t.Fatalf("id must be fixed-length so long event ids cannot overflow the primary key: %q", a)
	}
	// 没有 DedupeKey ⇒ 不参与幂等，两次必须不同（否则会静默丢通知）。
	if inboxItemID("") == inboxItemID("") {
		t.Fatal("an empty dedupe key must fall back to a random id, not a constant")
	}
}

// event:/command: 两个前缀是幂等的**唯一**依据 —— 一旦漂移，重放会静默变成
// 两条通知（id 变了就撞不上主键），而界面上完全看不出异常。
func TestDedupeKeyNamespacesDoNotCollide(t *testing.T) {
	if EventDedupeKey("x") == CommandDedupeKey("x") {
		t.Fatal("event and command keys must live in different namespaces")
	}
	if EventDedupeKey("evt_1") != "event:evt_1" || CommandDedupeKey("cmd_1") != "command:cmd_1" {
		t.Fatalf("dedupe key prefixes changed: %q / %q", EventDedupeKey("evt_1"), CommandDedupeKey("cmd_1"))
	}
}

func TestPushProviderFromEnv(t *testing.T) {
	env := func(pairs map[string]string) func(string) string {
		return func(k string) string { return pairs[k] }
	}
	// 关掉就是关掉：返回 nil（真的不推），不是 LogPushProvider。
	for _, off := range []string{"off", "OFF", "disabled", "Disabled", " off "} {
		provider, note := PushProviderFromEnv(env(map[string]string{"NOTIFICATION_PUSH": off}), nil)
		if provider != nil {
			t.Fatalf("NOTIFICATION_PUSH=%q must disable push, got %T", off, provider)
		}
		if !strings.Contains(note, "disabled") {
			t.Fatalf("the disabled case must say so in the startup note, got %q", note)
		}
	}
	// 没配凭据 → 只记日志，而且**日志必须说清楚是「没凭据」**。
	// 上一版三种情况（关掉 / 没凭据 / 真推）的日志长得一样，读起来都像推送已上线。
	for _, on := range []string{"", "log", "on"} {
		provider, note := PushProviderFromEnv(env(map[string]string{"NOTIFICATION_PUSH": on}), nil)
		if provider == nil {
			t.Fatalf("NOTIFICATION_PUSH=%q must keep a provider", on)
		}
		if _, ok := provider.(LogPushProvider); !ok {
			t.Fatalf("with no credentials the provider must be the log-only one, got %T", provider)
		}
		if !strings.Contains(note, "no push credentials") {
			t.Fatalf("the log-only case must admit there are no credentials, got %q", note)
		}
	}
	// 半套 APNs 配置是**配错了**，不是「没配」—— 必须能分辨。
	_, note := PushProviderFromEnv(env(map[string]string{"APNS_KEY_ID": "ABC123"}), nil)
	if !strings.Contains(note, "INCOMPLETE") {
		t.Fatalf("a half-configured APNs must be reported as INCOMPLETE, got %q", note)
	}
	if provider, _ := PushProviderFromEnv(nil, nil); provider == nil {
		t.Fatal("a nil getenv must not disable push")
	}
}

// 配了凭据但**建不起来**（密钥文件不存在）不能静默降级成日志推送 ——
// 那会让人以为推送已经上线。note 里必须带上原因。
func TestPushProviderFromEnvReportsUnusableCredentials(t *testing.T) {
	env := func(k string) string {
		switch k {
		case "APNS_KEY_PATH":
			return "/definitely/not/here/AuthKey.p8"
		case "APNS_KEY_ID":
			return "KEYID123"
		case "APNS_TEAMID", "APNS_TEAM_ID":
			return "TEAM123"
		case "APNS_TOPIC":
			return "com.proxy.app"
		}
		return ""
	}
	provider, note := PushProviderFromEnv(env, nil)
	if _, ok := provider.(LogPushProvider); !ok {
		t.Fatalf("expected the log-only fallback, got %T", provider)
	}
	if !strings.Contains(note, "UNUSABLE") || !strings.Contains(note, "AuthKey.p8") {
		t.Fatalf("the note must say the credentials are unusable and why, got %q", note)
	}
}

// 这条钉的是一个真回归：NewWithPushProvider 以前把 nil 兜成 LogPushProvider，
// 于是 NOTIFICATION_PUSH=off（configuredNotificationPush 返回 nil）**从来没生效过**。
func TestNewWithPushProviderHonoursExplicitNil(t *testing.T) {
	if svc := NewWithPushProvider(NewMemoryRepository(), nil); svc.pipeline.push != nil {
		t.Fatalf("explicit nil must disable push, got %T", svc.pipeline.push)
	}
	// 反过来：不配推送的构造器仍要有默认通道，否则推送会静默消失。
	if svc := NewWithRepository(NewMemoryRepository()); svc.pipeline.push == nil {
		t.Fatal("NewWithRepository must default to the log push provider")
	}
	if svc := New(); svc.pipeline.push == nil {
		t.Fatal("New must default to the log push provider")
	}
}

// 命令面与管线必须是**同一个** repo —— 分叉的话「发完立刻读」会读不到自己刚写的行。
func TestServiceSharesRepositoryWithPipeline(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	ctx := context.Background()

	r := svc.HandleContext(ctx, commandEnvelope("SendInboxNotification", map[string]any{
		"recipientId": "user_a", "title": "t", "body": "b",
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("SendInboxNotification: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	rows, err := repo.ListInbox(ctx, "user_a", false)
	if err != nil || len(rows) != 1 {
		t.Fatalf("the command must write through the shared repository: rows=%d err=%v", len(rows), err)
	}
}

// 同一个 idempotencyKey 重试必须只写一行 —— 这条命令以前用随机 id，
// 重试一次就多一行（对一个超时重发很常见的后台口来说，那是必然发生的）。
func TestSendInboxIsIdempotentPerIdempotencyKey(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	ctx := context.Background()
	payload := map[string]any{"recipientId": "user_a", "title": "t", "body": "b"}

	first := svc.HandleContext(ctx, commandEnvelope("SendInboxNotification", payload))
	second := svc.HandleContext(ctx, commandEnvelope("SendInboxNotification", payload))
	if first.Outcome != "ACCEPTED" || second.Outcome != "ACCEPTED" {
		t.Fatalf("outcomes: %s / %s", first.Outcome, second.Outcome)
	}
	rows, _ := repo.ListInbox(ctx, "user_a", false)
	if len(rows) != 1 {
		t.Fatalf("retrying one command must not write two rows, got %d", len(rows))
	}
	// 重放不发域事件 —— 重试不是「又发生了一件事」。
	if len(second.EventRefs) != 0 {
		t.Fatalf("a replayed command must not emit a second domain event, got %v", second.EventRefs)
	}
	if len(first.EventRefs) != 1 {
		t.Fatalf("the first send must emit exactly one event, got %v", first.EventRefs)
	}
}

// nilInboxRepo 模拟「第三个 Repository 实现」：ListInbox 返回 nil 切片。
// PG 那个实现原来正是这样（已修），内存仓不是。契约不该挂在某一个实现的自觉上。
type nilInboxRepo struct{ *MemoryRepository }

func (nilInboxRepo) ListInbox(context.Context, string, bool) ([]InboxItem, error) { return nil, nil }

// NOTIF-EMPTY-LIST-001（命令面契约）：空收件箱必须编码成 `[]`。
//
// `json.Marshal` 把 nil 切片写成 **`null`**，而客户端读的是
// `Array.isArray(body.items)` ⇒ `null` 让**收件箱为空**的用户看到
// 「通知没取到，下拉重试」的**失败态**，而不是空态。
//
// 这条在设备上就是这个症状。断言的是 operationRef 的**文本**，因为契约就是
// JSON 文本 —— 断言 Go 切片是否为 nil 抓不住「序列化成了 null」这一步。
func TestListInboxEmptyInboxSerialisesAsArray(t *testing.T) {
	svc := NewWithRepository(nilInboxRepo{NewMemoryRepository()})
	r := svc.HandleContext(context.Background(), commandEnvelope("ListInbox", map[string]any{}))

	if r.Outcome != "ACCEPTED" {
		t.Fatalf("ListInbox: outcome=%s err=%+v", r.Outcome, r.Error)
	}
	if strings.Contains(r.OperationRef, `"items":null`) {
		t.Fatalf("empty inbox must not serialise as null — the client throws on null: %s", r.OperationRef)
	}
	if !strings.Contains(r.OperationRef, `"items":[]`) {
		t.Fatalf("empty inbox must serialise as an empty array, got: %s", r.OperationRef)
	}
}

func commandEnvelope(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_fixed_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "ops_001"},
		Principal:      command.Principal{Type: "OPERATOR", ID: "ops_001"},
		Target:         command.Target{Type: "Notification", ID: "ops_001"},
		IdempotencyKey: "idem_fixed_1",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_notif_1",
		RequestedAt:    "2026-10-01T00:00:00Z",
		Payload:        payload,
	}
}
