package notification

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// NOTIF-PUSH-FCM-001 —— 真的 FCM (HTTP v1) 客户端，同样只用标准库。
//
// FCM v1 不接受长期服务器密钥，必须先用 service account 换一个 OAuth2 access token
// （jwt-bearer grant）。这套流程用 crypto/rsa + net/url 就能写完，不需要 SDK。
//
// 和 APNs 一样，这条链路此前完全不存在。Android 侧因此从来没有收到过任何推送。

const (
	fcmSendEndpoint = "https://fcm.googleapis.com/v1/projects/%s/messages:send"
	fcmScope        = "https://www.googleapis.com/auth/firebase.messaging"
	// access token 有效期通常 3600s；提前 60s 换，避免边界上刚好过期。
	fcmTokenSkew = 60 * time.Second
)

type fcmServiceAccount struct {
	ProjectID   string `json:"project_id"`
	PrivateKey  string `json:"private_key"`
	ClientEmail string `json:"client_email"`
	TokenURI    string `json:"token_uri"`
}

// FCMSender 通过 FCM HTTP v1 把一条消息推到一台 Android 设备。
type FCMSender struct {
	projectID   string
	clientEmail string
	tokenURI    string
	key         *rsa.PrivateKey
	client      httpDoer
	now         func() time.Time

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

// NewFCMSenderFromConfig 读 service account JSON 并建发送器。
func NewFCMSenderFromConfig(cfg PushConfig) (*FCMSender, error) {
	if !cfg.FCMConfigured() {
		return nil, errors.New("notification: FCM is not configured (need FCM_SERVICE_ACCOUNT_PATH)")
	}
	raw, err := os.ReadFile(cfg.FCMServiceAccountPath)
	if err != nil {
		return nil, fmt.Errorf("notification: read FCM service account %s: %w", cfg.FCMServiceAccountPath, err)
	}
	var sa fcmServiceAccount
	if err := json.Unmarshal(raw, &sa); err != nil {
		return nil, fmt.Errorf("notification: parse FCM service account %s: %w", cfg.FCMServiceAccountPath, err)
	}
	if sa.ProjectID == "" || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, fmt.Errorf("notification: FCM service account %s is missing project_id/client_email/private_key", cfg.FCMServiceAccountPath)
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	key, err := parseServiceAccountKey([]byte(sa.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("notification: parse FCM private key: %w", err)
	}
	return &FCMSender{
		projectID: sa.ProjectID, clientEmail: sa.ClientEmail, tokenURI: sa.TokenURI,
		key: key, client: &http.Client{Timeout: 15 * time.Second}, now: time.Now,
	}, nil
}

func parseServiceAccountKey(raw []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("not a PEM file")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("expected an RSA private key, got %T", parsed)
	}
	return key, nil
}

func (s *FCMSender) Send(ctx context.Context, token DeviceToken, msg PushMessage) error {
	if strings.TrimSpace(token.Token) == "" {
		return errors.New("notification: empty device token")
	}
	access, err := s.accessTokenFor(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(fcmEnvelope(token.Token, msg))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf(fcmSendEndpoint, s.projectID), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+access)
	req.Header.Set("content-type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("notification: fcm transport: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	// FCM 把「令牌已失效」编码在 error.details[].errorCode 里，
	// 而不是靠 HTTP 状态本身。只按状态码判断会把 UNREGISTERED 当成
	// 「一次普通失败」，于是每次推送都为同一台已卸载的设备白跑一趟。
	if code := readFCMErrorCode(raw); code == "UNREGISTERED" || code == "INVALID_ARGUMENT" && strings.Contains(string(raw), "registration token") {
		return fmt.Errorf("%w: status=%d errorCode=%s", ErrDeviceTokenUnregistered, res.StatusCode, code)
	}
	return fmt.Errorf("notification: fcm status=%d body=%s", res.StatusCode, strings.TrimSpace(string(raw)))
}

func fcmEnvelope(token string, msg PushMessage) map[string]any {
	message := map[string]any{
		"token":        token,
		"notification": map[string]any{"title": msg.Title, "body": msg.Body},
	}
	data := map[string]string{}
	if msg.DeepLink != "" {
		data["deepLink"] = msg.DeepLink
	}
	if msg.Type != "" {
		data["type"] = msg.Type
	}
	if len(data) > 0 {
		message["data"] = data
	}
	android := map[string]any{"priority": "HIGH"}
	if msg.CollapseKey != "" {
		android["collapse_key"] = msg.CollapseKey
	}
	message["android"] = android
	return map[string]any{"message": message}
}

func readFCMErrorCode(raw []byte) string {
	var parsed struct {
		Error struct {
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return ""
	}
	for _, d := range parsed.Error.Details {
		if d.ErrorCode != "" {
			return d.ErrorCode
		}
	}
	return ""
}

// accessTokenFor 换/取缓存的 OAuth2 access token。
func (s *FCMSender) accessTokenFor(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.accessToken != "" && s.now().Before(s.expiresAt) {
		token := s.accessToken
		s.mu.Unlock()
		return token, nil
	}
	s.mu.Unlock()

	now := s.now()
	assertion, err := serviceAccountAssertion(s.clientEmail, s.tokenURI, s.key, now)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	res, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("notification: fcm token exchange: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("notification: fcm token exchange status=%d body=%s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("notification: fcm token response: %w", err)
	}
	if parsed.AccessToken == "" {
		return "", errors.New("notification: fcm token response had no access_token")
	}
	ttl := time.Duration(parsed.ExpiresIn) * time.Second
	if ttl <= fcmTokenSkew {
		ttl = 10 * time.Minute
	}
	s.mu.Lock()
	s.accessToken = parsed.AccessToken
	s.expiresAt = now.Add(ttl - fcmTokenSkew)
	s.mu.Unlock()
	return parsed.AccessToken, nil
}

// serviceAccountAssertion 是 jwt-bearer grant 要的 RS256 JWT。
func serviceAccountAssertion(clientEmail, tokenURI string, key *rsa.PrivateKey, now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{
		"iss":   clientEmail,
		"scope": fcmScope,
		"aud":   tokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	if err != nil {
		return "", err
	}
	signingInput := base64URL(header) + "." + base64URL(claims)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + base64URL(sig), nil
}
