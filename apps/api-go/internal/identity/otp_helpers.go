package identity

// Helpers shared by the SMTP and HTTP providers:
//   - newProviderRef: opaque, unguessable token that links a Request to a
//     Verify. We do not embed the OTP or any PII; the token alone is useless
//     without the original channel delivery.
//   - buildOTPEmail / buildOTSSMSBody: render the message. Plain-text only,
//     with a localized template (en) and an explicit brand name; the proxy
//     may localize by swapping the file later.
//   - dialSMTP / tlsConfig: minimal net helpers; we avoid pulling in
//     golang.org/x/net because the standard library is enough for a single
//     StartTLS / implicit-TLS SMTP path.

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

const otpEmailTemplate = `From: %s
To: %s
Subject: Your Proxy verification code
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Your Proxy verification code is:

    %s

The code expires in %d minutes. If you did not request this code, you
can safely ignore this message — no account action will be taken.
`

const otpSMSBodyTemplate = "Proxy: your verification code is %s. It expires in %d minutes. If you did not request this, ignore this message."

func newProviderRef(prefix string) (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("provider ref generation: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(b[:]), nil
}

func buildOTPEmail(from, to, code string, ttl time.Duration) []byte {
	return []byte(fmt.Sprintf(otpEmailTemplate, from, to, code, int(ttl.Minutes())))
}

func buildOTPSMSBody(code string, ttl time.Duration) string {
	return fmt.Sprintf(otpSMSBodyTemplate, code, int(ttl.Minutes()))
}

// dialSMTP opens a TCP connection (and optionally negotiates TLS) to addr.
// ctx is honored for the initial connect only; the rest of the SMTP
// conversation is sequential and the server's own timeouts apply.
func dialSMTP(ctx context.Context, addr string, timeout time.Duration, tlsMode, sniHost string) (net.Conn, error) {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	d := net.Dialer{Timeout: timeout}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(tlsMode, "tls") {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: sniHost, MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, err
		}
		return tlsConn, nil
	}
	return conn, nil
}

// tlsConfig returns the *tls.Config to use for STARTTLS. We require TLS
// 1.2+ and do not skip verification; production SMTP relays present a
// valid CA-signed cert.
func (p *SMTPLoginChallengeProvider) tlsConfig(sniHost string) *tls.Config {
	return &tls.Config{ServerName: sniHost, MinVersion: tls.VersionTLS12}
}

// ensure interface satisfaction
var _ smtp.Auth = smtp.PlainAuth("", "", "", "")

// lookupEmailForLoginIdentity resolves the email address for a login
// identity. In production this is wired up by the service layer before
// calling Request; the placeholder returns ok=false so misconfig is loud.
var lookupEmailForLoginIdentity = func(loginIdentityID string) (string, bool) {
	return "", false
}

// RegisterLoginIdentityEmailResolver swaps the email resolver used by
// SMTPLoginChallengeProvider.Request. Called once from service wiring so
// the provider does not depend on the repository directly.
func RegisterLoginIdentityEmailResolver(fn func(loginIdentityID string) (string, bool)) {
	if fn == nil {
		return
	}
	lookupEmailForLoginIdentity = fn
}

// errSMTPNotReady is exported via ErrLoginChallengeProviderNotReady.
var errSMTPNotReady = errors.New("smtp provider not ready")

// suppress unused import on smtp when feature flags strip the auth path.
var _ = smtp.PlainAuth
