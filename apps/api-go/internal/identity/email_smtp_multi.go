package identity

// Multi-provider SMTP router for the EMAIL channel.
//
// Instead of hard-wiring one SMTP server, the login challenge provider can
// route outgoing mail to a per-recipient-domain SMTP backend. This lets
// us serve a global user base with the right local provider:
//
//	weilin@gmail.com  -> smtp.gmail.com   (overseas users)
//	12345@qq.com      -> smtp.qq.com:465  (mainland China)
//	foo@163.com       -> smtp.163.com:465 (mainland China, legacy)
//	bar@126.com       -> smtp.163.com:465 (mainland China, legacy)
//	default catch-all -> env-configured fallback SMTP
//
// Wire-up (env-driven, see cmd/api/main.go):
//
//	# Catch-all / default (existing single-SMTP env, unchanged)
//	PROXY_SMTP_HOST=smtp.gmail.com
//	PROXY_SMTP_PORT=587
//	PROXY_SMTP_USERNAME=...
//	PROXY_SMTP_PASSWORD=...
//	PROXY_SMTP_FROM=...
//	PROXY_SMTP_TLS=starttls
//
//	# Per-domain overrides (optional). Matched by recipient suffix
//	# (case-insensitive). First match wins, fall-through to default.
//	PROXY_SMTP_ROUTE_DOMAINS=gmail.com,qq.com,163.com,126.com
//	PROXY_SMTP_ROUTE_GMAIL_HOST=smtp.gmail.com
//	PROXY_SMTP_ROUTE_GMAIL_PORT=587
//	PROXY_SMTP_ROUTE_GMAIL_USERNAME=...
//	PROXY_SMTP_ROUTE_GMAIL_PASSWORD=...
//	PROXY_SMTP_ROUTE_GMAIL_FROM=...
//	PROXY_SMTP_ROUTE_GMAIL_TLS=starttls
//	PROXY_SMTP_ROUTE_QQ_HOST=smtp.qq.com
//	PROXY_SMTP_ROUTE_QQ_PORT=465
//	PROXY_SMTP_ROUTE_QQ_USERNAME=...
//	PROXY_SMTP_ROUTE_QQ_PASSWORD=...    # QQ 16-char authorization code
//	PROXY_SMTP_ROUTE_QQ_FROM=...
//	PROXY_SMTP_ROUTE_QQ_TLS=tls
//	# ... 163 / 126 follow the same pattern.
//
// The router keeps one inner SMTPLoginChallengeProvider per route; each
// keeps its own in-memory challenge map. OTP codes still never cross
// route boundaries (the user can only verify against the same provider
// that issued the challenge).

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

// SMTPMultiRoute describes one per-domain SMTP backend.
type SMTPMultiRoute struct {
	// Domain matches the recipient suffix (after the @), case-insensitive.
	// "gmail.com" matches "weilin@gmail.com" and "Weilin@GMail.COM".
	Domain string
	Cfg    SMTPConfig
}

// SMTPMultiProvider routes EMAIL challenges to one of several
// SMTPLoginChallengeProvider instances based on the recipient address.
type SMTPMultiProvider struct {
	logger      *slog.Logger
	defaultSMTP *SMTPLoginChallengeProvider
	routes      map[string]*SMTPLoginChallengeProvider // lowercased domain -> provider
}

// NewSMTPMultiProvider builds a router. `defaultCfg` is used when no
// per-domain route matches. `routes` is the optional per-domain list.
// Returns nil if both default and routes are empty (caller should treat
// this as "no email provider wired" and fail-closed).
func NewSMTPMultiProvider(defaultCfg SMTPConfig, routes []SMTPMultiRoute, logger *slog.Logger) *SMTPMultiProvider {
	if logger == nil {
		logger = slog.Default()
	}
	m := &SMTPMultiProvider{logger: logger, routes: make(map[string]*SMTPLoginChallengeProvider)}
	if defaultCfg.Host != "" {
		m.defaultSMTP = NewSMTPLoginChallengeProvider(defaultCfg)
	}
	for _, r := range routes {
		dom := strings.ToLower(strings.TrimSpace(r.Domain))
		if dom == "" {
			continue
		}
		if r.Cfg.Host == "" {
			logger.Warn("smtp multi-route skipped: empty host", slog.String("domain", dom))
			continue
		}
		m.routes[dom] = NewSMTPLoginChallengeProvider(r.Cfg)
		logger.Info("smtp multi-route registered",
			slog.String("domain", dom),
			slog.String("host", r.Cfg.Host),
			slog.Int("port", r.Cfg.Port),
			slog.String("from", r.Cfg.From),
		)
	}
	return m
}

// Configured reports whether the router has at least one usable backend.
func (m *SMTPMultiProvider) Configured() bool {
	if m == nil {
		return false
	}
	if m.defaultSMTP != nil && m.defaultSMTP.Configured() {
		return true
	}
	for _, p := range m.routes {
		if p.Configured() {
			return true
		}
	}
	return false
}

// selectProvider returns the inner provider that should service this
// recipient address. If no per-domain route matches, the default
// provider is used.
func (m *SMTPMultiProvider) selectProvider(recipient string) *SMTPLoginChallengeProvider {
	if m == nil {
		return nil
	}
	at := strings.LastIndex(recipient, "@")
	if at < 0 || at == len(recipient)-1 {
		return m.defaultSMTP
	}
	dom := strings.ToLower(strings.TrimSpace(recipient[at+1:]))
	if p, ok := m.routes[dom]; ok && p.Configured() {
		return p
	}
	// Match parent domains (e.g. 126.com matches foo@bar.126.com if any).
	if dot := strings.Index(dom, "."); dot > 0 {
		parent := dom[dot+1:]
		if p, ok := m.routes[parent]; ok && p.Configured() {
			return p
		}
	}
	return m.defaultSMTP
}

// Request routes to the matching provider.
func (m *SMTPMultiProvider) Request(ctx context.Context, req LoginChallengeRequest) (ProviderChallenge, error) {
	if m == nil {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	if req.Channel != "EMAIL" {
		return ProviderChallenge{}, fmt.Errorf("smtp multi: unsupported channel %q", req.Channel)
	}
	recipient, ok := lookupEmailForLoginIdentity(req.LoginIdentityID)
	if !ok {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	return m.RequestWithRecipient(ctx, req, recipient)
}

// RequestWithRecipient is the production entry point.
func (m *SMTPMultiProvider) RequestWithRecipient(ctx context.Context, req LoginChallengeRequest, recipient string) (ProviderChallenge, error) {
	if m == nil {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	p := m.selectProvider(recipient)
	if p == nil || !p.Configured() {
		return ProviderChallenge{}, ErrLoginChallengeProviderNotReady
	}
	return p.RequestWithRecipient(ctx, req, recipient)
}

// Verify tries the default and every route. Only the provider that
// issued the original challenge holds the matching ProviderRef; the
// others reject silently. We do not leak which provider matched.
func (m *SMTPMultiProvider) Verify(ctx context.Context, v LoginChallengeVerification) (ProviderVerification, error) {
	if m == nil {
		return ProviderVerification{}, ErrLoginChallengeProviderNotReady
	}
	if m.defaultSMTP != nil {
		if res, err := m.defaultSMTP.Verify(ctx, v); err == nil && res.Verified {
			return res, nil
		}
	}
	for _, p := range m.routes {
		if res, err := p.Verify(ctx, v); err == nil && res.Verified {
			return res, nil
		}
	}
	return ProviderVerification{}, nil
}
