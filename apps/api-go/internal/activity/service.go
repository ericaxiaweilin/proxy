// Package activity 是本地活动域（基线 activityhub / activitydetail）。
// Activity = 平台 / 商家 / 用户发起的本地活动；目录与计数均由服务端仓储权威维护。
// 命令：ListActivities / ToggleActivityInterest / JoinActivity。
// 规则（基线 activitydetail）：公开层用「感兴趣」而不是点赞；只有确认参加后
// 才开放活动群聊；名额满后不能再参加。
package activity

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"

	"github.com/proxy-app/proxy-api/internal/command"
)

// Activity 是本地活动（对齐基线 activityCatalog 字段）。
type Activity struct {
	ID             string `json:"activityId"`
	Origin         string `json:"origin"` // PLATFORM | MERCHANT | USER
	Title          string `json:"title"`
	Time           string `json:"time"`
	People         string `json:"people"`
	Price          string `json:"price"`
	Consumption    string `json:"consumption"`
	VenueIcon      string `json:"venueIcon"`
	VenueName      string `json:"venueName"`
	RealitySceneID string `json:"realitySceneId,omitempty"`
	VenueSpend     string `json:"venueSpend"`
	VenueType      string `json:"venueType"` // CAFE | RESTAURANT
	VenueTypeLabel string `json:"venueTypeLabel"`
	Desc           string `json:"desc"`
	Benefit        string `json:"benefit"`
	QACount        int    `json:"qaCount"`
	Interested     int    `json:"interested"`
	Joined         int    `json:"joined"`
	Capacity       int    `json:"capacity,omitempty"`
	Shares         int    `json:"shares"`
	ParentTitle    string `json:"parentTitle,omitempty"`

	interestedBy map[string]bool
	joinedBy     map[string]bool
}

// Service 处理活动命令。生产使用 PostgreSQL；New() 保留内存仓储供隔离测试使用。
type Service struct {
	repository Repository
	participations *ParticipationStore
}

var (
	ErrActivityNotFound = errors.New("activity not found")
	ErrAlreadyJoined    = errors.New("activity already joined")
	ErrActivityFull     = errors.New("activity full")
)

type Repository interface {
	Seed(ctx context.Context, activities []Activity) error
	List(ctx context.Context) ([]Activity, error)
	ToggleInterest(ctx context.Context, activityID, actorID string) (Activity, bool, error)
	Join(ctx context.Context, activityID, actorID string) (Activity, error)
}

type MemoryRepository struct {
	mu         sync.Mutex
	activities map[string]*Activity
	order      []string
}

func New() *Service {
	return NewWithRepository(&MemoryRepository{activities: make(map[string]*Activity)})
}
func NewWithParticipations(repo Repository, ps *ParticipationStore) *Service { return &Service{repository: repo, participations: ps} }

func NewWithRepository(repository Repository) *Service { return &Service{repository: repository, participations: NewParticipationStore()} }

// SeedDefaults 幂等写入基线 5 条活动（平台/商家数据，启动时 seed）。
func (s *Service) SeedDefaults() {
	seeds := defaultCatalog()
	items := make([]Activity, 0, len(seeds))
	for _, seed := range seeds {
		items = append(items, *seed)
	}
	_ = s.repository.Seed(context.Background(), items)
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "ListActivities", "ToggleActivityInterest", "JoinActivity", "CancelActivity", "CheckinActivity", "MarkNoShow":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "ListActivities":
		return s.listActivities(ctx, e)
	case "ToggleActivityInterest":
		return s.toggleInterest(ctx, e)
	case "JoinActivity":
		return s.joinActivity(ctx, e)
	case "CancelActivity":
		return s.cancelActivity(ctx, e)
	case "CheckinActivity":
		return s.checkinActivity(ctx, e)
	case "MarkNoShow":
		return s.markNoShow(ctx, e)
	default:
		return command.Rejected(e, "ACTIVITY_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "activity.unsupported_command", nil)
	}
}

// ---------- ListActivities ----------

func (s *Service) listActivities(ctx context.Context, e command.Envelope) command.Result {
	list, err := s.repository.List(ctx)
	if err != nil {
		return command.Rejected(e, "ACTIVITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.list_failed", nil)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Interested > list[j].Interested })
	return acceptedWithPayload(e, "Activity", "", 0, "LISTED", map[string]any{
		"activities": list,
		"note":       "活动读模型：计数服务端权威；参加后才开放群聊",
	}, nil)
}

// ---------- ToggleActivityInterest ----------

type activityRefPayload struct {
	ActivityID string `json:"activityId"`
}

func (s *Service) toggleInterest(ctx context.Context, e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	a, interested, err := s.repository.ToggleInterest(ctx, p.ActivityID, e.Actor.ID)
	if errors.Is(err, ErrActivityNotFound) {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ACTIVITY_INTEREST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.interest_failed", nil)
	}
	return acceptedWithPayload(e, "Activity", a.ID, 1, "INTEREST_UPDATED", map[string]any{
		"activity": a, "interested": interested,
	}, nil)
}

// ---------- JoinActivity ----------

func (s *Service) joinActivity(ctx context.Context, e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	a, err := s.repository.Join(ctx, p.ActivityID, e.Actor.ID)
	if errors.Is(err, ErrActivityNotFound) {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	if errors.Is(err, ErrAlreadyJoined) {
		return command.Rejected(e, "ACTIVITY_ALREADY_JOINED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.already_joined", nil)
	}
	if errors.Is(err, ErrActivityFull) {
		return command.Rejected(e, "ACTIVITY_FULL", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.full", map[string]any{"capacity": a.Capacity})
	}
	if err != nil {
		return command.Rejected(e, "ACTIVITY_JOIN_FAILED", "INTERNAL", "SAFE_RETRY", "activity.join_failed", nil)
	}
	return acceptedWithPayload(e, "Activity", a.ID, 1, "JOINED", map[string]any{
		"activity": a,
		"joined":   true,
		"note":     "确认参加后开放活动群聊",
	}, nil)
}

func (s *Service) cancelActivity(ctx context.Context, e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if s.participations != nil { s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartCancelled) }
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "CANCELLED", map[string]any{"activityId": p.ActivityID}, nil)
}
func (s *Service) checkinActivity(ctx context.Context, e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if s.participations != nil { s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartAttended) }
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "ATTENDED", map[string]any{"activityId": p.ActivityID}, nil)
}
func (s *Service) markNoShow(ctx context.Context, e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if s.participations != nil { s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartNoShow) }
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "NO_SHOW", map[string]any{"activityId": p.ActivityID}, nil)
}

func (r *MemoryRepository) Seed(_ context.Context, activities []Activity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range activities {
		item := activities[i]
		if _, exists := r.activities[item.ID]; !exists {
			r.activities[item.ID] = &item
			r.order = append(r.order, item.ID)
		}
	}
	return nil
}
func (r *MemoryRepository) List(_ context.Context) ([]Activity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]Activity, 0, len(r.order))
	for _, id := range r.order {
		if item := r.activities[id]; item != nil {
			items = append(items, *item)
		}
	}
	return items, nil
}
func (r *MemoryRepository) ToggleInterest(_ context.Context, activityID, actorID string) (Activity, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item := r.activities[activityID]
	if item == nil {
		return Activity{}, false, ErrActivityNotFound
	}
	if item.interestedBy == nil {
		item.interestedBy = make(map[string]bool)
	}
	interested := !item.interestedBy[actorID]
	if interested {
		item.interestedBy[actorID] = true
		item.Interested++
	} else {
		delete(item.interestedBy, actorID)
		item.Interested--
	}
	return *item, interested, nil
}
func (r *MemoryRepository) Join(_ context.Context, activityID, actorID string) (Activity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item := r.activities[activityID]
	if item == nil {
		return Activity{}, ErrActivityNotFound
	}
	if item.joinedBy == nil {
		item.joinedBy = make(map[string]bool)
	}
	if item.joinedBy[actorID] {
		return *item, ErrAlreadyJoined
	}
	if item.Capacity > 0 && item.Joined >= item.Capacity {
		return *item, ErrActivityFull
	}
	item.joinedBy[actorID] = true
	item.Joined++
	return *item, nil
}

// ---------- helpers ----------

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, target) == nil
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, _ []string) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, nil)
	raw, _ := json.Marshal(payload)
	result.OperationRef = string(raw)
	return result
}

// defaultCatalog 是基线 activityCatalog 的 5 条活动。
func defaultCatalog() []*Activity {
	return []*Activity{
		{
			ID: "proxy_coffee_weekend", Origin: "PLATFORM", Title: "Proxy 周末咖啡企划",
			Time: "本周六至周日", People: "特别企划", Price: "0₫", Consumption: "按门店场次",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "周末限定主题场次，联合合作咖啡店开放。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 4, Interested: 36, Joined: 18, Capacity: 24, Shares: 12,
		},
		{
			ID: "merchant_photo_day", Origin: "MERCHANT", Title: "木光咖啡 · 周日下午拍照季",
			Time: "周日 15:00–17:00", People: "6 / 10 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "自然光座位已预留，适合互相拍照和慢慢喝咖啡。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 3, Interested: 18, Joined: 6, Capacity: 10, Shares: 7,
			ParentTitle: "Proxy 周末咖啡企划",
		},
		{
			ID: "user_photo_buddy", Origin: "USER", Title: "周六 咖啡拍照搭子",
			Time: "周六 15:00–17:00", People: "找 1 位", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "互相帮对方拍照，一起喝咖啡；到店消费各自承担。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 1, Interested: 5, Joined: 1, Capacity: 2, Shares: 2,
		},
		{
			ID: "merchant_tasting", Origin: "MERCHANT", Title: "岚庭餐厅 · 新菜尝鲜晚餐",
			Time: "周五 18:30–20:30", People: "4 / 6 人", Price: "0₫", Consumption: "活动套餐 399k / 人",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", RealitySceneID: "westlake", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "餐厅开放新品尝鲜场次，按活动套餐到店消费。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 2, Interested: 24, Joined: 4, Capacity: 6, Shares: 9,
		},
		{
			ID: "user_dinner_group", Origin: "USER", Title: "周五一起吃新菜",
			Time: "周五 18:30–20:30", People: "2 / 4 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", RealitySceneID: "westlake", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "围绕岚庭餐厅的新品场次组一个小饭局，一起尝鲜。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 1, Interested: 8, Joined: 2, Capacity: 4, Shares: 3,
			ParentTitle: "岚庭餐厅 · 新菜尝鲜晚餐",
		},
	}
}
