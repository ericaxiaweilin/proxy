package safety

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type Incident struct {
	ID         string    `json:"id"`
	ReporterID string    `json:"reporterId"`
	TargetID   string    `json:"targetId"`
	TargetType string    `json:"targetType"`
	Reason     string    `json:"reason"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Block struct {
	ID         string     `json:"id"`
	IncidentID string     `json:"incidentId"`
	TargetID   string     `json:"targetId"`
	BlockType  string     `json:"blockType"`
	Reason     string     `json:"reason"`
	CreatedAt  time.Time  `json:"createdAt"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
}

type OperatorCase struct {
	ID         string    `json:"id"`
	IncidentID string    `json:"incidentId"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type JITGrant struct {
	ID        string    `json:"id"`
	GranteeID string    `json:"granteeId"`
	Scope     string    `json:"scope"`
	Purpose   string    `json:"purpose"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

type Consent struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Purpose   string    `json:"purpose"`
	Granted   bool      `json:"granted"`
	CreatedAt time.Time `json:"createdAt"`
}

type LegalHold struct {
	ID         string     `json:"id"`
	TargetID   string     `json:"targetId"`
	Reason     string     `json:"reason"`
	CreatedAt  time.Time  `json:"createdAt"`
	ReleasedAt *time.Time `json:"releasedAt,omitempty"`
}

type Repository interface {
	CreateIncident(ctx context.Context, inc Incident) error
	CreateBlock(ctx context.Context, b Block) error
	CreateCase(ctx context.Context, c OperatorCase) error
	CreateJIT(ctx context.Context, g JITGrant) error
	GetJIT(ctx context.Context, id string) (JITGrant, error)
	UpsertConsent(ctx context.Context, c Consent) error
	CreateLegalHold(ctx context.Context, h LegalHold) error
	GetActiveLegalHold(ctx context.Context, targetID string) (LegalHold, error)
	ReleaseLegalHold(ctx context.Context, id string) error
}

type MemoryRepository struct {
	mu        sync.Mutex
	incidents map[string]Incident
	blocks    map[string]Block
	cases     map[string]OperatorCase
	jits      map[string]JITGrant
	consents  map[string]Consent
	holds     map[string]LegalHold
	events    []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		incidents: make(map[string]Incident),
		blocks: make(map[string]Block),
		cases: make(map[string]OperatorCase),
		jits: make(map[string]JITGrant),
		consents: make(map[string]Consent),
		holds: make(map[string]LegalHold),
	}
}
func (r *MemoryRepository) CreateIncident(_ context.Context, inc Incident) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.incidents[inc.ID] = inc
	return nil
}
func (r *MemoryRepository) CreateBlock(_ context.Context, b Block) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.blocks[b.ID] = b
	return nil
}
func (r *MemoryRepository) CreateCase(_ context.Context, c OperatorCase) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cases[c.ID] = c
	return nil
}
func (r *MemoryRepository) CreateJIT(_ context.Context, g JITGrant) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.jits[g.ID] = g
	return nil
}
func (r *MemoryRepository) GetJIT(_ context.Context, id string) (JITGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	g, ok := r.jits[id]
	if !ok {
		return JITGrant{}, errors.New("jit not found")
	}
	return g, nil
}
func (r *MemoryRepository) UpsertConsent(_ context.Context, c Consent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.consents[c.UserID+"|"+c.Purpose] = c
	return nil
}
func (r *MemoryRepository) CreateLegalHold(_ context.Context, h LegalHold) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.holds[h.ID] = h
	return nil
}
func (r *MemoryRepository) GetActiveLegalHold(_ context.Context, targetID string) (LegalHold, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, h := range r.holds {
		if h.TargetID == targetID && h.ReleasedAt == nil {
			return h, nil
		}
	}
	return LegalHold{}, errors.New("no active hold")
}
func (r *MemoryRepository) ReleaseLegalHold(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.holds[id]
	if !ok {
		return errors.New("hold not found")
	}
	now := time.Now().UTC()
	h.ReleasedAt = &now
	r.holds[id] = h
	return nil
}

type Service struct {
	mu   sync.Mutex
	repo Repository
	clock clock.Clock
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }
func NewWithRepository(repo Repository) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Service{repo: repo, clock: clock.System{}}
}
func (s *Service) Supports(t string) bool {
	switch t {
	case "CreateIncident", "CreateSafetyBlock", "CreateOperatorCase", "GrantJITAccess", "CheckJITAccess", "RecordConsent", "CreateLegalHold", "ReleaseLegalHold", "CheckLegalHold":
		return true
	}
	return false
}
func (s *Service) Handle(e command.Envelope) command.Result { return s.HandleContext(context.Background(), e) }
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateIncident":
		return s.createIncident(ctx, e)
	case "CreateSafetyBlock":
		return s.createBlock(ctx, e)
	case "CreateOperatorCase":
		return s.createCase(ctx, e)
	case "GrantJITAccess":
		return s.grantJIT(ctx, e)
	case "CheckJITAccess":
		return s.checkJIT(ctx, e)
	case "RecordConsent":
		return s.recordConsent(ctx, e)
	case "CreateLegalHold":
		return s.createHold(ctx, e)
	case "ReleaseLegalHold":
		return s.releaseHold(ctx, e)
	case "CheckLegalHold":
		return s.checkHold(ctx, e)
	default:
		return command.Rejected(e, "SAFETY_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "safety.unsupported", nil)
	}
}

func (s *Service) createIncident(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		TargetID   string `json:"targetId"`
		TargetType string `json:"targetType"`
		Reason     string `json:"reason"`
	}
	if !decode(e.Payload, &p) || p.TargetID == "" || p.Reason == "" {
		return command.Rejected(e, "INVALID_INCIDENT", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_incident", nil)
	}
	now := s.clock.Now().UTC()
	inc := Incident{ID: newID("inc_"), ReporterID: e.Actor.ID, TargetID: p.TargetID, TargetType: p.TargetType, Reason: p.Reason, Status: "OPEN", CreatedAt: now}
	_ = s.repo.CreateIncident(ctx, inc)
	// Safety event creates downstream holds: create a block automatically
	block := Block{ID: newID("blk_"), IncidentID: inc.ID, TargetID: p.TargetID, BlockType: "ACCOUNT", Reason: p.Reason, CreatedAt: now}
	_ = s.repo.CreateBlock(ctx, block)
	ev := event.New("IncidentCreated", "Incident", inc.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"targetId": p.TargetID})
	return command.Accepted(e, "Incident", inc.ID, 1, inc.Status, []string{ev.EventID})
}

func (s *Service) createBlock(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		TargetID  string `json:"targetId"`
		BlockType string `json:"blockType"`
		Reason    string `json:"reason"`
	}
	if !decode(e.Payload, &p) || p.TargetID == "" {
		return command.Rejected(e, "INVALID_BLOCK", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_block", nil)
	}
	now := s.clock.Now().UTC()
	block := Block{ID: newID("blk_"), TargetID: p.TargetID, BlockType: p.BlockType, Reason: p.Reason, CreatedAt: now}
	_ = s.repo.CreateBlock(ctx, block)
	ev := event.New("SafetyBlockCreated", "Block", block.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return command.Accepted(e, "Block", block.ID, 1, block.BlockType, []string{ev.EventID})
}

func (s *Service) createCase(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		IncidentID string `json:"incidentId"`
		Title      string `json:"title"`
	}
	if !decode(e.Payload, &p) || p.Title == "" {
		return command.Rejected(e, "INVALID_CASE", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_case", nil)
	}
	now := s.clock.Now().UTC()
	c := OperatorCase{ID: newID("case_"), IncidentID: p.IncidentID, Title: p.Title, Status: "OPEN", CreatedAt: now}
	_ = s.repo.CreateCase(ctx, c)
	ev := event.New("OperatorCaseCreated", "OperatorCase", c.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return command.Accepted(e, "OperatorCase", c.ID, 1, c.Status, []string{ev.EventID})
}

func (s *Service) grantJIT(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		GranteeID string `json:"granteeId"`
		Scope     string `json:"scope"`
		Purpose   string `json:"purpose"`
		TTLMinutes int   `json:"ttlMinutes"`
	}
	if !decode(e.Payload, &p) || p.GranteeID == "" || p.Scope == "" {
		return command.Rejected(e, "INVALID_JIT", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_jit", nil)
	}
	if p.TTLMinutes <= 0 {
		p.TTLMinutes = 30
	}
	now := s.clock.Now().UTC()
	grant := JITGrant{ID: newID("jit_"), GranteeID: p.GranteeID, Scope: p.Scope, Purpose: p.Purpose, CreatedAt: now, ExpiresAt: now.Add(time.Duration(p.TTLMinutes) * time.Minute)}
	_ = s.repo.CreateJIT(ctx, grant)
	ev := event.New("JITGrantCreated", "JITGrant", grant.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return acceptedWithPayload(e, "JITGrant", grant.ID, 1, "GRANTED", map[string]any{"jitId": grant.ID, "expiresAt": grant.ExpiresAt.Format(time.RFC3339)}, []event.DomainEvent{ev})
}

func (s *Service) checkJIT(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ JITID string `json:"jitId"`}
	if !decode(e.Payload, &p) || p.JITID == "" {
		p.JITID = e.Target.ID
		if p.JITID == "" {
			return command.Rejected(e, "INVALID_JIT_CHECK", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_jit_check", nil)
		}
	}
	grant, err := s.repo.GetJIT(ctx, p.JITID)
	if err != nil {
		return command.Rejected(e, "JIT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "safety.jit_not_found", nil)
	}
	if s.clock.Now().UTC().After(grant.ExpiresAt) {
		return command.Rejected(e, "JIT_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "safety.jit_expired", nil)
	}
	return command.Accepted(e, "JITGrant", grant.ID, 1, "VALID", nil)
}

func (s *Service) recordConsent(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Purpose string `json:"purpose"`
		Granted bool   `json:"granted"`
	}
	if !decode(e.Payload, &p) || p.Purpose == "" {
		return command.Rejected(e, "INVALID_CONSENT", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_consent", nil)
	}
	now := s.clock.Now().UTC()
	c := Consent{ID: newID("cons_"), UserID: e.Actor.ID, Purpose: p.Purpose, Granted: p.Granted, CreatedAt: now}
	_ = s.repo.UpsertConsent(ctx, c)
	ev := event.New("ConsentRecorded", "Consent", c.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return command.Accepted(e, "Consent", c.ID, 1, "RECORDED", []string{ev.EventID})
}

func (s *Service) createHold(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		TargetID string `json:"targetId"`
		Reason   string `json:"reason"`
	}
	if !decode(e.Payload, &p) || p.TargetID == "" {
		return command.Rejected(e, "INVALID_HOLD", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_hold", nil)
	}
	now := s.clock.Now().UTC()
	h := LegalHold{ID: newID("hold_"), TargetID: p.TargetID, Reason: p.Reason, CreatedAt: now}
	_ = s.repo.CreateLegalHold(ctx, h)
	ev := event.New("LegalHoldCreated", "LegalHold", h.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return command.Accepted(e, "LegalHold", h.ID, 1, "ACTIVE", []string{ev.EventID})
}

func (s *Service) releaseHold(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ HoldID string `json:"holdId"`}
	if !decode(e.Payload, &p) || p.HoldID == "" {
		p.HoldID = e.Target.ID
		if p.HoldID == "" {
			return command.Rejected(e, "INVALID_RELEASE", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_release", nil)
		}
	}
	_ = s.repo.ReleaseLegalHold(ctx, p.HoldID)
	ev := event.New("LegalHoldReleased", "LegalHold", p.HoldID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), nil)
	return command.Accepted(e, "LegalHold", p.HoldID, 1, "RELEASED", []string{ev.EventID})
}

func (s *Service) checkHold(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ TargetID string `json:"targetId"`}
	if !decode(e.Payload, &p) || p.TargetID == "" {
		p.TargetID = e.Target.ID
		if p.TargetID == "" {
			return command.Rejected(e, "INVALID_HOLD_CHECK", "VALIDATION", "AFTER_USER_ACTION", "safety.invalid_hold_check", nil)
		}
	}
	_, err := s.repo.GetActiveLegalHold(ctx, p.TargetID)
	if err == nil {
		return command.Rejected(e, "LEGAL_HOLD_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "safety.legal_hold_active", nil)
	}
	return command.Accepted(e, "LegalHold", p.TargetID, 1, "NO_HOLD", nil)
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func newID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + "fallback"
}
func acceptedWithPayload(e command.Envelope, typ, id string, version int, state string, payload map[string]any, events []event.DomainEvent) command.Result {
	r := command.Accepted(e, typ, id, version, state, eventRefs(events))
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}
func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}
