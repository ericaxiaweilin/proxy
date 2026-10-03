package notification

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// NOTIF-PUSH-APNS-001 —— 真的 APNs 客户端。
//
// 只用标准库：HTTP/2 由 net/http 在 TLS 上自动协商，ES256 签名用 crypto/ecdsa，
// JWT 是 base64url(header).base64url(claims).base64url(sig) —— 没有引入依赖。
//
// 之前这条链路完全不存在：`PushProvider` 只有 `LogPushProvider`，`Push()` 打印一行
// 「notification push: recipient=…」就返回 nil。那条日志读起来像「推送发出去了」，
// 但它从来没有出过这台机器 —— 这是最坏的一种假象：日志说成功，用户什么都没收到。

const (
	apnsProductionHost = "https://api.push.apple.com"
	apnsSandboxHost    = "https://api.sandbox.push.apple.com"
	// Apple 允许 JWT 最多 1 小时；官方建议不要比 20 分钟更频繁地换，
	// 否则会吃到 TooManyProviderTokenUpdates。50 分钟留了余量。
	apnsTokenTTL = 50 * time.Minute
)

// httpDoer 让发送器可以脱离网络单测（注入一个假 client 就能断言请求长什么样）。
type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// ErrDeviceTokenUnregistered 表示 APNs/FCM 明确告诉你这个令牌已经失效
// （用户卸载、换机、重置）。**和普通发送失败不同**：重试永远不会成功，
// 正确动作是把令牌退役，而不是下次再试一遍。
var ErrDeviceTokenUnregistered = errors.New("notification: device token is no longer registered")

// APNsSender 通过 HTTP/2 把一条消息推到一台 iOS 设备。
type APNsSender struct {
	keyID  string
	teamID string
	topic  string
	host   string
	key    *ecdsa.PrivateKey
	client httpDoer
	now    func() time.Time

	mu       sync.Mutex
	cached   string
	cachedAt time.Time
}

// NewAPNsSenderFromConfig 读 .p8 私钥并建发送器。
//
// 读文件放在这里而不是 PushConfigFromEnv：让「没配」和「配了但文件读不了」
// 是两种可区分的错误。后者必须让启动失败（或者至少响亮地记日志），
// 静默降级成日志推送会让人以为推送已经上线了。
func NewAPNsSenderFromConfig(cfg PushConfig) (*APNsSender, error) {
	if !cfg.APNsConfigured() {
		return nil, errors.New("notification: APNs is not fully configured (need APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC)")
	}
	raw, err := os.ReadFile(cfg.APNsKeyPath)
	if err != nil {
		return nil, fmt.Errorf("notification: read APNs key %s: %w", cfg.APNsKeyPath, err)
	}
	key, err := parseAPNsKey(raw)
	if err != nil {
		return nil, fmt.Errorf("notification: parse APNs key %s: %w", cfg.APNsKeyPath, err)
	}
	host := apnsProductionHost
	if cfg.APNsSandbox {
		host = apnsSandboxHost
	}
	return &APNsSender{
		keyID: cfg.APNsKeyID, teamID: cfg.APNsTeamID, topic: cfg.APNsTopic,
		host: host, key: key, client: &http.Client{Timeout: 15 * time.Second}, now: time.Now,
	}, nil
}

// parseAPNsKey 解析 Apple 的 .p8（PKCS#8 的 EC 私钥）。
// 显式拒绝非 P-256 的曲线：ES256 这个名字就写死了 P-256，
// 拿 P-384 的钥匙去签会得到一个 Apple 侧看不懂的签名。
func parseAPNsKey(raw []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("not a PEM file")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("expected an EC private key, got %T", parsed)
	}
	if key.Curve.Params().Name != "P-256" {
		return nil, fmt.Errorf("ES256 requires P-256, got %s", key.Curve.Params().Name)
	}
	return key, nil
}

func (s *APNsSender) Send(ctx context.Context, token DeviceToken, msg PushMessage) error {
	if strings.TrimSpace(token.Token) == "" {
		return errors.New("notification: empty device token")
	}
	auth, err := s.providerToken()
	if err != nil {
		return err
	}
	body, err := json.Marshal(apnsPayload(msg))
	if err != nil {
		return err
	}
	url := s.host + "/3/device/" + token.Token
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "bearer "+auth)
	req.Header.Set("apns-topic", s.topic)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("apns-priority", "10")
	req.Header.Set("content-type", "application/json")
	if msg.CollapseKey != "" {
		// 同一类通知在锁屏上替换而不是堆叠。
		req.Header.Set("apns-collapse-id", msg.CollapseKey)
	}
	res, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("notification: apns transport: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		return nil
	}
	reason := readAPNsReason(res.Body)
	// 410 + Unregistered / BadDeviceToken 是「这台设备不再接受推送」，
	// 与「这次网络抖了」必须分开 —— 前者重试永远失败。
	if res.StatusCode == http.StatusGone || reason == "Unregistered" || reason == "BadDeviceToken" {
		return fmt.Errorf("%w: status=%d reason=%s", ErrDeviceTokenUnregistered, res.StatusCode, reason)
	}
	return fmt.Errorf("notification: apns status=%d reason=%s", res.StatusCode, reason)
}

// apnsPayload 是推给 iOS 的 JSON。
//
// deepLink / type 放在 **aps 之外**：aps 里塞自定义键会被 Apple 当成保留字段
// 处理，而顶层自定义键才是官方给客户端读的位置。
func apnsPayload(msg PushMessage) map[string]any {
	alert := map[string]any{"title": msg.Title}
	if msg.Body != "" {
		alert["body"] = msg.Body
	}
	payload := map[string]any{
		"aps": map[string]any{
			"alert": alert,
			"sound": "default",
		},
	}
	if msg.DeepLink != "" {
		payload["deepLink"] = msg.DeepLink
	}
	if msg.Type != "" {
		payload["type"] = msg.Type
	}
	return payload
}

func readAPNsReason(body io.Reader) string {
	raw, err := io.ReadAll(io.LimitReader(body, 4096))
	if err != nil {
		return ""
	}
	var parsed struct {
		Reason string `json:"reason"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return strings.TrimSpace(string(raw))
	}
	return parsed.Reason
}

// providerToken 返回可缓存的 provider JWT。
//
// 每次推送都重新签一个 JWT 会被 Apple 限流（TooManyProviderTokenUpdates），
// 所以这里缓存 50 分钟。
func (s *APNsSender) providerToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if s.cached != "" && now.Sub(s.cachedAt) < apnsTokenTTL {
		return s.cached, nil
	}
	token, err := apnsProviderToken(s.keyID, s.teamID, s.key, now)
	if err != nil {
		return "", err
	}
	s.cached = token
	s.cachedAt = now
	return token, nil
}

// apnsProviderToken 生成 Apple 要的 ES256 JWT。
//
// ES256 的签名是 **raw r||s 各 32 字节**，不是 DER —— 这是最常见的实现错误，
// 用 x509/ecdsa 的默认 DER 编码会被 Apple 拒成 403 InvalidProviderToken，
// 而错误信息完全不会提示是编码问题。
func apnsProviderToken(keyID, teamID string, key *ecdsa.PrivateKey, now time.Time) (string, error) {
	if keyID == "" || teamID == "" {
		return "", errors.New("notification: APNs key id and team id are required")
	}
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": keyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{"iss": teamID, "iat": now.Unix()})
	if err != nil {
		return "", err
	}
	signingInput := base64URL(header) + "." + base64URL(claims)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signingInput + "." + base64URL(sig), nil
}

func base64URL(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
