package identity

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func preferencesEnvelope(commandType, actor string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "cmd_preferences", CommandType: commandType, Actor: command.Actor{Type: "USER", ID: actor}, CorrelationID: "corr_preferences", Payload: payload}
}

func TestAccountPreferencesRoundTripUsesActorAsOwner(t *testing.T) {
	svc := New(nil)
	write := svc.Handle(preferencesEnvelope("UpdateAccountPreferences", "user_1", map[string]any{
		"userAccountId": "user_2", "socialAccounts": []any{map[string]any{"platform": "instagram", "handle": "proxy"}},
		"showOnProfile": true, "collaborationEnabled": true, "collaborationTypes": []string{"UGC"}, "collaborationContact": "hello@example.com",
	}))
	if write.Outcome != "ACCEPTED" || write.Aggregate == nil || write.Aggregate.ID != "user_1" || write.Aggregate.Version != 1 {
		t.Fatalf("unexpected write: %#v", write)
	}
	read := svc.Handle(preferencesEnvelope("GetAccountPreferences", "user_1", nil))
	if read.Outcome != "ACCEPTED" {
		t.Fatalf("unexpected read: %#v", read)
	}
	var body struct {
		Preferences AccountPreferences `json:"preferences"`
	}
	if err := json.Unmarshal([]byte(read.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Preferences.UserAccountID != "user_1" || !body.Preferences.ShowOnProfile || body.Preferences.CollaborationContact != "hello@example.com" {
		t.Fatalf("unexpected preferences: %#v", body.Preferences)
	}
}

func TestAccountPreferencesRejectsAnonymousActorAndOversizedContact(t *testing.T) {
	svc := New(nil)
	anonymous := preferencesEnvelope("GetAccountPreferences", "", nil)
	anonymous.Actor.Type = "ANONYMOUS"
	if got := svc.Handle(anonymous); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "ACCOUNT_PREFERENCES_FORBIDDEN" {
		t.Fatalf("unexpected anonymous result: %#v", got)
	}
	if got := svc.Handle(preferencesEnvelope("UpdateAccountPreferences", "user_1", map[string]any{"collaborationContact": string(make([]byte, 201))})); got.Outcome != "REJECTED" || got.Error == nil || got.Error.ErrorCode != "ACCOUNT_PREFERENCES_INVALID" {
		t.Fatalf("unexpected validation result: %#v", got)
	}
}
