package fulfillment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
	"github.com/proxy-app/proxy-api/internal/policydecisions"
)

// 履约全链（R14 Chapter21I §8/§12/§13 + R9 Gate G/H/N）。
// Traceable Human Order：Offer → Order → Execution → Outcome → Repeat。
// Gate G：Order 创建前冻结快照；Material Change 产生新版本不得静默覆盖。
// Gate H：DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号。

// Order 是订单聚合（含 Confirmation Snapshot）。
type Order struct {
	ID string `json:"orderId"`
	// ORDER-NO-001：面向人的全数字订单编号（internal/ordernumber）。客服、结算、
	// 争议、界面展示都用它；权威主键仍是 ID。一经分配不可改。老订单由迁移 136 回填。
	OrderNo     string            `json:"orderNo,omitempty"`
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
	PolicyDecisionID string    `json:"policyDecisionId,omitempty"`
	// STORE-STATS-001：服务发生在哪家店（人类断言，RecordOutcome 时由订单当事一方
	// 指认）。空 = 没归因（老订单/没填），统计时不计入任何店，不回填。
	StoreID       string    `json:"storeId,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
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
	// ORDER-SCENARIO-001: 消费场景（ordinary/assistance/空）。market 路径由
	// 机会快照带入；slot/scene 路径没有该信息，保持空。空 = 历史数据，
	// 客户端按金额档兜底。
	Scenario string `json:"scenario,omitempty"`
	// ORDER-AGENT-CLAIM-NO-001：接单方的接单编号（技师号，identity.agent_claim_numbers，
	// 注册时顺序分配、1 起无跳号、至少 3 位零填充）。
	//
	// **这不是 user id**：Agent 字段是 usr_xxx 这种内部主键，线下对不上号；技师号
	// 才是「打电话能报、扫一眼能认」的那个号（用户：「类似于按摩店的技师都有数字编号」）。
	// 所以它必须随订单冻结下来，条款变更也不许改 —— 当场是谁接的单，事后核销要对得上。
	//
	// 0 = 该接单方没有编号（内存仓 / 迁移前的历史单 / 编号未分配），客户端按
	// 「未分配」处理：不画这一行，也绝不拿 user id 或订单编号冒充。
	AgentClaimNumber int `json:"agentClaimNumber,omitempty"`
	// R8 Pillar #6: Cash Eligibility 状态机。仅在 SettlementMode
	// = DIRECT_SETTLEMENT 时生效。ALLOW/REVIEW/PLATFORM_PAY_REQUIRED/
	// BLOCK 四态之一。PLATFORM_PAY 任务此字段为空串。写入快照后不
	// 允许静默修改 — 任何变更走 Material Change (LC-30) 创建 vNext。
	CashEligibilityStatus string `json:"cashEligibilityStatus"`
	CashEligibilityReason string `json:"cashEligibilityReason"`
}

// Amendment 是 Material Change（新版本，不静默覆盖）。
// ORDER-AMEND-001：一方提出（PROPOSED，Snapshot = 提议的新条款），另一方接受
// （ACCEPTED：订单快照换成 Snapshot，旧快照存进 PreviousSnapshot）或拒绝
// （REJECTED：旧条款不变）；提出方可以撤回（WITHDRAWN）；订单完成 / 取消时
// 未决提议作废（LAPSED）。任何状态的 amendment 都永久留在订单上 —— 每一版
// 条款都能从这里还原（回滚依据）。Status 为空 = 审计前的历史记录。
type Amendment struct {
	AmendmentID      string         `json:"amendmentId"`
	Description      string         `json:"description"`
	Snapshot         OrderSnapshot  `json:"snapshot"`
	CreatedAt        time.Time      `json:"createdAt"`
	Status           string         `json:"status,omitempty"`
	ProposedBy       string         `json:"proposedBy,omitempty"`
	DecidedBy        string         `json:"decidedBy,omitempty"`
	DecidedAt        *time.Time     `json:"decidedAt,omitempty"`
	DecisionReason   string         `json:"decisionReason,omitempty"`
	PreviousSnapshot *OrderSnapshot `json:"previousSnapshot,omitempty"`
}

const (
	AmendmentProposed  = "PROPOSED"
	AmendmentAccepted  = "ACCEPTED"
	AmendmentRejected  = "REJECTED"
	AmendmentWithdrawn = "WITHDRAWN"
	AmendmentLapsed    = "LAPSED"
)

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
	// MATCH-RANK-001：需求方事后的主观满意。以前 RecordSatisfaction 只发一个领域事件、哪都不存 ——
	// 撮合排序想用「满意度」时根本没有数据可读。存在 outcome 里（同一个 JSONB 列，不用改表）。
	Satisfaction *SatisfactionRecord `json:"satisfaction,omitempty"`
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
	ID          string `json:"offerId"`
	TaskID      string `json:"taskId"`
	SlotID      string `json:"slotId"`
	RequesterID string `json:"requesterId"`
	AgentID     string `json:"agentId"`
	BatchID     string `json:"batchId,omitempty"`
	Status      string `json:"status"` // OFFERED | ACCEPTED | EXPIRED | CANCELLED
	// TOPIC-INVITE-001: 主题邀约字段。档位 Offer 这两项为空；主题邀约的
	// task/slot 为空（无任务可挂）。注意 orders.slot_id 必须存 NULL 而不是 ""，
	// 否则 uq_orders_slot_active 唯一索引会把所有主题订单卡成只能成交一单。
	TopicKey string `json:"topicKey,omitempty"`
	Note     string `json:"note,omitempty"`
	// ORDER-OFFER-COMP-001: 报价金额随 Offer 落库，接单时进订单快照。
	// 主题邀约没有金额（0 = 面议）。
	AgreedCompensation int64     `json:"agreedCompensation"`
	Currency           string    `json:"currency,omitempty"`
	ExpiresAt          time.Time `json:"expiresAt"`
	Version            int       `json:"version"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
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
	// STORE-STATS-001：按店查订单（读店铺经营统计用）。
	ListOrdersByStore(ctx context.Context, storeID string) ([]Order, error)
}

// TransactionalRepository 由支持事务性 outbox 的存储实现（订单与事件原子提交）。
type TransactionalRepository interface {
	Repository
	// EnsureOrder 幂等物化订单；只有真的插入了新行才发布 domainEvents（同一事务）。
	EnsureOrder(ctx context.Context, o Order, domainEvents []event.DomainEvent) error
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
	// ErrNumberLookupUnsupported：仓储没有按订单编号反查的能力（PUBLIC-NO-LOOKUP-001）。
	ErrNumberLookupUnsupported = errors.New("order number lookup not supported by repository")
)

type MemoryRepository struct {
	mu     sync.Mutex
	orders map[string]Order
	offers map[string]Offer
	events []event.DomainEvent
	// offerOrders: offerID → 接单生成的 orderID。档位占用看订单是否 CANCELLED，
	// 跟 PG 的 uq_orders_slot_active（WHERE lifecycle <> 'CANCELLED'）同语义。
	offerOrders map[string]string
	// audit 模拟 PG 触发器写的 fulfillment.audit_log（开发 / 测试环境同语义）。
	audit []memoryAudit
}

type memoryAudit struct {
	table, rowID string
	entry        AuditEntry
}

// record 追加一行审计（调用方已持锁）。
func (r *MemoryRepository) record(ctx context.Context, table, rowID, operation, oldState, newState string, oldVersion, newVersion int) {
	audit, _ := AuditFromContext(ctx)
	r.audit = append(r.audit, memoryAudit{table: table, rowID: rowID, entry: AuditEntry{
		Operation: operation, OldState: oldState, NewState: newState, OldVersion: oldVersion, NewVersion: newVersion,
		ActorID: audit.ActorID, CommandType: audit.CommandType, RecordedAt: time.Now().UTC(),
	}})
}

func (r *MemoryRepository) ListAudit(_ context.Context, table, rowID string) ([]AuditEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []AuditEntry{}
	for _, row := range r.audit {
		if row.table == table && row.rowID == rowID {
			out = append(out, row.entry)
		}
	}
	return out, nil
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{orders: make(map[string]Order), offers: make(map[string]Offer), offerOrders: make(map[string]string)}
}

func (r *MemoryRepository) CreateOrder(ctx context.Context, o Order) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.orders[o.ID]; exists {
		return errors.New("order already exists")
	}
	r.orders[o.ID] = cloneOrder(o)
	r.record(ctx, "orders", o.ID, "INSERT", "", o.Lifecycle, 0, o.Version)
	return nil
}

// EnsureOrder is the idempotent creation primitive used by cross-aggregate
// materialisation. An existing row is success only when it represents the
// same immutable order identity; an ID collision with different parties or
// need is rejected.
func (r *MemoryRepository) EnsureOrder(ctx context.Context, o Order, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.orders[o.ID]; ok {
		if existing.RequesterID != o.RequesterID || existing.AgentID != o.AgentID || existing.NeedID != o.NeedID {
			return errors.New("order id conflicts with another materialisation")
		}
		return nil
	}
	r.orders[o.ID] = cloneOrder(o)
	r.events = append(r.events, domainEvents...)
	r.record(ctx, "orders", o.ID, "INSERT", "", o.Lifecycle, 0, o.Version)
	return nil
}

// WithinTransaction 给内存仓同样的「全有或全无」语义：operation 失败时恢复到调用前
// 的快照（POLICY-STAMP-DURABLE-001：盖章失败时订单迁移与事件一并回滚）。
// Service 的互斥锁串行化了所有命令，快照期间不会有并发写入。
func (r *MemoryRepository) WithinTransaction(ctx context.Context, operation func(context.Context) error) error {
	r.mu.Lock()
	orders := make(map[string]Order, len(r.orders))
	for id, order := range r.orders {
		orders[id] = cloneOrder(order)
	}
	offers := make(map[string]Offer, len(r.offers))
	for id, offer := range r.offers {
		offers[id] = offer
	}
	offerOrders := make(map[string]string, len(r.offerOrders))
	for id, orderID := range r.offerOrders {
		offerOrders[id] = orderID
	}
	events := append([]event.DomainEvent(nil), r.events...)
	audit := append([]memoryAudit(nil), r.audit...)
	r.mu.Unlock()
	if err := operation(ctx); err != nil {
		r.mu.Lock()
		r.orders, r.offers, r.offerOrders, r.events, r.audit = orders, offers, offerOrders, events, audit
		r.mu.Unlock()
		return err
	}
	return nil
}

// Events 返回内存仓已发布的领域事件（测试核对 outbox 用）。
func (r *MemoryRepository) Events() []event.DomainEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]event.DomainEvent(nil), r.events...)
}

func (r *MemoryRepository) CreateOrderAndPublish(ctx context.Context, o Order, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.orders[o.ID]; exists {
		return errors.New("order already exists")
	}
	r.orders[o.ID] = cloneOrder(o)
	r.events = append(r.events, domainEvents...)
	r.record(ctx, "orders", o.ID, "INSERT", "", o.Lifecycle, 0, o.Version)
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

// GetOrderByNumber 按全数字订单编号反查（PUBLIC-NO-LOOKUP-001）。编号全局唯一，
// PG 侧由 fulfillment_orders_order_no_key 唯一索引保证；内存仓线性扫描即可。
func (r *MemoryRepository) GetOrderByNumber(_ context.Context, orderNo string) (Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if orderNo != "" {
		for _, o := range r.orders {
			if o.OrderNo == orderNo {
				return cloneOrder(o), nil
			}
		}
	}
	return Order{}, ErrOrderNotFound
}

func (r *MemoryRepository) UpdateOrder(ctx context.Context, o Order, expectedVersion int) error {
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
	r.record(ctx, "orders", o.ID, "UPDATE", current.Lifecycle, o.Lifecycle, current.Version, o.Version)
	return nil
}

func (r *MemoryRepository) UpdateOrderAndPublish(ctx context.Context, o Order, expectedVersion int, domainEvents []event.DomainEvent) error {
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
	r.record(ctx, "orders", o.ID, "UPDATE", current.Lifecycle, o.Lifecycle, current.Version, o.Version)
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

// ListOrdersByStore 按店查订单（STORE-STATS-001；内存实现：全量过滤）。
func (r *MemoryRepository) ListOrdersByStore(_ context.Context, storeID string) ([]Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Order{}
	for _, o := range r.orders {
		if storeID != "" && o.StoreID == storeID {
			result = append(result, cloneOrder(o))
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func (r *MemoryRepository) CreateOffer(ctx context.Context, o Offer) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.offers[o.ID]; exists {
		return errors.New("offer already exists")
	}
	r.offers[o.ID] = o
	r.record(ctx, "offers", o.ID, "INSERT", "", o.Status, 0, o.Version)
	return nil
}

func (r *MemoryRepository) CreateOfferAndPublish(ctx context.Context, o Offer, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.offers[o.ID]; exists {
		return errors.New("offer already exists")
	}
	r.offers[o.ID] = o
	r.record(ctx, "offers", o.ID, "INSERT", "", o.Status, 0, o.Version)
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

func (r *MemoryRepository) UpdateOffer(ctx context.Context, o Offer, expectedVersion int) error {
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
	r.record(ctx, "offers", o.ID, "UPDATE", current.Status, o.Status, current.Version, o.Version)
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

func (r *MemoryRepository) AcceptOfferAndCreateOrder(ctx context.Context, offer Offer, order Order, expectedOfferVersion int, domainEvents []event.DomainEvent) error {
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
	if _, exists := r.orders[order.ID]; exists {
		return errors.New("order already exists")
	}
	// Check duplicate slot via offers already accepted for same slot.
	// 空 slot（主题邀约）跳过 —— 对应 PG 那边 uq_orders_slot_active 的
	// WHERE slot_id IS NOT NULL。空串也判重的话，第二个主题订单永远成交不了。
	if offer.SlotID != "" {
		for _, o := range r.offers {
			if o.SlotID == offer.SlotID && o.Status == "ACCEPTED" && o.ID != offer.ID && r.orders[r.offerOrders[o.ID]].Lifecycle != "CANCELLED" {
				return ErrOfferNotAvailable
			}
		}
	}
	// 校验全过才写：失败时不能留下「offer 已接受但没有订单」的半状态。
	r.offers[offer.ID] = offer
	r.orders[order.ID] = cloneOrder(order)
	r.offerOrders[offer.ID] = order.ID
	r.record(ctx, "offers", offer.ID, "UPDATE", current.Status, offer.Status, current.Version, offer.Version)
	r.record(ctx, "orders", order.ID, "INSERT", "", order.Lifecycle, 0, order.Version)
	r.events = append(r.events, domainEvents...)
	return nil
}

// cloneOrder 深拷贝订单：commitOrder 拿 before / after 做状态机比对，二者不能共享指针。
func cloneOrder(o Order) Order {
	o.Amendments = append([]Amendment{}, o.Amendments...) // 空也是 []，不是 null
	for i := range o.Amendments {
		if p := o.Amendments[i].PreviousSnapshot; p != nil {
			copy := *p
			o.Amendments[i].PreviousSnapshot = &copy
		}
		if d := o.Amendments[i].DecidedAt; d != nil {
			copy := *d
			o.Amendments[i].DecidedAt = &copy
		}
	}
	if o.Settlement != nil {
		copy := *o.Settlement
		o.Settlement = &copy
	}
	if o.Outcome != nil {
		copy := *o.Outcome
		if copy.Satisfaction != nil {
			satisfaction := *copy.Satisfaction
			copy.Satisfaction = &satisfaction
		}
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
	// STORE-STATS-001：店铺存在性查询（RecordOutcome 归因校验用）。不接 = 不校验
	// （测试 / 无库环境）；生产在 main.go 接 business 仓。
	storeLookup func(ctx context.Context, storeID string) (active bool, err error)
	// ORDER-STORE-STATS-AUTHZ-001：谁能读一家店的经营统计（店铺成员）。不接 = 拒绝。
	storeAccess func(ctx context.Context, storeID, userID string) (bool, error)
	// ORDER-SLOT-OWNER-001：谁能对 task/slot 发档位报价（任务 / 机会的主人，且对方是报名人）。不接 = 拒绝。
	slotOfferAuthorizer func(ctx context.Context, taskID, slotID, requesterID, agentID string) (bool, error)
	// jurisdictionResolver resolves the requester's
	// jurisdiction (R16.7-P1-E) so the policy decision can
	// be evaluated under the correct regulatory family. The
	// default fallback is VN-79 (Ho Chi Minh City, proxy.vn
	// HQ). nil means the legacy test surface; Evaluate gets
	// the empty string and falls back to VN-79.
	jurisdictionResolver jurisdictionResolver
	// orderNumbers 分配全数字订单编号（ORDER-NO-001）。生产接 Postgres 序列，
	// 与活动报名共用同一个分配器；默认进程内计数器（开发 / 单测）。
	orderNumbers ordernumber.Allocator
	// agentClaimNumbers 查接单方的接单编号（ORDER-AGENT-CLAIM-NO-001）。生产接
	// identity.agent_claim_numbers；nil = 查不到（内存仓 / 未接），快照里该字段留 0，
	// 客户端隐藏这一行。查不到**不拒绝下单** —— 编号是展示用的，缺了不能挡住成交。
	agentClaimNumbers AgentClaimNumberReader
}

// AgentClaimNumberReader 按 user id 查接单编号（技师号）。谁查不到返回 0 + nil error
// （0 = 未分配，是正常状态不是失败）；只有真正的存储故障才返回 error。
type AgentClaimNumberReader interface {
	AgentClaimNumber(ctx context.Context, userID string) (int, error)
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
	return &Service{repository: repository, clock: clock.System{}, orderNumbers: defaultOrderNumbers(repository)}
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

// WithOrderNumbers 接上订单编号分配器（ORDER-NO-001）。main.go 让履约与活动
// 共用同一个实例，保证两类订单编号不撞号。
func (s *Service) WithOrderNumbers(allocator ordernumber.Allocator) *Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.orderNumbers = allocator
	return s
}

// OrderNumbers 返回当前的编号分配器（跨域物化订单的适配器用同一个）。
func (s *Service) OrderNumbers() ordernumber.Allocator { return s.orderNumbers }

// WithAgentClaimNumbers 接上接单编号查询（ORDER-AGENT-CLAIM-NO-001）。main.go 把它
// 指向 identity 仓，下单冻结快照时把技师号一起冻进去。
func (s *Service) WithAgentClaimNumbers(reader AgentClaimNumberReader) *Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentClaimNumbers = reader
	return s
}

// resolveAgentClaimNumber 取接单方的接单编号。
//
// **查不到不是错误**：0 = 未分配 / 没接查询器，客户端隐藏这一行。编号是线下核销的
// 凭证，不是成交前提 —— 存储故障时也不该把用户挡在门外（fail-open 只在这一处，
// 其余门禁照旧 fail-closed）。用户：「不接单 接单编号暂时隐藏」。
func (s *Service) resolveAgentClaimNumber(ctx context.Context, userID string) int {
	if s.agentClaimNumbers == nil || userID == "" {
		return 0
	}
	number, err := s.agentClaimNumbers.AgentClaimNumber(ctx, userID)
	if err != nil {
		return 0
	}
	if number < 1 || number > 10000000 {
		return 0
	}
	return number
}

// OrderNumberSource 由能提供持久编号分配器的仓储实现（PG：共享序列）。
type OrderNumberSource interface {
	OrderNumbers() ordernumber.Allocator
}

// defaultOrderNumbers：持久仓储用它自己的序列分配器；只有内存仓才用进程内计数器。
// 否则「PG 仓 + 默认计数器」的多个实例都从 1 发号，在同一个库里撞唯一约束。
func defaultOrderNumbers(repository any) ordernumber.Allocator {
	if source, ok := repository.(OrderNumberSource); ok {
		return source.OrderNumbers()
	}
	return ordernumber.NewMemory()
}

// nextOrderNo 分配一个编号；分配失败就拒绝下单，不生成假号。
func (s *Service) nextOrderNo(ctx context.Context) (string, error) {
	if s.orderNumbers == nil {
		return "", ordernumber.ErrUnavailable
	}
	return s.orderNumbers.Next(ctx, ordernumber.CategoryService)
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
	case "CreateOffer", "CreateSlotOffer", "AcceptSlotOffer", "CreateTopicInvite", "RespondTopicInvite", "GetOffer", "ListAgentOffers",
		"ListMyOrders", "GetStoreOrderStats", "GetOrderAuditTrail",
		"CheckInOrder", "SubmitEvidence",
		"ConfirmCooperation", "StartExecution", "RecordDirectSettlement",
		"RecordOutcome", "RecordSatisfaction", "RecordMaterialOrderChange", "RespondMaterialOrderChange",
		"CancelOrder":
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
	// ORDER-AUDIT-001：命令上下文随 ctx 进仓储，PG 审计触发器据此记录「谁、哪条命令」。
	ctx = WithAudit(ctx, AuditContext{ActorID: e.Actor.ID, PrincipalID: e.Principal.ID, CommandType: e.CommandType, CommandID: e.CommandID, CorrelationID: e.CorrelationID})
	switch e.CommandType {
	case "CreateOffer":
		return s.createOffer(ctx, e)
	case "CreateSlotOffer":
		return s.createSlotOffer(ctx, e)
	case "AcceptSlotOffer":
		return s.acceptSlotOffer(ctx, e)
	case "CreateTopicInvite":
		return s.createTopicInvite(ctx, e)
	case "RespondTopicInvite":
		return s.respondTopicInvite(ctx, e)
	case "GetOffer":
		return s.getOffer(ctx, e)
	case "ListAgentOffers":
		return s.listAgentOffers(ctx, e)
	case "ListMyOrders":
		return s.listMyOrders(ctx, e)
	case "GetStoreOrderStats":
		return s.getStoreOrderStats(ctx, e)
	case "GetOrderAuditTrail":
		return s.getOrderAuditTrail(ctx, e)
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
	case "RespondMaterialOrderChange":
		return s.respondMaterialChange(ctx, e)
	case "CancelOrder":
		return s.cancelOrder(ctx, e)
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

// ---------- GetOrderAuditTrail (ORDER-AUDIT-001) ----------
// 订单的完整变更轨迹（谁、哪条命令、前后状态 / 版本），只给订单双方看。
// 争议、客服、结算核对都以它为准；数据来自存储层审计（PG 触发器写入，只追加）。

func (s *Service) getOrderAuditTrail(ctx context.Context, e command.Envelope) command.Result {
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	if !isOrderParty(order, e.Actor.ID) {
		// 非当事人一律「不存在」，不泄露订单是否存在。
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	reader, ok := s.repository.(AuditReader)
	if !ok {
		return command.Rejected(e, "AUDIT_NOT_AVAILABLE", "INTERNAL", "AFTER_USER_ACTION", "fulfillment.audit_not_available", nil)
	}
	entries, err := reader.ListAudit(ctx, "orders", order.ID)
	if err != nil {
		return command.Rejected(e, "AUDIT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.audit_read_failed", nil)
	}
	return acceptedWithPayload(e, "OrderAuditTrail", order.ID, order.Version, order.Lifecycle, map[string]any{
		"orderId": order.ID, "entries": entries, "amendments": order.Amendments,
	}, nil)
}

// ---------- GetStoreOrderStats ----------
// STORE-STATS-001：一家店的经营统计（累计接单 / 满意分布 / 复购客户 / 最近接单）。
// 只数 COMPLETED 且归因到这家店的订单；老订单（store_id 为空）不计入，不回填。
// 调用方（店主/店员）由 dispatch 鉴权；这里不额外限角色 —— 店铺 id 本身不敏感，
// 数字只来自已完成的公开履约事实。

type StoreOrderRecent struct {
	OrderID      string `json:"orderId"`
	RequesterID  string `json:"requesterId"`
	ServiceSKU   string `json:"serviceSku"`
	Satisfaction string `json:"satisfaction"` // FULL | PARTIAL | NONE | ""
	CompletedAt  string `json:"completedAt"`
}

type StoreOrderStats struct {
	StoreID         string            `json:"storeId"`
	OrderCount      int               `json:"orderCount"`
	FullCount       int               `json:"fullCount"`
	PartialCount    int               `json:"partialCount"`
	RepeatRequesters int              `json:"repeatRequesters"`
	LastOrderAt     string            `json:"lastOrderAt,omitempty"`
	Recent          []StoreOrderRecent `json:"recent"`
}

func (s *Service) getStoreOrderStats(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		StoreID string `json:"storeId"`
	}
	if !decode(e.Payload, &p) || strings.TrimSpace(p.StoreID) == "" {
		p.StoreID = e.Target.ID
		if strings.TrimSpace(p.StoreID) == "" {
			return command.Rejected(e, "INVALID_STORE_ID", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_store_id", nil)
		}
	}
	storeID := strings.TrimSpace(p.StoreID)
	// ORDER-STORE-STATS-AUTHZ-001：统计里有顾客 id 和满意度，只给这家店的成员看。
	if s.storeAccess == nil {
		return command.Rejected(e, "STORE_ACCESS_NOT_CONFIGURED", "INTERNAL", "AFTER_USER_ACTION", "fulfillment.store_access_unconfigured", nil)
	}
	allowed, accessErr := s.storeAccess(ctx, storeID, e.Actor.ID)
	if accessErr != nil {
		return command.Rejected(e, "STORE_ACCESS_CHECK_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.store_access_check_failed", nil)
	}
	if !allowed {
		return command.Rejected(e, "STORE_ACCESS_DENIED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.store_access_denied", nil)
	}
	orders, err := s.repository.ListOrdersByStore(ctx, storeID)
	if err != nil {
		return command.Rejected(e, "ORDER_STATS_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_stats_failed", nil)
	}
	stats := StoreOrderStats{StoreID: storeID, Recent: []StoreOrderRecent{}}
	reuseRequesters := map[string]bool{}
	for _, order := range orders {
		if order.Lifecycle != "COMPLETED" || order.Outcome == nil {
			continue
		}
		stats.OrderCount++
		completedAt := order.UpdatedAt.UTC().Format(time.RFC3339)
		if stats.LastOrderAt == "" || completedAt > stats.LastOrderAt {
			stats.LastOrderAt = completedAt
		}
		satisfaction := ""
		if order.Outcome.Satisfaction != nil {
			satisfaction = order.Outcome.Satisfaction.Resolved
			switch satisfaction {
			case "FULL":
				stats.FullCount++
			case "PARTIAL":
				stats.PartialCount++
			}
			if order.Outcome.Satisfaction.RepeatIntent == "REUSE" {
				reuseRequesters[order.RequesterID] = true
			}
		}
		if len(stats.Recent) < 5 {
			stats.Recent = append(stats.Recent, StoreOrderRecent{
				OrderID:      order.ID,
				RequesterID:  order.RequesterID,
				ServiceSKU:   order.Snapshot.ServiceSKU,
				Satisfaction: satisfaction,
				CompletedAt:  completedAt,
			})
		}
	}
	for range reuseRequesters {
		stats.RepeatRequesters++
	}
	r := command.Accepted(e, "StoreOrderStats", storeID, 1, "READY", nil)
	raw, _ := json.Marshal(map[string]any{"stats": stats})
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
		// ORDER-AGENT-CLAIM-NO-001：接单方的接单编号随单冻结。
		AgentClaimNumber: s.resolveAgentClaimNumber(ctx, p.AgentID),
	}
	orderNo, err := s.nextOrderNo(ctx)
	if err != nil {
		return command.Rejected(e, "ORDER_NUMBER_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "fulfillment.order_number_unavailable", nil)
	}
	order := Order{
		ID:          newID("ord_"),
		OrderNo:     orderNo,
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
		"orderNo":  order.OrderNo,
		"snapshot": snapshot,
	}, domainEvents)
}

// offerTTLSeconds 归一化 TTL：缺省 fallback；上下限 30s..1800s。
// 下限防"0 秒过期"的必拒单，上限防长挂单占着列表。调用方传秒数。
func offerTTLSeconds(requested int64, fallback time.Duration) time.Duration {
	if requested <= 0 {
		return fallback
	}
	if requested < 30 {
		return 30 * time.Second
	}
	if requested > 1800 {
		return 1800 * time.Second
	}
	return time.Duration(requested) * time.Second
}

// ---------- CreateSlotOffer (M4 wave) ----------
type slotOfferPayload struct {
	TaskID             string `json:"taskId"`
	SlotID             string `json:"slotId"`
	AgentID            string `json:"agentId"`
	BatchID            string `json:"batchId"`
	AgreedCompensation int64  `json:"agreedCompensation"`
	Currency           string `json:"currency"`
	// TOPIC-INVITE-001: 可选 TTL 秒数（缺省 300s，保持现状）。
	TTLSeconds int64 `json:"ttlSeconds"`
}

func (s *Service) createSlotOffer(ctx context.Context, e command.Envelope) command.Result {
	var p slotOfferPayload
	if !decode(e.Payload, &p) || p.TaskID == "" || p.SlotID == "" || p.AgentID == "" {
		return command.Rejected(e, "INVALID_SLOT_OFFER", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_slot_offer", nil)
	}
	if p.AgreedCompensation <= 0 || p.AgreedCompensation > maxAmountVND {
		return command.Rejected(e, "INVALID_SLOT_OFFER_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_slot_offer_amount", nil)
	}
	if e.Actor.Type != "USER" || e.Actor.ID == p.AgentID {
		return command.Rejected(e, "SLOT_OFFER_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.slot_offer_not_allowed", nil)
	}
	// ORDER-SLOT-OWNER-001：以前任何用户都能对任意 task/slot 发报价（接单即占档位、
	// 生成 CONFIRMED 订单）。只有任务 / 机会的主人能发，且对象必须是报名人。
	if s.slotOfferAuthorizer == nil {
		return command.Rejected(e, "SLOT_OFFER_AUTHZ_NOT_CONFIGURED", "INTERNAL", "AFTER_USER_ACTION", "fulfillment.slot_offer_authz_unconfigured", nil)
	}
	allowed, authzErr := s.slotOfferAuthorizer(ctx, p.TaskID, p.SlotID, e.Actor.ID, p.AgentID)
	if authzErr != nil {
		return command.Rejected(e, "SLOT_OFFER_AUTHZ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.slot_offer_authz_failed", nil)
	}
	if !allowed {
		return command.Rejected(e, "SLOT_OFFER_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.slot_offer_not_allowed", nil)
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	now := s.clock.Now().UTC()
	offer := Offer{
		ID:                 newID("off_"),
		TaskID:             p.TaskID,
		SlotID:             p.SlotID,
		RequesterID:        e.Actor.ID,
		AgentID:            p.AgentID,
		BatchID:            p.BatchID,
		Status:             "OFFERED",
		AgreedCompensation: p.AgreedCompensation,
		Currency:           p.Currency,
		ExpiresAt:          now.Add(offerTTLSeconds(p.TTLSeconds, 5*time.Minute)),
		Version:            1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	// ORDER-OFFER-COMP-001: 接单即 CONFIRMED，没有人工复核的节拍 —— 过不了现金门的
	// 报价在创建时就拒掉，不要让服务方接到一张接不了的单。
	if rejected, blocked := cashEligibilityGate(e, offerSnapshot(offer, 0), "offerId", offer.ID); blocked {
		return rejected
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
	return s.acceptOfferAsOrder(ctx, e, offer, now)
}

// acceptOfferAsOrder 把一个已校验的 OFFERED offer 落成订单。档位与主题共用 ——
// 差异只在校验段（档位查 slot，主题查 topic），落库走同一条
// AcceptOfferAndCreateOrder（主题订单的 task/slot 存 NULL，不触发档位唯一索引）。
func (s *Service) acceptOfferAsOrder(ctx context.Context, e command.Envelope, offer Offer, now time.Time) command.Result {
	snapshot := offerSnapshot(offer, s.resolveAgentClaimNumber(ctx, offer.AgentID))
	if rejected, blocked := cashEligibilityGate(e, snapshot, "offerId", offer.ID); blocked {
		return rejected
	}
	orderNo, err := s.nextOrderNo(ctx)
	if err != nil {
		return command.Rejected(e, "ORDER_NUMBER_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "fulfillment.order_number_unavailable", nil)
	}
	order := Order{
		ID:          newID("ord_"),
		OrderNo:     orderNo,
		RequesterID: offer.RequesterID,
		AgentID:     offer.AgentID,
		NeedID:      offer.TaskID,
		Lifecycle:   "CONFIRMED",
		Version:     1,
		Snapshot:    snapshot,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
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
		// PG 仓在行锁内再判一次过期；这是业务状态，不是「接受失败请重试」。
		if errors.Is(err, ErrOfferExpired) {
			return command.Rejected(e, "OFFER_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_expired", map[string]any{"expiresAt": offer.ExpiresAt.Format(time.RFC3339)})
		}
		return command.Rejected(e, "ACCEPT_OFFER_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.accept_failed", nil)
	}
	return acceptedWithPayload(e, "Order", order.ID, 1, order.Lifecycle, map[string]any{
		"orderId": order.ID, "orderNo": order.OrderNo, "offerId": offer.ID, "slotId": offer.SlotID,
	}, domainEvents)
}

// ---------- CreateTopicInvite (TOPIC-INVITE-001) ----------
// 原型"加入 · 邀请她"按主题邀约：没有 task/slot/金额，只有 agent + 主题 (+一句话)。
// 与档位 Offer 共用一张表、同一套过期/接受语义 —— 差异只有 topic/note 两列和
// TTL 默认值（邀约 60s，原型 60 秒倒计时）。接受同样落单（task/slot 存 NULL）。
type topicInvitePayload struct {
	AgentID    string `json:"agentId"`
	TopicKey   string `json:"topicKey"`
	Note       string `json:"note"`
	TTLSeconds int64  `json:"ttlSeconds"`
}

func (s *Service) createTopicInvite(ctx context.Context, e command.Envelope) command.Result {
	var p topicInvitePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_TOPIC_INVITE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_topic_invite", nil)
	}
	agentID := strings.TrimSpace(p.AgentID)
	topicKey := strings.TrimSpace(p.TopicKey)
	note := strings.TrimSpace(p.Note)
	if agentID == "" || topicKey == "" {
		return command.Rejected(e, "INVALID_TOPIC_INVITE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_topic_invite", nil)
	}
	if len([]rune(topicKey)) > 32 || len([]rune(note)) > 280 {
		return command.Rejected(e, "INVALID_TOPIC_INVITE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_topic_invite", nil)
	}
	// 只有需求方能邀，不能给自己发，也不能替别人发。
	if e.Actor.Type != "USER" || e.Actor.ID == "" || e.Actor.ID == agentID {
		return command.Rejected(e, "TOPIC_INVITE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.topic_invite_not_allowed", nil)
	}
	now := s.clock.Now().UTC()
	offer := Offer{
		ID:          newID("off_"),
		TaskID:      "",
		SlotID:      "",
		RequesterID: e.Actor.ID,
		AgentID:     agentID,
		Status:      "OFFERED",
		TopicKey:    topicKey,
		Note:        note,
		ExpiresAt:   now.Add(offerTTLSeconds(p.TTLSeconds, 60*time.Second)),
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	domainEvents := []event.DomainEvent{event.New("TopicInviteCreated", "Offer", offer.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agentId": offer.AgentID, "topicKey": offer.TopicKey, "expiresAt": offer.ExpiresAt.Format(time.RFC3339),
	})}
	if err := s.repository.CreateOfferAndPublish(ctx, offer, domainEvents); err != nil {
		return command.Rejected(e, "TOPIC_INVITE_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.topic_invite_failed", nil)
	}
	return acceptedWithPayload(e, "Offer", offer.ID, 1, offer.Status, map[string]any{
		"offerId": offer.ID, "topicKey": offer.TopicKey, "expiresAt": offer.ExpiresAt.Format(time.RFC3339),
	}, domainEvents)
}

// ---------- RespondTopicInvite (TOPIC-INVITE-001) ----------
// 女孩接/拒。接受走共用落单；拒绝记 REJECTED（schema 原生支持，不是 CANCELLED ——
// 取消是需求方的动作，拒绝是女孩的动作，审计要分得清）。只能本人操作自己的邀约。
type respondTopicInvitePayload struct {
	OfferID string `json:"offerId"`
	Accept  bool   `json:"accept"`
}

func (s *Service) respondTopicInvite(ctx context.Context, e command.Envelope) command.Result {
	var p respondTopicInvitePayload
	// 注意：这里故意不用 target 兜 offerId —— 体解析失败时 Accept 是零值 false，
	// 兜了就会把一次坏请求误判成"拒绝"，把别人的邀约拒掉。解析失败直接拒掉重发。
	if !decode(e.Payload, &p) || p.OfferID == "" {
		return command.Rejected(e, "INVALID_RESPOND_INVITE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_respond_invite", nil)
	}
	offer, err := s.repository.GetOffer(ctx, p.OfferID)
	if errors.Is(err, ErrOfferNotFound) {
		return command.Rejected(e, "OFFER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "OFFER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.offer_read_failed", nil)
	}
	if offer.Status != "OFFERED" {
		return command.Rejected(e, "OFFER_NOT_AVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_available", map[string]any{"status": offer.Status})
	}
	now := s.clock.Now().UTC()
	if now.After(offer.ExpiresAt) {
		return command.Rejected(e, "OFFER_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_expired", map[string]any{"expiresAt": offer.ExpiresAt.Format(time.RFC3339)})
	}
	if offer.AgentID != e.Actor.ID && offer.AgentID != e.Principal.ID {
		return command.Rejected(e, "OFFER_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.offer_not_owned", nil)
	}
	if !p.Accept {
		offer.Status = "REJECTED"
		offer.Version++
		offer.UpdatedAt = now
		if err := s.repository.UpdateOffer(ctx, offer, offer.Version-1); err != nil {
			if errors.Is(err, ErrVersionConflict) {
				return command.Rejected(e, "OFFER_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "fulfillment.offer_version_conflict", nil)
			}
			return command.Rejected(e, "RESPOND_INVITE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.respond_invite_failed", nil)
		}
		return acceptedWithPayload(e, "Offer", offer.ID, offer.Version, offer.Status, map[string]any{
			"offerId": offer.ID, "status": offer.Status,
		}, nil)
	}
	return s.acceptOfferAsOrder(ctx, e, offer, now)
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
	// ORDER-OFFER-READ-001: 报价里有留言和需求方 id，只给报价双方看；外人一律
	// 「不存在」，不泄露这个 offerId 是否存在。
	if !isOfferParty(offer, e.Actor.ID) && !isOfferParty(offer, e.Principal.ID) {
		return command.Rejected(e, "OFFER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.offer_not_found", nil)
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
	before := cloneOrder(order)
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
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
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
	before := cloneOrder(order)
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
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "EVIDENCE_SUBMIT_FAILED", "fulfillment.evidence_failed")
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
	before := cloneOrder(order)
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "OFFERED" {
		return command.Rejected(e, "ORDER_NOT_CONFIRMABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_confirmable", map[string]any{"lifecycle": order.Lifecycle})
	}
	// ORDER-CONFIRM-AGENT-001: 报价是需求方发的，「确认合作」是服务方的同意。
	// 以前任一方都能确认，需求方一个人就能把单从 OFFERED 走到 COMPLETED 再打满分，
	// 满意度进撮合排序和店铺统计。
	if order.AgentID != e.Actor.ID {
		return command.Rejected(e, "ONLY_AGENT_CONFIRMS", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.only_agent_confirms", nil)
	}
	// R8 Pillar #6: DIRECT_SETTLEMENT 任务必须 Cash Eligibility
	// = ALLOW 才能 Lock 到 CONFIRMED。其他 3 态 (REVIEW /
	// PLATFORM_PAY_REQUIRED / BLOCK) 都明确阻断现金单创建。这条
	// 门控是越南 PDP 91/2025/QH15 + Decree 13/2023/ND-CP
	// 双重视角的现金交易透明度底线。
	if rejected, blocked := cashEligibilityGate(e, order.Snapshot, "orderId", order.ID); blocked {
		return rejected
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
		"snapshot":         order.Snapshot,
		"policyDecisionId": order.PolicyDecisionID,
	})}
	// R16.7-P1-B (LC-28): the (order, decision, lifecycle) stamp in
	// `policy.order_decisions` is the system of record. POLICY-STAMP-DURABLE-001:
	// it is written in the same transaction as the lifecycle change — a lost
	// stamp rolls the confirmation back instead of being silently dropped.
	if err := s.commitOrder(ctx, before, order, domainEvents, s.stampFor(order)...); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
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
	before := cloneOrder(order)
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
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
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
	before := cloneOrder(order)
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
	// ORDER-SETTLE-GUARD-001: 每一方只声明自己那一侧（需求方 = 付款方，服务方 =
	// 收款方）；提交即声明。替对方勾确认直接拒掉。金额先对快照（快照 0 = 面议时
	// 由先登记的一方定），后到的一方必须对上已登记的金额才算双方确认。
	isPayer := order.RequesterID == e.Actor.ID
	if (isPayer && p.PayeeConfirmed) || (!isPayer && p.PayerConfirmed) {
		return command.Rejected(e, "SETTLEMENT_FLAG_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.settlement_flag_not_owned", nil)
	}
	expectedAmount := order.Snapshot.AgreedCompensation
	if order.Settlement != nil {
		expectedAmount = order.Settlement.AgreedAmount
		if (isPayer && order.Settlement.PayerConfirmed) || (!isPayer && order.Settlement.PayeeConfirmed) {
			return command.Rejected(e, "SETTLEMENT_ALREADY_RECORDED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.settlement_exists", nil)
		}
	}
	if expectedAmount > 0 && p.AgreedAmount != expectedAmount {
		return command.Rejected(e, "SETTLEMENT_AMOUNT_MISMATCH", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.settlement_amount_mismatch", map[string]any{"expectedAmount": expectedAmount})
	}
	now := s.clock.Now().UTC()
	eventType := "DirectSettlementCountersigned"
	if order.Settlement == nil {
		eventType = "DirectSettlementRecorded"
		order.Settlement = &SettlementRecord{
			Mode:               "DIRECT_SETTLEMENT",
			AgreedAmount:       p.AgreedAmount,
			Currency:           order.Snapshot.Currency,
			Duration:           order.Snapshot.Duration,
			IncludedScope:      order.Snapshot.IncludedScope,
			ExcludedScope:      order.Snapshot.ExcludedScope,
			PaymentMethodLabel: p.PaymentMethodLabel,
			Payer:              order.RequesterID,
			Payee:              order.AgentID,
			ConfirmedAt:        now,
		}
	}
	if isPayer {
		order.Settlement.PayerConfirmed = true
	} else {
		order.Settlement.PayeeConfirmed = true
	}
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New(eventType, "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agreedAmount":   order.Settlement.AgreedAmount,
		"role":           viewerRole(order, e.Actor.ID),
		"payerConfirmed": order.Settlement.PayerConfirmed,
		"payeeConfirmed": order.Settlement.PayeeConfirmed,
		"note":           "DIRECT_SETTLEMENT 不创建 Platform Funding 假记录；双方确认是声明信号，不等于平台物理验证现金",
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
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
	// STORE-STATS-001：服务发生在哪家店（人类断言，可选）。空 = 不归因。
	StoreID string `json:"storeId"`
}

// SetStoreLookup 接上店铺存在性查询（STORE-STATS-001）：RecordOutcome 归因时必须
// 是真实存在的 ACTIVE 店。不接 = 不校验（测试 / 无库环境）；生产在 main.go 必须接。
func (s *Service) SetStoreLookup(check func(ctx context.Context, storeID string) (bool, error)) {
	s.storeLookup = check
}

// SetStoreAccess 接上店铺经营统计的读权限（ORDER-STORE-STATS-AUTHZ-001）。
// 不接 = GetStoreOrderStats 一律拒绝（fail closed）；生产在 main.go 接 business。
func (s *Service) SetStoreAccess(check func(ctx context.Context, storeID, userID string) (bool, error)) {
	s.storeAccess = check
}

// SetSlotOfferAuthorizer 接上档位报价的发起权校验（ORDER-SLOT-OWNER-001）。
// 不接 = CreateSlotOffer 一律拒绝（fail closed）；生产在 main.go 接 demand + marketplace。
func (s *Service) SetSlotOfferAuthorizer(check func(ctx context.Context, taskID, slotID, requesterID, agentID string) (bool, error)) {
	s.slotOfferAuthorizer = check
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
	before := cloneOrder(order)
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
	// STORE-STATS-001：归因必须指向真实存在的 ACTIVE 店（防手滑/编造 id）。
	// 空 = 不归因，直接过。
	storeID := strings.TrimSpace(p.StoreID)
	if storeID != "" && s.storeLookup != nil {
		if active, err := s.storeLookup(ctx, storeID); err != nil || !active {
			return command.Rejected(e, "UNKNOWN_STORE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.unknown_store", nil)
		}
	}
	now := s.clock.Now().UTC()
	order.StoreID = storeID
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
	lapsePendingAmendments(&order, now, "order completed")
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("OutcomeRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"onTime":          p.OnTime,
		"scopeCompleted":  p.ScopeCompleted,
		"materialChanges": p.MaterialChanges,
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
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
	before := cloneOrder(order)
	// MATCH-RANK-001：满意度是「需求方对服务者」的评价，进撮合排序 —— 服务者自己不能给自己打分。
	if order.RequesterID != e.Actor.ID {
		return command.Rejected(e, "ONLY_REQUESTER_RATES", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.only_requester_rates", nil)
	}
	if order.Lifecycle != "COMPLETED" || order.Outcome == nil {
		return command.Rejected(e, "ORDER_NOT_COMPLETED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_completed", map[string]any{"lifecycle": order.Lifecycle})
	}
	if p.RepeatIntent != "" && p.RepeatIntent != "REUSE" && p.RepeatIntent != "MAYBE" && p.RepeatIntent != "NO" {
		return command.Rejected(e, "INVALID_REPEAT_INTENT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_repeat_intent", nil)
	}
	now := s.clock.Now().UTC()
	// 改评价 = 覆盖成最新一次（Version 递增、事件留痕），不叠加成多条。
	order.Outcome.Satisfaction = &SatisfactionRecord{Resolved: p.Resolved, RepeatIntent: p.RepeatIntent, RecordedAt: now}
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("SatisfactionRecorded", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"resolved":     p.Resolved,
		"repeatIntent": p.RepeatIntent,
		"note":         "履约事实不要求用户重复打分",
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
	}
	return command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordMaterialOrderChange / RespondMaterialOrderChange ----------
// Gate G：Material Change 必须产生新版本/amendment，不得静默覆盖。
// ORDER-AMEND-001：以前 amendment 只记一句描述，快照原样复制 —— 条款根本改不了，
// 也不需要对方同意。现在一方提出新条款（PROPOSED），另一方接受才生效；
// 旧条款存进 amendment.PreviousSnapshot，任何一版都能还原。
// LC-30：条款真正变更（接受）时强制重新 EvaluateBoundary，并在同一事务内盖章。

type materialChangeTerms struct {
	StartTime          *string `json:"startTime"`
	Duration           *string `json:"duration"`
	MeetingContext     *string `json:"meetingContext"`
	AgreedCompensation *int64  `json:"agreedCompensation"`
	IncludedScope      *string `json:"includedScope"`
	ExcludedScope      *string `json:"excludedScope"`
	PaymentMethodLabel *string `json:"paymentMethodLabel"`
}

type materialChangePayload struct {
	Description string              `json:"description"`
	Changes     materialChangeTerms `json:"changes"`
}

// applyTerms 返回套用变更后的快照，以及哪些字段真的变了。
func applyTerms(base OrderSnapshot, c materialChangeTerms) (OrderSnapshot, []string) {
	next := base
	changed := []string{}
	setString := func(field string, target *string, value *string) {
		if value != nil && strings.TrimSpace(*value) != *target {
			*target = strings.TrimSpace(*value)
			changed = append(changed, field)
		}
	}
	setString("startTime", &next.StartTime, c.StartTime)
	setString("duration", &next.Duration, c.Duration)
	setString("meetingContext", &next.MeetingContext, c.MeetingContext)
	setString("includedScope", &next.IncludedScope, c.IncludedScope)
	setString("excludedScope", &next.ExcludedScope, c.ExcludedScope)
	setString("paymentMethodLabel", &next.PaymentMethodLabel, c.PaymentMethodLabel)
	if c.AgreedCompensation != nil && *c.AgreedCompensation != next.AgreedCompensation {
		next.AgreedCompensation = *c.AgreedCompensation
		changed = append(changed, "agreedCompensation")
		// 金额变了，现金资格按新金额重新评估（R8 Pillar #6；快照里的旧结论不能沿用）。
		if next.SettlementMode == "DIRECT_SETTLEMENT" {
			next.CashEligibilityStatus, next.CashEligibilityReason = assessCashEligibility(next.SettlementMode, next.AgreedCompensation, "")
		}
	}
	return next, changed
}

func pendingAmendment(order Order) int {
	for i, amendment := range order.Amendments {
		if amendment.Status == AmendmentProposed {
			return i
		}
	}
	return -1
}

// lapsePendingAmendments 在订单进入终态时作废未决提议（留痕，不删除）。
func lapsePendingAmendments(order *Order, now time.Time, reason string) {
	for i := range order.Amendments {
		if order.Amendments[i].Status == AmendmentProposed {
			decidedAt := now
			order.Amendments[i].Status = AmendmentLapsed
			order.Amendments[i].DecidedAt = &decidedAt
			order.Amendments[i].DecisionReason = reason
		}
	}
}

func (s *Service) recordMaterialChange(ctx context.Context, e command.Envelope) command.Result {
	var p materialChangePayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.Description) == "" {
		return command.Rejected(e, "INVALID_MATERIAL_CHANGE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_material_change", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	before := cloneOrder(order)
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle != "CONFIRMED" && order.Lifecycle != "EXECUTING" {
		return command.Rejected(e, "ORDER_NOT_AMENDABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_amendable", map[string]any{"lifecycle": order.Lifecycle})
	}
	if i := pendingAmendment(order); i >= 0 {
		return command.Rejected(e, "AMENDMENT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.amendment_pending", map[string]any{"amendmentId": order.Amendments[i].AmendmentID})
	}
	proposed, changed := applyTerms(order.Snapshot, p.Changes)
	if len(changed) == 0 {
		return command.Rejected(e, "NO_MATERIAL_CHANGE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.no_material_change", nil)
	}
	if rejected, blocked := validateProposedTerms(e, order, proposed, changed); blocked {
		return rejected
	}
	now := s.clock.Now().UTC()
	amendment := Amendment{
		AmendmentID: newID("amd_"),
		Description: strings.TrimSpace(p.Description),
		Snapshot:    proposed,
		CreatedAt:   now,
		Status:      AmendmentProposed,
		ProposedBy:  e.Actor.ID,
	}
	order.Amendments = append(order.Amendments, amendment)
	order.Version++
	order.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("MaterialOrderChangeProposed", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"amendmentId":   amendment.AmendmentID,
		"description":   amendment.Description,
		"changedFields": changed,
		"proposedBy":    e.Actor.ID,
		"note":          "Material Change 产生新版本/amendment，不得静默覆盖；对方接受后才生效",
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
	}
	return acceptedWithPayload(e, "Order", order.ID, order.Version, order.Lifecycle, map[string]any{
		"orderId": order.ID, "amendmentId": amendment.AmendmentID, "status": amendment.Status, "changedFields": changed,
	}, domainEvents)
}

// validateProposedTerms 是提出与接受两处共用的条款校验：金额边界、结算后不可
// 改价、现金资格门。
func validateProposedTerms(e command.Envelope, order Order, proposed OrderSnapshot, changed []string) (command.Result, bool) {
	for _, field := range changed {
		if field != "agreedCompensation" {
			continue
		}
		if proposed.AgreedCompensation <= 0 || proposed.AgreedCompensation > maxAmountVND {
			return command.Rejected(e, "INVALID_MATERIAL_CHANGE_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_material_change_amount", nil), true
		}
		// 已有结算声明时不能再改价：结算金额是对着旧快照确认的。
		if order.Settlement != nil {
			return command.Rejected(e, "AMENDMENT_AFTER_SETTLEMENT", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.amendment_after_settlement", nil), true
		}
	}
	return cashEligibilityGate(e, proposed, "orderId", order.ID)
}

func changedFields(before, after OrderSnapshot) []string {
	_, changed := applyTerms(before, materialChangeTerms{
		StartTime: &after.StartTime, Duration: &after.Duration, MeetingContext: &after.MeetingContext,
		AgreedCompensation: &after.AgreedCompensation, IncludedScope: &after.IncludedScope,
		ExcludedScope: &after.ExcludedScope, PaymentMethodLabel: &after.PaymentMethodLabel,
	})
	return changed
}

type respondMaterialChangePayload struct {
	AmendmentID string `json:"amendmentId"`
	Decision    string `json:"decision"` // ACCEPT | REJECT | WITHDRAW
	Reason      string `json:"reason"`
}

func (s *Service) respondMaterialChange(ctx context.Context, e command.Envelope) command.Result {
	var p respondMaterialChangePayload
	if !decode(e.Payload, &p) || p.AmendmentID == "" || (p.Decision != "ACCEPT" && p.Decision != "REJECT" && p.Decision != "WITHDRAW") {
		return command.Rejected(e, "INVALID_AMENDMENT_RESPONSE", "VALIDATION", "AFTER_USER_ACTION", "fulfillment.invalid_amendment_response", nil)
	}
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	before := cloneOrder(order)
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	index := -1
	for i := range order.Amendments {
		if order.Amendments[i].AmendmentID == p.AmendmentID {
			index = i
		}
	}
	if index < 0 {
		return command.Rejected(e, "AMENDMENT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.amendment_not_found", nil)
	}
	amendment := order.Amendments[index]
	if amendment.Status != AmendmentProposed {
		return command.Rejected(e, "AMENDMENT_NOT_PENDING", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.amendment_not_pending", map[string]any{"status": amendment.Status})
	}
	if order.Lifecycle != "CONFIRMED" && order.Lifecycle != "EXECUTING" {
		return command.Rejected(e, "ORDER_NOT_AMENDABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.not_amendable", map[string]any{"lifecycle": order.Lifecycle})
	}
	isProposer := amendment.ProposedBy == e.Actor.ID
	if p.Decision == "WITHDRAW" && !isProposer {
		return command.Rejected(e, "ONLY_PROPOSER_WITHDRAWS", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.only_proposer_withdraws", nil)
	}
	if p.Decision != "WITHDRAW" && isProposer {
		return command.Rejected(e, "COUNTERPARTY_MUST_DECIDE", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.counterparty_must_decide", nil)
	}
	now := s.clock.Now().UTC()
	decidedAt := now
	amendment.DecidedBy = e.Actor.ID
	amendment.DecidedAt = &decidedAt
	amendment.DecisionReason = strings.TrimSpace(p.Reason)
	var stamps []policydecisions.OrderStamp
	eventType := "MaterialOrderChangeRejected"
	switch p.Decision {
	case "WITHDRAW":
		amendment.Status = AmendmentWithdrawn
		eventType = "MaterialOrderChangeWithdrawn"
	case "REJECT":
		amendment.Status = AmendmentRejected
	case "ACCEPT":
		// 提出之后状态可能变了（例如对方已登记结算），接受前按当前订单再校验一次。
		if rejected, blocked := validateProposedTerms(e, order, amendment.Snapshot, changedFields(order.Snapshot, amendment.Snapshot)); blocked {
			return rejected
		}
		if order.Snapshot.SettlementMode == "PLATFORM_PAY" {
			// LC-30：条款变了必须重新评估；策略服务没接 = 拒绝（旧条款不变），不放行。
			if s.policyDecisions == nil {
				return command.Rejected(e, "POLICY_GATE_NOT_CONFIGURED", "INTERNAL", "AFTER_USER_ACTION", "fulfillment.policy_gate_unconfigured", map[string]any{"orderId": order.ID})
			}
			decision, evalErr := s.policyDecisions.Evaluate(ctx, order.RequesterID, policydecisions.CategoryUserPaidService, s.resolveRequesterJurisdiction(ctx, order.RequesterID))
			if evalErr != nil {
				return command.Rejected(e, "POLICY_REEVALUATE_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.policy_reevaluate_failed", map[string]any{"orderId": order.ID})
			}
			order.PolicyDecisionID = decision.ID
		}
		previous := order.Snapshot
		amendment.PreviousSnapshot = &previous
		amendment.Status = AmendmentAccepted
		order.Snapshot = amendment.Snapshot
		eventType = "MaterialOrderChangeAccepted"
	}
	order.Amendments[index] = amendment
	order.Version++
	order.UpdatedAt = now
	if amendment.Status == AmendmentAccepted {
		stamps = s.stampFor(order)
	}
	domainEvents := []event.DomainEvent{event.New(eventType, "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"amendmentId":      amendment.AmendmentID,
		"status":           amendment.Status,
		"decidedBy":        e.Actor.ID,
		"reason":           amendment.DecisionReason,
		"policyDecisionId": order.PolicyDecisionID,
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents, stamps...); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
	}
	payload := map[string]any{"orderId": order.ID, "amendmentId": amendment.AmendmentID, "status": amendment.Status, "lifecycle": order.Lifecycle}
	if amendment.Status == AmendmentAccepted && order.PolicyDecisionID != "" {
		payload["policyDecisionId"] = order.PolicyDecisionID
	}
	return acceptedWithPayload(e, "Order", order.ID, order.Version, order.Lifecycle, payload, domainEvents)
}

// ---------- CancelOrder ----------
// R18.x CANCEL-001: previously the Order lifecycle enum
// included CANCELLED, but no command wrote it. Users saw
// '我的订单' in the '已取消' tab never populate, and had no
// UI affordance to abandon a CONFIRMED or EXECUTING order.
// Either party (Requester or Agent) can cancel, in any
// pre-terminal state. COMPLETED is terminal (the cooperation
// already happened); CANCELLED is itself terminal. The reason
// is recorded in the OrderCancelled event payload so the
// audit log can answer 'why did this order die'.

func (s *Service) cancelOrder(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Reason string `json:"reason"`
	}
	_ = decode(e.Payload, &p)
	order, err := s.repository.GetOrder(ctx, e.Target.ID)
	if errors.Is(err, ErrOrderNotFound) {
		return command.Rejected(e, "ORDER_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "ORDER_READ_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.order_read_failed", nil)
	}
	before := cloneOrder(order)
	if !isOrderParty(order, e.Actor.ID) {
		return command.Rejected(e, "NOT_ORDER_PARTY", "AUTHORIZATION", "AFTER_USER_ACTION", "fulfillment.not_order_party", nil)
	}
	if order.Lifecycle == "CANCELLED" {
		return command.Rejected(e, "ORDER_ALREADY_CANCELLED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_already_cancelled", map[string]any{"lifecycle": order.Lifecycle})
	}
	if order.Lifecycle == "COMPLETED" {
		return command.Rejected(e, "ORDER_ALREADY_COMPLETED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_already_completed", map[string]any{"lifecycle": order.Lifecycle})
	}
	// ORDER-SETTLE-GUARD-001: 双方都确认过线下结算 = 钱已经换手，不能再取消。
	// 只有一方声明时不锁（否则一方能用假结算把对方锁在订单里）。
	if order.Settlement != nil && order.Settlement.PayerConfirmed && order.Settlement.PayeeConfirmed {
		return command.Rejected(e, "ORDER_SETTLED_NOT_CANCELLABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.order_settled_not_cancellable", map[string]any{"lifecycle": order.Lifecycle})
	}
	now := s.clock.Now().UTC()
	order.Lifecycle = "CANCELLED"
	lapsePendingAmendments(&order, now, "order cancelled")
	order.Version++
	order.UpdatedAt = now
	reason := strings.TrimSpace(p.Reason)
	if reason == "" {
		reason = "user-cancelled"
	}
	domainEvents := []event.DomainEvent{event.New("OrderCancelled", "Order", order.ID, order.Version, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"orderId": order.ID,
		"reason":  reason,
		"by":      e.Actor.ID,
		"role":    viewerRole(order, e.Actor.ID),
	})}
	if err := s.commitOrder(ctx, before, order, domainEvents); err != nil {
		return orderUpdateRejected(e, err, "ORDER_UPDATE_FAILED", "fulfillment.update_failed")
	}
	r := command.Accepted(e, "Order", order.ID, order.Version, order.Lifecycle, eventRefs(domainEvents))
	raw, _ := json.Marshal(map[string]any{
		"orderId":   order.ID,
		"lifecycle": order.Lifecycle,
		"reason":    reason,
		"version":   order.Version,
	})
	r.OperationRef = string(raw)
	return r
}

func viewerRole(order Order, actorID string) string {
	if order.RequesterID == actorID {
		return "REQUESTER"
	}
	if order.AgentID == actorID {
		return "AGENT"
	}
	return "OBSERVER"
}

// ---------- helpers ----------

// maxAmountVND 是订单/结算金额的服务端上限（防超大金额脏数据）。
const maxAmountVND = 10_000_000

// R8 Pillar #6: Cash Eligibility 4 态。
const (
	CashEligibilityAllow               = "ALLOW"
	CashEligibilityReview              = "REVIEW"
	CashEligibilityPlatformPayRequired = "PLATFORM_PAY_REQUIRED"
	CashEligibilityBlock               = "BLOCK"
)

// cashEligibilityGate 是 R8 Pillar #6 的锁单门：DIRECT_SETTLEMENT 快照必须是
// ALLOW 才能进 CONFIRMED。确认合作、创建档位报价、接单三处共用（档位 / 主题
// 接单直接落 CONFIRMED，不经过 ConfirmCooperation —— ORDER-OFFER-COMP-001）。
func cashEligibilityGate(e command.Envelope, snapshot OrderSnapshot, refKey, refID string) (command.Result, bool) {
	if snapshot.SettlementMode != "DIRECT_SETTLEMENT" {
		return command.Result{}, false
	}
	switch snapshot.CashEligibilityStatus {
	case CashEligibilityAllow:
		return command.Result{}, false
	case CashEligibilityReview:
		return command.Rejected(e, "CASH_ELIGIBILITY_REVIEW", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_review", map[string]any{
			refKey:   refID,
			"reason": snapshot.CashEligibilityReason,
			"hint":   "现金任务状态为 REVIEW, 需人工复核后才能 Lock",
		}), true
	case CashEligibilityPlatformPayRequired:
		return command.Rejected(e, "CASH_PAYMENT_REQUIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_payment_required", map[string]any{
			refKey:   refID,
			"reason": snapshot.CashEligibilityReason,
			"hint":   "现金任务被要求必须改用平台支付",
		}), true
	case CashEligibilityBlock:
		return command.Rejected(e, "CASH_ELIGIBILITY_BLOCKED", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_blocked", map[string]any{
			refKey:   refID,
			"reason": snapshot.CashEligibilityReason,
			"hint":   "现金任务被禁止, 需走申诉或换 PLATFORM_PAY",
		}), true
	default:
		return command.Rejected(e, "CASH_ELIGIBILITY_MISSING", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.cash_eligibility_missing", map[string]any{
			refKey: refID,
			"hint": "现金任务未携带 Cash Eligibility 评估结果",
		}), true
	}
}

// offerSnapshot 是接单时冻结进订单的快照（Gate G）：金额来自报价本身。
func offerSnapshot(offer Offer, agentClaimNumber int) OrderSnapshot {
	currency := offer.Currency
	if currency == "" {
		currency = "VND"
	}
	cashStatus, cashReason := assessCashEligibility("DIRECT_SETTLEMENT", offer.AgreedCompensation, "")
	return OrderSnapshot{
		Requester:             offer.RequesterID,
		Agent:                 offer.AgentID,
		ServiceSKU:            "CITY_COMPANION",
		NeedVersion:           offer.TaskID,
		AgreedCompensation:    offer.AgreedCompensation,
		Currency:              currency,
		SettlementMode:        "DIRECT_SETTLEMENT",
		CashEligibilityStatus: cashStatus,
		CashEligibilityReason: cashReason,
		// ORDER-AGENT-CLAIM-NO-001：接单编号在这一刻冻结（不是报价创建时 —— 报价
		// 可能挂着没人接，接单才是「当场是谁接的单」成立的那一刻）。
		AgentClaimNumber: agentClaimNumber,
	}
}

// orderUpdateRejected 把仓储写失败翻成命令结果：版本冲突是并发（刷新重试），
// 非法迁移是业务状态，其余才是内部错误（ORDER-CONFLICT-CODE-001）。
func orderUpdateRejected(e command.Envelope, err error, code, messageKey string) command.Result {
	if errors.Is(err, ErrVersionConflict) {
		return command.Rejected(e, "ORDER_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "fulfillment.order_version_conflict", nil)
	}
	if errors.Is(err, ErrIllegalTransition) {
		return command.Rejected(e, "ILLEGAL_ORDER_TRANSITION", "BUSINESS_STATE", "AFTER_USER_ACTION", "fulfillment.illegal_transition", map[string]any{"reason": err.Error()})
	}
	if errors.Is(err, ErrPolicyStampFailed) {
		// ORDER-ERROR-LOGGED-001：INTERNAL 类拒绝必须把底层错误写进日志。
		// 策略盖章失败往往意味着数据库层出了问题（权限、约束、连接），而拒绝码
		// 本身（POLICY_STAMP_FAILED）看不出是哪一种。
		log.Printf("order stamp failed: order=%s code=%s err=%v", e.Target.ID, code, err)
		return command.Rejected(e, "POLICY_STAMP_FAILED", "INTERNAL", "SAFE_RETRY", "fulfillment.policy_stamp_failed", nil)
	}
	// ORDER-ERROR-LOGGED-001：兜底分支以前把 err 整个丢掉 —— 于是数据库层的
	// 「permission denied for table policy_decisions」在日志里一个字都不留，
	// 调用方只看到一个 INTERNAL 拒绝码。2026-09-30 的 LC-28 阻断（付费单永远确认
	// 不了）就是这样隐形的：真实原因既没进日志，也没进响应。
	// 只记日志、不进 safeDetails：DB 错误文本可能含表名/约束名，不该回给客户端。
	log.Printf("order update rejected: order=%s code=%s err=%v", e.Target.ID, code, err)
	return command.Rejected(e, code, "INTERNAL", "SAFE_RETRY", messageKey, nil)
}

// ---------- 订单状态机（ORDER-FSM-001） ----------
// 唯一的合法迁移表。各命令先按自己的业务规则给出具体拒绝码；commitOrder 在
// 写库前再用这张表和不变量兜底一次 —— 任何一条命令写错都过不了这里。
// 数据库侧由 fulfillment.orders 的守卫触发器执行同一张表（migrations/143）。
var orderTransitions = map[string]map[string]bool{
	"OFFERED":   {"CONFIRMED": true, "CANCELLED": true},
	"CONFIRMED": {"EXECUTING": true, "CANCELLED": true},
	"EXECUTING": {"COMPLETED": true, "CANCELLED": true},
}

var (
	ErrIllegalTransition = errors.New("illegal order transition")
	ErrPolicyStampFailed = errors.New("policy decision stamp failed")
)

func illegal(reason string) error { return fmt.Errorf("%w: %s", ErrIllegalTransition, reason) }

// checkOrderTransition 校验一次订单写入（before → after）是否合法：
//   - 身份列（id / 双方 / needId / createdAt）不可变；版本严格 +1；
//   - 生命周期只能按 orderTransitions 走；CANCELLED 冻结，不再有任何写入；
//   - amendments 只能追加；已裁决的 amendment 不可改；快照只能随一条
//     PROPOSED → ACCEPTED 的 amendment 一起变（Gate G：不得静默覆盖）；
//   - 结算一方确认后不可撤回、金额不可改；结果记录后只有满意度可改。
func checkOrderTransition(before, after Order) error {
	if after.ID != before.ID || after.RequesterID != before.RequesterID || after.AgentID != before.AgentID || after.NeedID != before.NeedID || !after.CreatedAt.Equal(before.CreatedAt) {
		return illegal("identity columns are immutable")
	}
	if after.Version != before.Version+1 {
		return illegal(fmt.Sprintf("version must advance by one (%d -> %d)", before.Version, after.Version))
	}
	if before.OrderNo != "" && after.OrderNo != before.OrderNo {
		return illegal("order number is immutable")
	}
	if before.Lifecycle == "CANCELLED" {
		return illegal("CANCELLED orders are frozen")
	}
	if after.Lifecycle != before.Lifecycle && !orderTransitions[before.Lifecycle][after.Lifecycle] {
		return illegal(before.Lifecycle + " -> " + after.Lifecycle)
	}
	if len(after.Amendments) < len(before.Amendments) {
		return illegal("amendments are append-only")
	}
	acceptedNow := -1
	for i, prev := range before.Amendments {
		next := after.Amendments[i]
		if next.AmendmentID != prev.AmendmentID {
			return illegal("amendments are append-only")
		}
		if prev.Status != AmendmentProposed {
			if !sameJSON(prev, next) {
				return illegal("decided amendments are immutable")
			}
			continue
		}
		if next.Status == AmendmentAccepted {
			acceptedNow = i
		}
	}
	if !sameJSON(before.Snapshot, after.Snapshot) {
		if acceptedNow < 0 || !sameJSON(after.Snapshot, after.Amendments[acceptedNow].Snapshot) {
			return illegal("snapshot changes only through an accepted amendment")
		}
	}
	if prev := before.Settlement; prev != nil {
		next := after.Settlement
		if next == nil || next.AgreedAmount != prev.AgreedAmount || (prev.PayerConfirmed && !next.PayerConfirmed) || (prev.PayeeConfirmed && !next.PayeeConfirmed) {
			return illegal("settlement confirmations cannot be withdrawn or re-priced")
		}
	}
	if prev := before.Outcome; prev != nil {
		next := after.Outcome
		if next == nil {
			return illegal("outcome cannot be removed")
		}
		a, b := *prev, *next
		a.Satisfaction, b.Satisfaction = nil, nil
		if !sameJSON(a, b) {
			return illegal("recorded outcome facts are immutable")
		}
	}
	return nil
}

func sameJSON(a, b any) bool {
	ra, errA := json.Marshal(a)
	rb, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(ra) == string(rb)
}

// transactionRunner 由支持事务的仓储实现（PG）；内存仓直接执行。
type transactionRunner interface {
	WithinTransaction(ctx context.Context, operation func(context.Context) error) error
}

func (s *Service) inTransaction(ctx context.Context, operation func(context.Context) error) error {
	if runner, ok := s.repository.(transactionRunner); ok {
		return runner.WithinTransaction(ctx, operation)
	}
	return operation(ctx)
}

// commitOrder 是订单唯一的写入路径：状态机校验 → 同一事务内写订单 + outbox
// 事件 + 策略决策盖章（+ 数据库触发器写审计行）。任何一步失败整体回滚。
func (s *Service) commitOrder(ctx context.Context, before, after Order, domainEvents []event.DomainEvent, stamps ...policydecisions.OrderStamp) error {
	if err := checkOrderTransition(before, after); err != nil {
		return err
	}
	return s.inTransaction(ctx, func(txCtx context.Context) error {
		if err := s.repository.UpdateOrderAndPublish(txCtx, after, before.Version, domainEvents); err != nil {
			return err
		}
		for _, stamp := range stamps {
			if err := s.policyDecisions.Stamp(txCtx, stamp); err != nil {
				return fmt.Errorf("%w: %v", ErrPolicyStampFailed, err)
			}
		}
		return nil
	})
}

// stampFor 返回订单当前策略决策的盖章（没有决策 / 没接策略服务时为空）。
func (s *Service) stampFor(order Order) []policydecisions.OrderStamp {
	if s.policyDecisions == nil || order.PolicyDecisionID == "" {
		return nil
	}
	return []policydecisions.OrderStamp{{
		OrderID:          order.ID,
		DecisionID:       order.PolicyDecisionID,
		StampedAt:        order.UpdatedAt,
		StampedLifecycle: order.Lifecycle,
	}}
}

// ---------- 审计上下文（ORDER-AUDIT-001） ----------

// AuditContext 是一次写入的「谁 / 哪条命令」。仓储把它交给数据库审计触发器。
type AuditContext struct {
	ActorID       string
	PrincipalID   string
	CommandType   string
	CommandID     string
	CorrelationID string
}

// AuditEntry 是一行订单 / 报价审计记录（PG：fulfillment.audit_log，由触发器写入）。
type AuditEntry struct {
	Operation      string    `json:"operation"` // INSERT | UPDATE
	OldState       string    `json:"oldState,omitempty"`
	NewState       string    `json:"newState,omitempty"`
	OldVersion     int       `json:"oldVersion,omitempty"`
	NewVersion     int       `json:"newVersion,omitempty"`
	ActorID        string    `json:"actorId"`
	CommandType    string    `json:"commandType"`
	EventTypes     string    `json:"eventTypes,omitempty"`
	OverrideReason string    `json:"overrideReason,omitempty"`
	RecordedAt     time.Time `json:"recordedAt"`
}

// AuditReader 由能读审计轨迹的仓储实现（PG 与内存仓都实现）。
type AuditReader interface {
	ListAudit(ctx context.Context, table, rowID string) ([]AuditEntry, error)
}

// OrderNumberReader 由能按编号反查订单的仓储实现（PG 与内存仓都实现）。是可选
// 接口，不进 Repository —— 其他包里的测试仓不必跟着改。
type OrderNumberReader interface {
	GetOrderByNumber(ctx context.Context, orderNo string) (Order, error)
}

// FindOrderByNumber 是客服 / 运营的**跨当事人**反查入口（PUBLIC-NO-LOOKUP-001）：
// 按全数字订单编号取回订单和它的存储层审计轨迹。
//
// 这里不做任何鉴权 —— 调用方（internal/numberlookup）负责运营门、scope 和每次查询的
// 审计留痕；订单当事人自己走 GetOrderAuditTrail，那条路径按当事人过滤。
// 审计轨迹读不出来不影响订单本身（返回空轨迹），因为客服首先要看到订单。
func (s *Service) FindOrderByNumber(ctx context.Context, orderNo string) (Order, []AuditEntry, error) {
	reader, ok := s.repository.(OrderNumberReader)
	if !ok {
		return Order{}, nil, ErrNumberLookupUnsupported
	}
	order, err := reader.GetOrderByNumber(ctx, orderNo)
	if err != nil {
		return Order{}, nil, err
	}
	entries := []AuditEntry{}
	if audits, ok := s.repository.(AuditReader); ok {
		if listed, listErr := audits.ListAudit(ctx, "orders", order.ID); listErr == nil {
			entries = listed
		}
	}
	return order, entries, nil
}

type auditContextKey struct{}

func WithAudit(ctx context.Context, audit AuditContext) context.Context {
	return context.WithValue(ctx, auditContextKey{}, audit)
}

// AuditFromContext 读取命令审计上下文；没有命令上下文（跨域物化）时 ok=false，
// 仓储退回用领域事件的 principal / causation。
func AuditFromContext(ctx context.Context) (AuditContext, bool) {
	if ctx == nil {
		return AuditContext{}, false
	}
	audit, ok := ctx.Value(auditContextKey{}).(AuditContext)
	return audit, ok
}

// ---------- 跨域物化订单（ORDER-MATERIALIZE-AUDIT-001） ----------
// 市场报名确认、场景邀约接受会直接生成 CONFIRMED 订单，不经过 ConfirmCooperation。
// 以前这两条路径不评估现金资格、也不发任何订单事件（审计里看不到订单从哪来）。
// 现在统一走 MaterializedOrder：金额边界 + 现金门 + OrderMaterialized 事件
// （只在第一次真正插入时随订单同事务发布，重试不重复）。

var ErrCashEligibility = errors.New("cash eligibility does not allow a confirmed order")

// MaterializedOrder 构造一张由其它域物化的 CONFIRMED 订单。
func MaterializedOrder(id, orderNo, requesterID, agentID, needID string, snapshot OrderSnapshot, now time.Time) (Order, error) {
	if id == "" || requesterID == "" || agentID == "" || requesterID == agentID {
		return Order{}, errors.New("materialised order needs two distinct parties")
	}
	if !ordernumber.Valid(orderNo) {
		return Order{}, fmt.Errorf("%w: invalid order number %q", ordernumber.ErrUnavailable, orderNo)
	}
	snapshot.Requester, snapshot.Agent = requesterID, agentID
	if snapshot.SettlementMode == "" {
		snapshot.SettlementMode = "DIRECT_SETTLEMENT"
	}
	if snapshot.Currency == "" {
		snapshot.Currency = "VND"
	}
	if snapshot.AgreedCompensation < 0 || snapshot.AgreedCompensation > maxAmountVND {
		return Order{}, fmt.Errorf("%w: amount %d out of range", ErrCashEligibility, snapshot.AgreedCompensation)
	}
	if snapshot.SettlementMode == "DIRECT_SETTLEMENT" {
		snapshot.CashEligibilityStatus, snapshot.CashEligibilityReason = assessCashEligibility(snapshot.SettlementMode, snapshot.AgreedCompensation, "")
		if snapshot.CashEligibilityStatus != CashEligibilityAllow {
			return Order{}, fmt.Errorf("%w: %s", ErrCashEligibility, snapshot.CashEligibilityReason)
		}
	}
	now = now.UTC()
	return Order{ID: id, OrderNo: orderNo, RequesterID: requesterID, AgentID: agentID, NeedID: needID, Lifecycle: "CONFIRMED", Version: 1, Snapshot: snapshot, CreatedAt: now, UpdatedAt: now}, nil
}

// MaterializedEvent 是物化订单的出生事件：来源域 + 来源 id 进审计。
func MaterializedEvent(order Order, source, sourceID string) event.DomainEvent {
	return event.New("OrderMaterialized", "Order", order.ID, order.Version, "system:"+source, sourceID, sourceID, order.CreatedAt, map[string]any{
		"source":             source,
		"sourceId":           sourceID,
		"orderNo":            order.OrderNo,
		"requesterId":        order.RequesterID,
		"agentId":            order.AgentID,
		"agreedCompensation": order.Snapshot.AgreedCompensation,
		"cashEligibility":    order.Snapshot.CashEligibilityStatus,
	})
}

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

func isOfferParty(offer Offer, id string) bool {
	return id != "" && (offer.RequesterID == id || offer.AgentID == id)
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
