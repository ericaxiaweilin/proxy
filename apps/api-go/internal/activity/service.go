// Package activity 是本地活动域（基线 activityhub / activitydetail）。
// Activity = 平台 / 商家 / 用户发起的本地活动（P0 内存读模型；计数服务端权威）。
// 命令：ListActivities / ToggleActivityInterest / JoinActivity。
// 规则（基线 activitydetail）：公开层用「感兴趣」而不是点赞；只有确认参加后
// 才开放活动群聊；名额满后不能再参加。
package activity

import (
	"context"
	"encoding/json"
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

// Service 处理活动命令（P0：内存仓储，进程内权威计数）。
type Service struct {
	mu         sync.Mutex
	activities map[string]*Activity
	order      []string
}

func New() *Service {
	return &Service{activities: make(map[string]*Activity)}
}

// SeedDefaults 幂等写入基线 5 条活动（平台/商家数据，启动时 seed）。
func (s *Service) SeedDefaults() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, seed := range defaultCatalog() {
		if _, exists := s.activities[seed.ID]; exists {
			continue
		}
		s.activities[seed.ID] = seed
		s.order = append(s.order, seed.ID)
	}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "ListActivities", "ToggleActivityInterest", "JoinActivity":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(_ context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "ListActivities":
		return s.listActivities(e)
	case "ToggleActivityInterest":
		return s.toggleInterest(e)
	case "JoinActivity":
		return s.joinActivity(e)
	default:
		return command.Rejected(e, "ACTIVITY_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "activity.unsupported_command", nil)
	}
}

// ---------- ListActivities ----------

func (s *Service) listActivities(e command.Envelope) command.Result {
	list := make([]Activity, 0, len(s.order))
	for _, id := range s.order {
		if a, ok := s.activities[id]; ok {
			list = append(list, *a)
		}
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

func (s *Service) toggleInterest(e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
	a, ok := s.activities[p.ActivityID]
	if !ok {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	if a.interestedBy == nil {
		a.interestedBy = make(map[string]bool)
	}
	if a.interestedBy[e.Actor.ID] {
		delete(a.interestedBy, e.Actor.ID)
		a.Interested--
	} else {
		a.interestedBy[e.Actor.ID] = true
		a.Interested++
	}
	return acceptedWithPayload(e, "Activity", a.ID, 1, "INTEREST_UPDATED", map[string]any{
		"activity":   *a,
		"interested": a.interestedBy[e.Actor.ID],
	}, nil)
}

// ---------- JoinActivity ----------

func (s *Service) joinActivity(e command.Envelope) command.Result {
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
	a, ok := s.activities[p.ActivityID]
	if !ok {
		return command.Rejected(e, "ACTIVITY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_found", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	if a.joinedBy == nil {
		a.joinedBy = make(map[string]bool)
	}
	if a.joinedBy[e.Actor.ID] {
		return command.Rejected(e, "ACTIVITY_ALREADY_JOINED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.already_joined", nil)
	}
	if a.Capacity > 0 && a.Joined >= a.Capacity {
		return command.Rejected(e, "ACTIVITY_FULL", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.full", map[string]any{"capacity": a.Capacity})
	}
	a.joinedBy[e.Actor.ID] = true
	a.Joined++
	return acceptedWithPayload(e, "Activity", a.ID, 1, "JOINED", map[string]any{
		"activity": *a,
		"joined":   true,
		"note":     "确认参加后开放活动群聊",
	}, nil)
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
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "周末限定主题场次，联合合作咖啡店开放。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 4, Interested: 36, Joined: 18, Capacity: 24, Shares: 12,
		},
		{
			ID: "merchant_photo_day", Origin: "MERCHANT", Title: "木光咖啡 · 周日下午拍照季",
			Time: "周日 15:00–17:00", People: "6 / 10 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "自然光座位已预留，适合互相拍照和慢慢喝咖啡。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 3, Interested: 18, Joined: 6, Capacity: 10, Shares: 7,
			ParentTitle: "Proxy 周末咖啡企划",
		},
		{
			ID: "user_photo_buddy", Origin: "USER", Title: "周六 咖啡拍照搭子",
			Time: "周六 15:00–17:00", People: "找 1 位", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "互相帮对方拍照，一起喝咖啡；到店消费各自承担。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 1, Interested: 5, Joined: 1, Capacity: 2, Shares: 2,
		},
		{
			ID: "merchant_tasting", Origin: "MERCHANT", Title: "岚庭餐厅 · 新菜尝鲜晚餐",
			Time: "周五 18:30–20:30", People: "4 / 6 人", Price: "0₫", Consumption: "活动套餐 399k / 人",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "餐厅开放新品尝鲜场次，按活动套餐到店消费。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 2, Interested: 24, Joined: 4, Capacity: 6, Shares: 9,
		},
		{
			ID: "user_dinner_group", Origin: "USER", Title: "周五一起吃新菜",
			Time: "周五 18:30–20:30", People: "2 / 4 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "围绕岚庭餐厅的新品场次组一个小饭局，一起尝鲜。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 1, Interested: 8, Joined: 2, Capacity: 4, Shares: 3,
			ParentTitle: "岚庭餐厅 · 新菜尝鲜晚餐",
		},
	}
}
