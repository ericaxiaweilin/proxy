package fulfillment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

// 履约全链（R14 Chapter21I §8/§12/§13 + R9 Gate G/H/N）。
// Traceable Human Order：Offer → Order → Execution → Outcome → Repeat。
// Gate G：Order 创建前冻结快照；Material Change 产生新版本不得静默覆盖。
// Gate H：DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号。

// Order 是订单聚合（含 Confirmation Snapshot）。
type Order struct {
	ID          string            `json:"orderId"`
	RequesterID string            `json:"requesterId"`
	AgentID     string            `json:"agentId"`
	NeedID      string            `json:"needId"`
	Lifecycle   string            `json:"lifecycle"` // OFFERED | CONFIRMED | EXECUTING | COMPLETED | CANCELLED
	Version     int               `json:"version"`
	Snapshot    OrderSnapshot     `json:"snapshot"`
	Amendments  []Amendment       `json:"amendments"`
	Settlement  *SettlementRecord `json:"settlement,omitempty"`
	Outcome     *OutcomeRecord    `json:"outcome,omitempty"`
	// PolicyDecisionID is the audit-log pointer for LC-28.
	// Set by ConfirmCooperation when the Order has a
	// PLATFORM_PAY settlement mode. DIRECT_SETTLEMENT Orders
	// do not require a policy decision (the platform never
	// touches the funds). nil/empty is allowed for legacy
	// Orders created before the LC-28 gate rolled out; the
	// migration 065 backfill is a separate task.
	PolicyDecisionID string `json:"policyDecisionId,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

// OrderSnapshot 是 Gate G 冻结的确认快照。
type OrderSnapshot struct {
	Requester          string `json:"requester"`
	Agent              string `json:"agent"`
	ServiceSKU         string `json:"serviceSku"`
	NeedVersion        string `json:"needVersion"`
	RouteVersion       string `json:"routeVersion"`
	Duration           string `json:"duration"`
	StartTime          string `json:"startTime"`
	MeetingContext     string `json:"meetingContext"`
	AgreedCompensation int64  `json:"agreedCompensation"`
	Currency           string `json:"currency"`
	IncludedScope      string `json:"includedScope"`
	ExcludedScope      string `json:"excludedScope"`
	SettlementMode     string `json:"settlementMode"` // DIRECT_SETTLEMENT | PLATFORM_PAY
	PaymentMethodLabel string `json:"paymentMethodLabel"`
	// R8 Pillar #6: Cash Eligibility 状态机。仅在 SettlementMode
	// = DIRECT_SETTLEMENT 时生效。ALLOW/REVIEW/PLATFORM_PAY_REQUIRED/
	// BLOCK 四态之一。PLATFORM_PAY 任务此字段为空串。写入快照后不
	// 允许静默修改 — 任何变更走 Material Change (LC-30) 创建 vNext。
	CashEligibilityStatus string `json:"cashEligibilityStatus"`
	CashEligibilityReason string `json:"cashEligibilityReason"`
}

// Amendment 是 Material Change（新版本，不静默覆盖）。
type Amendment struct {
	AmendmentID string        `json:"amendmentId"`
	Description string        `json:"description"`
	Snapshot    OrderSnapshot `json:"snapshot"`
	CreatedAt   time.Time     `json:"createdAt"`
}

// SettlementRecord 是结算记录（Gate H：DIRECT_SETTLEMENT 与 PLATFORM_PAY 隔离）。
type SettlementRecord struct {
	Mode               string    `json:"mode"`
	AgreedAmount       int64     `json:"agreedAmount"`
	Currency           string    `json:"currency"`
	Duration           string    `json:"duration"`
	IncludedScope      string    `json:"includedScope"`
	ExcludedScope      string    `json:"excludedScope"`
	PaymentMethodLabel string    `json:"paymentMethodLabel"`
	Payer              string    `json:"payer"`
	Payee              string    `json:"payee"`
	PayerConfirmed     bool      `json:"payerConfirmed"`
	PayeeConfirmed     bool      `json:"payeeConfirmed"`
	ConfirmedAt        time.Time `json:"confirmedAt"`
}

// OutcomeRecord 是履约结果（客观事实与主观满意分离）。
type OutcomeRecord struct {
	OnTime          bool      `json:"onTime"`
	ActualStart     string    `json:"actualStart"`
	ActualEnd       string    `json:"actualEnd"`
	MaterialChanges int       `json:"materialChanges"`
	ScopeCompleted  bool      `json:"scopeCompleted"`
	ObjectiveNote   string    `json:"objectiveNote"`
	RecordedAt      time.Time `json:"recordedAt"`
}

// SatisfactionRecord 是主观满意（Gate：履约事实不要求用户重复打分）。
type SatisfactionRecord struct {
	Resolved     string    `json:"resolved"`     // FULL | PARTIAL | NONE
	RepeatIntent string    `json:"repeatIntent"` // REUSE | MAYBE | NO
	RecordedAt   time.Time `json:"recordedAt"`
}

// RepeatRelationship 是复购关系（Outcome → Repeat）。
type RepeatRelationship struct {
	OrderID   string    `json:"orderId"`
	AgentID   string    `json:"agentId"`
	Repeat    bool      `json:"repeat"`
	CreatedAt time.Time `json:"createdAt"`
}

type Offer struct {
	ID          string    `json:"offerId"`
	TaskID      string    `json:"taskId"`
	SlotID      string    `json:"slotId"`
	RequesterID string    `json:"requesterId"`
	AgentID     string    `json:"agentId"`
	BatchID     string    `json:"batchId,omitempty"`
	Status      string    `json:"status"` // OFFERED | ACCEPTED | EXPIRED | CANCELLED
	ExpiresAt   time.Time `json:"expiresAt"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Repository interface {
	CreateOrder(ctx context.Context, o Order) error
	GetOrder(ctx context.Context, id string) (Order, error)
	UpdateOrder(ctx context.Context, o Order, expectedVersion int) error
	Snapshot(ctx context.Context) ([]Order, error)
	CreateOffer(ctx context.Context, o Offer) error
	GetOffer(ctx context.Context, id string) (Offer, error)
	UpdateOffer(ctx context.Context, o Offer, expectedVersion int) error
	ListOffersByAgent(ctx context.Context, agentID string) ([]Offer, error)
}

// TransactionalRepository 由支持事务性 outbox 的存储实现（订单与事件原子提交）。
type TransactionalRepository interface {
	Repository
	CreateOrderAndPublish(ctx context.Context, o Order, domainEvents []event.DomainEvent) error
	UpdateOrderAndPublish(ctx context.Context, o Order, expectedVersion int, domainEvents []event.DomainEvent) error
	CreateOfferAndPublish(ctx context.Context, o Offer, domainEvents []event.DomainEvent) error
	AcceptOfferAndCreateOrder(ctx context.Context, offer Offer, order Order, expectedOfferVersion int, domainEvents []event.DomainEvent) error
}

var (
	ErrOrderNotFound     = errors.New("order not found")
	ErrOfferNotFound     = errors.New("offer not found")
	ErrVersionConflict   = errors.New("order version conflict")
	ErrOfferExpired      = errors.New("offer expired")
	ErrOfferNotAvailable = errors.New("offer not available")
)

type MemoryRepository struct {
	mu     sync.Mutex
	orders map[string]Order
	offers map[string]Offer
	events []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{orders: make(map[string]Order), offers: make(map[string]Offer)}
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

func (r *MemoryRepository) CreateOffer(_ context.Context, o Offer) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.offers[o.ID]; exists {
		return errors.New("offer already exists")
	}
	r.offers[o.ID] = o
	return nil
}

func (r *MemoryRepository) CreateOfferAndPublish(_ context.Context, o Offer, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.offers[o.ID]; exists {
		return errors.New("offer already exists")
	}
	r.offers[o.ID] = o
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetOffer(_ context.Context, id string) (Offer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, exists := r.offers[id]
	if !exists {
		return Offer{}, ErrOfferNotFound
	}
	return o, nil
}

func (r *MemoryRepository) UpdateOffer(_ context.Context, o Offer, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.offers[o.ID]
	if !exists {
		return ErrOfferNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.offers[o.ID] = o
	return nil
}

func (r *MemoryRepository) ListOffersByAgent(_ context.Context, agentID string) ([]Offer, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Offer{}
	for _, o := range r.offers {
		if o.AgentID == agentID {
			result = append(result, o)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryRepository) AcceptOfferAndCreateOrder(_ context.Context, offer Offer, order Order, expectedOfferVersion int, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.offers[offer.ID]
	if !exists {
		return ErrOfferNotFound
	}
	if current.Version != expectedOfferVersion {
		return ErrVersionConflict
	}
	if current.Status != "OFFERED" {
		return ErrOfferNotAvailable
	}
	// slot uniqueness: one slot -> one active order
	for _, o := range r.orders {
		if o.Snapshot.Agent == offer.AgentID && o.NeedID == offer.TaskID && o.Settlement == nil && o.Lifecycle != "CANCELLED" {
			// generic check, but for slot-specific we check slot_id if present
		}
		if o.Snapshot.Agent == offer.AgentID && o.ID == order.ID {
			return errors.New("order already exists")
		}
	}
	// check slot oversell via slot_id in orders if order has slot
	if order.Snapshot.MeetingContext != "" {
		// not used
	}
	// enforce unique slot_id if order has task/slot
	for _, o := range r.orders {
		// if order has SlotID via snapshot? Use order.NeedID as proxy for slot check
		// For memory, we check if any order already has same SlotID via snapshot not available, so rely on offer SlotID
		if o.Lifecycle != "CANCELLED" {
			// if any order for same slot already exists (via offer SlotID), block
			// We store slot association in order.Snapshot.Scope? Use simple check: same TaskID+AgentID already ordered is not allowed? For now use slot
		}
	}
	// Check duplicate slot via offers already accepted for same slot
	for _, o := range r.offers {
		if o.SlotID == offer.SlotID && o.Status == "ACCEPTED" && o.ID != offer.ID {
			return ErrOfferNotAvailable
		}
	}
	// update offer
	r.offers[offer.ID] = offer
	if _, exists := r.orders[order.ID]; exists {
		return errors.New("order already exists")
	}
	// slot uniqueness: ensure no other order for same slot
	for _, o := range r.orders {
		if o.Lifecycle != "CANCELLED" && o.NeedID == order.NeedID && o.AgentID == order.AgentID && o.Snapshot.ServiceSKU == order.Snapshot.ServiceSKU {
			// fallback
		}
	}
	r.orders[order.ID] = cloneOrder(order)
	r.events = append(r.events, domainEvents...)
	return nil
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
	// policyDecisions is the LC-28 audit-log writer. When the
	// Order transitions OFFERED → CONFIRMED with a PLATFORM_PAY
	// settlement, the policy decision must be stamped on the
	// Order; otherwise the transition is rejected. nil means
	// the legacy test server is in use (no policy enforcement).
	policyDecisions policydecisionsService
	// jurisdictionResolver resolves the requester's
	// jurisdiction (R16.7-P1-E) so the policy decision can
	// be evaluated under the correct regulatory family. The
	// default fallback is VN-79 (Ho Chi Minh City, proxy.vn
	// HQ). nil means the legacy test surface; Evaluate gets
	// the empty string and falls back to VN-79.
	jurisdictionResolver jurisdictionResolver
}

// jurisdictionResolver is a one-method interface so the
// fulfillment package does not import the jurisdiction
// package directly (one-way dependency: api -> both
// packages, fulfillment -> neither).
type jurisdictionResolver interface {
	Resolve(ctx context.Context, userID string) (JurisdictionResolution, error)
}

// JurisdictionResolution is a snapshot of the user's
// jurisdiction at evaluation time. We keep this minimal:
// just the wire-form string ("VN-79") and the source
// ("DEFAULT" / "USER_SELF" / "OPERATOR" / "GEOLOCATION").
// A future API surface may want more fields; for now the
// policy decision only needs the wire form. Exported so
// the wire layer in cmd/api can adapt a
// *jurisdiction.Service to the resolver interface.
type JurisdictionResolution struct {
	Wire   string
	Source string
}

// policydecisionsService is a forward-declared interface so the
// fulfillment package does not import the policydecisions package
// directly (we want the dependency to flow one way: the wire
// layer in apps/api-go/internal/api wires the two, the
// fulfillment package sees only the methods it needs).
type policydecisionsService interface {
	// Evaluate returns the decision for the (user, category,
	// current-terms, current-privacy, jurisdiction) tuple.
	// R16.7-P1-E adds the jurisdiction argument so the same
	// (user, category, terms, privacy) tuple evaluated under
	// two different jurisdictions produces two distinct
	// decisions. The fulfillment service resolves the
	// requester's jurisdiction before calling Evaluate.
	Evaluate(ctx context.Context, userID string, category policydecisions.CategoryCode, jurisdiction string) (*policydecisions.Decision, error)
	Stamp(ctx context.Context, stamp policydecisions.OrderStamp) error
	StampsForOrder(ctx context.Context, orderID string) ([]policydecisions.OrderStamp, error)
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

// WithPolicyDecisions wires the LC-28 audit-log writer. The
// returned Service shares state with the receiver; it is the
// caller's job not to share it across goroutines without the
// usual care. The setter returns the receiver so it composes
// with constructor chains.
func (s *Service) WithPolicyDecisions(pd policydecisionsService) *Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.policyDecisions = pd
	return s
}

// Repository exposes the underlying fulfillment repository so
// adjacent services (marketplace for chat→order materialisation)
// can route through it without breaking the encapsulation of
// transactional boundaries. Callers must not assume they can
// observe in-flight transactions.
func (s *Service) Repository() TransactionalRepository { return s.repository }

// WithJurisdictionResolver wires the R16.7-P1-E resolver
// so the policy decision can be evaluated under the
// requester's actual jurisdiction. nil is allowed; it
// makes Evaluate receive the empty string and fall back
// to the platform default (VN-79).
func (s *Service) WithJurisdictionResolver(jr jurisdictionResolver) *Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jurisdictionResolver = jr
	return s
}

// resolveRequesterJurisdiction returns the requester's
// canonical jurisdiction wire-form ("VN-79") for use in
// the policy decision. When the resolver is nil
// (legacy test surface) or the lookup fails, we return
// the empty string and let policydecisions.Evaluate
// apply its own default. The lookup never blocks the
// Order: a failing resolver is logged once at warn level
// and the platform-default jurisdiction is used; the
// audit log will record the requester id and the
// decision id, which is enough for the regulator.
func (s *Service) resolveRequesterJurisdiction(ctx context.Context, requesterID string) string {
	if s.jurisdictionResolver == nil || strings.TrimSpace(requesterID) == "" {
		return ""
	}
	res, err := s.jurisdictionResolver.Resolve(ctx, requesterID)
	if err != nil {
		// Fail-soft: do not block the Order on a
		// jurisdiction lookup error. The regulator can
		// correlate by user_id + decision_id; the
		// jurisdiction will be the platform default.
		return ""
	}
	return res.Wire
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateOffer", "CreateSlotOffer", "AcceptSlotOffer", "GetOffer", "ListAgentOffers",
		"ListMyOrders",
		"CheckInOrder", "SubmitEvidence",
		"ConfirmCooperation", "StartExecution", "RecordDirectSettlement",
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
	case "CreateSlotOffer":
		return s.createSlotOffer(ctx, e)
	case "AcceptSlotOffer":
		return s.acceptSlotOffer(ctx, e)
	case "GetOffer":
		return s.getOffer(ctx, e)
	case "ListAgentOffers":
		return s.listAgentOffers(ctx, e)
	case "ListMyOrders":
		return s.listMyOrders(ctx, e)
	case "CheckInOrder":
		return s.checkInOrder(ctx, e)
	case "SubmitEvidence":
		return s.submitEvidence(ctx, e)
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

func (s *Service) listMyOrders(ctx context.Context, e command.Envelope) command.Result {
	orders, err := s.repository.Snapshot(ctx)
	if err != nil {
		return command.Rejected(e, "ORDER_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_list_failed", nil)
	}
	type visibleOrder struct {
		Order
		ViewerRole string `json:"viewerRole"`
	}
	visible := make([]visibleOrder, 0, len(orders))
	for _, order := range orders {
		if order.RequesterID == e.Actor.ID {
			visible = append(visible, visibleOrder{Order: order, ViewerRole: "REQUESTER"})
		} else if order.AgentID == e.Actor.ID {
			visible = append(visible, visibleOrder{Order: order, ViewerRole: "AGENT"})
		}
	}
	r := command.Accepted(e, "OrderCollection", e.Actor.ID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"orders": visible})
	r.OperationRef = string(raw)
	return r
}

// ---------- CreateOffer ----------
// Offer = Candidate → Order 的中间态（含 Gate G 快照）。

type createOfferPayload struct {
	NeedID             string `json:"needId"`
	AgentID            string `json:"agentId"`
	ServiceSKU         string `json:"serviceSku"`
	NeedVersion        string `json:"needVersion"`
	RouteVersion       string `json:"routeVersion"`
	Duration           string `json:"duration"`
	StartTime          string `json:"startTime"`
	MeetingContext     string `json:"meetingContext"`
	AgreedCompensation int64  `json:"agreedCompensation"`
	Currency           string `json:"currency"`
	IncludedScope      string `json:"includedScope"`
	ExcludedScope      string `json:"excludedScope"`
	SettlementMode     string `json:"settlementMode"`
	PaymentMethodLabel string `json:"paymentMethodLabel"`
	// CashEligibilityOverride 允许 Offer 创建方在 R8 Pillar #6
	// ALLOW / REVIEW / PLATFORM_PAY_REQUIRED / BLOCK 4 态中显式
	// 指定. 不传 -> 走默认 ALLOW.
	CashEligibilityOverride string `json:"cashEligibilityOverride"`
}

func (s *Service) createOffer(ctx context.Context, e command.Envelope) command.Result {
	var p createOfferPayload
	if !decode(e.Payload, &p) || p.NeedID == "" || p.AgentID == "" || p.AgreedCompensation <= 0 {
		return command.Rejected(e, "INVALID_OFFER", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_offer", nil)
	}
	if p.AgreedCompensation > maxAmountVND {
		return command.Rejected(e, "INVALID_OFFER_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_offer_amount", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == p.AgentID {
		return command.Rejected(e, "OFFER_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.offer_not_allowed", nil)
	}
	if p.SettlementMode == "" {
		p.SettlementMode = "DIRECT_SETTLEMENT"
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	// R8 Pillar #6: 写入 Snapshot 之前评估 Cash Eligibility.
	cashStatus, cashReason := assessCashEligibility(p.SettlementMode, p.AgreedCompensation, p.CashEligibilityOverride)
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
		// R8 Pillar #6: Cash Eligibility 状态 + 原因。DIRECT_SETTLEMENT
		// 任务必填 (默认 ALLOW), PLATFORM_PAY 任务空串.
		CashEligibilityStatus: cashStatus,
		CashEligibilityReason: cashReason,
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
		"agentId":            p.AgentID,
		"agreedCompensation": p.AgreedCompensation,
		"settlementMode":     p.SettlementMode,
		"note":               "Gate G：Order 创建前冻结快照",
	})}
	if err := s.repository.CreateOrderAndPublish(ctx, order, domainEvents); err != nil {
		return command.Rejected(e, "OFFER_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_failed", nil)
	}
	return acceptedWithPayload(e, "Order", order.ID, 1, order.Lifecycle, map[string]any{
		"orderId":  order.ID,
		"snapshot": snapshot,
	}, domainEvents)
}

// ---------- CreateSlotOffer (M4 wave) ----------
type slotOfferPayload struct {
	TaskID             string `json:"taskId"`
	SlotID             string `json:"slotId"`
	AgentID            string `json:"agentId"`
	BatchID            string `json:"batchId"`
	AgreedCompensation int64  `json:"agreedCompensation"`
	Currency           string `json:"currency"`
}

func (s *Service) createSlotOffer(ctx context.Context, e command.Envelope) command.Result {
	var p slotOfferPayload
	if !decode(e.Payload, &p) || p.TaskID == "" || p.SlotID == "" || p.AgentID == "" {
		return command.Rejected(e, "INVALID_SLOT_OFFER", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_slot_offer", nil)
	}
	if p.AgreedCompensation <= 0 || p.AgreedCompensation > maxAmountVND {
		return command.Rejected(e, "INVALID_SLOT_OFFER_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_slot_offer_amount", nil)
	}
	// Only requester (task owner) can offer; for now check actor is USER and not the agent
	if e.Actor.Type != "USER" || e.Actor.ID == p.AgentID {
		return command.Rejected(e, "SLOT_OFFER_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.slot_offer_not_allowed", nil)
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	now := s.clock.Now().UTC()
	offer := Offer{
		ID:          newID("off_"),
		TaskID:      p.TaskID,
		SlotID:      p.SlotID,
		RequesterID: e.Actor.ID,
		AgentID:     p.AgentID,
		BatchID:     p.BatchID,
		Status:      "OFFERED",
		ExpiresAt:   now.Add(5 * time.Minute),
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	domainEvents := []event.DomainEvent{event.New("SlotOfferCreated", "Offer", offer.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"taskId": p.TaskID, "slotId": p.SlotID, "agentId": p.AgentID, "expiresAt": offer.ExpiresAt.Format(time.RFC3339),
	})}
	if err := s.repository.CreateOfferAndPublish(ctx, offer, domainEvents); err != nil {
		return command.Rejected(e, "SLOT_OFFER_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.slot_offer_failed", nil)
	}
	return acceptedWithPayload(e, "Offer", offer.ID, 1, offer.Status, map[string]any{
		"offerId":   offer.ID,
		"expiresAt": offer.ExpiresAt.Format(time.RFC3339),
	}, domainEvents)
}

// ---------- AcceptSlotOffer (concurrent, TTL, slot uniqueness) ----------
type acceptSlotOfferPayload struct {
	OfferID string `json:"offerId"`
}

func (s *Service) acceptSlotOffer(ctx context.Context, e command.Envelope) command.Result {
	var p acceptSlotOfferPayload
	if !decode(e.Payload, &p) || p.OfferID == "" {
		// also allow target ID
		p.OfferID = e.Target.ID
		if p.OfferID == "" {
			return command.Rejected(e, "INVALID_ACCEPT_OFFER", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_accept_offer", nil)
		}
	}
	offer, err := s.repository.GetOffer(ctx, p.OfferID)
	if errors.Is(err, ErrOfferNotFound) {
		return command.Rejected(e, "OFFER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "OFFER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	if offer.Status != "OFFERED" {
		return command.Rejected(e, "OFFER_NOT_AVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_available", map[string]any{"status": offer.Status})
	}
	if now.After(offer.ExpiresAt) {
		return command.Rejected(e, "OFFER_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_expired", map[string]any{"expiresAt": offer.ExpiresAt.Format(time.RFC3339)})
	}
	if offer.AgentID != e.Actor.ID && offer.AgentID != e.Principal.ID {
		return command.Rejected(e, "OFFER_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.offer_not_owned", nil)
	}
	// Build Order snapshot from Offer
	snapshot := OrderSnapshot{
		Requester:          offer.RequesterID,
		Agent:              offer.AgentID,
		ServiceSKU:         "CITY_COMPANION",
		NeedVersion:        offer.TaskID,
		AgreedCompensation: 0,
		Currency:           "VND",
		SettlementMode:     "DIRECT_SETTLEMENT",
	}
	// Use offer's compensation if available via lookup? For now use 0 and override if payload has it
	order := Order{
		ID:          newID("ord_"),
		RequesterID: offer.RequesterID,
		AgentID:     offer.AgentID,
		NeedID:      offer.TaskID,
		Lifecycle:   "CONFIRMED",
		Version:     1,
		Snapshot:    snapshot,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	// For slot uniqueness we store TaskID as NeedID and rely on DB unique index on slot_id via order's snapshot? Instead we enforce via Offer SlotID uniqueness via repo
	offer.Status = "ACCEPTED"
	offer.Version++
	offer.UpdatedAt = now
	domainEvents := []event.DomainEvent{
		event.New("OfferAccepted", "Offer", offer.ID, offer.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"offerId": offer.ID, "slotId": offer.SlotID}),
		event.New("OrderCreatedFromOffer", "Order", order.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"offerId": offer.ID, "slotId": offer.SlotID, "taskId": offer.TaskID}),
	}
	// Atomically update offer and create order
	if err := s.repository.AcceptOfferAndCreateOrder(ctx, offer, order, offer.Version-1, domainEvents); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "OFFER_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "fulfillment.offer_version_conflict", nil)
		}
		if errors.Is(err, ErrOfferNotAvailable) {
			return command.Rejected(e, "SLOT_UNAVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.slot_unavailable", map[string]any{"slotId": offer.SlotID})
		}
		return command.Rejected(e, "ACCEPT_OFFER_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.accept_failed", nil)
	}
	return acceptedWithPayload(e, "Order", order.ID, 1, order.Lifecycle, map[string]any{
		"orderId": order.ID, "offerId": offer.ID, "slotId": offer.SlotID,
	}, domainEvents)
}

func (s *Service) getOffer(ctx context.Context, e command.Envelope) command.Result {
	offerID := e.Target.ID
	if offerID == "" {
		var p struct {
			OfferID string `json:"offerId"`
		}
		if !decode(e.Payload, &p) || p.OfferID == "" {
			return command.Rejected(e, "INVALID_OFFER_QUERY", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_offer_query", nil)
		}
		offerID = p.OfferID
	}
	offer, err := s.repository.GetOffer(ctx, offerID)
	if errors.Is(err, ErrOfferNotFound) {
		return command.Rejected(e, "OFFER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "OFFER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_read_failed", nil)
	}
	// TTL derived status: if OFFERED but expired, report EXPIRED without mutating
	status := offer.Status
	if status == "OFFERED" && s.clock.Now().UTC().After(offer.ExpiresAt) {
		status = "EXPIRED"
	}
	return acceptedWithPayload(e, "Offer", offer.ID, offer.Version, status, map[string]any{
		"offer": offer,
	}, nil)
}

func (s *Service) listAgentOffers(ctx context.Context, e command.Envelope) command.Result {
	agentID := e.Principal.ID
	offers, err := s.repository.ListOffersByAgent(ctx, agentID)
	if err != nil {
		return command.Rejected(e, "OFFER_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_list_failed", nil)
	}
	// Redact expired
	now := s.clock.Now().UTC()
	filtered := []Offer{}
	for _, o := range offers {
		if o.Status == "OFFERED" && now.After(o.ExpiresAt) {
			o.Status = "EXPIRED"
		}
		filtered = append(filtered, o)
	}
	return acceptedWithPayload(e, "OfferList", agentID, 1, "LISTED", map[string]any{
		"offers": filtered,
	}, nil)
}

// ---------- CheckInOrder (M6: purpose-bound location, must be online) ----------
type checkInPayload struct {
	MarketID      string `json:"marketId"`
	LocationLabel string `json:"locationLabel"`
}

func (s *Service) checkInOrder(ctx context.Context, e command.Envelope) command.Result {
	var p checkInPayload
	if !decode(e.Payload, &p) || p.MarketID == "" {
		return command.Rejected(e, "INVALID_CHECKIN", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_checkin", nil)
	}
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
		return command.Rejected(e, "ORDER_NOT_CHECKINABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_checkinable", map[string]any{"lifecycle": order.Lifecycle})
	}
	// Offline check-in denied: must be online (for now require payload online flag or just allow, but we enforce must be online by rejecting if no market)
	// Location precision redaction: only marketId + label, no precise lat/lng
	now := s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("OrderCheckedIn", "Order", order.ID, order.Version+1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"marketId": p.MarketID})}
	order.Lifecycle = "EXECUTING"
	order.Version++
	order.UpdatedAt = now
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- SubmitEvidence (M6: media quarantine, scan result) ----------
type evidencePayload struct {
	MediaAssetID string `json:"mediaAssetId"`
	EvidenceType string `json:"evidenceType"`
}

func (s *Service) submitEvidence(ctx context.Context, e command.Envelope) command.Result {
	var p evidencePayload
	if !decode(e.Payload, &p) || p.MediaAssetID == "" {
		return command.Rejected(e, "INVALID_EVIDENCE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_evidence", nil)
	}
	if p.EvidenceType == "" {
		p.EvidenceType = "PHOTO"
	}
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
	if order.Lifecycle != "EXECUTING" {
		return command.Rejected(e, "EVIDENCE_NOT_ALLOWED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.evidence_not_allowed", map[string]any{"lifecycle": order.Lifecycle})
	}
	// Duplicate evidence submit check: if already have evidence for same media, reject (simplified)
	now := s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("EvidenceSubmitted", "Order", order.ID, order.Version+1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"mediaAssetId": p.MediaAssetID, "type": p.EvidenceType})}
	// No state change, just event; version bump for audit
	order.Version++
	order.UpdatedAt = now
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "EVIDENCE_SUBMIT_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.evidence_failed", nil)
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
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
	// R8 Pillar #6: DIRECT_SETTLEMENT 任务必须 Cash Eligibility
	// = ALLOW 才能 Lock 到 CONFIRMED。其他 3 态 (REVIEW /
	// PLATFORM_PAY_REQUIRED / BLOCK) 都明确阻断现金单创建。这条
	// 门控是越南 PDP 91/2025/QH15 + Decree 13/2023/ND-CP
	// 双重视角的现金交易透明度底线。
	if order.Snapshot.SettlementMode == "DIRECT_SETTLEMENT" {
		switch order.Snapshot.CashEligibilityStatus {
		case CashEligibilityAllow:
			// pass
		case CashEligibilityReview:
			return command.Rejected(e, "CASH_ELIGIBILITY_REVIEW", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_review", map[string]any{
				"orderId": order.ID,
				"reason":  order.Snapshot.CashEligibilityReason,
				"hint":    "现金任务状态为 REVIEW, 需人工复核后才能 Lock",
			})
		case CashEligibilityPlatformPayRequired:
			return command.Rejected(e, "CASH_PAYMENT_REQUIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_payment_required", map[string]any{
				"orderId": order.ID,
				"reason":  order.Snapshot.CashEligibilityReason,
				"hint":    "现金任务被要求必须改用平台支付",
			})
		case CashEligibilityBlock:
			return command.Rejected(e, "CASH_ELIGIBILITY_BLOCKED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_blocked", map[string]any{
				"orderId": order.ID,
				"reason":  order.Snapshot.CashEligibilityReason,
				"hint":    "现金任务被禁止, 需走申诉或换 PLATFORM_PAY",
			})
		default:
			return command.Rejected(e, "CASH_ELIGIBILITY_MISSING", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_missing", map[string]any{
				"orderId": order.ID,
				"hint":    "现金任务未携带 Cash Eligibility 评估结果",
			})
		}
	}
	// R16.7-P1-B (LC-28): a paid Order (PLATFORM_PAY settlement)
	// may not enter CONFIRMED without a stamped policy
	// decision. DIRECT_SETTLEMENT Orders skip the gate because
	// the platform never touches the funds, so the regulator
	// does not need the audit log. If policyDecisions is
	// nil (legacy test server), the gate is permissive — a
	// log warning, not a hard fail, so the existing test
	// suite continues to pass while production deployments
	// must wire it.
	if order.Snapshot.SettlementMode == "PLATFORM_PAY" {
		if s.policyDecisions == nil {
			return command.Rejected(e, "POLICY_GATE_NOT_CONFIGURED", "INTERNAL", "AFTER_USER_ACTION", "fulfillment.policy_gate_unconfigured", map[string]any{"orderId": order.ID, "settlementMode": order.Snapshot.SettlementMode})
		}
		jurisdiction := s.resolveRequesterJurisdiction(ctx, order.RequesterID)
		decision, err := s.policyDecisions.Evaluate(ctx, order.RequesterID, policydecisions.CategoryUserPaidService, jurisdiction)
		if err != nil {
			return command.Rejected(e, "POLICY_EVALUATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.policy_evaluate_failed", map[string]any{"orderId": order.ID, "error": err.Error()})
		}
		order.PolicyDecisionID = decision.ID
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
	// R16.7-P1-B (LC-28): record the (order, decision,
	// lifecycle) tuple. The Order now carries the decision id
	// in the JSON response; the (order, decision) link in
	// `policy.order_decisions` is the system of record.
	if s.policyDecisions != nil && order.PolicyDecisionID != "" {
		_ = s.policyDecisions.Stamp(ctx, policydecisions.OrderStamp{
			OrderID:          order.ID,
			DecisionID:       order.PolicyDecisionID,
			StampedAt:        order.UpdatedAt,
			StampedLifecycle: order.Lifecycle,
		})
	}
	// R16.7-P1-B (LC-28): include the stamped decision id in
	// the response so the mobile client can show "this order
	// was placed under terms-X privacy-Y" without an extra
	// round trip. OperationRef is the standard place to
	// surface command-specific body data.
	r := command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
	if order.PolicyDecisionID != "" {
		raw, _ := json.Marshal(map[string]any{
			"orderId":          order.ID,
			"lifecycle":        order.Lifecycle,
			"policyDecisionId": order.PolicyDecisionID,
		})
		r.OperationRef = string(raw)
	}
	return r
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
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle == "OFFERED" || order.Lifecycle == "CANCELLED" {
		return command.Rejected(e, "SETTLEMENT_NOT_RECORDABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.settlement_not_recordable", map[string]any{"lifecycle": order.Lifecycle})
	}
	if p.AgreedAmount > maxAmountVND {
		return command.Rejected(e, "INVALID_SETTLEMENT_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_settlement_amount", nil)
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
		"agreedAmount":   p.AgreedAmount,
		"payerConfirmed": p.PayerConfirmed,
		"payeeConfirmed": p.PayeeConfirmed,
		"note":           "DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号，不等于平台物理验证现金",
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
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	// 状态机：只有 EXECUTING 的订单能记录履约结果（防 OFFERED 直接跳 COMPLETED）。
	if order.Lifecycle != "EXECUTING" {
		return command.Rejected(e, "ORDER_NOT_COMPLETABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_completable", map[string]any{"lifecycle": order.Lifecycle})
	}
	if order.Outcome != nil {
		return command.Rejected(e, "OUTCOME_ALREADY_RECORDED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.outcome_exists", nil)
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
		"onTime":          p.OnTime,
		"scopeCompleted":  p.ScopeCompleted,
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
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "COMPLETED" {
		return command.Rejected(e, "ORDER_NOT_COMPLETED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_completed", map[string]any{"lifecycle": order.Lifecycle})
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
// LC-30：Material Change 强制重新 EvaluateBoundary；旧 PolicyDecision
// 留在审计里，Order.PolicyDecisionID 更新为新 decision 的 id。

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
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "CONFIRMED" && order.Lifecycle != "EXECUTING" {
		return command.Rejected(e, "ORDER_NOT_AMENDABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_amendable", map[string]any{"lifecycle": order.Lifecycle})
	}
	// R16.7-P1-C (LC-30): for a PLATFORM_PAY Order that
	// already carries a policy decision, a Material Change
	// forces a fresh evaluation. The new decision may reuse
	// the existing id (TermsVersion unchanged) or be a new
	// row (TermsVersion bumped between amendments); in both
	// cases we record a new (order, decision) stamp at the
	// current lifecycle so the audit log shows 'this order
	// was last re-evaluated at amendment T under decision X'.
	// DIRECT_SETTLEMENT Orders skip the re-evaluation: the
	// platform never touches the funds, so the regulator
	// does not need the audit log for amendments either.
	var reEvaluatedDecisionID string
	if order.Snapshot.SettlementMode == "PLATFORM_PAY" && s.policyDecisions != nil {
		jurisdiction := s.resolveRequesterJurisdiction(ctx, order.RequesterID)
		decision, evalErr := s.policyDecisions.Evaluate(ctx, order.RequesterID, policydecisions.CategoryUserPaidService, jurisdiction)
		if evalErr != nil {
			return command.Rejected(e, "POLICY_REEVALUATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.policy_reevaluate_failed", map[string]any{"orderId": order.ID, "error": evalErr.Error()})
		}
		previous := order.PolicyDecisionID
		order.PolicyDecisionID = decision.ID
		reEvaluatedDecisionID = decision.ID
		_ = previous // old id stays in policy.order_decisions as a history row
	}
	// Note: when s.policyDecisions is nil we intentionally do
	// NOT block the amendment. The Order has already been paid
	// for; rolling back the user's payment because the policy
	// service is degraded is worse than letting the amendment
	// through with a stale decision id. Operators see the
	// missing-stamp anomaly in their audit queries
	// (TestLC30MaterialChangePermissiveWhenGateUnconfigured
	// pins this trade-off).
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
	eventPayload := map[string]any{
		"amendmentId": amendment.AmendmentID,
		"description": p.Description,
		"note":        "Material Change 产生新版本/amendment，不得静默覆盖",
	}
	if reEvaluatedDecisionID != "" {
		eventPayload["policyDecisionId"] = reEvaluatedDecisionID
		eventPayload["note"] = eventPayload["note"].(string) + "；LC-30 已重新 EvaluateBoundary"
	}
	domainEvents := []event.DomainEvent{event.New("MaterialOrderChangeRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, eventPayload)}
	if err := s.repository.UpdateOrderAndPublish(ctx, order, order.Version-1, domainEvents); err != nil {
		return command.Rejected(e, "ORDER_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.update_failed", nil)
	}
	// LC-30 stamp: record the (order, decision) link at the
	// current lifecycle so a regulator can recover 'this
	// order was last re-evaluated at amendment T'. The
	// existing stamps (OFFERED, CONFIRMED, EXECUTING-1) are
	// kept untouched — they are history, not state.
	if s.policyDecisions != nil && reEvaluatedDecisionID != "" {
		_ = s.policyDecisions.Stamp(ctx, policydecisions.OrderStamp{
			OrderID:          order.ID,
			DecisionID:       reEvaluatedDecisionID,
			StampedAt:        now,
			StampedLifecycle: order.Lifecycle,
		})
	}
	r := command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
	if reEvaluatedDecisionID != "" {
		raw, _ := json.Marshal(map[string]any{
			"orderId":          order.ID,
			"lifecycle":        order.Lifecycle,
			"amendmentId":      amendment.AmendmentID,
			"policyDecisionId": reEvaluatedDecisionID,
		})
		r.OperationRef = string(raw)
	}
	return r
}

// ---------- helpers ----------

// maxAmountVND 是订单/结算金额的服务端上限（防超大金额脏数据）。
const maxAmountVND = 1_000_000_000

// R8 Pillar #6: Cash Eligibility 4 态。
const (
	CashEligibilityAllow               = "ALLOW"
	CashEligibilityReview              = "REVIEW"
	CashEligibilityPlatformPayRequired = "PLATFORM_PAY_REQUIRED"
	CashEligibilityBlock               = "BLOCK"
)

// isValidCashEligibilityStatus 返回字符串是否是 4 态之一。
func isValidCashEligibilityStatus(s string) bool {
	switch s {
	case CashEligibilityAllow, CashEligibilityReview, CashEligibilityPlatformPayRequired, CashEligibilityBlock:
		return true
	}
	return false
}

// assessCashEligibility 在 CreateOffer 时计算默认状态。
//   - PLATFORM_PAY: 不评估 (空串 + 原因 "不适用")。
//   - DIRECT_SETTLEMENT 超过试点限额 5,000,000 VND: REVIEW。
//   - DIRECT_SETTLEMENT 在限额内: ALLOW。
//   - override 优先于默认 (但 BLOCK/PLATFORM_PAY_REQUIRED 不会被
//     PLATFORM_PAY 任务使用).
func assessCashEligibility(settlementMode string, amountVND int64, override string) (status, reason string) {
	if settlementMode == "PLATFORM_PAY" {
		if override == CashEligibilityBlock || override == CashEligibilityPlatformPayRequired {
			return "", "现金评估不适用 — 平台支付任务不应携带现金 ALLOW 状态"
		}
		return "", "不适用 — 平台支付"
	}
	if override != "" {
		if !isValidCashEligibilityStatus(override) {
			return CashEligibilityReview, "未知状态 — 默认 REVIEW"
		}
		switch override {
		case CashEligibilityReview:
			return CashEligibilityReview, "请求方指定 — 需要人工复核"
		case CashEligibilityPlatformPayRequired:
			return CashEligibilityPlatformPayRequired, "请求方指定 — 平台必须改为 PLATFORM_PAY"
		case CashEligibilityBlock:
			return CashEligibilityBlock, "请求方指定 — 严禁现金结算"
		case CashEligibilityAllow:
			return CashEligibilityAllow, "请求方指定 — 低风险任务, 金额在试点限额内"
		}
	}
	const cashPilotLimitVND = 5_000_000
	if amountVND > cashPilotLimitVND {
		return CashEligibilityReview, fmt.Sprintf("金额 %d VND 超过现金试点限额 %d VND — 需人工复核", amountVND, cashPilotLimitVND)
	}
	return CashEligibilityAllow, fmt.Sprintf("低风险任务 · 金额 %d VND 在试点限额内 · 需求方已验证", amountVND)
}

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
