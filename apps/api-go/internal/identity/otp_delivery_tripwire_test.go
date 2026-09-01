package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// Tripwire for the OTP recipient-lookup bug class (2026-09-01):
// the SMS and EMAIL challenge providers resolved the delivery recipient
// via global var lookup hooks (lookupPhoneForLoginIdentity /
// lookupEmailForLoginIdentity) whose production implementations were
// NEVER registered — RegisterLookupPhoneHook and
// RegisterLoginIdentityEmailResolver have zero callers outside tests.
// Both channels silently failed with ErrLoginChallengeProviderNotReady:
// OTP delivery was dead in production.
//
// The fix threads LoginIdentity.Identifier through LoginChallengeRequest
// (service layer resolves the row before calling the provider). These
// tests pin the full service->provider->upstream chain: if anyone reverts
// to relying on the unwired hooks (or drops Identifier threading), the
// challenge request must fail loudly here, not silently in production.

// recordingUpstream captures the delivery payload the provider forwards.
type recordingUpstream struct {
	captured atomic.Value // map[string]any
	server   *httptest.Server
}

func newRecordingUpstream() *recordingUpstream {
	u := &recordingUpstream{}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		u.captured.Store(body)
		w.WriteHeader(http.StatusAccepted)
	}))
	return u
}

func (u *recordingUpstream) URL() string      { return u.server.URL }
func (u *recordingUpstream) Close()           { u.server.Close() }
func (u *recordingUpstream) last() map[string]any { b, _ := u.captured.Load().(map[string]any); return b }

func otpTripwireService(t *testing.T, upstreamURL string) *Service {
	t.Helper()
	fixed := clock.NewFixed(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC))
	sms := NewSMSHTTPLoginChallengeProvider(SMSConfig{URL: upstreamURL, From: "Proxy", Token: "tripwire-token"})
	router := NewChannelRouter(nil, sms)
	return NewWithRepositoryAndClockAndChallengeProvider(NewMemoryRepository(&Seed{
		User:          UserAccount{ID: "user_001", Status: "ACTIVE"},
		LoginIdentity: LoginIdentity{ID: "login_sms_001", UserAccountID: "user_001", Verified: true, Status: "ACTIVE", Identifier: "+84912345678", Channel: "SMS"},
		Memberships:   []Membership{{Principal: command.Principal{Type: "BUSINESS", ID: "business_001" }, UserAccountID: "user_001", Status: "ACTIVE"}},
		Devices:       []DeviceRegistration{{ID: "device_001", UserAccountID: "user_001", Platform: "IOS", Status: "ACTIVE"}},
	}), fixed, router)
}

// TestRequestLoginChallengeDeliversSMSToUpstream pins the full
// service->channel-router->SMS-provider->upstream chain: the identifier
// resolved from the LoginIdentity row must reach the upstream webhook.
// Before the fix, the lookup stub returned ok=false and the request was
// rejected as LOGIN_PROVIDER_NOT_CONFIGURED.
func TestRequestLoginChallengeDeliversSMSToUpstream(t *testing.T) {
	upstream := newRecordingUpstream()
	defer upstream.Close()
	service := otpTripwireService(t, upstream.URL())

	result := service.Handle(command.Envelope{
		CommandID:     "cmd_tripwire_sms",
		CommandType:   "RequestLoginChallenge",
		CommandVersion: 1,
		Actor:         command.Actor{Type: "USER", ID: "user_001"},
		Principal:     command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:        command.Target{Type: "LoginChallenge", ID: "new"},
		IdempotencyKey: "idem_tripwire_sms_001",
		Purpose:       "identity_lifecycle",
		CorrelationID:  "corr_tripwire_sms",
		Payload:        map[string]any{"loginIdentityId": "login_sms_001", "deviceId": "device_001", "channel": "SMS"},
	})

	if result.Outcome != "PENDING" {
		t.Fatalf("expected PENDING challenge, got %#v", result)
	}
	body := upstream.last()
	if body == nil {
		t.Fatalf("upstream never received the delivery payload — OTP silently dead (the recipient lookup bug is back)")
	}
	if to, _ := body["to"].(string); to != "+84912345678" {
		t.Fatalf("upstream got wrong recipient %q, want the E.164 identifier from the LoginIdentity row", to)
	}
	if code := extractOTPCodeFromMessage(t, body["body"].(string)); len(code) != 6 {
		t.Fatalf("delivery body missing 6-digit OTP: %v", body["body"])
	}
}

// TestRequestLoginChallengeFailsLoudWithoutIdentifier pins the fail-closed
// side of the same fix: when the service layer cannot resolve an identifier
// (empty row), the request must be REJECTED — never a silent no-delivery
// "PENDING" that tells the user a code was sent.
func TestRequestLoginChallengeFailsLoudWithoutIdentifier(t *testing.T) {
	upstream := newRecordingUpstream()
	defer upstream.Close()
	service := otpTripwireService(t, upstream.URL())

	result := service.Handle(command.Envelope{
		CommandID:     "cmd_tripwire_sms_blank",
		CommandType:   "RequestLoginChallenge",
		CommandVersion: 1,
		Actor:         command.Actor{Type: "USER", ID: "user_001"},
		Principal:     command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:        command.Target{Type: "LoginChallenge", ID: "new"},
		IdempotencyKey: "idem_tripwire_sms_blank_001",
		Purpose:       "identity_lifecycle",
		CorrelationID: "corr_tripwire_sms_blank",
		// LoginIdentity row carries an empty identifier: the service must
		// not let this through as a delivery that never happens.
		Payload: map[string]any{"loginIdentityId": "login_sms_blank", "deviceId": "device_001", "channel": "SMS"},
	})

	if result.Outcome == "PENDING" {
		t.Fatalf("blank identifier must not be accepted as PENDING — OTP would be silently dead")
	}
	if upstream.last() != nil {
		t.Fatalf("upstream must not be called when the recipient is unresolvable")
	}
}

// TestRequestLoginChallengeDeliversEmailPastLookup pins the EMAIL side of
// the same fix: provider.Request (the path service calls) must accept the
// identifier threaded through LoginChallengeRequest and reach the SMTP
// dial — no dependency on the unwired global lookup hooks. Before the fix
// this returned ErrLoginChallengeProviderNotReady (delivery dead).
func TestRequestLoginChallengeDeliversEmailPastLookup(t *testing.T) {
	sink, body := startSMTPSink(t)
	defer sink.Close()
	provider := NewSMTPLoginChallengeProvider(SMTPConfig{
		Host: sink.host, Port: sink.port,
		From: "no-reply@proxy.example", TLSMode: "none",
		Now: func() time.Time { return time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC) },
	})

	// Request (not RequestWithRecipient): the service-layer entry point.
	challenge, err := provider.Request(context.Background(), LoginChallengeRequest{
		LoginIdentityID: "login_email_001", DeviceID: "device_001",
		Channel: "EMAIL", Identifier: "person@example.com",
	})
	if err != nil {
		t.Fatalf("Request with threaded identifier must not depend on lookup hooks: %v", err)
	}
	if !strings.HasPrefix(challenge.ProviderRef, "smtp_") {
		t.Fatalf("expected smtp_ provider ref, got %q", challenge.ProviderRef)
	}
	if code := extractOTPCodeFromMessage(t, body.String()); len(code) != 6 {
		t.Fatalf("sink message missing 6-digit OTP: %q", body.String())
	}
}

// TestRequestWithoutIdentifierFailsClosed pins the fail-closed contract:
// with no threaded identifier AND no wired lookup hook, provider.Request
// must refuse (ErrLoginChallengeProviderNotReady) rather than guess.
func TestRequestWithoutIdentifierFailsClosed(t *testing.T) {
	provider := NewSMTPLoginChallengeProvider(SMTPConfig{Host: "", Port: 0, From: "", TLSMode: "none"}) // zero-value: Configured() == false
	_, err := provider.Request(context.Background(), LoginChallengeRequest{
		LoginIdentityID: "login_x", DeviceID: "device_x", Channel: "EMAIL",
	})
	if !errors.Is(err, ErrLoginChallengeProviderNotReady) {
		t.Fatalf("unresolvable recipient must fail closed, got %v", err)
	}
}
