package demand

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

type TaskSlot struct {
	ID     string `json:"id"`
	RoleID string `json:"roleId"`
	State  string `json:"state"`
}

type TaskDraft struct {
	ID                 string            `json:"id"`
	OwnerUserAccountID string            `json:"ownerUserAccountId"`
	Principal          command.Principal `json:"principal"`
	Lifecycle          string            `json:"lifecycle"`
	Version            int               `json:"version"`
	SourceInput        string            `json:"sourceInput"`
	DraftProgress      int               `json:"draftProgress"`
	LastCompletedStep  int               `json:"lastCompletedStep"`
	Changes            map[string]any    `json:"changes"`
	Slots              []TaskSlot        `json:"slots"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

type GateDecision struct {
	Status       string
	OperationRef string
	ErrorCode    string
	MessageKey   string
}

type Gate func(*TaskDraft, command.Envelope) GateDecision

type Service struct {
	mu            sync.Mutex
	repository    Repository
	admissionGate Gate
	fundingGate   Gate
	clock         clock.Clock
}

func New(admissionGate, fundingGate Gate) *Service {
	return NewWithRepository(admissionGate, fundingGate, NewMemoryRepository())
}

func NewWithRepository(admissionGate, fundingGate Gate, repository Repository) *Service {
	if admissionGate == nil {
		admissionGate = func(*TaskDraft, command.Envelope) GateDecision {
			return GateDecision{Status: "PENDING", OperationRef: "admission_pending", ErrorCode: "ADMISSION_GATE_NOT_CONFIGURED", MessageKey: "demand.admission_gate_pending"}
		}
	}
	if fundingGate == nil {
		fundingGate = func(*TaskDraft, command.Envelope) GateDecision {
			return GateDecision{Status: "PENDING", OperationRef: "funding_pending", ErrorCode: "FUNDING_GATE_NOT_CONFIGURED", MessageKey: "demand.funding_gate_pending"}
		}
	}
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, admissionGate: admissionGate, fundingGate: fundingGate, clock: clock.System{}}
}

func NewWithClock(admissionGate, fundingGate Gate, domainClock clock.Clock) *Service {
	service := NewWithRepository(admissionGate, fundingGate, NewMemoryRepository())
	if domainClock != nil {
		service.clock = domainClock
	}
	return service

}

func NewWithRepositoryAndClock(admissionGate, fundingGate Gate, repository Repository, domainClock clock.Clock) *Service {
	service := NewWithRepository(admissionGate, fundingGate, repository)
	if domainClock != nil {
		service.clock = domainClock
	}
	return service
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateTaskDraft", "UpdateTaskDraft", "PreviewTaskDraft", "PublishTask":
		return true
	default:
		return false
	}
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreateTaskDraft":
		return s.createDraft(ctx, e)
	case "UpdateTaskDraft":
		return s.updateDraft(ctx, e)
	case "PreviewTaskDraft":
		return s.previewDraft(ctx, e)
	case "PublishTask":
		return s.publishTask(ctx, e)
	default:
		return command.Rejected(e, "DEMAND_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "demand.unsupported_command", nil)
	}
}

func (s *Service) Snapshot() []TaskDraft {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.repository.Snapshot(context.Background())
	if err != nil {
		return nil
	}
	return result
}

type createDraftPayload struct {
	OwnerUserAccountID string            `json:"ownerUserAccountId"`
	Principal          command.Principal `json:"principal"`
	SourceInput        string            `json:"sourceInput"`
	CatalogVersion     string            `json:"catalogVersion"`
	PolicySnapshot     map[string]any    `json:"policySnapshot"`
}

func (s *Service) createDraft(ctx context.Context, e command.Envelope) command.Result {
	var p createDraftPayload
	if !decode(e.Payload, &p) || p.OwnerUserAccountID == "" || p.SourceInput == "" || p.Principal.ID == "" {
		return command.Rejected(e, "INVALID_TASK_DRAFT", "VALIDATION", "AFTER_USER_ACTION", "demand.invalid_create_draft", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID != p.OwnerUserAccountID || e.Principal.Type != p.Principal.Type || e.Principal.ID != p.Principal.ID {
		return command.Rejected(e, "DRAFT_CREATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "demand.draft_creation_not_allowed", nil)
	}
	changes := map[string]any{}
	if p.CatalogVersion != "" {
		changes["catalogVersion"] = p.CatalogVersion
	}
	if p.PolicySnapshot != nil {
		changes["policySnapshot"] = p.PolicySnapshot
	}
	draft := TaskDraft{ID: newID("draft_"), OwnerUserAccountID: p.OwnerUserAccountID, Principal: p.Principal, Lifecycle: "DRAFT", Version: 1, SourceInput: p.SourceInput, Changes: changes, Slots: []TaskSlot{}, UpdatedAt: s.clock.Now().UTC()}
	domainEvents := []event.DomainEvent{event.New("TaskDraftCreated", "TaskDraft", draft.ID, draft.Version, e.Principal.ID, e.CorrelationID, e.CommandID, draft.UpdatedAt, map[string]any{
		"ownerUserAccountId": draft.OwnerUserAccountID,
		"sourceInput":        draft.SourceInput,
		"changes":            draft.Changes,
	})}
	if err := s.persistCreateDraft(ctx, draft, domainEvents); err != nil {
		return command.Rejected(e, "TASK_DRAFT_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "demand.draft_create_failed", nil)
	}
	return command.Accepted(e, "TaskDraft", draft.ID, 1, "DRAFT", eventRefs(domainEvents))
}

type updateDraftPayload struct {
	ExpectedVersion int            `json:"expectedVersion"`
	Changes         map[string]any `json:"changes"`
}

func (s *Service) updateDraft(ctx context.Context, e command.Envelope) command.Result {
	var p updateDraftPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 || p.Changes == nil {
		return command.Rejected(e, "INVALID_TASK_DRAFT_UPDATE", "VALIDATION", "AFTER_USER_ACTION", "demand.invalid_update_draft", nil)
	}
	draft, err := s.repository.GetDraft(ctx, e.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return command.Rejected(e, "TASK_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "TASK_DRAFT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "demand.draft_read_failed", nil)
	}
	if !canEdit(draft, e) {
		return command.Rejected(e, "DRAFT_UPDATE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "demand.draft_update_not_allowed", nil)
	}
	if draft.Lifecycle != "DRAFT" {
		return command.Rejected(e, "TASK_DRAFT_NOT_EDITABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_not_editable", nil)
	}
	if p.ExpectedVersion != draft.Version {
		return command.Rejected(e, "TASK_DRAFT_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "demand.draft_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion, "actualVersion": draft.Version})
	}
	material := false
	for key, value := range p.Changes {
		draft.Changes[key] = value
		if isMaterialField(key) {
			material = true
		}
	}
	if material {
		if _, hasConfirmation := p.Changes["confirmation"]; !hasConfirmation {
			draft.Changes["confirmation"] = map[string]any{"scopeConfirmed": false, "materialChangePolicyConfirmed": false, "fundingAuthorizationConfirmed": false}
		}
	}
	if value, ok := number(p.Changes["draftProgress"]); ok {
		draft.DraftProgress = int(value)
	}
	if value, ok := number(p.Changes["lastCompletedStep"]); ok {
		draft.LastCompletedStep = int(value)
	}
	previousVersion := draft.Version
	draft.Version++
	draft.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("TaskDraftUpdated", "TaskDraft", draft.ID, draft.Version, e.Principal.ID, e.CorrelationID, e.CommandID, draft.UpdatedAt, map[string]any{
		"changes":         p.Changes,
		"previousVersion": previousVersion,
		"expectedVersion": p.ExpectedVersion,
	})}
	if err := s.persistUpdateDraft(ctx, draft, previousVersion, domainEvents); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "TASK_DRAFT_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "demand.draft_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "TASK_DRAFT_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "demand.draft_update_failed", nil)
	}
	return command.Accepted(e, "TaskDraft", draft.ID, draft.Version, draft.Lifecycle, eventRefs(domainEvents))
}

type previewPayload struct {
	ExpectedVersion int `json:"expectedVersion"`
}

func (s *Service) previewDraft(ctx context.Context, e command.Envelope) command.Result {
	var p previewPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 {
		return command.Rejected(e, "INVALID_TASK_PREVIEW", "VALIDATION", "AFTER_USER_ACTION", "demand.invalid_preview", nil)
	}
	draft, err := s.repository.GetDraft(ctx, e.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return command.Rejected(e, "TASK_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "TASK_DRAFT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "demand.draft_read_failed", nil)
	}
	if !canEdit(draft, e) {
		return command.Rejected(e, "DRAFT_PREVIEW_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "demand.draft_preview_not_allowed", nil)
	}
	if p.ExpectedVersion != draft.Version {
		return command.Rejected(e, "TASK_DRAFT_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "demand.draft_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion, "actualVersion": draft.Version})
	}
	missing := missingPreviewFields(draft)
	if len(missing) > 0 {
		return command.Rejected(e, "TASK_DRAFT_INCOMPLETE", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_incomplete", map[string]any{"missingFields": missing})
	}
	return command.Accepted(e, "DemandPreview", draft.ID, draft.Version, "READY", []string{})
}

type publishPayload struct {
	ExpectedVersion int  `json:"expectedVersion"`
	Online          bool `json:"online"`
}

func (s *Service) publishTask(ctx context.Context, e command.Envelope) command.Result {
	var p publishPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 || !p.Online {
		return command.Rejected(e, "INVALID_TASK_PUBLISH", "VALIDATION", "AFTER_USER_ACTION", "demand.invalid_publish", nil)
	}
	draft, err := s.repository.GetDraft(ctx, e.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return command.Rejected(e, "TASK_DRAFT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "TASK_DRAFT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "demand.draft_read_failed", nil)
	}
	if !canEdit(draft, e) {
		return command.Rejected(e, "TASK_PUBLISH_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "demand.publish_not_allowed", nil)
	}
	if draft.Lifecycle != "DRAFT" && draft.Lifecycle != "READY" {
		return command.Rejected(e, "TASK_NOT_ACTIONABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.task_not_actionable", nil)
	}
	if p.ExpectedVersion != draft.Version {
		return command.Rejected(e, "TASK_DRAFT_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "demand.draft_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion, "actualVersion": draft.Version})
	}
	missing := missingPublishFields(draft)
	if len(missing) > 0 {
		return command.Rejected(e, "TASK_DRAFT_INCOMPLETE", "BUSINESS_STATE", "AFTER_USER_ACTION", "demand.draft_incomplete", map[string]any{"missingFields": missing})
	}
	admission := s.admissionGate(&draft, e)
	if admission.Status != "ALLOW" {
		return gateResult(e, admission, "ADMISSION")
	}
	funding := s.fundingGate(&draft, e)
	if funding.Status != "ALLOW" {
		return gateResult(e, funding, "FUNDING")
	}
	draft.Slots = expandSlots(draft.Changes["slotGroups"])
	draft.Lifecycle = "COMMITTED"
	previousVersion := draft.Version
	draft.Version++
	draft.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{
		event.New("TaskPublished", "Task", draft.ID, draft.Version, e.Principal.ID, e.CorrelationID, e.CommandID, draft.UpdatedAt, map[string]any{
			"lifecycle": "COMMITTED",
			"slotCount": len(draft.Slots),
		}),
		event.New("TaskSlotsCreated", "Task", draft.ID, draft.Version, e.Principal.ID, e.CorrelationID, e.CommandID, draft.UpdatedAt, map[string]any{
			"slotCount": len(draft.Slots),
		}),
	}
	if err := s.persistUpdateDraft(ctx, draft, previousVersion, domainEvents); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "TASK_DRAFT_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "demand.draft_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "TASK_DRAFT_PUBLISH_FAILED", "INTERNAL", "SAFE_RETRY", "demand.publish_failed", nil)
	}
	return command.Accepted(e, "Task", draft.ID, draft.Version, "COMMITTED", eventRefs(domainEvents))
}

func (s *Service) persistCreateDraft(ctx context.Context, draft TaskDraft, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.CreateDraftAndPublish(ctx, draft, domainEvents)
	}
	return s.repository.CreateDraft(ctx, draft)
}

func (s *Service) persistUpdateDraft(ctx context.Context, draft TaskDraft, expectedVersion int, domainEvents []event.DomainEvent) error {
	if repository, ok := s.repository.(TransactionalRepository); ok {
		return repository.UpdateDraftAndPublish(ctx, draft, expectedVersion, domainEvents)
	}
	return s.repository.UpdateDraft(ctx, draft, expectedVersion)
}

func eventRefs(domainEvents []event.DomainEvent) []string {
	refs := make([]string, 0, len(domainEvents))
	for _, domainEvent := range domainEvents {
		refs = append(refs, domainEvent.EventID)
	}
	return refs
}

func missingPreviewFields(draft TaskDraft) []string {
	missing := []string{}
	for _, key := range []string{"industry", "scenario", "startAt", "endAt", "location", "slotGroups", "mustRequirements", "deliverables", "budget", "matchingMode", "catalogVersion", "policySnapshot"} {
		if emptyValue(draft.Changes[key]) {
			missing = append(missing, key)
		}
	}
	if start, ok := draft.Changes["startAt"].(string); ok {
		if end, ok := draft.Changes["endAt"].(string); ok {
			startTime, startErr := time.Parse(time.RFC3339, start)
			endTime, endErr := time.Parse(time.RFC3339, end)
			if startErr == nil && endErr == nil && !endTime.After(startTime) {
				missing = append(missing, "time_range")
			}
		}
	}
	return missing
}

func missingPublishFields(draft TaskDraft) []string {
	missing := missingPreviewFields(draft)
	confirmation, _ := draft.Changes["confirmation"].(map[string]any)
	for _, key := range []string{"scopeConfirmed", "materialChangePolicyConfirmed", "fundingAuthorizationConfirmed"} {
		if value, ok := confirmation[key].(bool); !ok || !value {
			missing = append(missing, key)
		}
	}
	return missing
}

func canEdit(draft TaskDraft, e command.Envelope) bool {
	return e.Actor.Type == "USER" && e.Actor.ID == draft.OwnerUserAccountID && e.Principal == draft.Principal
}
func isMaterialField(key string) bool {
	switch key {
	case "industry", "scenario", "startAt", "endAt", "location", "slotGroups", "mustRequirements", "deliverables", "budget", "matchingMode", "catalogVersion", "policySnapshot":
		return true
	default:
		return false
	}
}
func emptyValue(value any) bool {
	if value == nil {
		return true
	}
	switch value := value.(type) {
	case string:
		return value == ""
	case []any:
		return len(value) == 0
	case map[string]any:
		return len(value) == 0
	case float64:
		return value <= 0
	default:
		return false
	}
}
func number(value any) (float64, bool) { numeric, ok := value.(float64); return numeric, ok }

func gateResult(e command.Envelope, decision GateDecision, gate string) command.Result {
	if decision.Status == "PENDING" {
		return command.Pending(e, decision.OperationRef, decision.ErrorCode, "PROVIDER", decision.MessageKey, map[string]any{"gate": gate})
	}
	return command.Rejected(e, decision.ErrorCode, "BUSINESS_STATE", "AFTER_USER_ACTION", decision.MessageKey, map[string]any{"gate": gate})
}

func expandSlots(value any) []TaskSlot {
	groups, ok := value.([]any)
	if !ok {
		return []TaskSlot{}
	}
	result := []TaskSlot{}
	for _, raw := range groups {
		group, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		role, _ := group["roleId"].(string)
		quantity, _ := number(group["quantity"])
		for i := 0; i < int(quantity); i++ {
			result = append(result, TaskSlot{ID: newID("slot_"), RoleID: role, State: "OPEN"})
		}
	}
	return result
}

func cloneDraft(draft TaskDraft) TaskDraft {
	copy := draft
	copy.Changes = map[string]any{}
	for key, value := range draft.Changes {
		copy.Changes[key] = value
	}
	copy.Slots = append([]TaskSlot{}, draft.Slots...)
	return copy
}
func decode(payload map[string]any, target any) bool {
	bytes, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(bytes, target) == nil
}

var idSequence uint64

func newID(prefix string) string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err == nil {
		return prefix + hex.EncodeToString(bytes[:])
	}
	return prefix + "fallback_" + formatSequence(atomic.AddUint64(&idSequence, 1))
}

func formatSequence(value uint64) string {
	var bytes [8]byte
	for index := range bytes {
		bytes[len(bytes)-1-index] = byte(value >> (index * 8))
	}
	return hex.EncodeToString(bytes[:])
}
