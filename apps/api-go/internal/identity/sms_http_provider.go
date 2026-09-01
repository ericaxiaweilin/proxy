package identity

// HTTP-webhook-backed LoginChallengeProvider for the SMS channel.
//
// The contract is intentionally generic so any vendor that exposes a
// minimal "send SMS" HTTP endpoint works (Twilio, MessageMedia, NAPAS,
// custom corporate gateway). The provider POSTs a JSON body of shape:
//
//	{ "to": "<E.164>", "body": "<message>" }
//
// with an Authorization: Bearer <token> header. The endpoint must return
// 2xx; non-2xx is treated as a transport failure and surfaces as
// ErrLoginChallengeProviderNotReady (fail-closed).
//
// Wire-up:
//
//	PROXY_LOGIN_PROVIDER=sms \
//	PROXY_SMS_URL=https://sms.example.com/v1/messages \
//	PROXY_SMS_TOKEN=... \
//	PROXY_SMS_FROM=Proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// SMSHTTPLoginChallengeProvider delivers OTP codes via an HTTP webhook.
type SMSHTTPLoginChallengeProvider struct {
	mu          sync.Mutex
	challenges  map[string]smsChallenge
	codeTTL     time.Duration
	endpoint    string
	from        string
	token       string
	httpClient  *http.Client
	now         func() time.Time
	logger      *slog.Logger
}

type smsChallenge struct {
	codeHash  string
	expiresAt time.Time
	attempts  int
	loginID   string
	deviceID  string
}

// SMSConfig configures the SMS provider. Empty required fields cause
// ErrLoginChallengeProviderNotReady (fail-closed).
type SMSConfig struct {
	URL        string
	From       string
	Token      string
	HTTPClient *http.Client // nil = 10s timeout default
	Logger     *slog.Logger
	Now        func() time.Time
	CodeTTL    time.Duration // zero = 5 minutes
}

func NewSMSHTTPLoginChallengeProvider(cfg SMSConfig) *SMSHTTPLoginChallengeProvider {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	ttl := cfg.CodeTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &SMSHTTPLoginChallengeProvider{
		challenges: make(map[string]smsChallenge),
		codeTTL:    ttl,
		endpoint:   strings.TrimSpace(cfg.URL),
		from:       strings.TrimSpace(cfg.From),
		token:      cfg.Token,
		httpClient: client,
		now:        now,
		logger:     logger,
	}
}

func (p *SMSHTTPLoginChallengeProvider) Configured() bool {
	if p == nil {
		return false
	}
	return p.endpoint != "" && p.from != ""
}

func (p *SMSHTTPLoginChallengeProvider) Request(ctx context.Context, req LoginChallengeRequest) (ProviderChallenge, error) {
	if p == nil || !p.Configured() {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	if req.Channel != "SMS" {
		return ProviderChallenge{}, fmt.Errorf("sms provider: unsupported channel %q", req.Channel)
	}
	phone, ok := req.Identifier, req.Identifier != ""
	if !ok {
		// Fallback for direct provider tests that never wired the
		// identifier through LoginChallengeRequest. Production always
		// threads it (service layer resolves the LoginIdentity row).
		phone, ok = lookupPhoneForLoginIdentity(req.LoginIdentityID)
	}
	if !ok {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	return p.RequestWithRecipient(ctx, req, phone)
}

func (p *SMSHTTPLoginChallengeProvider) RequestWithRecipient(ctx context.Context, req LoginChallengeRequest, phone string) (ProviderChallenge, error) {
	if p == nil || !p.Configured() {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	if !validE164Phone(phone) {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	plainCode, err := generateOTPCode()
	if err != nil {
		return ProviderChallenge{}, fmt.Errorf("sms provider: otp generation failed: %w", err)
	}
	now := p.now().UTC()
	expiresAt := now.Add(p.codeTTL)
	ref, err := newProviderRef("sms")
	if err != nil {
		return ProviderChallenge{}, err
	}
	if err := p.postSMS(ctx, phone, plainCode); err != nil {
		p.logger.Warn("sms login challenge send failed",
			slog.String("error_category", classifyHTTPError(err)),
			slog.String("login_identity_id", req.LoginIdentityID),
			slog.String("device_id", req.DeviceID),
			slog.String("correlation_id", req.CorrelationID),
		)
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	p.mu.Lock()
	p.challenges[ref] = smsChallenge{
		codeHash:  hashOTPCode(plainCode),
		expiresAt: expiresAt,
		loginID:   req.LoginIdentityID,
		deviceID:  req.DeviceID,
	}
	p.mu.Unlock()
	p.logger.Info("sms login challenge sent",
		slog.String("login_identity_id", req.LoginIdentityID),
		slog.String("device_id", req.DeviceID),
		slog.String("channel", "SMS"),
		slog.String("provider_ref", ref),
		slog.String("expires_at", expiresAt.Format(time.RFC3339)),
		slog.String("correlation_id", req.CorrelationID),
	)
	return ProviderChallenge{ProviderRef: ref, ExpiresAt: expiresAt}, nil
}

func (p *SMSHTTPLoginChallengeProvider) Verify(_ context.Context, v LoginChallengeVerification) (ProviderVerification, error) {
	if p == nil || !p.Configured() {
		return ProviderVerification{}, ErrLoginChallengeProviderNotReady
	}
	now := p.now().UTC()
	p.mu.Lock()
	defer p.mu.Unlock()
	challenge, ok := p.challenges[v.ProviderRef]
	if !ok {
		return ProviderVerification{}, nil
	}
	if !now.Before(challenge.expiresAt) {
		delete(p.challenges, v.ProviderRef)
		return ProviderVerification{}, nil
	}
	challenge.attempts++
	if challenge.attempts > 5 {
		delete(p.challenges, v.ProviderRef)
		return ProviderVerification{}, nil
	}
	p.challenges[v.ProviderRef] = challenge
	if !constantTimeEqualHash(v.Code, challenge.codeHash) {
		return ProviderVerification{}, nil
	}
	delete(p.challenges, v.ProviderRef)
	return ProviderVerification{Verified: true}, nil
}

func (p *SMSHTTPLoginChallengeProvider) postSMS(ctx context.Context, phone, code string) error {
	body, err := json.Marshal(map[string]any{
		"to":   phone,
		"from": p.from,
		"body": buildOTPSMSBody(code, p.codeTTL),
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if p.token != "" {
		req.Header.Set("Authorization", "Bearer "+p.token)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Drain a small prefix of the body for diagnostics, never the
		// whole thing (could be large).
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("sms provider: upstream status %d: %s", resp.StatusCode, string(preview))
	}
	// Drain the rest so the connection can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func classifyHTTPError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "context deadline exceeded"), strings.Contains(msg, "Client.Timeout"):
		return "timeout"
	case strings.Contains(msg, "no such host"), strings.Contains(msg, "connection refused"):
		return "dial"
	case strings.Contains(msg, "upstream status"):
		return "upstream_status"
	default:
		return "send"
	}
}

func validE164Phone(phone string) bool {
	phone = strings.TrimSpace(phone)
	if phone == "" || phone[0] != '+' {
		return false
	}
	if len(phone) < 8 || len(phone) > 16 {
		return false
	}
	for _, r := range phone[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

var lookupPhoneForLoginIdentity = func(loginIdentityID string) (string, bool) {
	return "", false
}

// RegisterLoginIdentityPhoneResolver swaps the phone resolver used by
// SMSHTTPLoginChallengeProvider.Request. Called once from service wiring.
func RegisterLoginIdentityPhoneResolver(fn func(loginIdentityID string) (string, bool)) {
	if fn == nil {
		return
	}
	lookupPhoneForLoginIdentity = fn
}

// ErrSMSProviderMisconfigured surfaces a "we are wired up but the
// underlying call refused" failure; the API converts it to fail-closed
// in service.go.
var ErrSMSProviderMisconfigured = errors.New("sms provider misconfigured")
