package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// OTP generation primitives

func TestGenerateOTPCodeIsSixDigits(t *testing.T) {
	for i := 0; i < 50; i++ {
		c, err := generateOTPCode()
		if err != nil {
			t.Fatalf("generateOTPCode: %v", err)
		}
		if len(c) != 6 {
			t.Fatalf("want 6 digits got %q", c)
		}
		for _, r := range c {
			if r < '0' || r > '9' {
				t.Fatalf("non-digit in %q", c)
			}
		}
	}
}

func TestHashAndConstantTimeEqualHash(t *testing.T) {
	h := hashOTPCode("123456")
	if h == "" || len(h) != 64 {
		t.Fatalf("hex hash length unexpected: %q", h)
	}
	if !constantTimeEqualHash("123456", h) {
		t.Fatal("matching code should compare equal")
	}
	if constantTimeEqualHash("123457", h) {
		t.Fatal("non-matching code should not compare equal")
	}
	if !constantTimeEqualHash(" 123456 ", h) {
		t.Fatal("trim should still match")
	}
	if constantTimeEqualHash("123456", "not-hex") {
		t.Fatal("invalid hex must not match")
	}
}

func TestValidEmail(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"a@b.co", true},
		{"  a@b.co  ", true},
		{"first.last+tag@sub.example.com", true},
		{"missing-at.example.com", false},
		{"@b.co", false},
		{"a@", false},
		{"a@b", false},
		{"", false},
	}
	for _, c := range cases {
		if got := validEmail(c.in); got != c.want {
			t.Errorf("validEmail(%q)=%v want %v", c.in, got, c.want)
		}
	}
}

func TestValidE164Phone(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"+84912345678", true},
		{"+12025550100", true},
		{"+1 415 555 0100", false}, // no spaces
		{"84912345678", false},
		{"+12", false},                 // too short
		{"+12345678901234567", false},  // too long
		{"", false},
	}
	for _, c := range cases {
		if got := validE164Phone(c.in); got != c.want {
			t.Errorf("validE164Phone(%q)=%v want %v", c.in, got, c.want)
		}
	}
}

// ---- SMTP provider ----

func TestSMTPLoginChallengeProviderSendsMailAndVerifies(t *testing.T) {
	sink, body := startSMTPSink(t)
	defer sink.Close()
	provider := NewSMTPLoginChallengeProvider(SMTPConfig{
		Host:    sink.host,
		Port:    sink.port,
		From:    "no-reply@proxy.example",
		TLSMode: "none",
		Now:     func() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) },
	})
	if !provider.Configured() {
		t.Fatal("provider should be configured")
	}
	challenge, err := provider.RequestWithRecipient(context.Background(),
		LoginChallengeRequest{LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "EMAIL"},
		"person@example.com")
	if err != nil {
		t.Fatalf("RequestWithRecipient: %v", err)
	}
	if !strings.HasPrefix(challenge.ProviderRef, "smtp_") {
		t.Fatalf("expected smtp_ prefix, got %q", challenge.ProviderRef)
	}
	code := extractOTPCodeFromMessage(t, body.String())
	if len(code) != 6 {
		t.Fatalf("smtp body did not contain 6-digit code, got %q", body.String())
	}
	wrong, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: "000000"})
	if err != nil || wrong.Verified {
		t.Fatalf("wrong code rejected: %#v err=%v", wrong, err)
	}
	ok, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: code})
	if err != nil || !ok.Verified {
		t.Fatalf("correct code accepted: %#v err=%v", ok, err)
	}
	replay, err := provider.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: code})
	if err != nil || replay.Verified {
		t.Fatalf("smtp challenge must be one-time: %#v err=%v", replay, err)
	}
}

func TestSMTPLoginChallengeProviderRejectsMisconfig(t *testing.T) {
	missingHost := NewSMTPLoginChallengeProvider(SMTPConfig{Port: 587, From: "x"})
	if missingHost.Configured() {
		t.Fatal("configured should be false without host")
	}
	missingFrom := NewSMTPLoginChallengeProvider(SMTPConfig{Host: "smtp.example.com", Port: 587})
	if missingFrom.Configured() {
		t.Fatal("configured should be false without From")
	}
	ok := NewSMTPLoginChallengeProvider(SMTPConfig{Host: "smtp.example.com", Port: 587, From: "x", TLSMode: "starttls"})
	if !ok.Configured() {
		t.Fatal("configured should be true with full SMTPConfig")
	}
}

func TestSMTPLoginChallengeProviderFailsClosedOnDialError(t *testing.T) {
	// Bind and immediately close to get a free port that is no longer
	// accepting connections — any dial attempt must fail fast.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	host, portS, _ := net.SplitHostPort(addr)
	var port int
	for _, r := range portS {
		port = port*10 + int(r-'0')
	}
	p := NewSMTPLoginChallengeProvider(SMTPConfig{Host: host, Port: port, From: "no-reply@proxy.example", TLSMode: "none"})
	_, err = p.RequestWithRecipient(context.Background(),
		LoginChallengeRequest{Channel: "EMAIL"},
		"person@example.com")
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("dial failure must surface as fail-closed, got %v", err)
	}
}

func TestSMTPLoginChallengeProviderRejectsWrongChannel(t *testing.T) {
	p := NewSMTPLoginChallengeProvider(SMTPConfig{Host: "smtp.example.com", Port: 587, From: "x"})
	_, err := p.RequestWithRecipient(context.Background(), LoginChallengeRequest{Channel: "SMS"}, "+84912345678")
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("wrong channel must fail closed, got %v", err)
	}
}

func TestSMTPLoginChallengeProviderVerifyExpires(t *testing.T) {
	sink, body := startSMTPSink(t)
	defer sink.Close()
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	clock := now
	p := NewSMTPLoginChallengeProvider(SMTPConfig{Host: sink.host, Port: sink.port, From: "x", TLSMode: "none", Now: func() time.Time { return clock }})
	challenge, err := p.RequestWithRecipient(context.Background(), LoginChallengeRequest{Channel: "EMAIL"}, "person@example.com")
	if err != nil {
		t.Fatal(err)
	}
	code := extractOTPCodeFromMessage(t, body.String())
	clock = clock.Add(6 * time.Minute) // past TTL
	v, err := p.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: code})
	if err != nil || v.Verified {
		t.Fatalf("expired challenge should not verify: %#v err=%v", v, err)
	}
}

// ---- SMS provider ----

func TestSMSHTTPLoginChallengeProviderSendsMessageAndVerifies(t *testing.T) {
	var captured atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("missing or wrong Authorization header: %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("bad body: %v", err)
		}
		captured.Store(body)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	p := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: srv.URL, From: "Proxy", Token: "test-token"})
	challenge, err := p.RequestWithRecipient(context.Background(),
		LoginChallengeRequest{LoginIdentityID: "login_001", DeviceID: "device_001", Channel: "SMS"},
		"+84912345678")
	if err != nil {
		t.Fatalf("RequestWithRecipient: %v", err)
	}
	if !strings.HasPrefix(challenge.ProviderRef, "sms_") {
		t.Fatalf("expected sms_ prefix, got %q", challenge.ProviderRef)
	}
	body, _ := captured.Load().(map[string]any)
	if body["to"] != "+84912345678" {
		t.Fatalf("upstream got wrong to: %v", body["to"])
	}
	smsBody, _ := body["body"].(string)
	code := extractOTPCodeFromMessage(t, smsBody)
	if len(code) != 6 {
		t.Fatalf("sms body did not contain 6-digit code, got %q", smsBody)
	}
	ok, err := p.Verify(context.Background(), LoginChallengeVerification{ProviderRef: challenge.ProviderRef, Code: code})
	if err != nil || !ok.Verified {
		t.Fatalf("correct sms code accepted: %#v err=%v", ok, err)
	}
}

func TestSMSHTTPLoginChallengeProviderFailsClosedOnUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"upstream-down"}`))
	}))
	defer srv.Close()
	p := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: srv.URL, From: "Proxy"})
	_, err := p.RequestWithRecipient(context.Background(),
		LoginChallengeRequest{Channel: "SMS"},
		"+84912345678")
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("upstream 500 must surface as fail-closed, got %v", err)
	}
}

func TestSMSHTTPLoginChallengeProviderRejectsBadPhone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("upstream should not be called for invalid phone")
	}))
	defer srv.Close()
	p := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: srv.URL, From: "Proxy"})
	_, err := p.RequestWithRecipient(context.Background(),
		LoginChallengeRequest{Channel: "SMS"},
		"not-a-phone")
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("invalid phone must fail closed, got %v", err)
	}
}

// ---- Channel router ----

func TestChannelRouterDispatchesByChannel(t *testing.T) {
	smsHit := atomic.Int32{}
	smsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		smsHit.Add(1)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer smsSrv.Close()
	sink, _ := startSMTPSink(t)
	defer sink.Close()
	email := NewSMTPLoginChallengeProvider(SMTPConfig{Host: sink.host, Port: sink.port, From: "x", TLSMode: "none"})
	sms := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: smsSrv.URL, From: "Proxy"})
	r := NewChannelRouter(email, sms)
	// Without a resolver registered, both channels must fail-closed at
	// the Request boundary, and the upstream must not be called.
	_, err := r.Request(context.Background(), LoginChallengeRequest{Channel: "EMAIL", LoginIdentityID: "login_001"})
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("email without resolver should be fail-closed, got %v", err)
	}
	_, err = r.Request(context.Background(), LoginChallengeRequest{Channel: "SMS", LoginIdentityID: "login_001"})
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("sms without resolver should be fail-closed, got %v", err)
	}
	if smsHit.Load() != 0 {
		t.Fatalf("SMS server was hit %d times without a resolver registered", smsHit.Load())
	}
}

func TestChannelRouterVerifyRoutesByPrefix(t *testing.T) {
	sink, _ := startSMTPSink(t)
	defer sink.Close()
	email := NewSMTPLoginChallengeProvider(SMTPConfig{Host: sink.host, Port: sink.port, From: "x", TLSMode: "none"})
	sms := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: "http://127.0.0.1:1", From: "Proxy"})
	r := NewChannelRouter(email, sms)
	// Unknown ref must not panic and must not verify.
	v, err := r.Verify(context.Background(), LoginChallengeVerification{ProviderRef: "unknown_ref", Code: "123456"})
	if err != nil || v.Verified {
		t.Fatalf("unknown ref must not verify, got %#v err=%v", v, err)
	}
}

// ---- Local SMTP sink ----

type smtpSink struct {
	host string
	port int
	ln   net.Listener
	body *syncBuffer
}

func (h *smtpSink) Close() { _ = h.ln.Close() }

type syncBuffer struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func startSMTPSink(t *testing.T) (*smtpSink, *syncBuffer) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	host, portS, _ := net.SplitHostPort(ln.Addr().String())
	var port int
	for _, r := range portS {
		port = port*10 + int(r-'0')
	}
	body := &syncBuffer{}
	go acceptSMTPLoop(ln, body)
	return &smtpSink{host: host, port: port, ln: ln, body: body}, body
}

func acceptSMTPLoop(ln net.Listener, captured *syncBuffer) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go handleSMTPConn(c, captured)
	}
}

// handleSMTPConn is a minimal SMTP server that responds to EHLO, MAIL,
// RCPT, DATA and QUIT and stashes the DATA payload. It is intentionally
// not RFC-complete — enough for the provider to deliver a message in a
// unit test.
func handleSMTPConn(c net.Conn, captured *syncBuffer) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = c.Write([]byte("220 proxy.test ESMTP ready\r\n"))
	for {
		line, err := readSMTPLine(c)
		if err != nil {
			return
		}
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
			_, _ = c.Write([]byte("250-proxy.test\r\n250 OK\r\n"))
		case strings.HasPrefix(upper, "MAIL"):
			_, _ = c.Write([]byte("250 OK\r\n"))
		case strings.HasPrefix(upper, "RCPT"):
			_, _ = c.Write([]byte("250 OK\r\n"))
		case strings.HasPrefix(upper, "DATA"):
			_, _ = c.Write([]byte("354 End data with <CR><LF>.<CR><LF>\r\n"))
			for {
				dataLine, err := readSMTPLine(c)
				if err != nil {
					return
				}
				if dataLine == "." {
					break
				}
				captured.Write([]byte(dataLine + "\r\n"))
			}
			_, _ = c.Write([]byte("250 OK\r\n"))
		case strings.HasPrefix(upper, "QUIT"):
			_, _ = c.Write([]byte("221 Bye\r\n"))
			return
		case strings.HasPrefix(upper, "RSET"):
			_, _ = c.Write([]byte("250 OK\r\n"))
		case strings.HasPrefix(upper, "NOOP"):
			_, _ = c.Write([]byte("250 OK\r\n"))
		default:
			_, _ = c.Write([]byte("500 Unrecognized\r\n"))
		}
	}
}

func readSMTPLine(c net.Conn) (string, error) {
	var b []byte
	tmp := make([]byte, 1)
	for {
		_, err := c.Read(tmp)
		if err != nil {
			return "", err
		}
		b = append(b, tmp[0])
		if len(b) >= 2 && b[len(b)-2] == '\r' && b[len(b)-1] == '\n' {
			return strings.TrimRight(string(b), "\r\n"), nil
		}
	}
}

// extractOTPCodeFromMessage finds a 6-digit numeric code in the message.
func extractOTPCodeFromMessage(t *testing.T, msg string) string {
	t.Helper()
	for i := 0; i+6 <= len(msg); i++ {
		ok := true
		for j := 0; j < 6; j++ {
			if msg[i+j] < '0' || msg[i+j] > '9' {
				ok = false
				break
			}
		}
		if ok {
			return msg[i : i+6]
		}
	}
	t.Fatalf("no 6-digit code in message:\n%s", msg)
	return ""
}
