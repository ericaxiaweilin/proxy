package demand

import (
	"sync"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func demandEnvelope(commandType string, payload map[string]any, target command.Target) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "BUSINESS", ID: "business_001"},
		Target:         target,
		IdempotencyKey: "idem_" + commandType + "_001",
		Purpose:        "demand_builder",
		CorrelationID:  "corr_" + commandType,
		Payload:        payload,
	}
}

func completeDraft(t *testing.T, service *Service) string {
	t.Helper()
	created := service.Handle(demandEnvelope("CreateTaskDraft", map[string]any{
		"ownerUserAccountId": "user_001",
		"principal":          map[string]any{"type": "BUSINESS", "id": "business_001"},
		"sourceInput":        "Need two greeters for an opening event",
	}, command.Target{Type: "TaskDraft", ID: "new"}))
	if created.Outcome != "ACCEPTED" {
		t.Fatalf("create draft failed: %#v", created)
	}
	draftID := created.Aggregate.ID
	updated := service.Handle(demandEnvelope("UpdateTaskDraft", map[string]any{
		"expectedVersion": 1,
		"changes": map[string]any{
			"industry": "events", "scenario": "opening", "startAt": "2026-08-20T09:00:00Z", "endAt": "2026-08-20T12:00:00Z",
			"location":         map[string]any{"mode": "PLACE_ONLY", "label": "District 1 venue"},
			"slotGroups":       []any{map[string]any{"roleId": "GREETER", "quantity": 2}},
			"mustRequirements": []any{"arrive_on_time"}, "deliverables": []any{"attendance_report"},
			"budget":       map[string]any{"currency": "USD", "amountMinor": 5000, "pricingMode": "PER_SLOT_FIXED"},
			"matchingMode": "CURATED", "catalogVersion": "CATALOG_V1",
			"policySnapshot": map[string]any{"policySetId": "PSET_LAUNCH", "policySetVersion": "1"},
			"confirmation":   map[string]any{"scopeConfirmed": true, "materialChangePolicyConfirmed": true, "fundingAuthorizationConfirmed": true, "maxBudgetMinor": 5000},
		},
	}, command.Target{Type: "TaskDraft", ID: draftID}))
	if updated.Outcome != "ACCEPTED" {
		t.Fatalf("update draft failed: %#v", updated)
	}
	return draftID
}

func TestPreviewAndPendingPublish(t *testing.T) {
	service := New(nil, nil)
	draftID := completeDraft(t, service)
	preview := service.Handle(demandEnvelope("PreviewTaskDraft", map[string]any{"expectedVersion": 2}, command.Target{Type: "TaskDraft", ID: draftID}))
	if preview.Outcome != "ACCEPTED" || preview.Aggregate.State != "READY" {
		t.Fatalf("preview failed: %#v", preview)
	}
	publish := service.Handle(demandEnvelope("PublishTask", map[string]any{"expectedVersion": 2, "online": true}, command.Target{Type: "TaskDraft", ID: draftID}))
	if publish.Outcome != "PENDING" || publish.Error == nil || publish.Error.ErrorCode != "ADMISSION_GATE_NOT_CONFIGURED" {
		t.Fatalf("publish should stay pending: %#v", publish)
	}
	if service.Snapshot()[0].Lifecycle != "DRAFT" {
		t.Fatal("pending publish must not mutate lifecycle")
	}
}

func TestPreviewDoesNotRequirePublishAuthorization(t *testing.T) {
	service := New(nil, nil)
	draftID := completeDraft(t, service)
	updated := service.Handle(demandEnvelope("UpdateTaskDraft", map[string]any{
		"expectedVersion": 2,
		"changes": map[string]any{
			"scenario": "opening event with guided reception",
		},
	}, command.Target{Type: "TaskDraft", ID: draftID}))
	if updated.Outcome != "ACCEPTED" {
		t.Fatalf("material update failed: %#v", updated)
	}
	preview := service.Handle(demandEnvelope("PreviewTaskDraft", map[string]any{"expectedVersion": 3}, command.Target{Type: "TaskDraft", ID: draftID}))
	if preview.Outcome != "ACCEPTED" || preview.Aggregate.State != "READY" {
		t.Fatalf("preview must be available before publish authorization: %#v", preview)
	}
	publish := service.Handle(demandEnvelope("PublishTask", map[string]any{"expectedVersion": 3, "online": true}, command.Target{Type: "TaskDraft", ID: draftID}))
	if publish.Outcome != "REJECTED" || publish.Error == nil || publish.Error.ErrorCode != "TASK_DRAFT_INCOMPLETE" {
		t.Fatalf("publish must still require explicit confirmations: %#v", publish)
	}
}

func TestPublishExpandsAtomicSlotsWhenGatesAllow(t *testing.T) {
	allow := func(*TaskDraft, command.Envelope) GateDecision { return GateDecision{Status: "ALLOW"} }
	service := New(allow, allow)
	draftID := completeDraft(t, service)
	publish := service.Handle(demandEnvelope("PublishTask", map[string]any{"expectedVersion": 2, "online": true}, command.Target{Type: "TaskDraft", ID: draftID}))
	if publish.Outcome != "ACCEPTED" || publish.Aggregate.State != "COMMITTED" {
		t.Fatalf("publish failed: %#v", publish)
	}
	if len(service.Snapshot()[0].Slots) != 2 {
		t.Fatalf("expected 2 atomic slots, got %#v", service.Snapshot()[0].Slots)
	}
}

func TestRepositoryVersionGuardsAcrossServiceInstances(t *testing.T) {
	repository := NewMemoryRepository()
	first := NewWithRepository(nil, nil, repository)
	second := NewWithRepository(nil, nil, repository)
	draftID := completeDraft(t, first)

	var wait sync.WaitGroup
	results := make(chan command.Result, 2)
	for _, service := range []*Service{first, second} {
		wait.Add(1)
		go func(service *Service) {
			defer wait.Done()
			results <- service.Handle(demandEnvelope("UpdateTaskDraft", map[string]any{
				"expectedVersion": 2,
				"changes":         map[string]any{"draftProgress": 3},
			}, command.Target{Type: "TaskDraft", ID: draftID}))
		}(service)
	}
	wait.Wait()
	close(results)

	accepted := 0
	conflicted := 0
	for result := range results {
		switch {
		case result.Outcome == "ACCEPTED":
			accepted++
		case result.Error != nil && result.Error.ErrorCode == "TASK_DRAFT_VERSION_CONFLICT":
			conflicted++
		}
	}
	if accepted != 1 || conflicted != 1 {
		t.Fatalf("expected one accepted and one conflict, got accepted=%d conflicted=%d", accepted, conflicted)
	}
}
