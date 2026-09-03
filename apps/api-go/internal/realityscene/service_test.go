package realityscene

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelope(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "c1", CommandType: commandType, Actor: command.Actor{Type: "USER", ID: "u1"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "p1"}, Target: command.Target{Type: "RealityScene", ID: "westlake"}, Payload: payload}
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
