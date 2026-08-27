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

type Repository interface {
	Create(ctx context.Context, s Scene) error
	Get(ctx context.Context, id string) (Scene, error)
	Update(ctx context.Context, s Scene, expectedVersion int) error
	ListByHost(ctx context.Context, hostID string, limit int) ([]Scene, error)
	CreateInvitation(ctx context.Context, inv Invitation) error
	GetInvitation(ctx context.Context, id string) (Invitation, error)
	UpdateInvitation(ctx context.Context, inv Invitation) error
	ListInvitationsByInvitee(ctx context.Context, inviteeID string, limit int) ([]Invitation, error)
}

type memoryRepo struct {
	mu   sync.Mutex
	m    map[string]Scene
	invs map[string]Invitation
}

func NewMemoryRepository() Repository { return &memoryRepo{m: map[string]Scene{}, invs: map[string]Invitation{}} }

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
