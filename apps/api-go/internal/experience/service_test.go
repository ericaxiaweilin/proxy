package experience

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeForExperience(contextName string) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_experience_001",
		CommandType:    CommandGetExperienceManifest,
		CommandVersion: 1,
		Actor: command.Actor{
			Type: "USER",
			ID:   "user_001",
		},
		Principal: command.Principal{
			Type: "USER",
			ID:   "user_001",
		},
		Target: command.Target{
			Type: "ExperienceManifest",
			ID:   contextName,
		},
		IdempotencyKey: "idem_experience_001",
		AuthContext:    map[string]any{"role": "USER"},
		Purpose:        "experience_manifest",
		CorrelationID:  "corr_experience_001",
		RequestedAt:    "2026-08-17T14:00:00Z",
		Payload: map[string]any{
			"context": contextName,
		},
	}
}

func TestRequesterManifest(t *testing.T) {
	service := New()

	result := service.Handle(envelopeForExperience("REQUESTER"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", result.Outcome, result.Error)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("manifest operationRef is not JSON: %v", err)
	}

	if payload["schemaVersion"] != "1.0" {
		t.Fatalf("unexpected schemaVersion: %+v", payload["schemaVersion"])
	}

	if payload["context"] != "REQUESTER" {
		t.Fatalf("unexpected context: %+v", payload["context"])
	}

	me, ok := payload["me"].(map[string]any)
	if !ok {
		t.Fatalf("missing me payload")
	}

	sections, ok := me["sections"].([]any)
	if !ok || len(sections) != 5 {
		t.Fatalf("expected five server-composed Me sections, got %+v", me["sections"])
	}

	if me["mode"] != "REPLACE" {
		t.Fatalf("expected REPLACE mode, got %+v", me["mode"])
	}

	var typed manifest
	if err := json.Unmarshal([]byte(result.OperationRef), &typed); err != nil {
		t.Fatalf("manifest did not decode to typed payload: %v", err)
	}
	if got := typed.Me.Sections[0].Items[0].Icon; got != "profile-ring" {
		t.Fatalf("homepage icon drifted from Module Logo Master: %q", got)
	}
	if got := typed.Me.Sections[1].Items[0].Icon; got != "target" {
		t.Fatalf("friend relationship icon drifted from Module Logo Master: %q", got)
	}
	market := typed.Me.Sections[2]
	if market.ID != "my_market" || len(market.Items) != 4 {
		t.Fatalf("unexpected my market section: %+v", market)
	}
	// R15.40.3: facet section 补回（与 me.tsx REQUESTER_ME.sections 同步）。
	facet := typed.Me.Sections[4]
	if facet.ID != "facet" || len(facet.Items) != 1 {
		t.Fatalf("unexpected facet section: %+v", facet)
	}
	if facet.Items[0].ID != "facet_home" || facet.Items[0].Action.Route != "facet" {
		t.Fatalf("facet item drifted: %+v", facet.Items[0])
	}
	want := []struct{ id, label, route string }{
		{"my_orders", "我的订单", "myorders"},
		{"availability", "能力与可用时间", "available"},
		{"my_activities", "我的活动", "myactivities"},
		{"favorites", "收藏", "favorites"},
	}
	for index, expected := range want {
		item := market.Items[index]
		if item.ID != expected.id || item.Label != expected.label || item.Action.Type != "OPEN_REGISTERED_ROUTE" || item.Action.Route != expected.route {
			t.Fatalf("my market item %d drifted to an obsolete baseline: %+v", index, item)
		}
	}
}

func TestRejectsUnknownContext(t *testing.T) {
	service := New()

	result := service.Handle(envelopeForExperience("ADMIN"))
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", result.Outcome)
	}

	if result.Error == nil || result.Error.ErrorCode != "INVALID_EXPERIENCE_CONTEXT" {
		t.Fatalf("unexpected error: %+v", result.Error)
	}
}

// ---------- R15.49 ListExperiences ----------

func TestListExperiences_HappyPath(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	result := svc.HandleContext(context.Background(), envelopeForListExperiences())
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", result)
	}
	if result.Aggregate.State != "LISTED" {
		t.Errorf("expected state=LISTED, got %q", result.Aggregate.State)
	}
	var payload struct {
		Experiences []ExperienceSummary `json:"experiences"`
		Count       int                 `json:"count"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("failed to parse OperationRef: %v", err)
	}
	if payload.Count != 24 {
		t.Errorf("expected 24 default experiences, got %d", payload.Count)
	}
	if len(payload.Experiences) != 24 {
		t.Errorf("expected 24 entries, got %d", len(payload.Experiences))
	}
	// 验证字段被正确序列化
	first := payload.Experiences[0]
	if first.ExperienceID == "" || first.Title == "" || first.Category == "" || first.Origin == "" {
		t.Errorf("first experience missing required fields: %+v", first)
	}
}

func TestListExperiences_AnonymousAllowed(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewWithRepository(repo)
	env := envelopeForListExperiences()
	env.Actor = command.Actor{Type: "PUBLIC", ID: "anon"}
	result := svc.HandleContext(context.Background(), env)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("anonymous should be allowed, got %#v", result)
	}
}

func TestListExperiences_CustomSeed(t *testing.T) {
	custom := []ExperienceSummary{
		{ExperienceID: "exp_a", Title: "A", Category: "X", Origin: "PLATFORM", City: "HCMC", Status: "OPEN", Capacity: 5, Interested: 2},
		{ExperienceID: "exp_b", Title: "B", Category: "Y", Origin: "MERCHANT", City: "HANOI", Status: "OPEN", Capacity: 10, Interested: 3},
	}
	repo := NewMemoryRepositoryWithSeed(custom)
	svc := NewWithRepository(repo)
	result := svc.HandleContext(context.Background(), envelopeForListExperiences())
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", result)
	}
	var payload struct {
		Experiences []ExperienceSummary `json:"experiences"`
		Count       int                 `json:"count"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("failed to parse OperationRef: %v", err)
	}
	if payload.Count != 2 {
		t.Errorf("expected 2 seeded, got %d", payload.Count)
	}
	if payload.Experiences[0].City != "HCMC" || payload.Experiences[1].City != "HANOI" {
		t.Errorf("seeded data not preserved: %+v", payload.Experiences)
	}
}

func TestListExperiences_NoRepository(t *testing.T) {
	svc := New() // 不带 repository
	result := svc.HandleContext(context.Background(), envelopeForListExperiences())
	if result.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED without repository, got %#v", result)
	}
	if result.Error == nil || result.Error.ErrorCode != "EXPERIENCE_LIST_NO_REPOSITORY" {
		t.Errorf("expected EXPERIENCE_LIST_NO_REPOSITORY, got %#v", result.Error)
	}
}

func envelopeForListExperiences() command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_list_exp_001",
		CommandType:    CommandListExperiences,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Experience", ID: "list"},
		IdempotencyKey: "test_list_exp_123",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
	}
}
