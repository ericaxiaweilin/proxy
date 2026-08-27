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

// ── R15.13 P2: Memory aggregate ──────────────────────────────────
// A Memory is the post-outcome snapshot of a Scene. One Memory per
// Scene (scene_id is the natural key in scene.memories). Memories
// are append-only — once written, they are the audit trail of "we
// actually did this thing", and they feed:
//   * reputation (host + guest + venue future reputation signals)
//   * aesthetic asset gallery (AestheticAssets feeds the feed card)
//   * price corridor back-pressure (ActualSpend vs PlannedBudget)
// Memories are NEVER updated; if the host realizes they spent less
// than they recorded, that is a new event, not a mutation of the
// past. The repository therefore has only an Upsert keyed on
// scene_id (idempotent re-record is allowed because the user might
// re-submit after a network blip; the row is replaced atomically).

type Memory struct {
	ID              string           `json:"memoryId"`
	SceneID         string           `json:"sceneId"`
	HostID          string           `json:"hostId"`
	GuestID         string           `json:"guestId"`
	MerchantID      string           `json:"merchantId,omitempty"`
	SceneType       string           `json:"sceneType"`
	FundingMode     string           `json:"fundingMode"`
	PlannedBudget   int64            `json:"plannedBudget"`
	ActualSpend     int64            `json:"actualSpend"`
	Currency        string           `json:"currency"`
	DurationMin     int              `json:"durationMin"`
	AestheticAssets []map[string]any `json:"aestheticAssets"`
	Rating          float64          `json:"rating"`
	Notes           string           `json:"notes,omitempty"`
	CreatedAt       time.Time        `json:"createdAt"`
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
	// Memory (R15.13 P2)
	UpsertMemory(ctx context.Context, m Memory) error
	GetMemory(ctx context.Context, sceneID string) (Memory, error)
	ListMemoriesByUser(ctx context.Context, userID string, limit int) ([]Memory, error)
	ListMemoriesByScene(ctx context.Context, sceneID string) ([]Memory, error)
}

type memoryRepo struct {
	mu       sync.Mutex
	m        map[string]Scene
	invs     map[string]Invitation
	benefits map[string]Benefit
	checkins map[string]map[string]Checkin
	memories map[string]Memory
}

func NewMemoryRepository() Repository {
	return &memoryRepo{
		m:        map[string]Scene{},
		invs:     map[string]Invitation{},
		benefits: map[string]Benefit{},
		checkins: map[string]map[string]Checkin{},
		memories: map[string]Memory{},
	}
}

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

// ── Memory (R15.13 P2) ────────────────────────────────────────────

func (r *memoryRepo) UpsertMemory(ctx context.Context, m Memory) error {
	r.mu.Lock(); defer r.mu.Unlock()
	if m.SceneID == "" {
		return errors.New("memory sceneId is required")
	}
	if m.ID == "" {
		m.ID = newID("mem_")
	}
	if m.AestheticAssets == nil {
		m.AestheticAssets = []map[string]any{}
	}
	r.memories[m.SceneID] = m
	return nil
}

func (r *memoryRepo) GetMemory(ctx context.Context, sceneID string) (Memory, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	m, ok := r.memories[sceneID]
	if !ok { return Memory{}, ErrNotFound }
	return m, nil
}

func (r *memoryRepo) ListMemoriesByUser(ctx context.Context, userID string, limit int) ([]Memory, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	out := []Memory{}
	if limit <= 0 { return out, nil }
	for _, m := range r.memories {
		if m.HostID == userID || m.GuestID == userID {
			out = append(out, m)
			if len(out) >= limit { break }
		}
	}
	return out, nil
}

func (r *memoryRepo) ListMemoriesByScene(ctx context.Context, sceneID string) ([]Memory, error) {
	r.mu.Lock(); defer r.mu.Unlock()
	out := []Memory{}
	if m, ok := r.memories[sceneID]; ok {
		out = append(out, m)
	}
	return out, nil
}
