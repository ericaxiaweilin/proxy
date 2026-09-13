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
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/aiboundary"
	"github.com/proxy-app/proxy-api/internal/command"
)

// Activity 是本地活动（对齐基线 activityCatalog 字段）。
type Activity struct {
	ID              string `json:"activityId"`
	// Code 是 R58 成功页展示编号（PX-A-yymmdd-####，展示用；权威主键仍是 ID）。
	Code            string `json:"code,omitempty"`
	Origin          string `json:"origin"` // PLATFORM | MERCHANT | USER | TEST (AI 不可作 origin — 平台发布主体)
	Title           string `json:"title"`
	Time            string `json:"time"`
	People          string `json:"people"`
	Price           string `json:"price"`
	MoneyFlow       string `json:"moneyFlow"` // FREE | PAY_TO_JOIN | PAID_TO_ATTEND
	PriceLabel      string `json:"priceLabel"`
	Consumption     string `json:"consumption"`
	VenueIcon       string `json:"venueIcon"`
	VenueName       string `json:"venueName"`
	RealitySceneID  string `json:"realitySceneId,omitempty"`
	VenueSpend      string `json:"venueSpend"`
	VenueType       string `json:"venueType"` // CAFE | RESTAURANT
	VenueTypeLabel  string `json:"venueTypeLabel"`
	// CoverImageURL 活动封面图（R17.x 预留，omitempty：上传管线接好之前
	// 不下发，客户端见契约注释）。
	CoverImageURL   string `json:"coverImageUrl,omitempty"`
	Desc            string `json:"desc"`
	Benefit         string `json:"benefit"`
	QACount         int    `json:"qaCount"`
	Interested      int    `json:"interested"`
	Joined          int    `json:"joined"`
	Capacity        int    `json:"capacity,omitempty"`
	Shares          int    `json:"shares"`
	ParentTitle     string `json:"parentTitle,omitempty"`
	OwnerID         string `json:"ownerId,omitempty"`
	Status          string `json:"status,omitempty"`
	ConsumptionTerm string `json:"consumptionTerm,omitempty"`
	// R58: 报名方式 OPEN(自由报名)/REVIEW(审核后加入)/INVITE_ONLY(仅邀请)。
	SignupMode string `json:"signupMode,omitempty"`
	// R58: 主题（日落/奥黛/胶片/本地人…），可选。
	Theme string `json:"theme,omitempty"`
	// MerchantName 以商家名义发布时的店名（MERCHANT-PUBLISH-001，omitempty）。
	// 只认 api 层注记；个人发布为空。
	MerchantName    string `json:"merchantName,omitempty"`

	// AI 状态字段。AIStatus != NONE 时客户端必须显示 AI 标注 +
	// persona 头像 + 名字 (跟 X / Threads / 抖音 / 小红书的 "AI 生成"
	// 标注一致)。AI 不能作为 Activity.origin 存在 — origin 永远是
	// PLATFORM / MERCHANT / USER / TEST 中之一，AI 是 PLATFORM/MERCHANT
	// 在内容生成阶段的"助理"，不是活动主体本身。
	// AIActorKind ∈ { PLATFORM_AI, USER_TWIN, USER_ASSISTANT }。
	AIPersonaID     string `json:"aiPersonaId,omitempty"`
	AIPersonaName   string `json:"aiPersonaName,omitempty"`
	AIPersonaAvatar string `json:"aiPersonaAvatar,omitempty"`
	// R17.x: aiPersonaPhoto 是资产 photo 引用 (URL 或
	// 相对 assets/ 路径)。 平台 AI 角色 (PLATFORM_AI) 必填
	// (ai_001-ai_005 都有 SVG 头像, 见
	// apps/mobile/assets/ai-personas/INDEX.md) — 客户端
	// 用 Image 渲染, fallback 到 AIPersonaAvatar emoji.
	// 必须明确标识 AI 身份, 不能"看起来像真人". USER_TWIN
	// 必须先有 LikenessConsent LIVE (PRD LC-07) 才会下发.
	AIPersonaPhoto  string `json:"aiPersonaPhoto,omitempty"`
	AIStatus        string `json:"aiStatus"` // NONE | AI_ASSISTED | AI_GENERATED
	AIActorKind     string `json:"aiActorKind,omitempty"`

	interestedBy map[string]bool
	joinedBy     map[string]bool
}

// Service 处理活动命令。生产使用 PostgreSQL；New() 保留内存仓储供隔离测试使用。
type Service struct {
	repository     Repository
	participations *ParticipationStore
}

var (
	ErrActivityNotFound = errors.New("activity not found")
	ErrAlreadyJoined    = errors.New("activity already joined")
	ErrActivityFull     = errors.New("activity full")
)

type Repository interface {
	Seed(ctx context.Context, activities []Activity) error
	Create(ctx context.Context, activity Activity) error
	List(ctx context.Context) ([]Activity, error)
	ToggleInterest(ctx context.Context, activityID, actorID string) (Activity, bool, error)
	Join(ctx context.Context, activityID, actorID string) (Activity, error)

	// R17.x: “我的活动” 物化路径。
	// ListByOwner 返回该 actor 作为 owner (Origin=USER 且 ownerId=actor) 创建的活动。
	// ListByParticipant 返回该 actor 参加了的活动 (activity.participants 表)。
	// 两个方法必须都是 actor-scoped：不能“错”返回为“”"（否则看到“别人的”"）。
	ListByOwner(ctx context.Context, ownerID string) ([]Activity, error)
	ListByParticipant(ctx context.Context, actorID string) ([]Activity, error)
}

type MemoryRepository struct {
	mu         sync.Mutex
	activities map[string]*Activity
	order      []string
}

func New() *Service {
	return NewWithRepository(&MemoryRepository{activities: make(map[string]*Activity)})
}
func NewWithParticipations(repo Repository, ps *ParticipationStore) *Service {
	return &Service{repository: repo, participations: ps}
}

func NewWithRepository(repository Repository) *Service {
	return &Service{repository: repository, participations: NewParticipationStore()}
}

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
	case "ListActivities", "ListMyActivities", "PublishActivity", "ToggleActivityInterest", "JoinActivity", "CancelActivity", "CheckinActivity", "MarkNoShow":
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
	case "ListMyActivities":
		return s.listMyActivities(ctx, e)
	case "PublishActivity":
		return s.publishActivity(ctx, e)
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

type publishActivityPayload struct {
	Title           string `json:"title"`
	Time            string `json:"time"`
	Capacity        int    `json:"capacity"`
	VenueName       string `json:"venueName"`
	VenueIcon       string `json:"venueIcon"`
	VenueType       string `json:"venueType"`
	RealitySceneID  string `json:"realitySceneId"`
	Description     string `json:"desc"`
	ConsumptionTerm string `json:"consumptionTerm"`
	// R58: 报名方式 OPEN(自由报名)/REVIEW(审核后加入)/INVITE_ONLY(仅邀请)。
	SignupMode string `json:"signupMode"`
	// R58: 主题（日落/奥黛/胶片/本地人…），可选。
	Theme string `json:"theme"`
}

// venueTypeLabels 扩展 R58 户外场地；未知类型不进白名单（publish 拒绝）。
var venueTypeLabels = map[string]string{
	"CAFE": "咖啡店", "RESTAURANT": "餐厅",
	"PARK": "公园", "LAKE": "湖边", "STREET": "街区", "OTHER": "通用",
}

// activityDisplayCode 生成 R58 成功页展示编号 PX-A-yymmdd-####。
// 展示用（复制/报单号），权威主键仍是 Activity.ID；由活动 ID 稳定派生
// （FNV-1a），同活动多次读取不变，无需序列设施。
func activityDisplayCode(activityID string, now time.Time) string {
	sum := fnv.New32a()
	_, _ = sum.Write([]byte(activityID))
	return "PX-A-" + now.UTC().Format("060102") + "-" + strconv.Itoa(int(sum.Sum32()%9000)+1000)
}

func (s *Service) publishActivity(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.PublishActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	var p publishActivityPayload
	if !decode(e.Payload, &p) || p.Title == "" || p.Time == "" || p.VenueName == "" || p.RealitySceneID == "" || p.Capacity < 2 || p.Capacity > 50 {
		return command.Rejected(e, "ACTIVITY_PUBLISH_INVALID", "VALIDATION", "AFTER_USER_ACTION", "activity.publish_invalid", nil)
	}
	if _, ok := venueTypeLabels[p.VenueType]; !ok {
		return command.Rejected(e, "ACTIVITY_VENUE_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "activity.venue_unsupported", nil)
	}
	if p.SignupMode == "" {
		p.SignupMode = "OPEN"
	}
	if p.SignupMode != "OPEN" && p.SignupMode != "REVIEW" && p.SignupMode != "INVITE_ONLY" {
		return command.Rejected(e, "ACTIVITY_SIGNUP_INVALID", "VALIDATION", "AFTER_USER_ACTION", "activity.signup_invalid", nil)
	}
	p.Theme = strings.TrimSpace(p.Theme)
	if len([]rune(p.Theme)) > 30 {
		return command.Rejected(e, "ACTIVITY_THEME_INVALID", "VALIDATION", "AFTER_USER_ACTION", "activity.theme_invalid", nil)
	}
	if p.ConsumptionTerm != "SPLIT" && p.ConsumptionTerm != "HOST_COVERS" {
		return command.Rejected(e, "ACTIVITY_CONSUMPTION_TERM_INVALID", "VALIDATION", "AFTER_USER_ACTION", "activity.consumption_term_invalid", nil)
	}
	consumption := "各自承担到店消费"
	if p.ConsumptionTerm == "HOST_COVERS" {
		consumption = "发起人承担约定的到店消费"
	}
	activityID := "activity_" + e.CommandID
	a := Activity{ID: activityID, Code: activityDisplayCode(activityID, time.Now().UTC()), Origin: "USER", OwnerID: e.Actor.ID, Status: "PUBLISHED", Title: p.Title, Time: p.Time, People: "0 / " + strconv.Itoa(p.Capacity) + " 人", Capacity: p.Capacity, Price: "0₫", MoneyFlow: "FREE", PriceLabel: "免费参加", Consumption: consumption, ConsumptionTerm: p.ConsumptionTerm, SignupMode: p.SignupMode, Theme: p.Theme, VenueName: p.VenueName, VenueIcon: p.VenueIcon, VenueType: p.VenueType, VenueTypeLabel: venueTypeLabels[p.VenueType], RealitySceneID: p.RealitySceneID, Desc: p.Description, AIStatus: "NONE"}
	// MERCHANT-PUBLISH-001: 商家注记（api 层已验成员）→ Origin MERCHANT +
	// 店名。OwnerID 保留发布人（ListByOwner 按 ownerId 照常找到自己的店单）。
	// 只认注记，不读 payload。
	if _, merchantName, ok := merchantStamp(e); ok {
		a.Origin = "MERCHANT"
		a.MerchantName = merchantName
	}
	if err := s.repository.Create(ctx, a); err != nil {
		return command.Rejected(e, "ACTIVITY_PUBLISH_FAILED", "INTERNAL", "SAFE_RETRY", "activity.publish_failed", nil)
	}
	return acceptedWithPayload(e, "Activity", a.ID, 1, "PUBLISHED", map[string]any{"activity": a}, nil)
}

// ---------- ListActivities ----------

func (s *Service) listActivities(ctx context.Context, e command.Envelope) command.Result {
	list, err := s.repository.List(ctx)
	if err != nil {
		return command.Rejected(e, "ACTIVITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.list_failed", nil)
	}
	for i := range list {
		normalizeActivityMoneyAndAI(&list[i])
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Interested > list[j].Interested })
	return acceptedWithPayload(e, "Activity", "", 0, "LISTED", map[string]any{
		"activities": list,
		"note":       "活动读模型：计数服务端权威；参加后才开放群聊",
	}, nil)
}

// ---------- ListMyActivities ----------
//
// R17.x: 补上“我的活动”这条物化路径。客户端在 me.tsx
// myactivities subpage 之前用 hardcoded mock,
// 走这条路径后“我的活动” 页面才能看到 server 真实
// owner / participant 记录。
//
// 返回 payload 包含两个数组 — joined + created
// — 让 client 能在一个回合里刷新两个 tab。
// 二个查询都是 actor-scoped：不会泄露其他 actor 的活动。
// actor ID 必填（匿名不应能看到“任何”我的活动"）。
func (s *Service) listMyActivities(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "ACTIVITY_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "activity.actor_required", nil)
	}
	created, err := s.repository.ListByOwner(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "ACTIVITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.list_failed", nil)
	}
	joined, err := s.repository.ListByParticipant(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "ACTIVITY_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "activity.list_failed", nil)
	}
	for i := range created {
		normalizeActivityMoneyAndAI(&created[i])
	}
	for i := range joined {
		normalizeActivityMoneyAndAI(&joined[i])
	}
	return acceptedWithPayload(e, "Activity", e.Actor.ID, 1, "LISTED", map[string]any{
		"created": created,
		"joined":  joined,
		"note":    "我的活动: created = 我发起的, joined = 我参加的. 都按 created_at 逆序.",
	}, nil)
}

func normalizeActivityMoneyAndAI(a *Activity) {
	if a.MoneyFlow == "" {
		if a.Price == "" || a.Price == "0₫" {
			a.MoneyFlow = "FREE"
		} else {
			a.MoneyFlow = "PAY_TO_JOIN"
		}
	}
	if a.PriceLabel == "" {
		switch a.MoneyFlow {
		case "FREE":
			a.PriceLabel = "免费参加"
		case "PAID_TO_ATTEND":
			a.PriceLabel = "参加后你可获得"
		default:
			a.PriceLabel = "你需支付"
		}
	}
	if a.AIStatus == "" {
		a.AIStatus = "NONE"
	}
}

// ---------- ToggleActivityInterest ----------

type activityRefPayload struct {
	ActivityID string `json:"activityId"`
}

func (s *Service) toggleInterest(ctx context.Context, e command.Envelope) command.Result {
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.InterestActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
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
	if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.JoinActivity) {
		return command.Rejected(e, "AI_ACTION_FORBIDDEN", "AUTHORIZATION", "AFTER_USER_ACTION", "ai.action_forbidden", nil)
	}
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
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
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
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
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
	if !decode(e.Payload, &p) || p.ActivityID == "" {
		return command.Rejected(e, "INVALID_ACTIVITY_REF", "VALIDATION", "AFTER_USER_ACTION", "activity.invalid_ref", nil)
	}
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
func (r *MemoryRepository) Create(_ context.Context, activity Activity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.activities[activity.ID]; exists {
		return errors.New("activity already exists")
	}
	r.activities[activity.ID] = &activity
	r.order = append(r.order, activity.ID)
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

// R17.x: 我的活动物化路径。ListByOwner 返回该 actor 作为 owner
// (Activity.OwnerID == ownerID) 创建的活动，按 created_at 逆序。
// ListByParticipant 返回该 actor 参加了的活动 (joinedBy 包含 actorID)。
// 两个方法都是 actor-scoped：不会泄露其他 actor 的活动。
func (r *MemoryRepository) ListByOwner(_ context.Context, ownerID string) ([]Activity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]Activity, 0)
	for _, id := range r.order {
		item := r.activities[id]
		if item == nil || item.OwnerID != ownerID {
			continue
		}
		items = append(items, *item)
	}
	reverseActivityOrder(items)
	return items, nil
}
func (r *MemoryRepository) ListByParticipant(_ context.Context, actorID string) ([]Activity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]Activity, 0)
	for _, id := range r.order {
		item := r.activities[id]
		if item == nil {
			continue
		}
		if item.joinedBy == nil || !item.joinedBy[actorID] {
			continue
		}
		items = append(items, *item)
	}
	reverseActivityOrder(items)
	return items, nil
}
func reverseActivityOrder(items []Activity) {
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
}

// ---------- helpers ----------

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, target) == nil
}

// merchantStamp reads the verified merchant annotation stamped by the api
// layer (resolveMerchantPublish). Canonical keys live in
// apps/api-go/internal/api/merchant_identity.go — this is a read-only
// mirror (api cannot be imported here: import cycle). Never read
// payload.merchantId here: it is client-controlled.
func merchantStamp(e command.Envelope) (string, string, bool) {
	if e.AuthContext == nil {
		return "", "", false
	}
	id, _ := e.AuthContext["merchantID"].(string)
	name, _ := e.AuthContext["merchantName"].(string)
	if id == "" || name == "" {
		return "", "", false
	}
	return id, name, true
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
//   - ORIGIN 徽标 (PLATFORM/MERCHANT/USER/TEST) — 永远指 *人*
//   - aiStatus 副标识 (NONE/AI_ASSISTED/AI_GENERATED) — 指内容生成方式
//   - aiActorKind + aiPersona* — 平台 AI 小美的辅助信息
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
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_001", AIPersonaName: "平台 AI 小美 · 周末企划", AIPersonaAvatar: "☕", AIPersonaPhoto: "ai-personas/photos/ai_001.png", MoneyFlow: "FREE", PriceLabel: "免费参加",
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
			AIStatus:    "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_002", AIPersonaName: "平台 AI 小美 · 拍照季", AIPersonaAvatar: "📸", AIPersonaPhoto: "ai-personas/photos/ai_002.png", MoneyFlow: "FREE", PriceLabel: "免费参加",
		},
		{
			ID: "user_photo_buddy", Origin: "PLATFORM", Title: "周六 咖啡拍照搭子",
			Time: "周六 15:00–17:00", People: "找 1 位", Price: "0₫", Consumption: "各自消费",
			VenueIcon: "☕", VenueName: "木光咖啡 · 还剑郡", RealitySceneID: "bonsaidon", VenueSpend: "90,000–140,000₫ / 人",
			VenueType: "CAFE", VenueTypeLabel: "咖啡店",
			Desc:    "互相帮对方拍照，一起喝咖啡；到店消费各自承担。",
			Benefit: "双人到店各点一杯，赠共享甜点",
			QACount: 1, Interested: 5, Joined: 1, Capacity: 2, Shares: 2,
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_003", AIPersonaName: "平台 AI 小美 · 拍照搭子", AIPersonaAvatar: "🤝", AIPersonaPhoto: "ai-personas/photos/ai_003.png", MoneyFlow: "FREE", PriceLabel: "免费参加",
		},
		{
			ID: "merchant_tasting", Origin: "PLATFORM", Title: "岚庭餐厅 · 新菜尝鲜晚餐",
			Time: "周五 18:30–20:30", People: "4 / 6 人", Price: "0₫", Consumption: "活动套餐 399k / 人",
			VenueIcon: "🍽️", VenueName: "岚庭餐厅 · 西湖", RealitySceneID: "westlake", VenueSpend: "380,000–650,000₫ / 人",
			VenueType: "RESTAURANT", VenueTypeLabel: "餐厅",
			Desc:    "餐厅开放新品尝鲜场次，按活动套餐到店消费。",
			Benefit: "Proxy 活动预订赠餐后甜点",
			QACount: 2, Interested: 24, Joined: 4, Capacity: 6, Shares: 9,
			AIStatus: "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_004", AIPersonaName: "平台 AI 小美 · 餐厅尝鲜", AIPersonaAvatar: "🍽️", AIPersonaPhoto: "ai-personas/photos/ai_004.png", MoneyFlow: "FREE", PriceLabel: "免费参加",
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
			AIStatus:    "AI_GENERATED", AIActorKind: "PLATFORM_AI", AIPersonaID: "ai_005", AIPersonaName: "平台 AI 小美 · 饭局推荐", AIPersonaAvatar: "🍜", AIPersonaPhoto: "ai-personas/photos/ai_005.png", MoneyFlow: "FREE", PriceLabel: "免费参加",
		},
	}
}
