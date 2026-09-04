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
	"github.com/proxy-app/proxy-api/internal/aiboundary"
)

// Activity 是本地活动（对齐基线 activityCatalog 字段）。
type Activity struct {
	ID             string `json:"activityId"`
	Origin         string `json:"origin"` // PLATFORM | MERCHANT | USER | TEST (AI 不可作 origin — 平台发布主体)
	Title          string `json:"title"`
	Time           string `json:"time"`
	People         string `json:"people"`
	Price          string `json:"price"`
	MoneyFlow      string `json:"moneyFlow"` // FREE | PAY_TO_JOIN | PAID_TO_ATTEND
	PriceLabel     string `json:"priceLabel"`
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

	// AI 状态字段。AIStatus != NONE 时客户端必须显示 AI 标注 +
	// persona 头像 + 名字 (跟 X / Threads / 抖音 / 小红书的 "AI 生成"
	// 标注一致)。AI 不能作为 Activity.origin 存在 — origin 永远是
	// PLATFORM / MERCHANT / USER / TEST 中之一，AI 是 PLATFORM/MERCHANT
	// 在内容生成阶段的"助理"，不是活动主体本身。
	// AIActorKind ∈ { PLATFORM_AI, USER_TWIN, USER_ASSISTANT }。
	AIPersonaID     string `json:"aiPersonaId,omitempty"`
	AIPersonaName   string `json:"aiPersonaName,omitempty"`
	AIPersonaAvatar string `json:"aiPersonaAvatar,omitempty"`
	AIStatus        string `json:"aiStatus"` // NONE | AI_ASSISTED | AI_GENERATED
	AIActorKind     string `json:"aiActorKind,omitempty"`

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
	for i := range list { normalizeActivityMoneyAndAI(&list[i]) }
	sort.Slice(list, func(i, j int) bool { return list[i].Interested > list[j].Interested })
	return acceptedWithPayload(e, "Activity", "", 0, "LISTED", map[string]any{
		"activities": list,
		"note":       "活动读模型：计数服务端权威；参加后才开放群聊",
	}, nil)
}

func normalizeActivityMoneyAndAI(a *Activity) {
	if a.MoneyFlow == "" { if a.Price == "" || a.Price == "0₫" { a.MoneyFlow="FREE" } else { a.MoneyFlow="PAY_TO_JOIN" } }
	if a.PriceLabel == "" { switch a.MoneyFlow { case "FREE": a.PriceLabel="免费参加"; case "PAID_TO_ATTEND": a.PriceLabel="参加后你可获得"; default: a.PriceLabel="你需支付" } }
	if a.AIStatus == "" { a.AIStatus="NONE" }
}

// ---------- ToggleActivityInterest ----------

type activityRefPayload struct {
	ActivityID string `json:"activityId"`
}

func (s *Service) toggleInterest(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type,e.Principal.Type),aiboundary.InterestActivity) { return command.Rejected(e,"AI_ACTION_FORBIDDEN","AUTHORIZATION","AFTER_USER_ACTION","ai.action_forbidden",nil) }
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
	// ACT-CONTRACT-001: 单条返回也要 normalize（旧 PG 行缺 moneyFlow/
	// priceLabel/aiStatus，List 有 normalize 但 Toggle/Join 之前没有 → zod 炸）。
	normalizeActivityMoneyAndAI(&a)
	return acceptedWithPayload(e, "Activity", a.ID, 1, "INTEREST_UPDATED", map[string]any{
		"activity": a, "interested": interested,
	}, nil)
}

// ---------- JoinActivity ----------

func (s *Service) joinActivity(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type,e.Principal.Type),aiboundary.JoinActivity) { return command.Rejected(e,"AI_ACTION_FORBIDDEN","AUTHORIZATION","AFTER_USER_ACTION","ai.action_forbidden",nil) }
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
	// ACT-ATTEND-001: 报名成功必须落 participation 记录，后续 cancel/checkin/
	// noShow 凭它验归属。之前 Join 只改 repository 计数，participation 永远
	// 为空 → 考勤全是假成功。
	if s.participations != nil {
		s.participations.Ensure(p.ActivityID, e.Actor.ID, PartConfirmed)
	}
	// ACT-CONTRACT-001: 同上，Join 单条返回也要 normalize。
	normalizeActivityMoneyAndAI(&a)
	return acceptedWithPayload(e, "Activity", a.ID, 1, "JOINED", map[string]any{
		"activity": a,
		"joined":   true,
		"note":     "确认参加后开放活动群聊",
	}, nil)
}

func (s *Service) cancelActivity(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.CancelActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	// ACT-ATTEND-001: 只能取消自己报过名的活动；没记录=没报名，拒。
	// UpdateState=false 说明记录在检查后消失（并发），按失败处理，绝不假成功。
	if s.participations == nil {
		return command.Rejected(e, "ACTIVITY_CANCEL_FAILED", "INTERNAL", "SAFE_RETRY", "activity.cancel_failed", nil)
	}
	if _, ok := s.participations.Get(p.ActivityID, e.Actor.ID); !ok {
		return command.Rejected(e, "ACTIVITY_NOT_JOINED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_joined", nil)
	}
	if !s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartCancelled) {
		return command.Rejected(e, "ACTIVITY_CANCEL_FAILED", "CONCURRENCY", "SAFE_RETRY", "activity.cancel_failed", nil)
	}
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "CANCELLED", map[string]any{"activityId": p.ActivityID}, nil)
}
func (s *Service) checkinActivity(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.CheckinActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	// ACT-ATTEND-001: 只有 CONFIRMED（已报名且未取消）才能签到。
	if s.participations == nil {
		return command.Rejected(e, "ACTIVITY_CHECKIN_FAILED", "INTERNAL", "SAFE_RETRY", "activity.checkin_failed", nil)
	}
	rec, ok := s.participations.Get(p.ActivityID, e.Actor.ID)
	if !ok {
		return command.Rejected(e, "ACTIVITY_NOT_JOINED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_joined", nil)
	}
	if rec.State != PartConfirmed {
		return command.Rejected(e, "ACTIVITY_CHECKIN_NOT_ALLOWED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.checkin_not_allowed", map[string]any{"state": string(rec.State)})
	}
	if !s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartAttended) {
		return command.Rejected(e, "ACTIVITY_CHECKIN_FAILED", "CONCURRENCY", "SAFE_RETRY", "activity.checkin_failed", nil)
	}
	return acceptedWithPayload(e, "Activity", p.ActivityID, 1, "ATTENDED", map[string]any{"activityId": p.ActivityID}, nil)
}
func (s *Service) markNoShow(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.NoShowActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
	var p activityRefPayload
	if !decode(e.Payload, &p) || p.ActivityID == "" { return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	// ACT-ATTEND-001: payload 只有 activityId，自助标记只能标自己，且必须
	// 有 participation 记录（没报名的人不能给自己记 NO_SHOW 污染考勤）。
	// 注：组织者代标他人需要 targetUserId 字段 + 组织者鉴权，当前 wire 无此
	// 字段，保持自助语义，不扩大。
	if s.participations == nil {
		return command.Rejected(e, "ACTIVITY_NOSHOW_FAILED", "INTERNAL", "SAFE_RETRY", "activity.noshow_failed", nil)
	}
	rec, ok := s.participations.Get(p.ActivityID, e.Actor.ID)
	if !ok {
		return command.Rejected(e, "ACTIVITY_NOT_JOINED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.not_joined", nil)
	}
	if rec.State == PartCancelled {
		return command.Rejected(e, "ACTIVITY_NOSHOW_NOT_ALLOWED", "BUSINESS_STATE", "AFTER_USER_ACTION", "activity.noshow_not_allowed", map[string]any{"state": string(rec.State)})
	}
	if !s.participations.UpdateState(p.ActivityID, e.Actor.ID, PartNoShow) {
		return command.Rejected(e, "ACTIVITY_NOSHOW_FAILED", "CONCURRENCY", "SAFE_RETRY", "activity.noshow_failed", nil)
	}
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
//
// 平台没有"假数据"。冷启动期间，5 条活动都明确标 origin = "PLATFORM"，
// 配合 aiStatus = "AI_GENERATED" + aiActorKind = "PLATFORM_AI" + 一个
// 平台 AI 助手 persona (ai_001..ai_005)，由 Proxy 作为发布方承担
// 内容责任 — 而不是把 AI 数字人伪装成"活动主办方"。
//
// UI 端三件套：
//   * ORIGIN 徽标 (PLATFORM/MERCHANT/USER/TEST) — 永远指 *人*
//   * aiStatus 副标识 (NONE/AI_ASSISTED/AI_GENERATED) — 指内容生成方式
//   * aiActorKind + aiPersona* — 平台 AI 小美的辅助信息
//
// 新增字段 MoneyFlow / PriceLabel 把"客户预算"和"到店消费"分开：
// MoneyFlow ∈ { FREE, PAY_TO_JOIN, PAID_TO_ATTEND }。基线 5 条全是
// FREE 活动 + 门店各自消费 — 平台/AI 不能借活动收钱。
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
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_001", AIPersonaName: "平台 AI 小美 · 周末企划", AIPersonaAvatar: "☕", MoneyFlow:"FREE", PriceLabel:"免费参加",
		},
		{
			ID: "merchant_photo_day", Origin: "PLATFORM", Title: "木光咖啡 · 周日下午拍照季",
			Time: "周日 15:00–17:00", People: "6 / 10 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "自然光座位已预留，适合互相拍照和慢慢喝咖啡。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 3, Interested: 18, Joined: 6, Capacity: 10, Shares: 7,
			ParentTitle: "Proxy 周末咖啡企划",
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_002", AIPersonaName: "平台 AI 小美 · 拍照季", AIPersonaAvatar: "📸", MoneyFlow:"FREE", PriceLabel:"免费参加",
		},
		{
			ID: "user_photo_buddy", Origin: "PLATFORM", Title: "周六 咖啡拍照搭子",
			Time: "周六 15:00–17:00", People: "找 1 位", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "互相帮对方拍照，一起喝咖啡；到店消费各自承担。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 1, Interested: 5, Joined: 1, Capacity: 2, Shares: 2,
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_003", AIPersonaName: "平台 AI 小美 · 拍照搭子", AIPersonaAvatar: "🤝", MoneyFlow:"FREE", PriceLabel:"免费参加",
		},
		{
			ID: "merchant_tasting", Origin: "PLATFORM", Title: "岚庭餐厅 · 新菜尝鲜晚餐",
			Time: "周五 18:30–20:30", People: "4 / 6 人", Price: "0₫", Consumption: "活动套餐 399k / 人",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", RealitySceneID: "westlake", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "餐厅开放新品尝鲜场次，按活动套餐到店消费。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 2, Interested: 24, Joined: 4, Capacity: 6, Shares: 9,
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_004", AIPersonaName: "平台 AI 小美 · 餐厅尝鲜", AIPersonaAvatar: "🍽️", MoneyFlow:"FREE", PriceLabel:"免费参加",
		},
		{
			ID: "user_dinner_group", Origin: "PLATFORM", Title: "周五一起吃新菜",
			Time: "周五 18:30–20:30", People: "2 / 4 人", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", RealitySceneID: "westlake", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "围绕岚庭餐厅的新品场次组一个小饭局，一起尝鲜。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 1, Interested: 8, Joined: 2, Capacity: 4, Shares: 3,
			ParentTitle: "岚庭餐厅 · 新菜尝鲜晚餐",
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_005", AIPersonaName: "平台 AI 小美 · 饭局推荐", AIPersonaAvatar: "🍜", MoneyFlow:"FREE", PriceLabel:"免费参加",
		},
	}
}
