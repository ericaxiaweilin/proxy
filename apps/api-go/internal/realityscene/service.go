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

// Detail is the R27 scene read model. A Scene is a time-bound behavior context,
// not another name for a venue. Catalog truth remains in Repository; the
// projections below are replaceable derived data and never create attendance,
// visit, or order evidence.
type Detail struct {
	SceneID         string        `json:"sceneId"`
	VenueID         string        `json:"venueId"`
	VenueName       string        `json:"venueName"`
	HeroImageURL    string        `json:"heroImageUrl"`
	MediaVersion    int           `json:"mediaVersion"`
	SelectedVariant string        `json:"selectedVariant"`
	Variants        []Variant     `json:"variants"`
	LiveState       LiveState     `json:"liveState"`
	Menu            []MenuItem    `json:"menu"`
	Humans          []Human       `json:"humans"`
	Actions         []SceneAction `json:"actions"`
	TruthBoundary   string        `json:"truthBoundary"`
}

type Variant struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Window      string   `json:"window"`
	StartMinute int      `json:"-"`
	EndMinute   int      `json:"-"`
	Facets      []string `json:"facets"`
	BestFor     string   `json:"bestFor"`
}

type LiveState struct {
	State       string    `json:"state"`
	Label       string    `json:"label"`
	BestWindow  string    `json:"bestWindow"`
	CapacityPct int       `json:"capacityPct"`
	FreshUntil  time.Time `json:"freshUntil"`
}

type MenuItem struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	PriceLabel string `json:"priceLabel"`
	SceneFit   string `json:"sceneFit"`
	Available  bool   `json:"available"`
	ImageURL   string `json:"imageUrl"`
}

type Human struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	Availability string `json:"availability"`
	FitReason    string `json:"fitReason"`
	SceneFit     int    `json:"sceneFit"`
	IsAI         bool   `json:"isAI"`
	AvatarURL    string `json:"avatarUrl"`
}

type SceneAction struct {
	Type         string `json:"type"`
	Label        string `json:"label"`
	State        string `json:"state"`
	MoneyMeaning string `json:"moneyMeaning"`
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
		{ID: "threebeans", Name: "Three Beans · Cầu Giấy", Area: "Cầu Giấy", Type: "咖啡 · 动态场景", Latitude: 21.0359, Longitude: 105.7906, Quality: 94, Best: "07:30–20:30", Posts: 128, Creators: 36, Activities: 12, Invites: 27, Active: true, Description: "同一门店按时间切换咖啡、出片、下班社交与周末活动场景。"},
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

func (s *Service) GetDetail(ctx context.Context, sceneID, requestedVariant string, now time.Time) (Detail, bool, error) {
	scenes, err := s.repo.ListScenes(ctx)
	if err != nil {
		return Detail{}, false, err
	}
	var scene Scene
	found := false
	for _, candidate := range scenes {
		if candidate.ID == sceneID {
			scene, found = candidate, true
			break
		}
	}
	if !found {
		return Detail{}, false, nil
	}
	variants := variantsFor(scene)
	selected := variants[0]
	minute := now.Hour()*60 + now.Minute()
	for _, candidate := range variants {
		if requestedVariant == candidate.ID || (requestedVariant == "" && minute >= candidate.StartMinute && minute < candidate.EndMinute) {
			selected = candidate
			break
		}
	}
	state := "GOOD_SOON"
	label := "近期适合"
	if minute >= selected.StartMinute && minute < selected.EndMinute {
		state, label = "AVAILABLE_NOW", "现在适合"
	}
	if !scene.Active && state == "AVAILABLE_NOW" {
		state, label = "GOOD_SOON", "近期适合"
	}
	return Detail{
		SceneID: scene.ID, VenueID: venueIDFor(scene), VenueName: scene.Name,
		HeroImageURL: heroImageFor(scene.ID), MediaVersion: 1,
		SelectedVariant: selected.ID, Variants: variants,
		LiveState: LiveState{State: state, Label: label, BestWindow: selected.Window, CapacityPct: capacityFor(selected.ID, minute), FreshUntil: now.UTC().Add(5 * time.Minute)},
		Menu:      menuFor(selected.ID), Humans: humansFor(selected.ID),
		Actions: []SceneAction{
			{Type: "DIRECT_INVITE", Label: "邀请真人", State: "REQUIRES_HUMAN_ACCEPTANCE", MoneyMeaning: "费用约定，不代表已付款或收入"},
			{Type: "OPEN_TASK", Label: "发布机会", State: "ACCEPTS_APPLICATIONS", MoneyMeaning: "标价是完成任务可获得的报酬"},
			{Type: "PUBLIC_ACTIVITY", Label: "报名活动", State: "REGISTRATION_ONLY", MoneyMeaning: "价格是参与者需支付的报名或消费费用"},
		},
		TruthBoundary: "推荐不预订真人；报名不等于到场；AI 预览不产生到访、出席或订单证据。",
	}, true, nil
}

func heroImageFor(sceneID string) string {
	if sceneID == "threebeans" {
		return "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=86"
	}
	return "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=1200&q=86"
}

func venueIDFor(scene Scene) string {
	if scene.ID == "threebeans" {
		return "venue_threebeans_caugiay"
	}
	return "venue_" + scene.ID
}
func variantsFor(scene Scene) []Variant {
	if scene.ID == "threebeans" {
		return []Variant{
			{ID: "morning", Name: "Morning Coffee", Window: "07:30–10:30", StartMinute: 450, EndMinute: 630, Facets: []string{"安静", "快速", "一起办公"}, BestFor: "快速咖啡、独处办公、通勤前碰面"},
			{ID: "sunlight", Name: "Sunlight Coffee", Window: "14:00–17:00", StartMinute: 840, EndMinute: 1020, Facets: []string{"自然光", "出片", "轻社交"}, BestFor: "喝咖啡、拍照、第一次见面"},
			{ID: "afterwork", Name: "Afterwork Coffee", Window: "17:30–20:30", StartMinute: 1050, EndMinute: 1230, Facets: []string{"下班后", "聊天", "轻约会"}, BestFor: "双人到四人的轻社交"},
			{ID: "weekend", Name: "Weekend Social", Window: "周末 14:00–19:00", StartMinute: 840, EndMinute: 1140, Facets: []string{"多人局", "活动", "Creator"}, BestFor: "公开活动和认识新朋友"},
		}
	}
	return []Variant{{ID: "best-time", Name: scene.Type, Window: scene.Best, StartMinute: 0, EndMinute: 1440, Facets: []string{scene.Type}, BestFor: scene.Description}}
}
func capacityFor(variant string, minute int) int {
	base := map[string]int{"morning": 61, "sunlight": 39, "afterwork": 74, "weekend": 81}[variant]
	if base == 0 {
		base = 52
	}
	if minute%60 > 45 {
		base += 4
	}
	return base
}
func menuFor(variant string) []MenuItem {
	items := []MenuItem{{ID: "sku_corn_coffee", Name: "Cafe Kem Bắp", PriceLabel: "45K+", SceneFit: "高 UGC Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=520&q=84"}, {ID: "sku_matcha", Name: "Matcha Latte", PriceLabel: "50K", SceneFit: "高出片 Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=520&q=84"}}
	if variant == "afterwork" {
		items = []MenuItem{{ID: "sku_passion", Name: "Passion Guava", PriceLabel: "45K", SceneFit: "Afterwork Fit", Available: true, ImageURL: "https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&w=520&q=84"}, items[1]}
	}
	if variant == "weekend" {
		items = append(items, MenuItem{ID: "sku_popcorn", Name: "Bắp Rang Bơ", PriceLabel: "55K", SceneFit: "多人分享", Available: true, ImageURL: "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=520&q=84"})
	}
	return items
}
func humansFor(variant string) []Human {
	role := "Cafe / Lifestyle"
	availability := "本周可约"
	if variant == "morning" {
		role, availability = "Coffee / Work", "上午可约"
	}
	if variant == "weekend" {
		role, availability = "Host / Lifestyle", "周末可约"
	}
	return []Human{{ID: "creator_mai", Name: "Mai", Role: role, Availability: availability, FitReason: "同类 Scene 有真实完成记录", SceneFit: 96, IsAI: false, AvatarURL: "https://images.unsplash.com/photo-1616325629936-99a9013c29c6?auto=format&fit=crop&w=240&q=84"}, {ID: "creator_linh", Name: "Linh", Role: "Photo / Lifestyle", Availability: "近期可约", FitReason: "出片与到访转化稳定", SceneFit: 92, IsAI: false, AvatarURL: "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=240&q=84"}, {ID: "creator_trang", Name: "Trang", Role: "Food / UGC", Availability: "周末可约", FitReason: "相关 SKU 内容经验", SceneFit: 88, IsAI: false, AvatarURL: "https://images.unsplash.com/photo-1511081692775-05d0f180a065?auto=format&fit=crop&w=240&q=84"}}
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
