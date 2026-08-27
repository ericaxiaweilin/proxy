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
	Benefits      []map[string]any `json:"benefits"`
	VenueID       string         `json:"venueId,omitempty"`
	StartsAt      time.Time      `json:"startsAt"`
	EndsAt        *time.Time     `json:"endsAt,omitempty"`
	CapacityMin   int            `json:"capacityMin,omitempty"`
	CapacityMax   int            `json:"capacityMax,omitempty"`
	HostUserID    string         `json:"hostUserId"`
	CityScope     string         `json:"cityScope,omitempty"`
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
	case "CreateScene", "UpdateScene", "PublishScene", "CreateInvitation", "RespondInvitation", "RecordAttendance", "RecordOutcome", "ListMyScenes", "ListMyInvitations":
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
	default: return command.Rejected(e, "SCENE_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "scene.unsupported_command", nil)
	}
}

type createPayload struct {
	Tool          string           `json:"tool"`
	Intent        string           `json:"intent"`
	Anchor        map[string]any   `json:"anchor"`
	Participation string           `json:"participation"`
	Cost          string           `json:"cost"`
	Benefits      []map[string]any `json:"benefits"`
	VenueID       string           `json:"venueId"`
	StartsAt      string           `json:"startsAt"`
	EndsAt        *string          `json:"endsAt"`
	CapacityMin   *int             `json:"capacityMin"`
	CapacityMax   *int             `json:"capacityMax"`
	CityScope     string           `json:"cityScope"`
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
	scene := Scene{
		ID: newID("scene_"), Tool: p.Tool, Title: title, Intent: p.Intent, Anchor: p.Anchor,
		Participation: p.Participation, Cost: p.Cost, Benefits: p.Benefits, VenueID: p.VenueID,
		StartsAt: startsAt, EndsAt: endsAt, HostUserID: e.Actor.ID, CityScope: p.CityScope,
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
func (s *Service) recordAttendance(ctx context.Context, e command.Envelope) command.Result { return command.Accepted(e,"Attendance",e.Target.ID,1,"ATTENDED", nil) }
func (s *Service) recordOutcome(ctx context.Context, e command.Envelope) command.Result { return command.Accepted(e,"Outcome",e.Target.ID,1,"RECORDED", nil) }
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
	case "cityScope": if str,ok:=v.(string);ok{ s.CityScope=str }
	case "benefits": if arr,ok:=v.([]any);ok{ s.Benefits = toBenefits(arr) }
	case "anchor": if m,ok:=v.(map[string]any);ok{ s.Anchor=m }
	}
}
func toBenefits(arr []any) []map[string]any { out:=[]map[string]any{}; for _,v:=range arr{ if m,ok:=v.(map[string]any);ok{out=append(out,m)}}; return out }
func eventRefs(ev []event.DomainEvent) []string { r:=[]string{}; for _,e:=range ev{ r=append(r,e.EventID)}; return r}
func decode(p map[string]any, target any) bool { b,_:=json.Marshal(p); return json.Unmarshal(b,target)==nil }
var seq uint64
func newID(prefix string) string { var b [16]byte; if _,err:=rand.Read(b[:]);err==nil {return prefix+hex.EncodeToString(b[:])}; return prefix+hex.EncodeToString([]byte{byte(atomic.AddUint64(&seq,1))}) }
