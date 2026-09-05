package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// AI-ACCOUNT-API-001: the mobile recommendation rail reads the addressable
// social-account catalog, never the unrelated platform-assistant surface.
func TestListPlatformAIAccounts(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/ai/accounts", nil)
	(&Server{}).listPlatformAIAccounts(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var payload struct {
		Accounts []struct {
			AccountID   string `json:"accountId"`
			DisplayName string `json:"displayName"`
			AIStatus    string `json:"aiStatus"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Accounts) != 5 || payload.Accounts[0].AccountID == "" || payload.Accounts[0].DisplayName == "" || payload.Accounts[0].AIStatus != "AI" {
		t.Fatalf("unexpected social AI accounts: %+v", payload.Accounts)
	}
}
