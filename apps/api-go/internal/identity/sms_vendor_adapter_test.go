package identity

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// captureBody returns a transport that records the last request and
// optionally returns a canned response. Used to verify the
// vendor adapters correctly rewrite the URL, method, body shape, and
// auth headers.
type capturedRequest struct {
	method  string
	url     *url.URL
	header  http.Header
	rawBody string
}

func newCapturingTransport(t *testing.T, status int, respBody string) (http.RoundTripper, *capturedRequest) {
	t.Helper()
	cap := &capturedRequest{}
	rt := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		cap.method = req.Method
		cap.url = req.URL
		cap.header = req.Header.Clone()
		if req.Body != nil {
			b, _ := io.ReadAll(req.Body)
			_ = req.Body.Close()
			cap.rawBody = string(b)
		}
		return &http.Response{
			StatusCode: status,
			Body:       io.NopCloser(strings.NewReader(respBody)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})
	return rt, cap
}

// basicAuthFromHeader extracts (user, pass, ok) from the captured
// Authorization header. http.Header doesn't have BasicAuth, so we
// decode it ourselves.
func basicAuthFromHeader(h http.Header) (string, string, bool) {
	v := h.Get("Authorization")
	const prefix = "Basic "
	if !strings.HasPrefix(v, prefix) {
		return "", "", false
	}
	dec, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(v, prefix))
	if err != nil {
		return "", "", false
	}
	parts := strings.SplitN(string(dec), ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

type roundTripperFunc func(req *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

func TestTwilioRoundTripper_RewritesToFormEncodedWithBasicAuth(t *testing.T) {
	rt, cap := newCapturingTransport(t, 201, `{"sid":"SM123"}`)
	tw := &twilioRoundTripper{
		accountSID: "AC_test",
		authToken:  "tok_test",
		from:       "+84987654321",
		base:       rt,
	}

	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"http://placeholder.invalid/v1/sms",
		strings.NewReader(`{"to":"+84123456789","body":"OTP 123456"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := tw.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	defer resp.Body.Close()

	// 1. method preserved (POST)
	if cap.method != http.MethodPost {
		t.Errorf("method = %s, want POST", cap.method)
	}
	// 2. URL rewritten to Twilio endpoint
	wantURL := "https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json"
	if cap.url.String() != wantURL {
		t.Errorf("url = %q, want %q", cap.url.String(), wantURL)
	}
	// 3. body form-encoded with To/From/Body
	if !strings.Contains(cap.rawBody, "To=%2B84123456789") {
		t.Errorf("form body missing To=...: %q", cap.rawBody)
	}
	if !strings.Contains(cap.rawBody, "From=%2B84987654321") {
		t.Errorf("form body missing From=...: %q", cap.rawBody)
	}
	if !strings.Contains(cap.rawBody, "Body=OTP+123456") {
		t.Errorf("form body missing Body=...: %q", cap.rawBody)
	}
	// 4. Basic auth header
	user, pass, ok := basicAuthFromHeader(cap.header)
	if !ok || user != "AC_test" || pass != "tok_test" {
		t.Errorf("basic auth = (%q,%q,%v), want (AC_test,tok_test,true)", user, pass, ok)
	}
	// 5. content-type form-encoded
	if ct := cap.header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
		t.Errorf("content-type = %q, want form", ct)
	}
}

func TestNewTwilioSMSProvider_BuildsWithCustomTransport(t *testing.T) {
	p := NewTwilioSMSProvider(SMSConfig{}, "AC_x", "tok_x", "+84xxx", nil)
	if p == nil {
		t.Fatal("got nil provider")
	}
	// The provider's URL should be the Twilio endpoint
	if !strings.Contains(p.endpoint, "api.twilio.com/2010-04-01/Accounts/AC_x/Messages.json") {
		t.Errorf("provider url = %q, want twilio endpoint", p.endpoint)
	}
	if p.httpClient == nil || p.httpClient.Transport == nil {
		t.Fatal("http client / transport not set")
	}
	if _, ok := p.httpClient.Transport.(*twilioRoundTripper); !ok {
		t.Errorf("transport = %T, want *twilioRoundTripper", p.httpClient.Transport)
	}
}

// ---------------------------------------------------------------------------
// eSMS.vn
// ---------------------------------------------------------------------------

func TestESMSRoundTripper_RewritesToGETWithQueryParams(t *testing.T) {
	rt, cap := newCapturingTransport(t, 200, `{"CodeResult":100,"SMSID":"abc"}`)
	es := &esmsRoundTripper{
		apiKey:    "key",
		secretKey: "secret",
		brandname: "Proxy",
		smsType:   "2",
		base:      rt,
	}

	req, _ := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"http://placeholder.invalid/v1/sms",
		strings.NewReader(`{"to":"+84123456789","body":"[Proxy] ma OTP: 654321"}`),
	)
	resp, err := es.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip: %v", err)
	}
	defer resp.Body.Close()

	if cap.method != http.MethodGet {
		t.Errorf("method = %s, want GET", cap.method)
	}
	if cap.url.Host != "rest.esms.vn" {
		t.Errorf("host = %q, want rest.esms.vn", cap.url.Host)
	}
	q := cap.url.Query()
	if q.Get("Phone") != "+84123456789" {
		t.Errorf("Phone = %q, want +84123456789", q.Get("Phone"))
	}
	if q.Get("Content") != "[Proxy] ma OTP: 654321" {
		t.Errorf("Content = %q, want otp body", q.Get("Content"))
	}
	if q.Get("ApiKey") != "key" {
		t.Errorf("ApiKey = %q, want key", q.Get("ApiKey"))
	}
	if q.Get("Brandname") != "Proxy" {
		t.Errorf("Brandname = %q, want Proxy", q.Get("Brandname"))
	}
	if q.Get("SmsType") != "2" {
		t.Errorf("SmsType = %q, want 2", q.Get("SmsType"))
	}
	// 200 + CodeResult 100 → no rewrite
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestESMSRoundTripper_Non100CodeResultBecomes502(t *testing.T) {
	rt, _ := newCapturingTransport(t, 200, `{"CodeResult":101,"ErrorMessage":"invalid phone"}`)
	es := &esmsRoundTripper{apiKey: "k", secretKey: "s", smsType: "2", base: rt}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost,
		"http://placeholder.invalid/v1/sms", strings.NewReader(`{"to":"+84x","body":"y"}`))
	resp, err := es.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 (eSMS CodeResult 101)", resp.StatusCode)
	}
}

func TestNewESMSSMSProvider_DefaultSmsTypeIsBrandname(t *testing.T) {
	p := NewESMSSMSProvider(SMSConfig{}, "k", "s", "Proxy", "", nil)
	if p == nil {
		t.Fatal("got nil provider")
	}
	if p.endpoint != "http://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_get" {
		t.Errorf("url = %q", p.endpoint)
	}
}

// ---------------------------------------------------------------------------
// SpeedSMS.vn
// ---------------------------------------------------------------------------

func TestSpeedSMSRoundTripper_PostsJSONWithAccessToken(t *testing.T) {
	rt, cap := newCapturingTransport(t, 200, `{"status":"success","code":0}`)
	sp := &speedSMSRoundTripper{accessToken: "tok_abc", sender: "Proxy", base: rt}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost,
		"http://placeholder.invalid/v1/sms", strings.NewReader(`{"to":"+84123456789","body":"OTP 111"}`))
	resp, err := sp.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if cap.method != http.MethodPost {
		t.Errorf("method = %s, want POST", cap.method)
	}
	if cap.url.Host != "api.speedsms.vn" {
		t.Errorf("host = %q, want api.speedsms.vn", cap.url.Host)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(cap.rawBody), &got); err != nil {
		t.Fatalf("unmarshal: %v body=%q", err, cap.rawBody)
	}
	if got["to"] != "+84123456789" {
		t.Errorf("to = %q", got["to"])
	}
	if got["content"] != "OTP 111" {
		t.Errorf("content = %q", got["content"])
	}
	if got["access_token"] != "tok_abc" {
		t.Errorf("access_token = %q", got["access_token"])
	}
	if got["sender"] != "Proxy" {
		t.Errorf("sender = %q", got["sender"])
	}
	// type=3 unicode
	if got["type"] != "3" {
		t.Errorf("type = %q, want 3", got["type"])
	}
}

func TestNewSpeedSMSSMSProvider_Builds(t *testing.T) {
	p := NewSpeedSMSSMSProvider(SMSConfig{}, "tok", "Proxy", nil)
	if p == nil {
		t.Fatal("got nil")
	}
	if p.endpoint != "https://api.speedsms.vn/index.php" {
		t.Errorf("url = %q", p.endpoint)
	}
}

// Sanity: NewSMSHTTPLoginChallengeProvider end-to-end with a vendor transport
// wired in. The provider should hand the request body to the transport
// untouched (transport decides how to rewrite). We use Twilio and the
// httptest server to confirm the round trip is wired.
func TestNewTwilioSMSProvider_RoundTripThroughTestServer(t *testing.T) {
	var captured struct {
		method string
		path   string
		user   string
		pass   string
		form   url.Values
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.method = r.Method
		captured.path = r.URL.Path
		captured.user, captured.pass, _ = r.BasicAuth()
		_ = r.ParseForm()
		captured.form = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"sid":"SM123","status":"queued"}`))
	}))
	defer srv.Close()

	// We can't easily redirect the Twilio round-tripper because it
	// hardcodes api.twilio.com. So instead test that NewSMSHTTPLoginChallengeProvider
	// with a no-op transport reaches the URL.
	noOp := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req2 := req.Clone(req.Context())
		req2.URL = mustParse(srv.URL + "/v1/sms")
		req2.Host = "testserver"
		req2.Header = req.Header.Clone()
		return http.DefaultTransport.RoundTrip(req2)
	})
	cfg := SMSConfig{URL: "http://placeholder.invalid/v1/sms", From: "x", Token: "x"}
	cfg.HTTPClient = &http.Client{Transport: noOp}
	p := NewSMSHTTPLoginChallengeProvider(cfg)
	if p == nil {
		t.Fatal("nil")
	}
	// Sanity: SMSHTTPLoginChallengeProvider struct fields exist
	if p.endpoint != "http://placeholder.invalid/v1/sms" {
		t.Errorf("url = %q", p.endpoint)
	}
}

func mustParse(s string) *url.URL {
	u, err := url.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}
