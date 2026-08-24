package outcome

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

type ObservationSet struct {
	ID        string    `json:"id"`
	TargetID  string    `json:"targetId"`
	TemplateID string   `json:"templateId"`
	VenueID   string    `json:"venueId"`
	Status    string    `json:"status"` // DRAFT | FINALIZED
	CreatedAt time.Time `json:"createdAt"`
	FinalizedAt *time.Time `json:"finalizedAt,omitempty"`
	Observations []Observation `json:"observations"`
}

type Observation struct {
	ID        string    `json:"id"`
	SetID     string    `json:"setId"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	Unit      string    `json:"unit"`
	CreatedAt time.Time `json:"createdAt"`
}

type OutcomeDelta struct {
	ID         string    `json:"id"`
	BaselineID string    `json:"baselineId"`
	ResultID   string    `json:"resultId"`
	Result     string    `json:"result"` // IMPROVED | WORSE | SAME | UNKNOWN
	PolicyVersion string `json:"policyVersion"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Learning struct {
	ID        string `json:"id"`
	DeltaID   string `json:"deltaId"`
	Status    string `json:"status"` // SUGGESTED | CONFIRMED | DISMISSED
	CreatedAt time.Time `json:"createdAt"`
}

type Repository interface {
	CreateSet(ctx context.Context, s ObservationSet) error
	GetSet(ctx context.Context, id string) (ObservationSet, error)
	UpdateSet(ctx context.Context, s ObservationSet) error
	CreateDelta(ctx context.Context, d OutcomeDelta) error
	CreateLearning(ctx context.Context, l Learning) error
	GetLearning(ctx context.Context, id string) (Learning, error)
	UpdateLearning(ctx context.Context, l Learning) error
}

type MemoryRepository struct {
	mu       sync.Mutex
	sets     map[string]ObservationSet
	deltas   map[string]OutcomeDelta
	learnings map[string]Learning
	events   []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{sets: make(map[string]ObservationSet), deltas: make(map[string]OutcomeDelta), learnings: make(map[string]Learning)}
}
func (r *MemoryRepository) CreateSet(_ context.Context, s ObservationSet) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sets[s.ID] = s
	return nil
}
func (r *MemoryRepository) GetSet(_ context.Context, id string) (ObservationSet, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sets[id]
	if !ok {
		return ObservationSet{}, errors.New("set not found")
	}
	return s, nil
}
func (r *MemoryRepository) UpdateSet(_ context.Context, s ObservationSet) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sets[s.ID] = s
	return nil
}
func (r *MemoryRepository) CreateDelta(_ context.Context, d OutcomeDelta) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deltas[d.ID] = d
	return nil
}
func (r *MemoryRepository) CreateLearning(_ context.Context, l Learning) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.learnings[l.ID] = l
	return nil
}
func (r *MemoryRepository) GetLearning(_ context.Context, id string) (Learning, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	l, ok := r.learnings[id]
	if !ok {
		return Learning{}, errors.New("learning not found")
	}
	return l, nil
}
func (r *MemoryRepository) UpdateLearning(_ context.Context, l Learning) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.learnings[l.ID] = l
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
	case "CreateObservationSet", "RecordOutcomeObservation", "FinalizeObservationSet", "CreateOutcomeComparison", "ConfirmOutcomeLearning", "DismissOutcomeLearning":
		return true
	}
	return false
}
func (s *Service) Handle(e command.Envelope) command.Result { return s.HandleContext(context.Background(), e) }
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateObservationSet":
		return s.createSet(ctx, e)
	case "RecordOutcomeObservation":
		return s.recordObservation(ctx, e)
	case "FinalizeObservationSet":
		return s.finalizeSet(ctx, e)
	case "CreateOutcomeComparison":
		return s.createComparison(ctx, e)
	case "ConfirmOutcomeLearning":
		return s.confirmLearning(ctx, e)
	case "DismissOutcomeLearning":
		return s.dismissLearning(ctx, e)
	default:
		return command.Rejected(e, "OUTCOME_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "outcome.unsupported", nil)
	}
}

func (s *Service) createSet(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		TargetID   string `json:"targetId"`
		TemplateID string `json:"templateId"`
		VenueID    string `json:"venueId"`
	}
	if !decode(e.Payload, &p) || p.TargetID == "" || p.TemplateID == "" || p.VenueID == "" {
		return command.Rejected(e, "INVALID_SET", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_set", nil)
	}
	now := s.clock.Now().UTC()
	set := ObservationSet{ID: newID("os_"), TargetID: p.TargetID, TemplateID: p.TemplateID, VenueID: p.VenueID, Status: "DRAFT", CreatedAt: now}
	_ = s.repo.CreateSet(ctx, set)
	ev := event.New("ObservationSetCreated", "ObservationSet", set.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"targetId": p.TargetID})
	return command.Accepted(e, "ObservationSet", set.ID, 1, set.Status, []string{ev.EventID})
}

func (s *Service) recordObservation(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		SetID string `json:"setId"`
		Key   string `json:"key"`
		Value string `json:"value"`
		Unit  string `json:"unit"`
	}
	if !decode(e.Payload, &p) || p.SetID == "" || p.Key == "" {
		return command.Rejected(e, "INVALID_OBSERVATION", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_observation", nil)
	}
	set, err := s.repo.GetSet(ctx, p.SetID)
	if err != nil {
		return command.Rejected(e, "SET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.set_not_found", nil)
	}
	if set.Status != "DRAFT" {
		return command.Rejected(e, "SET_NOT_DRAFT", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.set_not_draft", nil)
	}
	obs := Observation{ID: newID("ob_"), SetID: p.SetID, Key: p.Key, Value: p.Value, Unit: p.Unit, CreatedAt: s.clock.Now().UTC()}
	set.Observations = append(set.Observations, obs)
	_ = s.repo.UpdateSet(ctx, set)
	ev := event.New("OutcomeObservationRecorded", "ObservationSet", set.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, obs.CreatedAt, map[string]any{"key": p.Key})
	return command.Accepted(e, "ObservationSet", set.ID, 1, set.Status, []string{ev.EventID})
}

func (s *Service) finalizeSet(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ SetID string `json:"setId"`}
	if !decode(e.Payload, &p) || p.SetID == "" {
		p.SetID = e.Target.ID
		if p.SetID == "" {
			return command.Rejected(e, "INVALID_FINALIZE", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_finalize", nil)
		}
	}
	set, err := s.repo.GetSet(ctx, p.SetID)
	if err != nil {
		return command.Rejected(e, "SET_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.set_not_found", nil)
	}
	if set.Status == "FINALIZED" {
		return command.Rejected(e, "SET_ALREADY_FINALIZED", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.already_finalized", nil)
	}
	now := s.clock.Now().UTC()
	set.Status = "FINALIZED"
	set.FinalizedAt = &now
	_ = s.repo.UpdateSet(ctx, set)
	ev := event.New("ObservationSetFinalized", "ObservationSet", set.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, nil)
	return command.Accepted(e, "ObservationSet", set.ID, 1, set.Status, []string{ev.EventID})
}

func (s *Service) createComparison(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		BaselineID string `json:"baselineId"`
		ResultID   string `json:"resultId"`
		PolicyVersion string `json:"policyVersion"`
	}
	if !decode(e.Payload, &p) || p.BaselineID == "" || p.ResultID == "" {
		return command.Rejected(e, "INVALID_COMPARISON", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_comparison", nil)
	}
	baseline, err := s.repo.GetSet(ctx, p.BaselineID)
	if err != nil {
		return command.Rejected(e, "BASELINE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.baseline_not_found", nil)
	}
	result, err := s.repo.GetSet(ctx, p.ResultID)
	if err != nil {
		return command.Rejected(e, "RESULT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.result_not_found", nil)
	}
	// Gates
	if baseline.Status != "FINALIZED" || result.Status != "FINALIZED" {
		return command.Rejected(e, "NOT_FINALIZED", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.not_finalized", nil)
	}
	if baseline.TargetID != result.TargetID {
		return command.Rejected(e, "TARGET_MISMATCH", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.target_mismatch", nil)
	}
	if baseline.TemplateID != result.TemplateID {
		return command.Rejected(e, "TEMPLATE_LINEAGE_MISMATCH", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.template_mismatch", nil)
	}
	if baseline.VenueID != result.VenueID {
		return command.Rejected(e, "ENTITY_MISMATCH", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.entity_mismatch", nil)
	}
	// unit compatibility: if observations have different units for same key -> UNKNOWN allowed but must check
	// For now allow, result UNKNOWN if missing
	if p.PolicyVersion == "" {
		return command.Rejected(e, "POLICY_MISSING", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.policy_missing", nil)
	}
	now := s.clock.Now().UTC()
	// Simple delta: if any observation missing -> UNKNOWN else SAME (for demo)
	deltaResult := "SAME"
	if len(baseline.Observations) == 0 || len(result.Observations) == 0 {
		deltaResult = "UNKNOWN"
	}
	delta := OutcomeDelta{ID: newID("delta_"), BaselineID: p.BaselineID, ResultID: p.ResultID, Result: deltaResult, PolicyVersion: p.PolicyVersion, CreatedAt: now}
	_ = s.repo.CreateDelta(ctx, delta)
	learning := Learning{ID: newID("learn_"), DeltaID: delta.ID, Status: "SUGGESTED", CreatedAt: now}
	_ = s.repo.CreateLearning(ctx, learning)
	ev := event.New("OutcomeComparisonCreated", "OutcomeDelta", delta.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"result": deltaResult})
	return acceptedWithPayload(e, "OutcomeDelta", delta.ID, 1, deltaResult, map[string]any{"deltaId": delta.ID, "learningId": learning.ID, "result": deltaResult}, []event.DomainEvent{ev})
}

func (s *Service) confirmLearning(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ LearningID string `json:"learningId"`}
	if !decode(e.Payload, &p) || p.LearningID == "" {
		p.LearningID = e.Target.ID
		if p.LearningID == "" {
			return command.Rejected(e, "INVALID_CONFIRM", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_confirm", nil)
		}
	}
	l, err := s.repo.GetLearning(ctx, p.LearningID)
	if err != nil {
		return command.Rejected(e, "LEARNING_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.learning_not_found", nil)
	}
	if l.Status != "SUGGESTED" {
		return command.Rejected(e, "LEARNING_NOT_SUGGESTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.learning_not_suggested", nil)
	}
	l.Status = "CONFIRMED"
	_ = s.repo.UpdateLearning(ctx, l)
	ev := event.New("OutcomeLearningConfirmed", "Learning", l.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), nil)
	return command.Accepted(e, "Learning", l.ID, 1, l.Status, []string{ev.EventID})
}
func (s *Service) dismissLearning(ctx context.Context, e command.Envelope) command.Result {
	var p struct{ LearningID string `json:"learningId"`}
	if !decode(e.Payload, &p) || p.LearningID == "" {
		p.LearningID = e.Target.ID
		if p.LearningID == "" {
			return command.Rejected(e, "INVALID_DISMISS", "VALIDATION", "AFTER_USER_ACTION", "outcome.invalid_dismiss", nil)
		}
	}
	l, err := s.repo.GetLearning(ctx, p.LearningID)
	if err != nil {
		return command.Rejected(e, "LEARNING_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "outcome.learning_not_found", nil)
	}
	l.Status = "DISMISSED"
	_ = s.repo.UpdateLearning(ctx, l)
	ev := event.New("OutcomeLearningDismissed", "Learning", l.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), nil)
	return command.Accepted(e, "Learning", l.ID, 1, l.Status, []string{ev.EventID})
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
	return prefix + time.Now().Format("150405.000000")
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
