package realityscene

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelope(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "c1", CommandType: commandType, Actor: command.Actor{Type: "USER", ID: "u1"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "p1"}, Target: command.Target{Type: "RealityScene", ID: "westlake"}, Payload: payload}
}

func TestR27DynamicSceneSwitchesWholeContext(t *testing.T) {
	s := New()
	morning, found, err := s.GetDetail(t.Context(), "threebeans", "morning", time.Date(2026, 9, 6, 8, 0, 0, 0, time.UTC))
	if err != nil || !found {
		t.Fatalf("morning detail found=%v err=%v", found, err)
	}
	sunlight, found, err := s.GetDetail(t.Context(), "threebeans", "sunlight", time.Date(2026, 9, 6, 15, 0, 0, 0, time.UTC))
	if err != nil || !found {
		t.Fatalf("sunlight detail found=%v err=%v", found, err)
	}
	if len(morning.Variants) != 4 || morning.SelectedVariant == sunlight.SelectedVariant {
		t.Fatalf("variant switch failed: morning=%#v sunlight=%#v", morning, sunlight)
	}
	if morning.Humans[0].Role == sunlight.Humans[0].Role || morning.Menu[0].ID == "" || sunlight.LiveState.State != "AVAILABLE_NOW" {
		t.Fatalf("scene context did not switch together: morning=%#v sunlight=%#v", morning, sunlight)
	}
	for _, human := range sunlight.Humans {
		if human.IsAI {
			t.Fatalf("AI account leaked into human recommendation: %#v", human)
		}
	}
	if sunlight.Actions[0].State != "REQUIRES_HUMAN_ACCEPTANCE" || sunlight.Actions[1].MoneyMeaning == sunlight.Actions[2].MoneyMeaning {
		t.Fatalf("action boundaries unclear: %#v", sunlight.Actions)
	}
}

func TestUserSceneStateRoundTrip(t *testing.T) {
	s := New()
	written := s.HandleContext(t.Context(), envelope("SetRealitySceneSaved", map[string]any{"sceneId": "westlake", "enabled": true}))
	if written.Outcome != "ACCEPTED" {
		t.Fatalf("write=%#v", written)
	}
	listed := s.HandleContext(t.Context(), envelope("ListMyRealitySceneState", map[string]any{}))
	var payload struct {
		States []UserState `json:"states"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.States) != 1 || !payload.States[0].Saved || payload.States[0].SceneID != "westlake" {
		t.Fatalf("states=%#v", payload.States)
	}
}

func TestPublicFootprintCannotBeWrittenByClient(t *testing.T) {
	s := New()
	result := s.HandleContext(t.Context(), envelope("SetPublicRealitySceneFootprint", map[string]any{"sceneId": "westlake", "enabled": true}))
	if result.Outcome != "REJECTED" {
		t.Fatalf("public footprint write must be rejected: %#v", result)
	}
}

func TestScenePipelineRanksNearbyAndRecordsVisitTime(t *testing.T) {
	s := New()
	nearby, err := s.ListNearbyScenes(t.Context(), 21.0454, 105.8361, 5, 8)
	if err != nil || len(nearby) == 0 {
		t.Fatalf("nearby=%#v err=%v", nearby, err)
	}
	if nearby[0].DistanceMeters < 0 || nearby[0].RecommendationScore == 0 {
		t.Fatalf("ranking metadata missing: %#v", nearby[0])
	}
	result := s.HandleContext(t.Context(), envelope("SetPrivateRealitySceneVisited", map[string]any{"sceneId": "trucbach", "enabled": true}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("visit failed: %#v", result)
	}
	listed := s.HandleContext(t.Context(), envelope("ListMyRealitySceneState", map[string]any{}))
	var payload struct {
		States []UserState `json:"states"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.States) != 1 || payload.States[0].VisitedAt == nil {
		t.Fatalf("visit timeline missing: %#v", payload.States)
	}
}
