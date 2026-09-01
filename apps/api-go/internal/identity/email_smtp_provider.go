package identity

// SMTP-backed LoginChallengeProvider for the EMAIL channel.
//
// Wire-up:
//
//	PROXY_LOGIN_PROVIDER=smtp \
//	PROXY_SMTP_HOST=smtp.example.com \
//	PROXY_SMTP_PORT=587 \
//	PROXY_SMTP_USERNAME=apikey \
//	PROXY_SMTP_PASSWORD=... \
//	PROXY_SMTP_FROM="Proxy <no-reply@proxy.example>" \
//	PROXY_SMTP_TLS=starttls      # starttls | tls | none
//
// Any SMTP relay works (Mailgun, Postmark, Resend via SMTP, AWS SES, Gmail
// App Password, plain Postfix). We do not depend on a vendor SDK.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strings"
	"sync"
	"time"
)

// SMTPLoginChallengeProvider sends OTP codes over SMTP. It owns the OTP
// in memory as a hash and only references it via ProviderRef. Plain codes
// are never logged, persisted, or returned through the API.
type SMTPLoginChallengeProvider struct {
	mu          sync.Mutex
	challenges  map[string]smtpChallenge
	codeTTL     time.Duration
	fromAddress string
	host        string
	port        int
	username    string
	password    string
	tlsMode     string // "starttls" | "tls" | "none"
	dialTimeout time.Duration
	now         func() time.Time
	logger      *slog.Logger
}

type smtpChallenge struct {
	codeHash  string
	expiresAt time.Time
	attempts  int
	loginID   string
	deviceID  string
}

// SMTPConfig is the only thing the API command actually depends on; the
// rest is internal and not exported. Empty required fields cause
// ErrLoginChallengeProviderNotReady (fail-closed).
type SMTPConfig struct {
	Host        string
	Port        int
	Username    string
	Password    string
	From        string
	TLSMode     string // "starttls" | "tls" | "none"; empty = "starttls"
	Logger      *slog.Logger
	Now         func() time.Time
	CodeTTL     time.Duration // zero = 5 minutes
	DialTimeout time.Duration // zero = 10s
}

// NewSMTPLoginChallengeProvider validates the config eagerly; an invalid
// config returns the provider in a "not ready" state so the API stays
// fail-closed without an extra constructor error.
func NewSMTPLoginChallengeProvider(cfg SMTPConfig) *SMTPLoginChallengeProvider {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	ttl := cfg.CodeTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	tlsMode := strings.ToLower(strings.TrimSpace(cfg.TLSMode))
	if tlsMode == "" {
		tlsMode = "starttls"
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	dialTimeout := cfg.DialTimeout
	if dialTimeout <= 0 {
		dialTimeout = 10 * time.Second
	}
	return &SMTPLoginChallengeProvider{
		challenges:  make(map[string]smtpChallenge),
		codeTTL:     ttl,
		fromAddress: strings.TrimSpace(cfg.From),
		host:        strings.TrimSpace(cfg.Host),
		port:        cfg.Port,
		username:    cfg.Username,
		password:    cfg.Password,
		tlsMode:     tlsMode,
		dialTimeout: dialTimeout,
		now:         now,
		logger:      logger,
	}
}

// Configured reports whether the provider is wired up with the minimum
// required fields. It does NOT probe the SMTP server; that happens on the
// first Request. The API layer uses this for /health/ready to surface
// configuration drift without attempting a real send.
func (p *SMTPLoginChallengeProvider) Configured() bool {
	if p == nil {
		return false
	}
	return p.host != "" && p.port > 0 && p.fromAddress != ""
}

func (p *SMTPLoginChallengeProvider) Request(ctx context.Context, req LoginChallengeRequest) (ProviderChallenge, error) {
	if p == nil || !p.Configured() {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	if req.Channel != "EMAIL" {
		// Mis-wired: this provider only handles EMAIL.
		return ProviderChallenge{}, fmt.Errorf("smtp provider: unsupported channel %q", req.Channel)
	}
	recipient, ok := req.Identifier, req.Identifier != ""
	if !ok {
		// Fallback for direct provider tests that never wired the
		// identifier through LoginChallengeRequest. Production always
		// threads it (service layer resolves the LoginIdentity row).
		recipient, ok = lookupEmailForLoginIdentity(req.LoginIdentityID)
	}
	if !ok {
		// We do not know the address from this call site; production
		// callers are expected to thread it through LoginChallengeRequest
		// (see RequestWithRecipient below). Refuse rather than guess.
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	return p.RequestWithRecipient(ctx, req, recipient)
}

// RequestWithRecipient is the production entry point: it accepts the
// resolved recipient address so the provider never has to reach back into
// identity storage. The service layer resolves the address from the
// LoginIdentity row before calling.
func (p *SMTPLoginChallengeProvider) RequestWithRecipient(ctx context.Context, req LoginChallengeRequest, recipient string) (ProviderChallenge, error) {
	if p == nil || !p.Configured() {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	if !validEmail(recipient) {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	plainCode, err := generateOTPCode()
	if err != nil {
		return ProviderChallenge{}, fmt.Errorf("smtp provider: otp generation failed: %w", err)
	}
	now := p.now().UTC()
	expiresAt := now.Add(p.codeTTL)
	ref, err := newProviderRef("smtp")
	if err != nil {
		return ProviderChallenge{}, err
	}
	if err := p.sendMail(ctx, recipient, plainCode); err != nil {
		// Fail-closed: any transport failure surfaces as
		// ErrLoginChallengeProviderNotReady, never a 5xx leak. We log
		// the error category (not the code) for ops.
		p.logger.Warn("smtp login challenge send failed",
			slog.String("error_category", classifySMTPError(err)),
			slog.String("login_identity_id", req.LoginIdentityID),
			slog.String("device_id", req.DeviceID),
			slog.String("correlation_id", req.CorrelationID),
		)
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	p.mu.Lock()
	p.challenges[ref] = smtpChallenge{
		codeHash:  hashOTPCode(plainCode),
		expiresAt: expiresAt,
		loginID:   req.LoginIdentityID,
		deviceID:  req.DeviceID,
	}
	p.mu.Unlock()
	p.logger.Info("smtp login challenge sent",
		slog.String("login_identity_id", req.LoginIdentityID),
		slog.String("device_id", req.DeviceID),
		slog.String("channel", "EMAIL"),
		slog.String("provider_ref", ref),
		slog.String("expires_at", expiresAt.Format(time.RFC3339)),
		slog.String("correlation_id", req.CorrelationID),
	)
	return ProviderChallenge{ProviderRef: ref, ExpiresAt: expiresAt}, nil
}

func (p *SMTPLoginChallengeProvider) Verify(_ context.Context, v LoginChallengeVerification) (ProviderVerification, error) {
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

func (p *SMTPLoginChallengeProvider) sendMail(ctx context.Context, to, code string) error {
	addr := fmt.Sprintf("%s:%d", p.host, p.port)
	body := buildOTPEmail(p.fromAddress, to, code, p.codeTTL)
	var auth smtp.Auth
	if p.username != "" {
		auth = smtp.PlainAuth("", p.username, p.password, p.host)
	}
	host, _, _ := net.SplitHostPort(addr)
	conn, err := dialSMTP(ctx, addr, p.dialTimeout, p.tlsMode, host)
	if err != nil {
		return err
	}
	defer conn.Close()
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if p.tlsMode == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("smtp provider: server does not advertise STARTTLS")
		}
		if err := client.StartTLS(p.tlsConfig(host)); err != nil {
			return err
		}
	}
	if auth != nil {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("smtp provider: server does not advertise AUTH")
		}
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(p.fromAddress); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		_ = w.Close()
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func classifySMTPError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "deadline exceeded"):
		return "timeout"
	case strings.Contains(msg, "connection refused"), strings.Contains(msg, "no such host"):
		return "dial"
	case strings.Contains(msg, "AUTH"):
		return "auth"
	case strings.Contains(msg, "STARTTLS"), strings.Contains(msg, "tls"):
		return "tls"
	default:
		return "send"
	}
}

func validEmail(addr string) bool {
	addr = strings.TrimSpace(addr)
	if addr == "" || strings.Count(addr, "@") != 1 {
		return false
	}
	at := strings.Index(addr, "@")
	local, domain := addr[:at], addr[at+1:]
	if local == "" || domain == "" {
		return false
	}
	if !strings.Contains(domain, ".") {
		return false
	}
	return true
}
