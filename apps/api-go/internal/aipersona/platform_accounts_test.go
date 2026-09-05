package aipersona

import "testing"

// AI-ACCOUNT-001: platform AI accounts must not collapse back into activity
// display metadata. Each has a stable addressable account, persona and photo.
func TestPlatformAIAccountsAreAddressableAndComplete(t *testing.T) {
	accounts := ListPlatformAccounts()
	if len(accounts) != 5 {
		t.Fatalf("got %d platform AI accounts, want 5", len(accounts))
	}
	ids, personas, handles := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, account := range accounts {
		if account.AccountID == "" || account.PersonaID == "" || account.Handle == "" || account.AvatarPath == "" || account.Role == "" || account.Personality == "" || account.WelcomeMessage == "" || len(account.SuggestedPrompts) < 2 || len(account.UGCSamples) < 2 {
			t.Fatalf("incomplete platform account: %+v", account)
		}
		if account.PersonaType != PersonaTypePlatformAI || account.Status != "ACTIVE" || account.AIStatus != "AI" {
			t.Fatalf("invalid platform account identity: %+v", account)
		}
		if ids[account.AccountID] || personas[account.PersonaID] || handles[account.Handle] {
			t.Fatalf("duplicate platform account identity: %+v", account)
		}
		ids[account.AccountID], personas[account.PersonaID], handles[account.Handle] = true, true, true
	}
}
