package scene

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type Scene struct {
	ID            string         `json:"sceneId"`
	Tool          string         `json:"tool"`
	Title         string         `json:"title"`
	Intent        string         `json:"intent"`
	Anchor        map[string]any `json:"anchor,omitempty"`
	Participation string         `json:"participation"`
	Cost          string         `json:"cost"`
	FundingMode   string         `json:"fundingMode"`
	BudgetMinor   int64          `json:"budgetMinor"`
	Currency      string         `json:"currency"`
	Benefits      []map[string]any `json:"benefits"`
	VenueID       string         `json:"venueId,omitempty"`
	StartsAt      time.Time      `json:"startsAt"`
	EndsAt        *time.Time     `json:"endsAt,omitempty"`
	CapacityMin   int            `json:"capacityMin,omitempty"`
	CapacityMax   int            `json:"capacityMax,omitempty"`
	HostUserID    string         `json:"hostUserId"`
	CityScope     string         `json:"cityScope,omitempty"`
	AestheticScore float64       `json:"aestheticScore"`
	PriceCorridor map[string]any `json:"priceCorridor"`
	Status        string         `json:"status"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
	Version       int            `json:"version"`
}

type guardResult struct {
	Result  string `json:"result"`
	Reason  string `json:"reason"`
	Suggest string `json:"suggest"`
}

func evaluateGuard(s Scene) guardResult {
	if s.Anchor == nil || len(s.Anchor) == 0 {
		return guardResult{Result: "NEEDS_MORE_INFORMATION", Reason: "missing anchor", Suggest: "SCENE_FIT"}
	}
	if s.Cost == "" {
		return guardResult{Result: "NEEDS_MORE_INFORMATION", Reason: "missing cost", Suggest: "SCENE_FIT"}
	}
	// high transaction feeling if no anchor but cost is direct pay
	if s.Tool == "PHOTO" && s.Cost == "HOST_PAY" && len(s.Benefits) == 0 {
		return guardResult{Result: "HIGH_TRANSACTION_FEELING", Reason: "direct pay without scene value", Suggest: "BENEFIT"}
	}
	return guardResult{Result: "GOOD_FIT"}
}

func passesIndependence(s Scene) bool {
	return s.Anchor != nil && len(s.Anchor) > 0 && s.Title != ""
}
func priceCorridorFor(city, merchant, sceneType string) map[string]any {
	p25, p50, p75 := int64(40000), int64(55000), int64(80000)
	if strings.Contains(sceneType, "ROOFTOP") { p25, p50, p75 = 60000, 80000, 120000 }
	if strings.Contains(sceneType, "BRUNCH") { p25, p50, p75 = 50000, 70000, 100000 }
	return map[string]any{"low": p25, "target": p50, "high": p75, "currency": "VND", "city": city, "merchant": merchant, "sceneType": sceneType}
}
func aestheticScoreFor(sceneType string) float64 {
	strong := map[string]bool{"PHOTO": true, "ROOFTOP_PHOTO": true, "PHOTO_CAFE": true, "BRUNCH": true, "EXHIBITION": true, "ROOFTOP": true}
	if strong[sceneType] { return 0.92 }
	if strings.Contains(sceneType, "SPA") || strings.Contains(sceneType, "CINEMA") { return 0.45 }
	return 0.72
}

type Service struct {
	mu   sync.Mutex
	repo Repository
	clock clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }
func NewWithRepository(r Repository) *Service {
	if r == nil { r = NewMemoryRepository() }
	return &Service{repo: r, clock: clock.System{}}
}
func NewWithClock(c clock.Clock) *Service { s := New(); s.clock = c; return s }

func (s *Service) Supports(t string) bool {
	switch t {
	case "CreateScene", "UpdateScene", "PublishScene", "CreateInvitation", "RespondInvitation", "RecordAttendance", "RecordOutcome", "ListMyScenes", "ListMyInvitations", "ListMyMemories", "GetMemory":
		return true
	default: return false
	}
}
func (s *Service) Handle(e command.Envelope) command.Result { return s.HandleContext(context.Background(), e) }
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateScene": return s.create(ctx,e)
	case "UpdateScene": return s.update(ctx,e)
	case "PublishScene": return s.publish(ctx,e)
	case "CreateInvitation": return s.createInvitation(ctx,e)
	case "RespondInvitation": return s.respondInvitation(ctx,e)
	case "RecordAttendance": return s.recordAttendance(ctx,e)
	case "RecordOutcome": return s.recordOutcome(ctx,e)
	case "ListMyScenes": return s.listMyScenes(ctx,e)
	case "ListMyInvitations": return s.listMyInvitations(ctx,e)
	case "ListMyMemories": return s.listMyMemories(ctx,e)
	case "GetMemory": return s.getMemory(ctx,e)
	default: return command.Rejected(e, "SCENE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "scene.unsupported_command", nil)
	}
}

type createPayload struct {
	Tool          string           `json:"tool"`
	Intent        string           `json:"intent"`
	Anchor        map[string]any   `json:"anchor"`
	Participation string           `json:"participation"`
	Cost          string           `json:"cost"`
	FundingMode   string           `json:"fundingMode"`
	BudgetMinor   *int64           `json:"budgetMinor"`
	Currency      string           `json:"currency"`
	Benefits      []map[string]any `json:"benefits"`
	VenueID       string           `json:"venueId"`
	StartsAt      string           `json:"startsAt"`
	EndsAt        *string          `json:"endsAt"`
	CapacityMin   *int             `json:"capacityMin"`
	CapacityMax   *int             `json:"capacityMax"`
	CityScope     string           `json:"cityScope"`
	SceneType     string           `json:"sceneType"`
}

func (s *Service) create(ctx context.Context, e command.Envelope) command.Result {
	var p createPayload
	if !decode(e.Payload,&p) || p.Tool=="" || strings.TrimSpace(p.Intent)=="" || p.Participation=="" || p.Cost=="" || p.StartsAt=="" {
		return command.Rejected(e, "INVALID_SCENE_CREATE", "VALIDATION", "AFTER_USER_ACTION", "scene.invalid_create", nil)
	}
	startsAt, err := time.Parse(time.RFC3339, p.StartsAt)
	if err != nil { return command.Rejected(e, "INVALID_SCENE_TIME", "VALIDATION", "AFTER_USER_ACTION", "scene.invalid_time", nil) }
	var endsAt *time.Time
	if p.EndsAt != nil { t,err:=time.Parse(time.RFC3339,*p.EndsAt); if err==nil { endsAt=&t } }
	now := s.clock.Now().UTC()
	title := strings.TrimSpace(p.Intent)
	if len(title)>60 { title = title[:60] }
	fundingMode := p.FundingMode
	if fundingMode == "" { fundingMode = "HOST" }
	currency := p.Currency
	if currency == "" { currency = "VND" }
	var budget int64
	if p.BudgetMinor != nil { budget = *p.BudgetMinor }
	sceneType := p.SceneType
	if sceneType == "" { sceneType = p.Tool }
	priceCorridor := priceCorridorFor(p.CityScope, p.VenueID, sceneType)
	aesthetic := aestheticScoreFor(sceneType)
	scene := Scene{
		ID: newID("scene_"), Tool: p.Tool, Title: title, Intent: p.Intent, Anchor: p.Anchor,
		Participation: p.Participation, Cost: p.Cost, FundingMode: fundingMode, BudgetMinor: budget, Currency: currency,
		Benefits: p.Benefits, VenueID: p.VenueID, StartsAt: startsAt, EndsAt: endsAt, HostUserID: e.Actor.ID, CityScope: p.CityScope,
		AestheticScore: aesthetic, PriceCorridor: priceCorridor,
		Status: "DRAFT", CreatedAt: now, UpdatedAt: now, Version: 1,
	}
	if p.CapacityMin != nil { scene.CapacityMin = *p.CapacityMin }
	if p.CapacityMax != nil { scene.CapacityMax = *p.CapacityMax }
	guard := evaluateGuard(scene)
	events := []event.DomainEvent{event.New("SceneCreated","Scene",scene.ID,1,e.Principal.ID,e.CorrelationID,e.CommandID,now,map[string]any{"tool":scene.Tool,"title":scene.Title,"guard":guard.Result})}
	if err:=s.repo.Create(ctx,scene); err!=nil { return command.Rejected(e, "SCENE_CREATE_FAILED","INTERNAL","SAFE_RETRY","scene.create_failed",nil) }
	_ = events
	return command.Accepted(e,"Scene",scene.ID,1,"DRAFT", eventRefs(events))
}
type updatePayload struct {
	ExpectedVersion int            `json:"expectedVersion"`
	Changes         map[string]any `json:"changes"`
}
func (s *Service) update(ctx context.Context, e command.Envelope) command.Result {
	var p updatePayload
	if !decode(e.Payload,&p) || p.Changes==nil { return command.Rejected(e, "INVALID_SCENE_UPDATE","VALIDATION","AFTER_USER_ACTION","scene.invalid_update",nil) }
	scene,err:=s.repo.Get(ctx,e.Target.ID)
	if errors.Is(err, ErrNotFound) { return command.Rejected(e, "SCENE_NOT_FOUND","BUSINESS_STATE","AFTER_USER_ACTION","scene.not_found",nil) }
	if err!=nil { return command.Rejected(e, "SCENE_READ_FAILED","INTERNAL","SAFE_RETRY","scene.read_failed",nil) }
	if scene.HostUserID != e.Actor.ID { return command.Rejected(e, "SCENE_UPDATE_NOT_ALLOWED","AUTHORIZATION","AFTER_USER_ACTION","scene.not_allowed",nil) }
	if p.ExpectedVersion != scene.Version { return command.Rejected(e, "SCENE_VERSION_CONFLICT","CONCURRENCY","SAFE_RETRY","scene.version_conflict", map[string]any{"expected":p.ExpectedVersion,"actual":scene.Version}) }
	for k,v:=range p.Changes { applyChange(&scene,k,v) }
	scene.Version++
	scene.UpdatedAt = s.clock.Now().UTC()
	guard:=evaluateGuard(scene)
	events:=[]event.DomainEvent{event.New("SceneUpdated","Scene",scene.ID,scene.Version,e.Principal.ID,e.CorrelationID,e.CommandID,scene.UpdatedAt,map[string]any{"guard":guard.Result})}
	if err:=s.repo.Update(ctx,scene,p.ExpectedVersion); err!=nil { if errors.Is(err, ErrVersionConflict){return command.Rejected(e,"SCENE_VERSION_CONFLICT","CONCURRENCY","SAFE_RETRY","scene.version_conflict",nil)}; return command.Rejected(e,"SCENE_UPDATE_FAILED","INTERNAL","SAFE_RETRY","scene.update_failed",nil)}
	return command.Accepted(e,"Scene",scene.ID,scene.Version,scene.Status, eventRefs(events))
}
func (s *Service) publish(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ ExpectedVersion int `json:"expectedVersion"`}
	if !decode(e.Payload,&p) || p.ExpectedVersion<=0 { return command.Rejected(e, "INVALID_SCENE_PUBLISH","VALIDATION","AFTER_USER_ACTION","scene.invalid_publish",nil)}
	scene,err:=s.repo.Get(ctx,e.Target.ID)
	if errors.Is(err, ErrNotFound){ return command.Rejected(e,"SCENE_NOT_FOUND","BUSINESS_STATE","AFTER_USER_ACTION","scene.not_found",nil)}
	if err!=nil{return command.Rejected(e,"SCENE_READ_FAILED","INTERNAL","SAFE_RETRY","scene.read_failed",nil)}
	if scene.HostUserID != e.Actor.ID {return command.Rejected(e,"SCENE_PUBLISH_NOT_ALLOWED","AUTHORIZATION","AFTER_USER_ACTION","scene.not_allowed",nil)}
	if p.ExpectedVersion != scene.Version {return command.Rejected(e,"SCENE_VERSION_CONFLICT","CONCURRENCY","SAFE_RETRY","scene.version_conflict",nil)}
	if !passesIndependence(scene){return command.Rejected(e,"SCENE_INDEPENDENCE_FAILED","BUSINESS_STATE","AFTER_USER_ACTION","scene.independence_failed", map[string]any{"reason":"Scene must have anchor and remain valuable without target participant"})}
	guard:=evaluateGuard(scene)
	if guard.Result=="HIGH_TRANSACTION_FEELING" || guard.Result=="HIGH_SAFETY_RISK" {return command.Rejected(e,"SCENE_GUARD_REJECTED","BUSINESS_STATE","AFTER_USER_ACTION","scene.guard_rejected", map[string]any{"guard":guard.Result})}
	scene.Status="INVITING"
	scene.Version++
	scene.UpdatedAt=s.clock.Now().UTC()
	events:=[]event.DomainEvent{event.New("ScenePublished","Scene",scene.ID,scene.Version,e.Principal.ID,e.CorrelationID,e.CommandID,scene.UpdatedAt,map[string]any{"guard":guard.Result})}
	if err:=s.repo.Update(ctx,scene,p.ExpectedVersion);err!=nil{return command.Rejected(e,"SCENE_PUBLISH_FAILED","INTERNAL","SAFE_RETRY","scene.publish_failed",nil)}
	_ = s.repo.CreateBenefit(ctx, Benefit{ID: newID("ben_"), SceneID: scene.ID, Type: "PHOTO_BOOTH", Status: "LOCKED", CreatedAt: scene.UpdatedAt})
	return command.Accepted(e,"Scene",scene.ID,scene.Version,"INVITING", eventRefs(events))
}
type invitationPayload struct {
	SceneID       string         `json:"sceneId"`
	InviteeUserID string         `json:"inviteeUserId"`
	Card          map[string]any `json:"card"`
}
func (s *Service) createInvitation(ctx context.Context, e command.Envelope) command.Result {
	var p invitationPayload
	if !decode(e.Payload,&p) || p.SceneID=="" || p.InviteeUserID=="" {return command.Rejected(e,"INVALID_INVITATION","VALIDATION","AFTER_USER_ACTION","scene.invalid_invitation",nil)}
	if _,err:=s.repo.Get(ctx,p.SceneID); err!=nil {return command.Rejected(e,"SCENE_NOT_FOUND","BUSINESS_STATE","AFTER_USER_ACTION","scene.not_found",nil)}
	inv:=Invitation{ID:newID("inv_"), SceneID:p.SceneID, InviteeID:p.InviteeUserID, HostID:e.Actor.ID, Status:"PENDING", Card:p.Card, CreatedAt:s.clock.Now().UTC()}
	if err:=s.repo.CreateInvitation(ctx,inv);err!=nil{return command.Rejected(e,"INVITATION_CREATE_FAILED","INTERNAL","SAFE_RETRY","scene.invitation_failed",nil)}
	ev:=event.New("InvitationCreated","Invitation",inv.ID,1,e.Principal.ID,e.CorrelationID,e.CommandID,inv.CreatedAt,map[string]any{"sceneId":inv.SceneID,"inviteeId":inv.InviteeID})
	return command.Accepted(e,"Invitation",inv.ID,1,"PENDING", eventRefs([]event.DomainEvent{ev}))
}
type respondPayload struct { Decision string `json:"decision"` }
func (s *Service) respondInvitation(ctx context.Context, e command.Envelope) command.Result {
	var p respondPayload
	if !decode(e.Payload,&p) || (p.Decision!="ACCEPTED" && p.Decision!="DECLINED" && p.Decision!="ASK") {return command.Rejected(e,"INVALID_INVITATION_RESPONSE","VALIDATION","AFTER_USER_ACTION","scene.invalid_response",nil)}
	inv,err:=s.repo.GetInvitation(ctx,e.Target.ID)
	if errors.Is(err, ErrNotFound){return command.Rejected(e,"INVITATION_NOT_FOUND","BUSINESS_STATE","AFTER_USER_ACTION","scene.invitation_not_found",nil)}
	if err!=nil{return command.Rejected(e,"INVITATION_READ_FAILED","INTERNAL","SAFE_RETRY","scene.read_failed",nil)}
	if inv.InviteeID != e.Actor.ID {return command.Rejected(e,"INVITATION_NOT_ALLOWED","AUTHORIZATION","AFTER_USER_ACTION","scene.not_allowed",nil)}
	inv.Status=p.Decision
	if err:=s.repo.UpdateInvitation(ctx,inv);err!=nil{return command.Rejected(e,"INVITATION_UPDATE_FAILED","INTERNAL","SAFE_RETRY","scene.update_failed",nil)}
	ev:=event.New("InvitationResponded","Invitation",inv.ID,2,e.Principal.ID,e.CorrelationID,e.CommandID,s.clock.Now().UTC(),map[string]any{"decision":p.Decision})
	return command.Accepted(e,"Invitation",inv.ID,2,p.Decision, eventRefs([]event.DomainEvent{ev}))
}
func (s *Service) recordAttendance(ctx context.Context, e command.Envelope) command.Result {
	scene, err := s.repo.Get(ctx, e.Target.ID)
	if err != nil { return command.Rejected(e, "SCENE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "scene.not_found", nil) }
	role := "GUEST"
	if e.Actor.ID == scene.HostUserID { role = "HOST" }
	_ = s.repo.CreateCheckin(ctx, Checkin{SceneID: scene.ID, UserID: e.Actor.ID, Role: role, At: s.clock.Now().UTC()})
	checkins, _ := s.repo.ListCheckins(ctx, scene.ID)
	hasHost, hasGuest := false, false
	for _, c := range checkins {
		if c.Role == "HOST" { hasHost = true }
		if c.Role == "GUEST" { hasGuest = true }
	}
	if hasHost && hasGuest {
		if ben, err := s.repo.GetBenefit(ctx, scene.ID); err == nil && ben.Status == "LOCKED" {
			ben.Status = "ACTIVE"
			_ = s.repo.UpdateBenefit(ctx, ben)
		}
	}
	return command.Accepted(e, "Attendance", scene.ID, 1, "ATTENDED", nil)
}
func (s *Service) recordOutcome(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		GuestID         string           `json:"guestId"`
		ActualSpend     *int64           `json:"actualSpend"`
		DurationMin     *int             `json:"durationMin"`
		AestheticAssets []map[string]any `json:"aestheticAssets"`
		Notes           string           `json:"notes"`
	}
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_OUTCOME_PAYLOAD", "VALIDATION", "AFTER_USER_ACTION", "scene.invalid_outcome", nil)
	}
	if p.GuestID == "" {
		return command.Rejected(e, "OUTCOME_GUEST_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "scene.outcome_guest_required", nil)
	}
	if p.ActualSpend == nil || *p.ActualSpend < 0 {
		return command.Rejected(e, "OUTCOME_SPEND_INVALID", "VALIDATION", "AFTER_USER_ACTION", "scene.outcome_spend_invalid", nil)
	}
	if p.DurationMin != nil && *p.DurationMin < 0 {
		return command.Rejected(e, "OUTCOME_DURATION_INVALID", "VALIDATION", "AFTER_USER_ACTION", "scene.outcome_duration_invalid", nil)
	}
	// Locate the scene — only the host can record the outcome, and the
	// scene must have been published first (we don't want a DRAFT to
	// leave a memory trail).
	sc, err := s.repo.Get(ctx, e.Target.ID)
	if errors.Is(err, ErrNotFound) {
		return command.Rejected(e, "SCENE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "scene.not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "SCENE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "scene.read_failed", nil)
	}
	if sc.HostUserID != e.Actor.ID {
		return command.Rejected(e, "OUTCOME_NOT_HOST", "AUTHORIZATION", "AFTER_USER_ACTION", "scene.outcome_not_host", nil)
	}
	if sc.Status != "INVITING" && sc.Status != "SIGNED_UP" {
		return command.Rejected(e, "OUTCOME_SCENE_NOT_PUBLISHED", "BUSINESS_STATE", "AFTER_USER_ACTION", "scene.outcome_scene_not_published", map[string]any{"currentStatus": sc.Status})
	}
	// Both host + guest must have checked in for the memory to be
	// trustworthy (no one-side-only records).
	checkins, _ := s.repo.ListCheckins(ctx, sc.ID)
	hasHost, hasGuest := false, false
	for _, c := range checkins {
		if c.Role == "HOST" { hasHost = true }
		if c.Role == "GUEST" { hasGuest = true }
	}
	if !hasHost || !hasGuest {
		return command.Rejected(e, "OUTCOME_CHECKIN_INCOMPLETE", "BUSINESS_STATE", "AFTER_USER_ACTION", "scene.outcome_checkin_incomplete", nil)
	}
	// Derive rating from aesthetic score (was 0..1) blended with
	// budget adherence: the closer actual_spend is to planned_budget,
	// the higher the rating. 0.5 * aesthetic + 0.5 * budgetAdherence.
	budgetAdherence := 1.0
	if sc.BudgetMinor > 0 {
		ratio := float64(*p.ActualSpend) / float64(sc.BudgetMinor)
		if ratio > 1 { ratio = 2 - ratio } // over-budget symmetric penalty
		if ratio < 0 { ratio = 0 }
		budgetAdherence = ratio
	}
	rating := 0.5*sc.AestheticScore + 0.5*budgetAdherence
	if rating < 0 { rating = 0 }
	if rating > 1 { rating = 1 }
	dur := 0
	if p.DurationMin != nil { dur = *p.DurationMin }
	assets := p.AestheticAssets
	if assets == nil { assets = []map[string]any{} }
	mem := Memory{
		SceneID:         sc.ID,
		HostID:          sc.HostUserID,
		GuestID:         p.GuestID,
		MerchantID:      sc.VenueID,
		SceneType:       sc.Tool,
		FundingMode:     sc.FundingMode,
		PlannedBudget:   sc.BudgetMinor,
		ActualSpend:     *p.ActualSpend,
		Currency:        sc.Currency,
		DurationMin:     dur,
		AestheticAssets: assets,
		Rating:          rating,
		Notes:           p.Notes,
		CreatedAt:       s.clock.Now().UTC(),
	}
	if err := s.repo.UpsertMemory(ctx, mem); err != nil {
		return command.Rejected(e, "OUTCOME_PERSIST_FAILED", "INTERNAL", "SAFE_RETRY", "scene.outcome_persist_failed", nil)
	}
	// Return the persisted memory as the operation ref so callers
	// can confirm what was actually stored.
	b, _ := json.Marshal(mem)
	res := command.Accepted(e, "Memory", mem.SceneID, 1, "RECORDED", nil)
	res.OperationRef = string(b)
	return res
}

func (s *Service) listMyMemories(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ Limit int `json:"limit"` }
	_ = decode(e.Payload, &p)
	if p.Limit <= 0 { p.Limit = 10 }
	if p.Limit > 50 { p.Limit = 50 }
	mems, _ := s.repo.ListMemoriesByUser(ctx, e.Actor.ID, p.Limit)
	items := []map[string]any{}
	for _, m := range mems {
		items = append(items, map[string]any{
			"memoryId":      m.ID,
			"sceneId":       m.SceneID,
			"sceneType":     m.SceneType,
			"actualSpend":   m.ActualSpend,
			"plannedBudget": m.PlannedBudget,
			"currency":      m.Currency,
			"durationMin":   m.DurationMin,
			"rating":        m.Rating,
			"createdAt":     m.CreatedAt.Format(time.RFC3339),
			"role":          roleForUser(m, e.Actor.ID),
		})
	}
	payload := map[string]any{"actorId": e.Actor.ID, "memories": items, "limit": p.Limit}
	b, _ := json.Marshal(payload)
	res := command.Accepted(e, "MyMemories", e.Actor.ID, 1, "LISTED", nil)
	res.OperationRef = string(b)
	return res
}

func (s *Service) getMemory(ctx context.Context, e command.Envelope) command.Result {
	mem, err := s.repo.GetMemory(ctx, e.Target.ID)
	if errors.Is(err, ErrNotFound) {
		return command.Rejected(e, "MEMORY_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "scene.memory_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "MEMORY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "scene.memory_read_failed", nil)
	}
	// Only the host, the guest, or an admin (we don't have roles here,
	// so any authenticated actor that matches either side wins) may
	// read the memory.
	if mem.HostID != e.Actor.ID && mem.GuestID != e.Actor.ID {
		return command.Rejected(e, "MEMORY_NOT_VISIBLE", "AUTHORIZATION", "AFTER_USER_ACTION", "scene.memory_not_visible", nil)
	}
	b, _ := json.Marshal(mem)
	res := command.Accepted(e, "Memory", mem.SceneID, 1, "READ", nil)
	res.OperationRef = string(b)
	return res
}

func roleForUser(m Memory, userID string) string {
	if m.HostID == userID { return "HOST" }
	if m.GuestID == userID { return "GUEST" }
	return ""
}
func (s *Service) listMyScenes(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ Limit int `json:"limit"`}
	_ = decode(e.Payload,&p); if p.Limit<=0{p.Limit=10}; if p.Limit>50{p.Limit=50}
	scenes,_:=s.repo.ListByHost(ctx,e.Actor.ID,p.Limit)
	items:=[]map[string]any{}
	for _,sc:=range scenes { items=append(items, map[string]any{"sceneId":sc.ID,"title":sc.Title,"tool":sc.Tool,"status":sc.Status,"startsAt":sc.StartsAt.Format(time.RFC3339)})}
	payload:=map[string]any{"actorId":e.Actor.ID,"scenes":items,"limit":p.Limit}
	b,_:=json.Marshal(payload)
	res:=command.Accepted(e,"MyScenes",e.Actor.ID,1,"LISTED", nil)
	res.OperationRef=string(b)
	return res
}
func (s *Service) listMyInvitations(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ Limit int `json:"limit"`}
	_ = decode(e.Payload,&p); if p.Limit<=0{p.Limit=10}; if p.Limit>50{p.Limit=50}
	invs,_:=s.repo.ListInvitationsByInvitee(ctx,e.Actor.ID,p.Limit)
	items:=[]map[string]any{}
	for _,inv:=range invs { items=append(items, map[string]any{"invitationId":inv.ID,"sceneId":inv.SceneID,"status":inv.Status,"card":inv.Card})}
	payload:=map[string]any{"actorId":e.Actor.ID,"invitations":items,"limit":p.Limit}
	b,_:=json.Marshal(payload)
	res:=command.Accepted(e,"MyInvitations",e.Actor.ID,1,"LISTED", nil)
	res.OperationRef=string(b)
	return res
}

func applyChange(s *Scene, k string, v any){
	switch k {
	case "title": if str,ok:=v.(string);ok{ s.Title=str }
	case "intent": if str,ok:=v.(string);ok{ s.Intent=str }
	case "participation": if str,ok:=v.(string);ok{ s.Participation=str }
	case "cost": if str,ok:=v.(string);ok{ s.Cost=str }
	case "fundingMode": if str,ok:=v.(string);ok{ s.FundingMode=str }
	case "budgetMinor": if n,ok:=v.(float64);ok{ s.BudgetMinor=int64(n) }
	case "cityScope": if str,ok:=v.(string);ok{ s.CityScope=str }
	case "venueId": if str,ok:=v.(string);ok{ s.VenueID=str }
	case "benefits": if arr,ok:=v.([]any);ok{ s.Benefits = toBenefits(arr) }
	case "anchor": if m,ok:=v.(map[string]any);ok{ s.Anchor=m }
	case "aestheticScore": if n,ok:=v.(float64);ok{ s.AestheticScore=n }
	}
}
func toBenefits(arr []any) []map[string]any { out:=[]map[string]any{}; for _,v:=range arr{ if m,ok:=v.(map[string]any);ok{out=append(out,m)}}; return out }
func eventRefs(ev []event.DomainEvent) []string { r:=[]string{}; for _,e:=range ev{ r=append(r,e.EventID)}; return r}
func decode(p map[string]any, target any) bool { b,_:=json.Marshal(p); return json.Unmarshal(b,target)==nil }
var seq uint64
func newID(prefix string) string { var b [16]byte; if _,err:=rand.Read(b[:]);err==nil {return prefix+hex.EncodeToString(b[:])}; return prefix+hex.EncodeToString([]byte{byte(atomic.AddUint64(&seq,1))}) }
