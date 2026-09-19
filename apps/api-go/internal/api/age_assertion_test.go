package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/identity"
)

// AGE-BACKFILL-001: POST /v1/identity/age-assertion — 本人给自己补年龄断言。
func TestRecordAgeAssertionRequiresToken(t *testing.T) {
	server := &Server{Authenticator: stubAuthenticator{}}
	recorder := httptest.NewRecorder()
	server.recordAgeAssertion(recorder, httptest.NewRequest(http.MethodPost, "/v1/identity/age-assertion", strings.NewReader(`{"dateOfBirth":"1990-01-01"}`)))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "access_token_required") {
		t.Fatalf("body = %s, want access_token_required", recorder.Body.String())
	}
}

func TestRecordAgeAssertionRejectsBadDate(t *testing.T) {
	server := &Server{
		Authenticator: stubAuthenticator{},
		Identity:      identity.NewWithRepositoryAndClock(identity.NewMemoryRepository(nil), clock.NewFixed(time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC))),
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/identity/age-assertion", strings.NewReader(`{"dateOfBirth":"2030-01-01"}`))
	request.Header.Set("Authorization", "Bearer test-token")
	server.recordAgeAssertion(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "record_failed") {
		t.Fatalf("body = %s, want record_failed", recorder.Body.String())
	}
}

func TestRecordAgeAssertionNeedsIdentityService(t *testing.T) {
	server := &Server{Authenticator: stubAuthenticator{}}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/identity/age-assertion", strings.NewReader(`{"dateOfBirth":"1990-01-01"}`))
	request.Header.Set("Authorization", "Bearer test-token")
	server.recordAgeAssertion(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
}
