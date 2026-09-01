package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubRoundTripper is a minimal RoundTripper that returns a canned
// body / status, and records the most recent URL hit. We use it to
// keep /v1/geocode/reverse unit tests off the public internet
// (Photon is a free service, but CI shouldn't depend on it).
type stubRoundTripper struct {
	lastURL   string
	status    int
	body      string
	callCount int
}

func (s *stubRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	s.callCount++
	s.lastURL = req.URL.String()
	return &http.Response{
		StatusCode: s.status,
		Status:     http.StatusText(s.status),
		Body:       io.NopCloser(strings.NewReader(s.body)),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func newReverseGeocodeTestServer(rt *stubRoundTripper) *Server {
	return &Server{
		HTTPClient: &http.Client{Transport: rt},
	}
}

// TestReverseGeocode_OK verifies the proxy returns the
// {displayName, source, poi, road, city} shape after a successful
// Photon hit.
func TestReverseGeocode_OK(t *testing.T) {
	photonBody := `{
		"type": "FeatureCollection",
		"features": [{
			"properties": {
				"name": "Lê Thánh Tôn",
				"street": "Lê Thánh Tôn",
				"city": "Thành phố Hồ Chí Minh",
				"country": "Việt Nam",
				"type": "street"
			}
		}]
	}`
	rt := &stubRoundTripper{status: 200, body: photonBody}
	srv := newReverseGeocodeTestServer(rt)
	req := httptest.NewRequest(http.MethodGet, "/v1/geocode/reverse?lat=10.776&lng=106.701", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DisplayName string `json:"displayName"`
		Source      string `json:"source"`
		POI         string `json:"poi"`
		Road        string `json:"road"`
		City        string `json:"city"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Source != "remote" {
		t.Errorf("expected source=remote, got %q", body.Source)
	}
	if body.DisplayName != "Lê Thánh Tôn, Thành phố Hồ Chí Minh, Việt Nam" {
		t.Errorf("unexpected displayName: %q", body.DisplayName)
	}
	if body.City != "Thành phố Hồ Chí Minh" {
		t.Errorf("expected city in props, got %q", body.City)
	}
	if rt.callCount != 1 {
		t.Errorf("expected 1 upstream call, got %d", rt.callCount)
	}
	if !strings.Contains(rt.lastURL, "photon.komoot.io/reverse") {
		t.Errorf("expected photon upstream, got %q", rt.lastURL)
	}
	if !strings.Contains(rt.lastURL, "lon=106.701") || !strings.Contains(rt.lastURL, "lat=10.776") {
		t.Errorf("upstream URL missing lat/lng: %q", rt.lastURL)
	}
}

// TestReverseGeocode_UpstreamError verifies that when the upstream
// returns 5xx, the proxy returns 200 with source=offline so the
// mobile side can fall back to its local grid POI lookup.
func TestReverseGeocode_UpstreamError(t *testing.T) {
	rt := &stubRoundTripper{status: 500, body: `{"error": "boom"}`}
	srv := newReverseGeocodeTestServer(rt)
	req := httptest.NewRequest(http.MethodGet, "/v1/geocode/reverse?lat=10&lng=106", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (offline fallback), got %d", rec.Code)
	}
	var body struct {
		Source string `json:"source"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Source != "offline" {
		t.Errorf("expected source=offline after upstream 500, got %q", body.Source)
	}
}

// TestReverseGeocode_EmptyFeatures verifies that Photon returning
// no features (e.g. middle of ocean) becomes source=offline, not a
// hard error.
func TestReverseGeocode_EmptyFeatures(t *testing.T) {
	rt := &stubRoundTripper{status: 200, body: `{"type":"FeatureCollection","features":[]}`}
	srv := newReverseGeocodeTestServer(rt)
	req := httptest.NewRequest(http.MethodGet, "/v1/geocode/reverse?lat=0&lng=0", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"source":"offline"`)) {
		t.Errorf("expected source=offline for empty features, got %s", rec.Body.String())
	}
}

// TestReverseGeocode_BadRequest verifies the 4 bad-input paths
// (missing params, non-numeric, out of range, wrong method).
func TestReverseGeocode_BadRequest(t *testing.T) {
	rt := &stubRoundTripper{status: 200, body: `{}`}
	srv := newReverseGeocodeTestServer(rt)
	cases := []struct {
		name   string
		url    string
		method string
		want   int
	}{
		{"missing lat", "/v1/geocode/reverse?lng=0", http.MethodGet, http.StatusBadRequest},
		{"missing lng", "/v1/geocode/reverse?lat=0", http.MethodGet, http.StatusBadRequest},
		{"non-numeric", "/v1/geocode/reverse?lat=abc&lng=0", http.MethodGet, http.StatusBadRequest},
		{"out of range lat", "/v1/geocode/reverse?lat=99&lng=0", http.MethodGet, http.StatusBadRequest},
		{"out of range lng", "/v1/geocode/reverse?lat=0&lng=999", http.MethodGet, http.StatusBadRequest},
		{"method POST", "/v1/geocode/reverse?lat=0&lng=0", http.MethodPost, http.StatusMethodNotAllowed},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.url, nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: expected %d, got %d (body=%s)", c.name, c.want, rec.Code, rec.Body.String())
		}
	}
}
