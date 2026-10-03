package notification

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"
)

// NOTIF-PUSH-001 —— 推送链路的钉子。
//
// 这些用例全部**离线**跑：假 lister + 假 sender 钉分发逻辑，假 httpDoer 钉真实
// 发送器**发出的那个请求**长什么样（URL / header / body）。没有网络也能证明
// 「APNs 请求带对了 topic 和 collapse-id」「JWT 用的是 raw r||s 而不是 DER」——
// 后者是 ES256 最常见的实现错误，而 Apple 的报错完全不会提示是编码问题。
//
// 为什么值得这么细：这条链路此前**完全不存在**（只有 LogPushProvider 打印一行
// 「notification push: recipient=…」）。那行日志读起来像推送发出去了，
// 但它从来没出过这台机器。

type fakeTokenLister struct {
	tokens  []DeviceToken
	err     error
	retired []string
}

func (f *fakeTokenLister) ListDeviceTokens(_ context.Context, user string) ([]DeviceToken, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := []DeviceToken{}
	for _, t := range f.tokens {
		if t.UserAccountID == user {
			out = append(out, t)
		}
	}
	return out, nil
}

func (f *fakeTokenLister) DeactivateDeviceToken(_ context.Context, id string) error {
	f.retired = append(f.retired, id)
	return nil
}

type recordingSender struct {
	sent []DeviceToken
	msgs []PushMessage
	err  error
}

func (s *recordingSender) Send(_ context.Context, t DeviceToken, m PushMessage) error {
	s.sent = append(s.sent, t)
	s.msgs = append(s.msgs, m)
	return s.err
}

func inboxFor(recipient string) InboxItem {
	return InboxItem{ID: "inbox_1", RecipientID: recipient, Type: "OfferCreated", Title: "收到 Offer", Body: "客户已发 Offer", DeepLink: "/offers/off_1"}
}

func TestDispatcherRoutesEachDeviceToItsPlatformSender(t *testing.T) {
	lister := &fakeTokenLister{tokens: []DeviceToken{
		{ID: "dt_ios1", UserAccountID: "user_a", Platform: "IOS", Token: "apns_1", Status: "ACTIVE"},
		{ID: "dt_ios2", UserAccountID: "user_a", Platform: "IOS", Token: "apns_2", Status: "ACTIVE"},
		{ID: "dt_and1", UserAccountID: "user_a", Platform: "ANDROID", Token: "fcm_1", Status: "ACTIVE"},
		{ID: "dt_other", UserAccountID: "user_b", Platform: "IOS", Token: "apns_x", Status: "ACTIVE"},
	}}
	ios := &recordingSender{}
	android := &recordingSender{}
	d := NewPushDispatcher(lister, ios, android)

	if err := d.Push(context.Background(), inboxFor("user_a")); err != nil {
		t.Fatalf("Push: %v", err)
	}
	if len(ios.sent) != 2 {
		t.Fatalf("both iOS devices must get the push, got %d", len(ios.sent))
	}
	if len(android.sent) != 1 {
		t.Fatalf("the Android device must get the push, got %d", len(android.sent))
	}
	// 别的收件人的设备**绝不能**被推 —— 这是最容易写错的地方（忘了按收件人过滤）。
	for _, tok := range append(append([]DeviceToken{}, ios.sent...), android.sent...) {
		if tok.UserAccountID != "user_a" {
			t.Fatalf("cross-recipient push: %+v", tok)
		}
	}
	// 消息内容要和 inbox 一致，且带上 deep link（客户端靠它决定点开去哪）。
	msg := ios.msgs[0]
	if msg.Title != "收到 Offer" || msg.DeepLink != "/offers/off_1" || msg.Type != "OfferCreated" {
		t.Fatalf("push message must mirror the inbox item, got %+v", msg)
	}
}

func TestDispatcherWithNoDevicesIsNotAnError(t *testing.T) {
	d := NewPushDispatcher(&fakeTokenLister{}, &recordingSender{}, &recordingSender{})
	// 绝大多数用户还没注册设备令牌 —— 那是「没得推」，不是失败。
	// 当成错误会让管线日志被噪音淹没，真正的失败反而看不见。
	if err := d.Push(context.Background(), inboxFor("user_nobody")); err != nil {
		t.Fatalf("no devices must be a silent no-op, got %v", err)
	}
}

func TestDispatcherOneFailedDeviceDoesNotBlockTheOthers(t *testing.T) {
	lister := &fakeTokenLister{tokens: []DeviceToken{
		{ID: "dt_1", UserAccountID: "user_a", Platform: "IOS", Token: "t1", Status: "ACTIVE"},
		{ID: "dt_2", UserAccountID: "user_a", Platform: "ANDROID", Token: "t2", Status: "ACTIVE"},
	}}
	ios := &recordingSender{err: errors.New("apns down")}
	android := &recordingSender{}
	d := NewPushDispatcher(lister, ios, android)

	err := d.Push(context.Background(), inboxFor("user_a"))
	if err == nil {
		t.Fatal("a partial failure must still be reported")
	}
	if len(android.sent) != 1 {
		t.Fatal("a failing iOS send must not stop the Android send — the user has both devices")
	}
	// 「2 台里推成 1 台」和「一台都没推成」必须能区分，否则排障时无从下手。
	if !strings.Contains(err.Error(), "1/2") {
		t.Fatalf("the error must carry the delivered/total counts, got %v", err)
	}
}

func TestDispatcherDoesNotGuessAnUnknownPlatform(t *testing.T) {
	lister := &fakeTokenLister{tokens: []DeviceToken{
		{ID: "dt_web", UserAccountID: "user_a", Platform: "WEB", Token: "t", Status: "ACTIVE"},
	}}
	ios := &recordingSender{}
	android := &recordingSender{}
	d := NewPushDispatcher(lister, ios, android)

	err := d.Push(context.Background(), inboxFor("user_a"))
	if err == nil {
		t.Fatal("an unknown platform must be reported, not silently skipped")
	}
	// 猜 IOS 会把一个 WEB 令牌发给 APNs，换来一个看不懂的 400。
	if len(ios.sent) != 0 || len(android.sent) != 0 {
		t.Fatal("an unknown platform must not be routed to any sender")
	}
}

func TestDispatcherRetiresUnregisteredTokens(t *testing.T) {
	lister := &fakeTokenLister{tokens: []DeviceToken{
		{ID: "dt_dead", UserAccountID: "user_a", Platform: "IOS", Token: "t", Status: "ACTIVE"},
	}}
	ios := &recordingSender{err: ErrDeviceTokenUnregistered}
	d := NewPushDispatcher(lister, ios, &recordingSender{})

	_ = d.Push(context.Background(), inboxFor("user_a"))
	// 用户卸载后那条令牌永远推不通。不退役就每次推送都为它白跑一趟，
	// 日志里堆满 410 而没有一步会去修它。
	if len(lister.retired) != 1 || lister.retired[0] != "dt_dead" {
		t.Fatalf("an unregistered token must be retired, got %v", lister.retired)
	}
}

func TestDispatcherDoesNotRetireTokensOnATransientFailure(t *testing.T) {
	// 反向臂：APNs 抖一下（500 / 网络超时）和「令牌真的死了」是两回事。
	// 退役是**不可逆**的（status='INACTIVE'），把瞬时故障当成死令牌 =
	// 用户从此再也收不到推送，而且没有任何一步会去修它。
	lister := &fakeTokenLister{tokens: []DeviceToken{
		{ID: "dt_alive", UserAccountID: "user_a", Platform: "IOS", Token: "t", Status: "ACTIVE"},
	}}
	ios := &recordingSender{err: errors.New("apns: status=500 reason=")}
	d := NewPushDispatcher(lister, ios, &recordingSender{})

	_ = d.Push(context.Background(), inboxFor("user_a"))
	if len(lister.retired) != 0 {
		t.Fatalf("a transient send failure must never retire a live token, got %v", lister.retired)
	}
}

func TestDispatcherSurfacesListerFailure(t *testing.T) {
	d := NewPushDispatcher(&fakeTokenLister{err: errors.New("pg down")}, &recordingSender{}, &recordingSender{})
	err := d.Push(context.Background(), inboxFor("user_a"))
	if err == nil || !strings.Contains(err.Error(), "pg down") {
		t.Fatalf("a token lookup failure must be surfaced with its cause, got %v", err)
	}
}

// collapse key 让同一类通知在锁屏上**替换**而不是堆叠。
// 带收件人是必须的：不带的话 A 的「订单已成立」会把 B 的顶掉。
func TestCollapseKeyScopesToRecipientAndType(t *testing.T) {
	a := collapseKeyFor(InboxItem{RecipientID: "user_a", Type: "OrderCreated"})
	b := collapseKeyFor(InboxItem{RecipientID: "user_b", Type: "OrderCreated"})
	if a == b {
		t.Fatalf("different recipients must not share a collapse key: %q", a)
	}
	if collapseKeyFor(InboxItem{RecipientID: "user_a"}) != "" {
		t.Fatal("no type means no collapse key — an empty key must not collapse everything together")
	}
}

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

func testP256KeyPEM(t *testing.T) ([]byte, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), key
}

func TestAPNsProviderTokenIsAValidES256JWT(t *testing.T) {
	_, key := testP256KeyPEM(t)
	now := time.Unix(1780000000, 0)
	token, err := apnsProviderToken("KEYID123", "TEAM123", key, now)
	if err != nil {
		t.Fatalf("apnsProviderToken: %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("a JWT has three segments, got %d", len(parts))
	}

	headerRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatalf("header is not base64url: %v", err)
	}
	var header map[string]string
	if err := json.Unmarshal(headerRaw, &header); err != nil {
		t.Fatalf("header is not JSON: %v", err)
	}
	if header["alg"] != "ES256" || header["kid"] != "KEYID123" {
		t.Fatalf("bad header: %+v", header)
	}

	claimsRaw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]any
	if err := json.Unmarshal(claimsRaw, &claims); err != nil {
		t.Fatalf("claims are not JSON: %v", err)
	}
	if claims["iss"] != "TEAM123" {
		t.Fatalf("iss must be the team id, got %v", claims["iss"])
	}
	if int64(claims["iat"].(float64)) != now.Unix() {
		t.Fatalf("iat must be the signing time, got %v", claims["iat"])
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatalf("signature is not base64url: %v", err)
	}
	// ES256 的签名是 raw r||s 各 32 字节 = 64。用 ecdsa 默认的 DER 编码
	// 会被 Apple 拒成 403 InvalidProviderToken，而报错完全不会提示是编码问题。
	// DER 的长度会随 r/s 的高位变化（70~72 字节），所以长度就是判据。
	if len(sig) != 64 {
		t.Fatalf("ES256 signature must be raw r||s (64 bytes), got %d — DER encoding would be rejected by Apple", len(sig))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(&key.PublicKey, digest[:], r, s) {
		t.Fatal("the signature must verify against the public key")
	}
}

func TestAPNsProviderTokenRejectsMissingIdentifiers(t *testing.T) {
	_, key := testP256KeyPEM(t)
	if _, err := apnsProviderToken("", "TEAM", key, time.Now()); err == nil {
		t.Fatal("a missing key id must be rejected")
	}
	if _, err := apnsProviderToken("KEY", "", key, time.Now()); err == nil {
		t.Fatal("a missing team id must be rejected")
	}
}

func TestParseAPNsKeyRejectsWrongKeyTypes(t *testing.T) {
	if _, err := parseAPNsKey([]byte("not pem at all")); err == nil {
		t.Fatal("a non-PEM file must be rejected")
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa: %v", err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(rsaKey)
	rsaPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if _, err := parseAPNsKey(rsaPEM); err == nil {
		t.Fatal("an RSA key must be rejected — APNs provider tokens are ES256")
	}
	p384, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		t.Fatalf("generate p384: %v", err)
	}
	der384, _ := x509.MarshalPKCS8PrivateKey(p384)
	if _, err := parseAPNsKey(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der384})); err == nil {
		t.Fatal("a P-384 key must be rejected — ES256 names P-256")
	}
}

type fakeDoer struct {
	status int
	body   string
	doErr  error
	reqs   []*http.Request
	bodies []string
	calls  int
}

func (d *fakeDoer) Do(req *http.Request) (*http.Response, error) {
	d.calls++
	d.reqs = append(d.reqs, req)
	raw, _ := io.ReadAll(req.Body)
	d.bodies = append(d.bodies, string(raw))
	if d.doErr != nil {
		return nil, d.doErr
	}
	return &http.Response{
		StatusCode: d.status,
		Body:       io.NopCloser(strings.NewReader(d.body)),
		Header:     make(http.Header),
	}, nil
}

func newTestAPNsSender(t *testing.T, doer httpDoer) *APNsSender {
	t.Helper()
	_, key := testP256KeyPEM(t)
	return &APNsSender{
		keyID: "KEYID123", teamID: "TEAM123", topic: "com.proxy.creator.dev",
		host: apnsProductionHost, key: key, client: doer,
		now: func() time.Time { return time.Unix(1780000000, 0) },
	}
}

func TestAPNsSendBuildsTheAppleRequest(t *testing.T) {
	doer := &fakeDoer{status: 200}
	sender := newTestAPNsSender(t, doer)
	token := DeviceToken{ID: "dt_1", Platform: "IOS", Token: "device-token-abc"}

	err := sender.Send(context.Background(), token, PushMessage{
		Title: "订单已成立", Body: "已生成订单，可打卡", DeepLink: "/orders/ord_1",
		Type: "OrderCreated", CollapseKey: "OrderCreated:user_a",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if doer.calls != 1 {
		t.Fatalf("expected exactly one request, got %d", doer.calls)
	}
	req := doer.reqs[0]
	if got, want := req.URL.String(), apnsProductionHost+"/3/device/device-token-abc"; got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
	for header, want := range map[string]string{
		"apns-topic":       "com.proxy.creator.dev",
		"apns-push-type":   "alert",
		"apns-priority":    "10",
		"apns-collapse-id": "OrderCreated:user_a",
	} {
		if got := req.Header.Get(header); got != want {
			t.Fatalf("%s = %q, want %q", header, got, want)
		}
	}
	if !strings.HasPrefix(req.Header.Get("authorization"), "bearer ") {
		t.Fatalf("authorization must be a bearer token, got %q", req.Header.Get("authorization"))
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(doer.bodies[0]), &payload); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	aps, ok := payload["aps"].(map[string]any)
	if !ok {
		t.Fatalf("body must have an aps dictionary, got %v", payload)
	}
	alert := aps["alert"].(map[string]any)
	if alert["title"] != "订单已成立" || alert["body"] != "已生成订单，可打卡" {
		t.Fatalf("alert must carry title and body, got %v", alert)
	}
	if aps["sound"] != "default" {
		t.Fatalf("expected a default sound, got %v", aps["sound"])
	}
	// deepLink / type 必须在 **aps 之外** —— aps 里是 Apple 的保留字段。
	if payload["deepLink"] != "/orders/ord_1" || payload["type"] != "OrderCreated" {
		t.Fatalf("deepLink/type must sit outside aps, got %v", payload)
	}
}

func TestAPNsSendClassifiesDeadTokens(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"410 Gone", 410, ""},
		{"Unregistered", 400, `{"reason":"Unregistered"}`},
		{"BadDeviceToken", 400, `{"reason":"BadDeviceToken"}`},
	} {
		doer := &fakeDoer{status: tc.status, body: tc.body}
		sender := newTestAPNsSender(t, doer)
		err := sender.Send(context.Background(), DeviceToken{ID: "d", Platform: "IOS", Token: "t"}, PushMessage{Title: "x"})
		// 和「这次网络抖了」分开：失效令牌重试**永远**失败，正确动作是退役它。
		if !errors.Is(err, ErrDeviceTokenUnregistered) {
			t.Fatalf("%s must map to ErrDeviceTokenUnregistered, got %v", tc.name, err)
		}
	}
	// 反向臂：一个普通 500 不许被当成失效令牌，否则一次 APNs 抖动会把
	// 所有健康令牌退役掉。
	doer := &fakeDoer{status: 500, body: `{"reason":"InternalServerError"}`}
	sender := newTestAPNsSender(t, doer)
	err := sender.Send(context.Background(), DeviceToken{ID: "d", Platform: "IOS", Token: "t"}, PushMessage{Title: "x"})
	if err == nil || errors.Is(err, ErrDeviceTokenUnregistered) {
		t.Fatalf("a 500 must be a plain failure, got %v", err)
	}
}

func TestAPNsReusesTheProviderToken(t *testing.T) {
	doer := &fakeDoer{status: 200}
	sender := newTestAPNsSender(t, doer)
	token := DeviceToken{ID: "d", Platform: "IOS", Token: "t"}
	for i := 0; i < 3; i++ {
		if err := sender.Send(context.Background(), token, PushMessage{Title: "x"}); err != nil {
			t.Fatalf("Send[%d]: %v", i, err)
		}
	}
	first := doer.reqs[0].Header.Get("authorization")
	for i, req := range doer.reqs {
		// 每次推送重签一个 JWT 会被 Apple 限流（TooManyProviderTokenUpdates）。
		if got := req.Header.Get("authorization"); got != first {
			t.Fatalf("request %d used a different provider token — the JWT must be cached", i)
		}
	}
}

func TestAPNsSendRejectsAnEmptyTokenWithoutCallingTheNetwork(t *testing.T) {
	doer := &fakeDoer{status: 200}
	sender := newTestAPNsSender(t, doer)
	if err := sender.Send(context.Background(), DeviceToken{ID: "d", Platform: "IOS", Token: "  "}, PushMessage{Title: "x"}); err == nil {
		t.Fatal("an empty device token must be rejected")
	}
	if doer.calls != 0 {
		t.Fatal("an empty token must not produce a network call")
	}
}

// ---------------------------------------------------------------------------
// FCM
// ---------------------------------------------------------------------------

func testServiceAccountPEM(t *testing.T) ([]byte, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), key
}

func TestServiceAccountAssertionIsAValidRS256JWT(t *testing.T) {
	pemBytes, key := testServiceAccountPEM(t)
	parsed, err := parseServiceAccountKey(pemBytes)
	if err != nil {
		t.Fatalf("parseServiceAccountKey: %v", err)
	}
	now := time.Unix(1780000000, 0)
	tokenURI := "https://oauth2.googleapis.com/token"
	assertion, err := serviceAccountAssertion("svc@project.iam.gserviceaccount.com", tokenURI, parsed, now)
	if err != nil {
		t.Fatalf("serviceAccountAssertion: %v", err)
	}
	parts := strings.Split(assertion, ".")
	if len(parts) != 3 {
		t.Fatalf("expected 3 JWT segments, got %d", len(parts))
	}
	claimsRaw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]any
	if err := json.Unmarshal(claimsRaw, &claims); err != nil {
		t.Fatalf("claims are not JSON: %v", err)
	}
	if claims["iss"] != "svc@project.iam.gserviceaccount.com" || claims["aud"] != tokenURI || claims["scope"] != fcmScope {
		t.Fatalf("bad claims: %v", claims)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], sig); err != nil {
		t.Fatalf("RS256 signature must verify: %v", err)
	}
}

func TestFCMEnvelopeCarriesDataAndCollapseKey(t *testing.T) {
	env := fcmEnvelope("device-token", PushMessage{
		Title: "订单已成立", Body: "已生成订单", DeepLink: "/orders/1", Type: "OrderCreated", CollapseKey: "OrderCreated:user_a",
	})
	message := env["message"].(map[string]any)
	if message["token"] != "device-token" {
		t.Fatalf("bad token: %v", message["token"])
	}
	notification := message["notification"].(map[string]any)
	if notification["title"] != "订单已成立" || notification["body"] != "已生成订单" {
		t.Fatalf("bad notification: %v", notification)
	}
	data := message["data"].(map[string]string)
	if data["deepLink"] != "/orders/1" || data["type"] != "OrderCreated" {
		t.Fatalf("data must carry deepLink/type, got %v", data)
	}
	android := message["android"].(map[string]any)
	if android["collapse_key"] != "OrderCreated:user_a" || android["priority"] != "HIGH" {
		t.Fatalf("bad android block: %v", android)
	}
	// 没有 deep link 时不该塞一个空的 data（FCM 不接受空字符串以外的值，
	// 而空 data 会让客户端读到 undefined）。
	bare := fcmEnvelope("t", PushMessage{Title: "x"})["message"].(map[string]any)
	if _, present := bare["data"]; present {
		t.Fatal("an empty data block must be omitted, not sent as an empty object")
	}
}

func TestFCMSendClassifiesUnregisteredTokens(t *testing.T) {
	body := `{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}`
	doer := &fakeDoer{status: 404, body: body}
	sender := &FCMSender{projectID: "p", clientEmail: "e", tokenURI: "https://oauth2.googleapis.com/token", key: nil, client: doer, now: time.Now}
	// 这条会先走 token exchange，所以用一个会在 exchange 阶段就失败的假 doer 不合适；
	// 直接测分类函数本身。
	if code := readFCMErrorCode([]byte(body)); code != "UNREGISTERED" {
		t.Fatalf("readFCMErrorCode = %q, want UNREGISTERED", code)
	}
	_ = sender
}
