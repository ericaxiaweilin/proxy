package realityscene

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/proxy-app/proxy-api/internal/command"
)

type UserState struct {
	SceneID        string `json:"sceneId"`
	Saved          bool   `json:"saved"`
	Planned        bool   `json:"planned"`
	PrivateVisited bool   `json:"privateVisited"`
}

type Repository interface {
	ListUserStates(context.Context, string) ([]UserState, error)
	SetUserState(context.Context, string, string, string, bool) error
}

type memoryRepository struct {
	mu sync.Mutex
	m  map[string]UserState
}

func newMemoryRepository() *memoryRepository { return &memoryRepository{m: map[string]UserState{}} }
func (r *memoryRepository) ListUserStates(_ context.Context, actorID string) ([]UserState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []UserState{}
	for key, state := range r.m {
		if len(key) > len(actorID) && key[:len(actorID)+1] == actorID+"|" {
			out = append(out, state)
		}
	}
	return out, nil
}
func (r *memoryRepository) SetUserState(_ context.Context, actorID, sceneID, field string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := actorID + "|" + sceneID
	state := r.m[key]
	state.SceneID = sceneID
	switch field {
	case "saved":
		state.Saved = enabled
	case "planned":
		state.Planned = enabled
	case "private_visited":
		state.PrivateVisited = enabled
	}
	r.m[key] = state
	return nil
}

type Service struct{ repo Repository }

func New() *Service { return NewWithRepository(newMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = newMemoryRepository()
	}
	return &Service{repo: repo}
}
func (s *Service) Supports(t string) bool {
	return t == "ListMyRealitySceneState" || t == "SetRealitySceneSaved" || t == "SetRealityScenePlanned" || t == "SetPrivateRealitySceneVisited"
}
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "REALITY_SCENE_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_REAUTH", "reality_scene.actor_required", nil)
	}
	if e.CommandType == "ListMyRealitySceneState" {
		states, err := s.repo.ListUserStates(ctx, e.Actor.ID)
		if err != nil {
			return command.Rejected(e, "REALITY_SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.read_failed", nil)
		}
		r := command.Accepted(e, "RealitySceneStateCollection", e.Actor.ID, 1, "READY", nil)
		raw, _ := json.Marshal(map[string]any{"states": states})
		r.OperationRef = string(raw)
		return r
	}
	sceneID, _ := e.Payload["sceneId"].(string)
	enabled, ok := e.Payload["enabled"].(bool)
	if sceneID == "" || !ok {
		return command.Rejected(e, "REALITY_SCENE_INPUT_INVALID", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.input_invalid", nil)
	}
	field := map[string]string{"SetRealitySceneSaved": "saved", "SetRealityScenePlanned": "planned", "SetPrivateRealitySceneVisited": "private_visited"}[e.CommandType]
	if field == "" {
		return command.Rejected(e, "REALITY_SCENE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "reality_scene.command_unsupported", nil)
	}
	if err := s.repo.SetUserState(ctx, e.Actor.ID, sceneID, field, enabled); err != nil {
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneUserState", sceneID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"sceneId": sceneID, "field": field, "enabled": enabled})
	r.OperationRef = string(raw)
	return r
}
