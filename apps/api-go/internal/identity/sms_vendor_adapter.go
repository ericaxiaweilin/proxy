package identity

// Vendor-specific SMS adapters.
//
// The base SMSHTTPLoginChallengeProvider is intentionally generic: it
// POSTs JSON `{to, body}` with a bearer token. Real vendors (Twilio,
// eSMS.vn, SpeedSMS.vn) use different auth + payload shapes, so we
// provide per-vendor wrappers that implement the same interface.
//
// To keep the wiring small, each vendor exposes a single function
// `new<X>SMSProvider(cfg)` that returns the standard
// SMSHTTPLoginChallengeProvider. The transport layer (http.RoundTripper)
// is replaced per-vendor so the same generic request/response loop
// works for all of them.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ============================================================================
// Twilio adapter
// ============================================================================
//
// Twilio Programmable SMS API:
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSID}/Messages.json
//   Authorization: Basic base64(AccountSID:AuthToken)
//   Content-Type: application/x-www-form-urlencoded
//   Body (form-encoded): To, From, Body
//
// The base SMSHTTPLoginChallengeProvider already POSTs JSON; we wrap
// the JSON body into form-encoded before the request and add the
// Twilio-specific Basic Auth + URL.

type twilioRoundTripper struct {
	accountSID string
	authToken  string
	from       string
	base       http.RoundTripper
}

func (t *twilioRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Decode the JSON body the base provider sends: {to, body}.
	var payload struct {
		To   string `json:"to"`
		Body string `json:"body"`
	}
	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_ = req.Body.Close()
		if len(body) > 0 {
			if err := json.Unmarshal(body, &payload); err != nil {
				return nil, fmt.Errorf("twilio adapter: bad payload: %w", err)
			}
		}
	}

	// Build the Twilio form-encoded body.
	form := url.Values{}
	form.Set("To", payload.To)
	form.Set("From", t.from)
	form.Set("Body", payload.Body)

	// New POST request to Twilio with Basic Auth.
	twilioURL := "https://api.twilio.com/2010-04-01/Accounts/" + t.accountSID + "/Messages.json"
	outReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, twilioURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	outReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	outReq.Header.Set("Accept", "application/json")
	outReq.SetBasicAuth(t.accountSID, t.authToken)

	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(outReq)
}

// newTwilioSMSProvider returns a SMSHTTPLoginChallengeProvider wired
// to the Twilio Programmable SMS API.
//
// Wire-up (env):
//
//	PROXY_SMS_PROVIDER=twilio
//	PROXY_SMS_TWILIO_ACCOUNT_SID=AC...
//	PROXY_SMS_TWILIO_AUTH_TOKEN=...
//	PROXY_SMS_TWILIO_FROM=+84xxxxxxxxx   # Twilio Vietnam number
func NewTwilioSMSProvider(cfg SMSConfig, accountSID, authToken, from string, logger *slog.Logger) *SMSHTTPLoginChallengeProvider {
	if logger == nil {
		logger = slog.Default()
	}
	// The base provider does the OTP bookkeeping; we only swap the
	// transport. The endpoint URL is just a placeholder because the
	// Twilio round-tripper rewrites every outgoing request.
	rt := &twilioRoundTripper{
		accountSID: accountSID,
		authToken:  authToken,
		from:       from,
		base:       http.DefaultTransport,
	}
	cfg.URL = "https://api.twilio.com/2010-04-01/Accounts/" + accountSID + "/Messages.json"
	cfg.HTTPClient = &http.Client{
		Timeout:   15 * time.Second,
		Transport: rt,
	}
	return NewSMSHTTPLoginChallengeProvider(cfg)
}

// ============================================================================
// eSMS.vn adapter
// ============================================================================
//
// eSMS.vn SendMultipleMessage_V4_get endpoint:
//   GET http://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_get
//   Query params: Phone, Content, ApiKey, SecretKey, SmsType, Brandname
//   Returns: JSON { CodeResult, ErrorMessage, SMSID } (CodeResult = 100 = success)
//
// The base provider is POST-oriented with a JSON body. eSMS uses GET
// with query params, so we rewrite the request via a custom
// RoundTripper.

type esmsRoundTripper struct {
	apiKey    string
	secretKey string
	brandname string
	smsType   string // "2" = brandname, "1" = shortcode
	base      http.RoundTripper
}

func (e *esmsRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Decode the JSON body.
	var payload struct {
		To   string `json:"to"`
		Body string `json:"body"`
	}
	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_ = req.Body.Close()
		if len(body) > 0 {
			if err := json.Unmarshal(body, &payload); err != nil {
				return nil, fmt.Errorf("esms adapter: bad payload: %w", err)
			}
		}
	}

	q := url.Values{}
	q.Set("Phone", payload.To)
	q.Set("Content", payload.Body)
	q.Set("ApiKey", e.apiKey)
	q.Set("SecretKey", e.secretKey)
	q.Set("SmsType", e.smsType)
	if e.brandname != "" {
		q.Set("Brandname", e.brandname)
	}

	endpoint := "http://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_get?" + q.Encode()
	outReq, err := http.NewRequestWithContext(req.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	outReq.Header.Set("Accept", "application/json")

	base := e.base
	if base == nil {
		base = http.DefaultTransport
	}
	resp, err := base.RoundTrip(outReq)
	if err != nil {
		return nil, err
	}
	// eSMS returns 200 even on errors; the JSON body has the actual
	// status. We peek at the body and surface non-100 as 502 so the
	// base provider treats it as a transport failure.
	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		var er struct {
			CodeResult   int    `json:"CodeResult"`
			ErrorMessage string `json:"ErrorMessage"`
		}
		if err := json.Unmarshal(body, &er); err == nil && er.CodeResult != 100 {
			resp.StatusCode = http.StatusBadGateway
			resp.Body = io.NopCloser(bytes.NewReader(body))
			return resp, nil
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
	}
	return resp, nil
}

// newESMSSMSProvider returns a SMSHTTPLoginChallengeProvider wired to
// the eSMS.vn SendMultipleMessage_V4_get API.
//
// Wire-up (env):
//
//	PROXY_SMS_PROVIDER=esms
//	PROXY_SMS_ESMS_API_KEY=...
//	PROXY_SMS_ESMS_SECRET_KEY=...
//	PROXY_SMS_ESMS_BRANDNAME=Proxy    # optional (pre-registered)
//	PROXY_SMS_ESMS_SMS_TYPE=2         # 1 = shortcode, 2 = brandname
func NewESMSSMSProvider(cfg SMSConfig, apiKey, secretKey, brandname, smsType string, logger *slog.Logger) *SMSHTTPLoginChallengeProvider {
	if logger == nil {
		logger = slog.Default()
	}
	if smsType == "" {
		smsType = "2" // default to brandname
	}
	rt := &esmsRoundTripper{
		apiKey:    apiKey,
		secretKey: secretKey,
		brandname: brandname,
		smsType:   smsType,
		base:      http.DefaultTransport,
	}
	cfg.URL = "http://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_get"
	cfg.HTTPClient = &http.Client{
		Timeout:   15 * time.Second,
		Transport: rt,
	}
	return NewSMSHTTPLoginChallengeProvider(cfg)
}

// ============================================================================
// SpeedSMS.vn adapter
// ============================================================================
//
// SpeedSMS API:
//   POST https://api.speedsms.vn/index.php
//   Content-Type: application/json
//   Body: { to, content, type, sender, access_token }
//   Returns: { status, code, message } where status="success" means OK.

type speedSMSRoundTripper struct {
	accessToken string
	sender      string
	base        http.RoundTripper
}

func (s *speedSMSRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	var payload struct {
		To   string `json:"to"`
		Body string `json:"body"`
	}
	if req.Body != nil {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		_ = req.Body.Close()
		if len(body) > 0 {
			if err := json.Unmarshal(body, &payload); err != nil {
				return nil, fmt.Errorf("speedsms adapter: bad payload: %w", err)
			}
		}
	}

	out := map[string]string{
		"to":          payload.To,
		"content":     payload.Body,
		"type":        "3", // 3 = unicode (works for OTP)
		"sender":      s.sender,
		"access_token": s.accessToken,
	}
	body, _ := json.Marshal(out)

	outReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, "https://api.speedsms.vn/index.php", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	outReq.Header.Set("Content-Type", "application/json")
	outReq.Header.Set("Accept", "application/json")

	base := s.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(outReq)
}

// newSpeedSMSSMSProvider returns a SMSHTTPLoginChallengeProvider wired
// to SpeedSMS.vn.
//
// Wire-up (env):
//
//	PROXY_SMS_PROVIDER=speedsms
//	PROXY_SMS_SPEEDSMS_ACCESS_TOKEN=...
//	PROXY_SMS_SPEEDSMS_SENDER=...    # short-code / brandname registered
func NewSpeedSMSSMSProvider(cfg SMSConfig, accessToken, sender string, logger *slog.Logger) *SMSHTTPLoginChallengeProvider {
	if logger == nil {
		logger = slog.Default()
	}
	rt := &speedSMSRoundTripper{
		accessToken: accessToken,
		sender:      sender,
		base:        http.DefaultTransport,
	}
	cfg.URL = "https://api.speedsms.vn/index.php"
	cfg.HTTPClient = &http.Client{
		Timeout:   15 * time.Second,
		Transport: rt,
	}
	return NewSMSHTTPLoginChallengeProvider(cfg)
}

// quietLinter is here to keep `context` referenced when this file is
// edited in isolation (the function bodies above use req.Context()).
var _ context.Context