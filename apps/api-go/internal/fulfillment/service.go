package fulfillment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// 履约全链（R14 Chapter21I §8/§12/§13 + R9 Gate G/H/N）。
// Traceable Human Order：Offer → Order → Execution → Outcome → Repeat。
// Gate G：Order 创建前冻结快照；Material Change 产生新版本不得静默覆盖。
// Gate H：DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号。

// Order 是订单聚合（含 Confirmation Snapshot）。
type Order struct {
	ID            string          `json:"orderId"`
	RequesterID   string          `json:"requesterId"`
	AgentID       string          `json:"agentId"`
	NeedID        string          `json:"needId"`
	Lifecycle     string          `json:"lifecycle"` // OFFERED | CONFIRMED | EXECUTING | COMPLETED | CANCELLED
	Version       int             `json:"version"`
	Snapshot      OrderSnapshot   `json:"snapshot"`
	Amendments    []Amendment     `json:"amendments"`
	Settlement    *SettlementRecord `json:"settlement,omitempty"`
	Outcome       *OutcomeRecord  `json:"outcome,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// OrderSnapshot 是 Gate G 冻结的确认快照。
type OrderSnapshot struct {
	Requester           string `json:"requester"`
	Agent               string `json:"agent"`
	ServiceSKU          string `json:"serviceSku"`
	NeedVersion         string `json:"needVersion"`
	RouteVersion        string `json:"routeVersion"`
	Duration            string `json:"duration"`
	StartTime           string `json:"startTime"`
	MeetingContext      string `json:"meetingContext"`
	AgreedCompensation  int64  `json:"agreedCompensation"`
	Currency            string `json:"currency"`
	IncludedScope       string `json:"includedScope"`
	ExcludedScope       string `json:"excludedScope"`
	SettlementMode      string `json:"settlementMode"` // DIRECT_SETTLEMENT | PLATFORM_PAY
	PaymentMethodLabel  string `json:"paymentMethodLabel"`
}

// Amendment 是 Material Change（新版本，不静默覆盖）。
type Amendment struct {
	AmendmentID string    `json:"amendmentId"`
	Description string    `json:"description"`
	Snapshot    OrderSnapshot `json:"snapshot"`
	CreatedAt   time.Time `json:"createdAt"`
}

// SettlementRecord 是结算记录（Gate H：DIRECT_SETTLEMENT 与 PLATFORM_PAY 隔离）。
type SettlementRecord struct {
	Mode              string    `json:"mode"`
	AgreedAmount      int64     `json:"agreedAmount"`
	Currency          string    `json:"currency"`
	Duration          string    `json:"duration"`
	IncludedScope     string    `json:"includedScope"`
	ExcludedScope     string    `json:"excludedScope"`
	PaymentMethodLabel string   `json:"paymentMethodLabel"`
	Payer             string    `json:"payer"`
	Payee             string    `json:"payee"`
	PayerConfirmed    bool      `json:"payerConfirmed"`
	PayeeConfirmed    bool      `json:"payeeConfirmed"`
	ConfirmedAt       time.Time `json:"confirmedAt"`
}

// OutcomeRecord 是履约结果（客观事实与主观满意分离）。
type OutcomeRecord struct {
	OnTime         bool      `json:"onTime"`
	ActualStart    string    `json:"actualStart"`
	ActualEnd      string    `json:"actualEnd"`
	MaterialChanges int      `json:"materialChanges"`
	ScopeCompleted bool      `json:"scopeCompleted"`
	ObjectiveNote  string    `json:"objectiveNote"`
	RecordedAt     time.Time `json:"recordedAt"`
}

// SatisfactionRecord 是主观满意（Gate：履约事实不要求用户重复打分）。
type SatisfactionRecord struct {
	Resolved      string    `json:"resolved"` // FULL | PARTIAL | NONE
	RepeatIntent  string    `json:"repeatIntent"` // REUSE | MAYBE | NO
	RecordedAt    time.Time `json:"recordedAt"`
}

// RepeatRelationship 是复购关系（Outcome → Repeat）。
type RepeatRelationship struct {
	OrderID   string    `json:"orderId"`
	AgentID   string    `json:"agentId"`
	Repeat    bool      `json:"repeat"`
	CreatedAt time.Time `json:"createdAt"`
}

type Repository interface {
	CreateOrder(ctx context.Context, o Order) error
	GetOrder(ctx context.Context, id string) (Order, error)
	UpdateOrder(ctx context.Context, o Order, expectedVersion int) error
	Snapshot(ctx context.Context) ([]Order, error)
}

// TransactionalRepository 由支持事务性 outbox 的存储实现（订单与事件原子提交）。
type TransactionalRepository interface {
	Repository
	CreateOrderAndPublish(ctx context.Context, o Order, domainEvents []event.DomainEvent) error
	UpdateOrderAndPublish(ctx context.Context, o Order, expectedVersion int, domainEvents []event.DomainEvent) error
}

var (
	ErrOrderNotFound   = errors.New("order not found")
	ErrVersionConflict = errors.New("order version conflict")
)

type MemoryRepository struct {
	mu     sync.Mutex
	orders map[string]Order
	events []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{orders: make(map[string]Order)}
}

func (r *MemoryRepository) CreateOrder(_ context.Context, o Order) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.orders[o.ID]; exists {
		return errors.New("order already exists")
	}
	r.orders[o.ID] = cloneOrder(o)
	return nil
}

func (r *MemoryRepository) CreateOrderAndPublish(_ context.Context, o Order, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.orders[o.ID]; exists {
		return errors.New("order already exists")
	}
	r.orders[o.ID] = cloneOrder(o)
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetOrder(_ context.Context, id string) (Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, exists := r.orders[id]
	if !exists {
		return Order{}, ErrOrderNotFound
	}
	return cloneOrder(o), nil
}

func (r *MemoryRepository) UpdateOrder(_ context.Context, o Order, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.orders[o.ID]
	if !exists {
		return ErrOrderNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.orders[o.ID] = cloneOrder(o)
	return nil
}

func (r *MemoryRepository) UpdateOrderAndPublish(_ context.Context, o Order, expectedVersion int, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.orders[o.ID]
	if !exists {
		return ErrOrderNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.orders[o.ID] = cloneOrder(o)
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Order, 0, len(r.orders))
	for _, o := range r.orders {
		result = append(result, cloneOrder(o))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func cloneOrder(o Order) Order {
	o.Amendments = append([]Amendment(nil), o.Amendments...)
	if o.Settlement != nil {
		copy := *o.Settlement
		o.Settlement = &copy
	}
	if o.Outcome != nil {
		copy := *o.Outcome
		o.Outcome = &copy
	}
	return o
}

type Service struct {
	mu         sync.Mutex
	repository TransactionalRepository
	clock      clock.Clock
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository TransactionalRepository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateOffer", "ConfirmCooperation", "StartExecution", "RecordDirectSettlement",
		"RecordOutcome", "RecordSatisfaction", "RecordMaterialOrderChange":
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
	case "CreateOffer":
		return s.createOffer(ctx, e)
	case "ConfirmCooperation":
		return s.confirmCooperation(ctx, e)
	case "StartExecution":
		return s.startExecution(ctx, e)
	case "RecordDirectSettlement":
		return s.recordDirectSettlement(ctx, e)
	case "RecordOutcome":
		return s.recordOutcome(ctx, e)
	case "RecordSatisfaction":
		return s.recordSatisfaction(ctx, e)
	case "RecordMaterialOrderChange":
		return s.recordMaterialChange(ctx, e)
	default:
		return command.Rejected(e, "FULFILLMENT_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.unsupported_command", nil)
	}
}

// ---------- CreateOffer ----------
// Offer = Candidate → Order 的中间态（含 Gate G 快照）。

type createOfferPayload struct {
	NeedID           string `json:"needId"`
	AgentID          string `json:"agentId"`
	ServiceSKU       string `json:"serviceSku"`
	NeedVersion      string `json:"needVersion"`
	RouteVersion     string `json:"routeVersion"`
	Duration         string `json:"duration"`
	StartTime        string `json:"startTime"`
	MeetingContext   string `json:"meetingContext"`
	AgreedCompensation int64 `json:"agreedCompensation"`
	Currency         string `json:"currency"`
	IncludedScope    string `json:"includedScope"`
	ExcludedScope    string `json:"excludedScope"`
	SettlementMode   string `json:"settlementMode"`
	PaymentMethodLabel string `json:"paymentMethodLabel"`
}

func (s *Service) createOffer(ctx context.Context, e command.Envelope) command.Result {
	var p createOfferPayload
	if !decode(e.Payload, &p) || p.NeedID == "" || p.AgentID == "" || p.AgreedCompensation <= 0 {
		return command.Rejected(e, "INVALID_OFFER", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_offer", nil)
	}
	if p.SettlementMode == "" {
		p.SettlementMode = "DIRECT_SETTLEMENT"
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	snapshot := OrderSnapshot{
		Requester:          e.Actor.ID,
		Agent:              p.AgentID,
		ServiceSKU:         p.ServiceSKU,
		NeedVersion:        p.NeedVersion,
		RouteVersion:       p.RouteVersion,
		Duration:           p.Duration,
		StartTime:          p.StartTime,
		MeetingContext:     p.MeetingContext,
		AgreedCompensation: p.AgreedCompensation,
		Currency:           p.Currency,
		IncludedScope:      p.IncludedScope,
		ExcludedScope:      p.ExcludedScope,
		SettlementMode:     p.SettlementMode,
		PaymentMethodLabel: p.PaymentMethodLabel,
	}
	order := Order{
		ID:          newID("ord_"),
		RequesterID: e.Actor.ID,
		AgentID:     p.AgentID,
		NeedID:      p.NeedID,
		Lifecycle:   "OFFERED",
		Version:     1,
		Snapshot:    snapshot,
		CreatedAt:   s.clock.Now().UTC(),
		UpdatedAt:   s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("OfferCreated", "Order", order.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, order.CreatedAt, map[string]any{
		"agentId":           p.AgentID,
		"agreedCompensation": p.AgreedCompensation,
		"settlementMode":    p.SettlementMode,
		"note":              "Gate G：Order 创建前冻结快照",
	})}
	if err := s.repository.CreateOrderAndPublish(ctx, order, domainEvents); err != nil {
		return command.Rejected(e, "OFFER_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_failed", nil)
	}
	return acceptedWithPayload(e, "Order", order.ID, 1, order.Lifecycle, map[string]any{
		"orderId":  order.ID,
		"snapshot": snapshot,
	}, domainEvents)
}

// ---------- ConfirmCooperation ----------
// 双方确认合作（Cooperation Confirmation）。

func (s *Service) confirmCooperation(ctx context.Context, e command.Envelope) command.Result {
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "OFFERED" {
		return command.Rejected(e, "ORDER_NOT_CONFIRMABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_confirmable", map[string]any{"lifecycle": order.Lifecycle})
	}
	order.Lifecycle = "CONFIRMED"
	order.Version++
	order.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CooperationConfirmed", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, order.UpdatedAt, map[string]any{
		"snapshot": order.Snapshot,
	})}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- StartExecution ----------

func (s *Service) startExecution(ctx context.Context, e command.Envelope) command.Result {
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "CONFIRMED" {
		return command.Rejected(e, "ORDER_NOT_EXECUTABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_executable", map[string]any{"lifecycle": order.Lifecycle})
	}
	order.Lifecycle = "EXECUTING"
	order.Version++
	order.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("ExecutionStarted", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, order.UpdatedAt, map[string]any{})}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordDirectSettlement ----------
// Gate H：DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认为声明信号。

type settlementPayload struct {
	AgreedAmount       int64  `json:"agreedAmount"`
	PaymentMethodLabel string `json:"paymentMethodLabel"`
	PayerConfirmed     bool   `json:"payerConfirmed"`
	PayeeConfirmed     bool   `json:"payeeConfirmed"`
}

func (s *Service) recordDirectSettlement(ctx context.Context, e command.Envelope) command.Result {
	var p settlementPayload
	if !decode(e.Payload, &p) || p.AgreedAmount <= 0 {
		return command.Rejected(e, "INVALID_SETTLEMENT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_settlement", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	if order.Snapshot.SettlementMode != "DIRECT_SETTLEMENT" {
		return command.Rejected(e, "SETTLEMENT_MODE_MISMATCH", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.settlement_mode_mismatch", map[string]any{"mode": order.Snapshot.SettlementMode})
	}
	if order.Settlement != nil {
		return command.Rejected(e, "SETTLEMENT_ALREADY_RECORDED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.settlement_exists", nil)
	}
	now := s.clock.Now().UTC()
	record := SettlementRecord{
		Mode:               "DIRECT_SETTLEMENT",
		AgreedAmount:       p.AgreedAmount,
		Currency:           order.Snapshot.Currency,
		Duration:           order.Snapshot.Duration,
		IncludedScope:      order.Snapshot.IncludedScope,
		ExcludedScope:      order.Snapshot.ExcludedScope,
		PaymentMethodLabel: p.PaymentMethodLabel,
		Payer:              order.RequesterID,
		Payee:              order.AgentID,
		PayerConfirmed:     p.PayerConfirmed,
		PayeeConfirmed:     p.PayeeConfirmed,
		ConfirmedAt:        now,
	}
	order.Settlement = &record
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("DirectSettlementRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agreedAmount":  p.AgreedAmount,
		"payerConfirmed": p.PayerConfirmed,
		"payeeConfirmed": p.PayeeConfirmed,
		"note":          "DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号，不等于平台物理验证现金",
	})}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordOutcome ----------

type outcomePayload struct {
	OnTime          bool   `json:"onTime"`
	ActualStart     string `json:"actualStart"`
	ActualEnd       string `json:"actualEnd"`
	MaterialChanges int    `json:"materialChanges"`
	ScopeCompleted  bool   `json:"scopeCompleted"`
	ObjectiveNote   string `json:"objectiveNote"`
}

func (s *Service) recordOutcome(ctx context.Context, e command.Envelope) command.Result {
	var p outcomePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_OUTCOME", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_outcome", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	order.Outcome = &OutcomeRecord{
		OnTime:          p.OnTime,
		ActualStart:     p.ActualStart,
		ActualEnd:       p.ActualEnd,
		MaterialChanges: p.MaterialChanges,
		ScopeCompleted:  p.ScopeCompleted,
		ObjectiveNote:   p.ObjectiveNote,
		RecordedAt:      now,
	}
	order.Lifecycle = "COMPLETED"
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("OutcomeRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"onTime":         p.OnTime,
		"scopeCompleted": p.ScopeCompleted,
		"materialChanges": p.MaterialChanges,
	})}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordSatisfaction ----------

type satisfactionPayload struct {
	Resolved     string `json:"resolved"`     // FULL | PARTIAL | NONE
	RepeatIntent string `json:"repeatIntent"` // REUSE | MAYBE | NO
}

func (s *Service) recordSatisfaction(ctx context.Context, e command.Envelope) command.Result {
	var p satisfactionPayload
	if !decode(e.Payload, &p) || p.Resolved == "" {
		return command.Rejected(e, "INVALID_SATISFACTION", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_satisfaction", nil)
	}
	if p.Resolved != "FULL" && p.Resolved != "PARTIAL" && p.Resolved != "NONE" {
		return command.Rejected(e, "INVALID_RESOLVED", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_resolved", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("SatisfactionRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"resolved":     p.Resolved,
		"repeatIntent": p.RepeatIntent,
		"note":         "履约事实不要求用户重复打分",
	})}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordMaterialOrderChange ----------
// Gate G：Material Change 必须产生新版本/amendment，不得静默覆盖。

type materialChangePayload struct {
	Description string `json:"description"`
}

func (s *Service) recordMaterialChange(ctx context.Context, e command.Envelope) command.Result {
	var p materialChangePayload
	if !decode(e.Payload, &p) || p.Description == "" {
		return command.Rejected(e, "INVALID_MATERIAL_CHANGE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_material_change", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	amendment := Amendment{
		AmendmentID: newID("amd_"),
		Description: p.Description,
		Snapshot:    order.Snapshot,
		CreatedAt:   now,
	}
	order.Amendments = append(order.Amendments, amendment)
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("MaterialOrderChangeRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"amendmentId": amendment.AmendmentID,
		"description": p.Description,
		"note":        "Material Change 产生新版本/amendment，不得静默覆盖",
	})}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- helpers ----------

func isOrderParty(order Order, actorID string) bool {
	return order.RequesterID == actorID || order.AgentID == actorID
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return false
	}
	return true
}

func newID(prefix string) string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return prefix + hex.EncodeToString(raw[:])
	}
	return prefix + "fallback"
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
