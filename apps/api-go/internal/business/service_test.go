package business

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func businessEnvelope(actorID, commandType, targetID string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_" + commandType + "_" + actorID,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "PERSON", ID: "principal_" + actorID},
		Target:         command.Target{Type: "BusinessAccount", ID: targetID},
		IdempotencyKey: "idem_" + commandType + "_" + actorID,
		AuthContext:    map[string]any{"sessionId": "session_" + actorID},
		Purpose:        "business_test",
		CorrelationID:  "corr_" + commandType,
		RequestedAt:    "2026-08-25T00:00:00Z",
		Payload:        payload,
	}
}

func TestBusinessOwnershipAndMemberAuthorization(t *testing.T) {
	service := New()
	created := service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Bonsaidon"}))
	if created.Outcome != "ACCEPTED" || created.OperationRef == "" {
		t.Fatalf("create failed: %+v", created)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil {
		t.Fatalf("decode create payload: %v", err)
	}
	businessID, _ := body["businessId"].(string)
	if businessID == "" {
		t.Fatal("create payload missing businessId")
	}

	denied := service.Handle(businessEnvelope("intruder", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "Fake Store", "address": "Hanoi",
	}))
	if denied.Outcome != "REJECTED" || denied.Error == nil || denied.Error.ErrorCode != "BUSINESS_WRITE_REQUIRED" {
		t.Fatalf("intruder store write was not denied: %+v", denied)
	}

	added := service.Handle(businessEnvelope("owner", "AddBusinessMember", businessID, map[string]any{
		"businessId": businessID, "userId": "operator", "role": "OPERATOR",
	}))
	if added.Outcome != "ACCEPTED" {
		t.Fatalf("owner add member failed: %+v", added)
	}
	store := service.Handle(businessEnvelope("operator", "CreateBusinessStore", "new", map[string]any{
		"businessId": businessID, "name": "West Lake", "address": "Tay Ho",
	}))
	if store.Outcome != "ACCEPTED" || store.OperationRef == "" {
		t.Fatalf("operator store create failed: %+v", store)
	}
	financeDenied := service.Handle(businessEnvelope("operator", "SpendSummary", businessID, map[string]any{"businessId": businessID}))
	if financeDenied.Outcome != "REJECTED" || financeDenied.Error == nil || financeDenied.Error.ErrorCode != "BUSINESS_FINANCE_REQUIRED" {
		t.Fatalf("operator finance read was not denied: %+v", financeDenied)
	}
}

func TestListMyBusinessAccountsIsActorScoped(t *testing.T) {
	service := New()
	service.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "Owner Store"}))
	ownerList := service.Handle(businessEnvelope("owner", "ListMyBusinessAccounts", "mine", map[string]any{}))
	intruderList := service.Handle(businessEnvelope("intruder", "ListMyBusinessAccounts", "mine", map[string]any{}))
	if ownerList.Outcome != "ACCEPTED" || intruderList.Outcome != "ACCEPTED" {
		t.Fatalf("list failed: owner=%+v intruder=%+v", ownerList, intruderList)
	}
	if ownerList.OperationRef == intruderList.OperationRef {
		t.Fatalf("actor-scoped account lists unexpectedly match: %s", ownerList.OperationRef)
	}
}
