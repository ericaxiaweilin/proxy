package notification

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// NOTIF-DEEPLINK-001：ResolveDeepLink 必须有**归属**校验。
//
// 改之前它是 `// Simulate permission check … (simplified: allow)`：任何非空
// 字符串都返回 resolved=true。那不是简化，是没有校验 —— 谁都能拿它当
// 枚举预言机逐个试 `/offers/off_xxx`，也能把任意路由塞给客户端去跳。

func seedInbox(t *testing.T, repo *MemoryRepository, recipientID, deepLink string) {
	t.Helper()
	svc := NewWithRepository(repo)
	res := svc.HandleContext(context.Background(), command.Envelope{
		CommandType: "SendInboxNotification",
		Principal:   command.Principal{Type: "INDIVIDUAL", ID: recipientID},
		Actor:       command.Actor{Type: "USER", ID: recipientID},
		Payload: map[string]any{
			"recipientId": recipientID,
			"type":        "OfferCreated",
			"title":       "收到 Offer",
			"body":        "客户已发 Offer",
			"deepLink":    deepLink,
		},
	})
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("seed inbox failed: %+v", res)
	}
}

func resolveEnvelope(actorID, deepLink string) command.Envelope {
	return command.Envelope{
		CommandType: "ResolveDeepLink",
		Principal:   command.Principal{Type: "INDIVIDUAL", ID: actorID},
		Actor:       command.Actor{Type: "USER", ID: actorID},
		Payload:     map[string]any{"deepLink": deepLink},
	}
}

func TestResolveDeepLinkAllowsALinkFromMyOwnInbox(t *testing.T) {
	repo := NewMemoryRepository()
	seedInbox(t, repo, "user_a", "/offers/off_1")
	svc := NewWithRepository(repo)

	res := svc.HandleContext(context.Background(), resolveEnvelope("user_a", "/offers/off_1"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("my own deep link must resolve, got %+v", res)
	}
	if !strings.Contains(res.OperationRef, `"resolved":true`) {
		t.Fatalf("operationRef must carry resolved=true, got %s", res.OperationRef)
	}
}

func TestResolveDeepLinkRejectsSomeoneElsesLink(t *testing.T) {
	repo := NewMemoryRepository()
	// 这条链接是投给 user_a 的（worker 按事件的收件人投递）。
	seedInbox(t, repo, "user_a", "/offers/off_1")
	svc := NewWithRepository(repo)

	// user_b 拿到同一串文本（截图 / 转发 / 猜），来问「这条能跳吗」。
	res := svc.HandleContext(context.Background(), resolveEnvelope("user_b", "/offers/off_1"))
	if res.Outcome != "REJECTED" {
		t.Fatalf("a link that was never delivered to me must not resolve, got %+v", res)
	}
	if res.Error == nil || res.Error.ErrorCode != "DEEPLINK_NOT_OWNED" {
		t.Fatalf("expected DEEPLINK_NOT_OWNED, got %+v", res.Error)
	}
	// 分类必须是授权而不是校验：客户端要靠它区分「你参数写错了」和「这不是你的」。
	if res.Error.Category != "AUTHORIZATION" {
		t.Fatalf("ownership failure must be AUTHORIZATION, got %s", res.Error.Category)
	}
	// 拒绝时**不能**回带 resolved=true，否则客户端解析 operationRef 还是会跳。
	if strings.Contains(res.OperationRef, "true") {
		t.Fatalf("a rejected link must not carry resolved=true, got %s", res.OperationRef)
	}
}

func TestResolveDeepLinkRejectsLinksThatAreNotOursToRoute(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)

	cases := []struct {
		name string
		link string
	}{
		{"外站绝对地址", "https://evil.com/offers/1"},
		{"协议相对地址", "//evil.com/offers/1"},
		{"反斜杠变体", `/\evil.com/offers/1`},
		{"伪协议", "javascript:alert(1)"},
		{"路由表里没有的前缀", "/admin/secret"},
		{"只有前缀没有 id", "/offers/"},
		{"路径穿越", "/offers/../../admin"},
		{"空", ""},
		{"超长", "/offers/" + strings.Repeat("a", 600)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := svc.HandleContext(context.Background(), resolveEnvelope("user_a", c.link))
			if res.Outcome != "REJECTED" {
				t.Fatalf("%q must be rejected, got %+v", c.link, res)
			}
			if res.Error == nil || res.Error.ErrorCode != "INVALID_DEEPLINK" {
				t.Fatalf("%q must fail as INVALID_DEEPLINK, got %+v", c.link, res.Error)
			}
		})
	}
}

// 反向臂：形状白名单不能把**真的**深链一起拒掉。
// worker 的 inboxForEvent 生产这五种前缀，白名单必须和它对齐 ——
// 少一个就是「收到通知点不开」。
func TestResolvableDeepLinkAcceptsEveryPrefixTheWorkerProduces(t *testing.T) {
	produced := []string{
		"/tasks/task_1",
		"/offers/off_1",
		"/orders/ord_1",
		"/vouchers/vch_1",
		"/invitations/inv_1",
	}
	for _, link := range produced {
		if !isResolvableDeepLink(link) {
			t.Fatalf("%q 是 worker 真的会生产的深链，白名单必须认它", link)
		}
	}
}

func TestResolveDeepLinkCannotBeResolvedByAnAnonymousCaller(t *testing.T) {
	repo := NewMemoryRepository()
	// 直接写一行「没有收件人、也没有深链」的坏数据。
	//
	// ⚠️ 不能用 SendInboxNotification 来铺这一行：管线会先把它按
	// ErrNotificationRecipientRequired 拒掉，于是收件箱是空的，测试就变成
	// 「空表当然查不到」—— 把下面的空串守卫删掉它照样绿（第一版就是这么写的，
	// 注入证明当场拆穿）。要钉的是**两个空串互相匹配**这件事，就必须真的
	// 有那一行空行在表里。
	now := time.Now().UTC()
	if _, err := repo.InsertInboxItemOnce(context.Background(), InboxItem{
		ID: "inbox_blank", RecipientID: "", Type: "OfferCreated",
		Title: "无收件人", Body: "……", DeepLink: "", CreatedAt: now,
	}); err != nil {
		t.Fatalf("seed blank row: %v", err)
	}
	svc := NewWithRepository(repo)

	// 空收件人 + 空深链曾经会互相匹配 ⇒「没登录」等于「拥有所有无深链的通知」。
	owned, err := repo.HasInboxDeepLink(context.Background(), "", "")
	if err != nil {
		t.Fatalf("HasInboxDeepLink: %v", err)
	}
	if owned {
		t.Fatal("两个空串绝不能互相匹配")
	}

	res := svc.HandleContext(context.Background(), resolveEnvelope("", "/offers/off_1"))
	if res.Outcome != "REJECTED" {
		t.Fatalf("an anonymous caller must not resolve anything, got %+v", res)
	}
}

// 反向臂：app 自己的 scheme 写法必须和站内路径写法**等价**。
// 库里存的是 `/offers/off_1`（worker 生产），而原生层交上来的是
// `proxy://offers/off_1`（app.json 的 scheme 是 proxy）。只认一种 =
// 「收到通知点不开」。
func TestResolveDeepLinkAcceptsTheAppSchemeForTheSameLink(t *testing.T) {
	repo := NewMemoryRepository()
	seedInbox(t, repo, "user_a", "/offers/off_1")
	svc := NewWithRepository(repo)

	res := svc.HandleContext(context.Background(), resolveEnvelope("user_a", "proxy://offers/off_1"))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("app scheme 形式必须能跳到同一条链接，got %+v", res)
	}
	// 回给客户端的必须是它能路由的形式，不是 `proxy://` 那串原样。
	if !strings.Contains(res.OperationRef, `"deepLink":"/offers/off_1"`) {
		t.Fatalf("回给客户端的应该是归一后的站内路径，got %s", res.OperationRef)
	}
	// 归属仍然按收件人算：换个 scheme 写法也过不了别人的链接。
	res = svc.HandleContext(context.Background(), resolveEnvelope("user_b", "proxy://offers/off_1"))
	if res.Outcome != "REJECTED" || res.Error.ErrorCode != "DEEPLINK_NOT_OWNED" {
		t.Fatalf("换 scheme 不能绕过归属校验，got %+v", res)
	}
	// scheme 后面接外站主机仍然是外站：归一成 `/evil.com/...`，前缀不在白名单里。
	res = svc.HandleContext(context.Background(), resolveEnvelope("user_a", "proxy://evil.com/offers/1"))
	if res.Outcome != "REJECTED" || res.Error.ErrorCode != "INVALID_DEEPLINK" {
		t.Fatalf("proxy:// 后面接主机不能当站内路径，got %+v", res)
	}
}

// fail-closed：查库失败必须**拒绝**，不能因为「查不出来」就放行。
type failingLookupRepo struct{ *MemoryRepository }

func (failingLookupRepo) HasInboxDeepLink(context.Context, string, string) (bool, error) {
	return false, errors.New("pg down")
}

func TestResolveDeepLinkFailsClosedWhenTheOwnershipLookupErrors(t *testing.T) {
	svc := NewWithRepository(failingLookupRepo{NewMemoryRepository()})
	res := svc.HandleContext(context.Background(), resolveEnvelope("user_a", "/offers/off_1"))
	if res.Outcome != "REJECTED" {
		t.Fatalf("a lookup failure must not resolve, got %+v", res)
	}
	if res.Error == nil || res.Error.ErrorCode != "DEEPLINK_LOOKUP_FAILED" {
		t.Fatalf("expected DEEPLINK_LOOKUP_FAILED, got %+v", res.Error)
	}
}

// 归属校验必须按**收件人**过滤，不是「表里存在这串文本就算数」。
// 少了 recipient 这一半，任何人都能拿别人的链接过闸。
func TestHasInboxDeepLinkIsScopedToTheRecipient(t *testing.T) {
	repo := NewMemoryRepository()
	seedInbox(t, repo, "user_a", "/offers/off_1")

	ok, err := repo.HasInboxDeepLink(context.Background(), "user_a", "/offers/off_1")
	if err != nil || !ok {
		t.Fatalf("owner must match: ok=%v err=%v", ok, err)
	}
	ok, err = repo.HasInboxDeepLink(context.Background(), "user_b", "/offers/off_1")
	if err != nil || ok {
		t.Fatalf("non-owner must not match: ok=%v err=%v", ok, err)
	}
	ok, err = repo.HasInboxDeepLink(context.Background(), "user_a", "/offers/off_2")
	if err != nil || ok {
		t.Fatalf("a link nobody was sent must not match: ok=%v err=%v", ok, err)
	}
}
