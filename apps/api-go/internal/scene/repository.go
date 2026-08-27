package scene

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrNotFound = errors.New("scene not found")
var ErrVersionConflict = errors.New("version conflict")

type Invitation struct {
	ID        string    `json:"id"`
	SceneID   string    `json:"sceneId"`
	InviteeID string    `json:"inviteeId"`
	HostID    string    `json:"hostId"`
	Status    string    `json:"status"`
	Card      map[string]any `json:"card"`
	CreatedAt time.Time `json:"createdAt"`
}

type Benefit struct {
	ID        string    `json:"benefitId"`
	SceneID   string    `json:"sceneId"`
	Type      string    `json:"type"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}
type Checkin struct {
	SceneID string    `json:"sceneId"`
	UserID  string    `json:"userId"`
	Role    string    `json:"role"`
	At      time.Time `json:"at"`
}

type Repository interface {
	Create(ctx context.Context, s Scene) error
	Get(ctx context.Context, id string) (Scene, error)
	Update(ctx context.Context, s Scene, expectedVersion int) error
	ListByHost(ctx context.Context, hostID string, limit int) ([]Scene, error)
	CreateInvitation(ctx context.Context, inv Invitation) error
	GetInvitation(ctx context.Context, id string) (Invitation, error)
	UpdateInvitation(ctx context.Context, inv Invitation) error
	ListInvitationsByInvitee(ctx context.Context, inviteeID string, limit int) ([]Invitation, error)
	CreateBenefit(ctx context.Context, b Benefit) error
	GetBenefit(ctx context.Context, sceneID string) (Benefit, error)
	UpdateBenefit(ctx context.Context, b Benefit) error
	CreateCheckin(ctx context.Context, c Checkin) error
	ListCheckins(ctx context.Context, sceneID string) ([]Checkin, error)
}

type memoryRepo struct {
	mu       sync.Mutex
	m        map[string]Scene
	invs     map[string]Invitation
	benefits map[string]Benefit
	checkins map[string]map[string]Checkin
}

func NewMemoryRepository() Repository { return &memoryRepo{m: map[string]Scene{}, invs: map[string]Invitation{}, benefits: map[string]Benefit{}, checkins: map[string]map[string]Checkin{}} }

func (r *memoryRepo) Create(ctx context.Context, s Scene) error {
	r.mu.Lock(); defer r.mu.Unlock()
	if _, ok := r.m[s.ID]; ok { return errors.New("exists") }
	r.m[s.ID]=s
	return nil
}
func (r *memoryRepo) Get(ctx context.Context, id string) (Scene, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	s,ok:=r.m[id]; if !ok { return Scene{}, ErrNotFound }
	return s,nil
}
func (r *memoryRepo) Update(ctx context.Context, s Scene, expectedVersion int) error {
	r.mu.Lock(); defer r.mu.Unlock()
	cur,ok:=r.m[s.ID]; if !ok {return ErrNotFound}
	if cur.Version != expectedVersion {return ErrVersionConflict}
	r.m[s.ID]=s
	return nil
}
func (r *memoryRepo) ListByHost(ctx context.Context, hostID string, limit int) ([]Scene, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	out:=[]Scene{}
	if limit <= 0 { return out, nil }
	for _,v:=range r.m { if v.HostUserID==hostID { out=append(out,v); if len(out)>=limit{break}} }
	return out,nil
}
func (r *memoryRepo) CreateInvitation(ctx context.Context, inv Invitation) error { r.mu.Lock(); defer r.mu.Unlock(); r.invs[inv.ID]=inv; return nil }
func (r *memoryRepo) GetInvitation(ctx context.Context, id string) (Invitation, error) { r.mu.Lock(); defer r.mu.Unlock(); inv,ok:=r.invs[id]; if !ok {return Invitation{}, ErrNotFound}; return inv,nil }
func (r *memoryRepo) UpdateInvitation(ctx context.Context, inv Invitation) error { r.mu.Lock(); defer r.mu.Unlock(); if _,ok:=r.invs[inv.ID];!ok{return ErrNotFound}; r.invs[inv.ID]=inv; return nil }
func (r *memoryRepo) ListInvitationsByInvitee(ctx context.Context, inviteeID string, limit int) ([]Invitation, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	out:=[]Invitation{}
	if limit <= 0 { return out, nil }
	for _,v:=range r.invs { if v.InviteeID==inviteeID { out=append(out,v); if len(out)>=limit{break}} }
	return out,nil
}

// ── Pass 3 audit closures: 5 new Repository methods (R15.13 P1) ────
// These are required by the extended Repository interface even though
// the service does not yet exercise them. Pin the memoryRepo behaviour
// so a refactor that swaps the implementation (e.g. PostgreSQL adapter)
// can be verified against the same in-memory contract.

func (r *memoryRepo) CreateBenefit(ctx context.Context, b Benefit) error {
	r.mu.Lock(); defer r.mu.Unlock()
	if b.ID == "" || b.SceneID == "" {
		return errors.New("benefit id and sceneId are required")
	}
	if _, exists := r.benefits[b.SceneID]; exists {
		return errors.New("benefit already exists for scene")
	}
	r.benefits[b.SceneID] = b
	return nil
}

func (r *memoryRepo) GetBenefit(ctx context.Context, sceneID string) (Benefit, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	b, ok := r.benefits[sceneID]
	if !ok { return Benefit{}, ErrNotFound }
	return b, nil
}

func (r *memoryRepo) UpdateBenefit(ctx context.Context, b Benefit) error {
	r.mu.Lock(); defer r.mu.Unlock()
	if _, ok := r.benefits[b.SceneID]; !ok { return ErrNotFound }
	r.benefits[b.SceneID] = b
	return nil
}

func (r *memoryRepo) CreateCheckin(ctx context.Context, c Checkin) error {
	r.mu.Lock(); defer r.mu.Unlock()
	if c.SceneID == "" || c.UserID == "" {
		return errors.New("checkin sceneId and userId are required")
	}
	if _, ok := r.checkins[c.SceneID]; !ok {
		r.checkins[c.SceneID] = map[string]Checkin{}
	}
	r.checkins[c.SceneID][c.UserID] = c
	return nil
}

func (r *memoryRepo) ListCheckins(ctx context.Context, sceneID string) ([]Checkin, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	out := []Checkin{}
	for _, c := range r.checkins[sceneID] {
		out = append(out, c)
	}
	return out, nil
}
