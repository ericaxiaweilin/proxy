package realityscene

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

type UserState struct {
	SceneID        string     `json:"sceneId"`
	Saved          bool       `json:"saved"`
	Planned        bool       `json:"planned"`
	PrivateVisited bool       `json:"privateVisited"`
	VisitedAt      *time.Time `json:"visitedAt,omitempty"`
}

type Scene struct {
	ID, Name, Area, Type, Best, Description                  string
	Latitude, Longitude, DistanceMeters, RecommendationScore float64
	Quality, Posts, Creators, Activities, Invites            int
	Active                                                   bool
}

func (s Scene) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID                  string  `json:"id"`
		Name                string  `json:"name"`
		Area                string  `json:"area"`
		Type                string  `json:"type"`
		Latitude            float64 `json:"latitude"`
		Longitude           float64 `json:"longitude"`
		Quality             int     `json:"quality"`
		Best                string  `json:"best"`
		Posts               int     `json:"posts"`
		Creators            int     `json:"creators"`
		Activities          int     `json:"activities"`
		Invites             int     `json:"invites"`
		Active              bool    `json:"active"`
		Description         string  `json:"description"`
		DistanceMeters      float64 `json:"distanceMeters,omitempty"`
		RecommendationScore float64 `json:"recommendationScore,omitempty"`
	}{s.ID, s.Name, s.Area, s.Type, s.Latitude, s.Longitude, s.Quality, s.Best, s.Posts, s.Creators, s.Activities, s.Invites, s.Active, s.Description, s.DistanceMeters, s.RecommendationScore})
}

type Repository interface {
	ListUserStates(context.Context, string) ([]UserState, error)
	SetUserState(context.Context, string, string, string, bool, time.Time) error
	ListScenes(context.Context) ([]Scene, error)
	ListNearbyScenes(context.Context, float64, float64, float64, int) ([]Scene, error)
}

type memoryRepository struct {
	mu     sync.Mutex
	m      map[string]UserState
	scenes []Scene
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{m: map[string]UserState{}, scenes: launchScenes()}
}
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
func (r *memoryRepository) SetUserState(_ context.Context, actorID, sceneID, field string, enabled bool, now time.Time) error {
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
		if enabled {
			visitedAt := now.UTC()
			state.VisitedAt = &visitedAt
		} else {
			state.VisitedAt = nil
		}
	}
	r.m[key] = state
	return nil
}
func (r *memoryRepository) ListScenes(_ context.Context) ([]Scene, error) {
	return append([]Scene(nil), r.scenes...), nil
}
func (r *memoryRepository) ListNearbyScenes(_ context.Context, lat, lng, radiusKM float64, limit int) ([]Scene, error) {
	out := make([]Scene, 0, len(r.scenes))
	for _, scene := range r.scenes {
		scene.DistanceMeters = haversineMeters(lat, lng, scene.Latitude, scene.Longitude)
		if scene.DistanceMeters <= radiusKM*1000 {
			scene.RecommendationScore = recommendationScore(scene)
			out = append(out, scene)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RecommendationScore == out[j].RecommendationScore {
			return out[i].DistanceMeters < out[j].DistanceMeters
		}
		return out[i].RecommendationScore > out[j].RecommendationScore
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func haversineMeters(aLat, aLng, bLat, bLng float64) float64 {
	const earth = 6371000.0
	p1, p2 := aLat*math.Pi/180, bLat*math.Pi/180
	dp := (bLat - aLat) * math.Pi / 180
	dl := (bLng - aLng) * math.Pi / 180
	h := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return earth * 2 * math.Atan2(math.Sqrt(h), math.Sqrt(1-h))
}
func recommendationScore(s Scene) float64 {
	popularity := float64(s.Posts) + 2*float64(s.Creators) + 4*float64(s.Activities) + 2*float64(s.Invites)
	return float64(s.Quality)*0.55 + math.Log1p(popularity)*8.0 - (s.DistanceMeters/1000)*2.5
}

func launchScenes() []Scene {
	return []Scene{
		{ID: "trucbach", Name: "Trúc Bạch 湖边", Area: "Ba Đình", Type: "湖边 · 夜景", Latitude: 21.0454, Longitude: 105.8361, Quality: 93, Best: "17:20–19:10", Posts: 86, Creators: 31, Activities: 8, Invites: 22, Active: true, Description: "湖边步行、夜景与小型聚会密度高。"},
		{ID: "westlake", Name: "West Lake Sunset Loop", Area: "Tây Hồ", Type: "骑行 · 日落", Latitude: 21.0669, Longitude: 105.8192, Quality: 96, Best: "16:30–18:40", Posts: 214, Creators: 72, Activities: 21, Invites: 48, Description: "高复访路线，适合骑行、散步和摄影。"},
		{ID: "phunghung", Name: "Phùng Hưng Mural Street", Area: "Hoàn Kiếm", Type: "街区 · 摄影", Latitude: 21.034, Longitude: 105.8442, Quality: 88, Best: "08:00–10:30", Posts: 102, Creators: 45, Activities: 4, Invites: 13, Description: "适合街拍、壁画和老城主题内容。"},
		{ID: "train", Name: "Hanoi Train Street", Area: "Hoàn Kiếm", Type: "街区 · 体验", Latitude: 21.0292, Longitude: 105.8426, Quality: 84, Best: "15:00–17:30", Posts: 167, Creators: 64, Activities: 3, Invites: 18, Description: "热门城市体验场景。"},
		{ID: "complex01", Name: "Complex 01", Area: "Đống Đa", Type: "空间 · 活动", Latitude: 21.0062, Longitude: 105.8284, Quality: 91, Best: "14:00–21:00", Posts: 74, Creators: 39, Activities: 14, Invites: 19, Active: true, Description: "近期活动密度高。"},
		{ID: "manzi", Name: "Manzi Art Space", Area: "Ba Đình", Type: "艺术 · 展览", Latitude: 21.0395, Longitude: 105.846, Quality: 89, Best: "10:00–18:00", Posts: 43, Creators: 22, Activities: 5, Invites: 9, Description: "内容质量高的展览空间。"},
		{ID: "banana", Name: "Red River Banana Island", Area: "Long Biên", Type: "自然 · 骑行", Latitude: 21.054, Longitude: 105.868, Quality: 87, Best: "06:30–09:00", Posts: 58, Creators: 26, Activities: 7, Invites: 17, Description: "适合骑行和自然内容。"},
		{ID: "bonsaidon", Name: "Bonsaidon · Tây Hồ", Area: "Tây Hồ", Type: "商家 · 社交", Latitude: 21.0621, Longitude: 105.8256, Quality: 90, Best: "14:00–20:30", Posts: 119, Creators: 41, Activities: 17, Invites: 32, Active: true, Description: "公开活动与 Creator 联动节点。"},
	}
}

type Service struct{ repo Repository }

func New() *Service { return NewWithRepository(newMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = newMemoryRepository()
	}
	return &Service{repo: repo}
}
func (s *Service) ListScenes(ctx context.Context) ([]Scene, error) { return s.repo.ListScenes(ctx) }
func (s *Service) ListNearbyScenes(ctx context.Context, lat, lng, radiusKM float64, limit int) ([]Scene, error) {
	return s.repo.ListNearbyScenes(ctx, lat, lng, radiusKM, limit)
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
	if err := s.repo.SetUserState(ctx, e.Actor.ID, sceneID, field, enabled, time.Now()); err != nil {
		return command.Rejected(e, "REALITY_SCENE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "reality_scene.write_failed", nil)
	}
	r := command.Accepted(e, "RealitySceneUserState", sceneID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"sceneId": sceneID, "field": field, "enabled": enabled})
	r.OperationRef = string(raw)
	return r
}
