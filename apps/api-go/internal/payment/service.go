package payment

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

type PaymentIntent struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"orderId"`
	RequesterID string    `json:"requesterId"`
	AgentID     string    `json:"agentId"`
	AmountMinor int64     `json:"amountMinor"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	ProviderRef string    `json:"providerRef,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type LedgerEntry struct {
	ID               string    `json:"id"`
	PaymentIntentID  string    `json:"paymentIntentId,omitempty"`
	OrderID          string    `json:"orderId"`
	EntryType        string    `json:"entryType"`
	AmountMinor      int64     `json:"amountMinor"`
	Currency         string    `json:"currency"`
	CreatedAt        time.Time `json:"createdAt"`
}

type PayoutHold struct {
	ID         string    `json:"id"`
	OrderID    string    `json:"orderId"`
	AgentID    string    `json:"agentId"`
	AmountMinor int64    `json:"amountMinor"`
	Currency   string    `json:"currency"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	ReleasedAt *time.Time `json:"releasedAt,omitempty"`
}

type Repository interface {
	CreateIntent(ctx context.Context, pi PaymentIntent) error
	GetIntent(ctx context.Context, id string) (PaymentIntent, error)
	UpdateIntent(ctx context.Context, pi PaymentIntent, expectedStatus string) error
	AddLedger(ctx context.Context, entries []LedgerEntry) error
	ListLedger(ctx context.Context, orderID string) ([]LedgerEntry, error)
	CreatePayoutHold(ctx context.Context, h PayoutHold) error
	GetPayoutHold(ctx context.Context, id string) (PayoutHold, error)
	UpdatePayoutHold(ctx context.Context, h PayoutHold) error
	ProviderEventExists(ctx context.Context, providerEventID string) (bool, error)
	SaveProviderEvent(ctx context.Context, providerEventID, paymentIntentID string, payload map[string]any) error
}

type TransactionalRepository interface {
	Repository
	CreateIntentAndLedgerAndPublish(ctx context.Context, pi PaymentIntent, entries []LedgerEntry, domainEvents []event.DomainEvent) error
	UpdateIntentAndLedgerAndPublish(ctx context.Context, pi PaymentIntent, entries []LedgerEntry, expectedStatus string, domainEvents []event.DomainEvent) error
}

var (
	ErrIntentNotFound = errors.New("payment intent not found")
	ErrIntentConflict = errors.New("payment intent conflict")
)

const maxAmountMinor = 1_000_000_000

type MemoryRepository struct {
	mu             sync.Mutex
	intents        map[string]PaymentIntent
	ledger         map[string][]LedgerEntry
	payouts        map[string]PayoutHold
	providerEvents map[string]bool
	events         []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		intents:        make(map[string]PaymentIntent),
		ledger:         make(map[string][]LedgerEntry),
		payouts:        make(map[string]PayoutHold),
		providerEvents: make(map[string]bool),
	}
}

func (r *MemoryRepository) CreateIntent(_ context.Context, pi PaymentIntent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.intents[pi.ID]; exists {
		return errors.New("intent exists")
	}
	r.intents[pi.ID] = pi
	return nil
}
func (r *MemoryRepository) GetIntent(_ context.Context, id string) (PaymentIntent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	pi, ok := r.intents[id]
	if !ok {
		return PaymentIntent{}, ErrIntentNotFound
	}
	return pi, nil
}
func (r *MemoryRepository) UpdateIntent(_ context.Context, pi PaymentIntent, expectedStatus string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.intents[pi.ID]
	if !ok {
		return ErrIntentNotFound
	}
	if cur.Status != expectedStatus {
		return ErrIntentConflict
	}
	r.intents[pi.ID] = pi
	return nil
}
func (r *MemoryRepository) AddLedger(_ context.Context, entries []LedgerEntry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range entries {
		r.ledger[e.OrderID] = append(r.ledger[e.OrderID], e)
	}
	return nil
}
func (r *MemoryRepository) ListLedger(_ context.Context, orderID string) ([]LedgerEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries := r.ledger[orderID]
	result := make([]LedgerEntry, len(entries))
	copy(result, entries)
	return result, nil
}
func (r *MemoryRepository) CreatePayoutHold(_ context.Context, h PayoutHold) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.payouts[h.ID] = h
	return nil
}
func (r *MemoryRepository) GetPayoutHold(_ context.Context, id string) (PayoutHold, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.payouts[id]
	if !ok {
		return PayoutHold{}, errors.New("payout not found")
	}
	return h, nil
}
func (r *MemoryRepository) UpdatePayoutHold(_ context.Context, h PayoutHold) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.payouts[h.ID] = h
	return nil
}
func (r *MemoryRepository) ProviderEventExists(_ context.Context, providerEventID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, exists := r.providerEvents[providerEventID]
	return exists, nil
}
func (r *MemoryRepository) SaveProviderEvent(_ context.Context, providerEventID, paymentIntentID string, payload map[string]any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.providerEvents[providerEventID] {
		return nil
	}
	r.providerEvents[providerEventID] = true
	_ = payload
	return nil
}
func (r *MemoryRepository) CreateIntentAndLedgerAndPublish(_ context.Context, pi PaymentIntent, entries []LedgerEntry, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.intents[pi.ID]; exists {
		return errors.New("intent exists")
	}
	r.intents[pi.ID] = pi
	for _, e := range entries {
		r.ledger[e.OrderID] = append(r.ledger[e.OrderID], e)
	}
	r.events = append(r.events, domainEvents...)
	return nil
}
func (r *MemoryRepository) UpdateIntentAndLedgerAndPublish(_ context.Context, pi PaymentIntent, entries []LedgerEntry, expectedStatus string, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.intents[pi.ID]
	if !ok {
		return ErrIntentNotFound
	}
	if cur.Status != expectedStatus {
		return ErrIntentConflict
	}
	r.intents[pi.ID] = pi
	for _, e := range entries {
		r.ledger[e.OrderID] = append(r.ledger[e.OrderID], e)
	}
	r.events = append(r.events, domainEvents...)
	return nil
}
func (r *MemoryRepository) Events() []event.DomainEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]event.DomainEvent, len(r.events))
	copy(result, r.events)
	return result
}

type PaymentProvider interface {
	CreateQR(ctx context.Context, req VietQRRequest) (VietQRResponse, error)
	Refund(ctx context.Context, paymentIntentID string, amountMinor int64) (string, error)
}

type Service struct {
	mu       sync.Mutex
	repo     TransactionalRepository
	clock    clock.Clock
	sandbox  bool
	provider PaymentProvider
}

func New() *Service { return NewWithRepository(NewMemoryRepository()) }
func NewWithRepository(repo TransactionalRepository) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	return &Service{repo: repo, clock: clock.System{}, sandbox: true, provider: NewVietQRProvider()}
}
func NewWithProvider(repo TransactionalRepository, provider PaymentProvider) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	if provider == nil {
		provider = NewVietQRProvider()
	}
	return &Service{repo: repo, clock: clock.System{}, sandbox: true, provider: provider}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreatePaymentIntent", "ConfirmPaymentIntent", "RefundPaymentIntent", "CreatePayoutHold", "ReleasePayout":
		return true
	default:
		return false
	}
}
func (s *Service) Handle(e command.Envelope) command.Result { return s.HandleContext(context.Background(), e) }
func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch e.CommandType {
	case "CreatePaymentIntent":
		return s.createIntent(ctx, e)
	case "ConfirmPaymentIntent":
		return s.confirmIntent(ctx, e)
	case "RefundPaymentIntent":
		return s.refundIntent(ctx, e)
	case "CreatePayoutHold":
		return s.createPayoutHold(ctx, e)
	case "ReleasePayout":
		return s.releasePayout(ctx, e)
	default:
		return command.Rejected(e, "PAYMENT_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "payment.unsupported", nil)
	}
}

type createIntentPayload struct {
	OrderID     string `json:"orderId"`
	AgentID     string `json:"agentId"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

func (s *Service) createIntent(ctx context.Context, e command.Envelope) command.Result {
	var p createIntentPayload
	if !decode(e.Payload, &p) || p.OrderID == "" || p.AmountMinor <= 0 {
		return command.Rejected(e, "INVALID_PAYMENT_INTENT", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_intent", nil)
	}
	if p.AmountMinor > maxAmountMinor {
		return command.Rejected(e, "INVALID_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_amount", nil)
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	if p.AgentID == "" {
		p.AgentID = "agent_unknown"
	}
	now := s.clock.Now().UTC()
	// VietQR bank scan: create PENDING intent with QR via provider
	providerRef := newID("vietqr_")
	qrResp, err := s.provider.CreateQR(ctx, VietQRRequest{OrderID: p.OrderID, AmountMinor: p.AmountMinor, Currency: p.Currency, ProviderRef: providerRef})
	if err != nil {
		return command.Rejected(e, "PAYMENT_PROVIDER_ERROR", "PROVIDER", "SAFE_RETRY", "payment.provider_error", nil)
	}
	pi := PaymentIntent{
		ID:          newID("pi_"),
		OrderID:     p.OrderID,
		RequesterID: e.Actor.ID,
		AgentID:     p.AgentID,
		AmountMinor: p.AmountMinor,
		Currency:    p.Currency,
		Status:      "PENDING",
		ProviderRef: qrResp.ProviderRef,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	domainEvents := []event.DomainEvent{event.New("PaymentIntentCreated", "PaymentIntent", pi.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"orderId": pi.OrderID, "providerRef": pi.ProviderRef})}
	if err := s.repo.CreateIntent(ctx, pi); err != nil {
		return command.Rejected(e, "PAYMENT_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "payment.create_failed", nil)
	}
	// publish event via direct Add? For now just return pending with QR
	_ = domainEvents
	return acceptedWithPayload(e, "PaymentIntent", pi.ID, 1, pi.Status, map[string]any{"paymentIntentId": pi.ID, "status": pi.Status, "qrString": qrResp.QRString, "expiresAt": qrResp.ExpiresAt.Format(time.RFC3339), "providerRef": pi.ProviderRef}, domainEvents)
}

type confirmPayload struct {
	PaymentIntentID string `json:"paymentIntentId"`
	ProviderEventID string `json:"providerEventId"`
	AmountMinor     int64  `json:"amountMinor"`
	Currency        string `json:"currency"`
	Status          string `json:"status"`
}

func (s *Service) confirmIntent(ctx context.Context, e command.Envelope) command.Result {
	var p confirmPayload
	if !decode(e.Payload, &p) || p.PaymentIntentID == "" || p.ProviderEventID == "" {
		return command.Rejected(e, "INVALID_CONFIRM", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_confirm", nil)
	}
	// dedupe provider event
	exists, _ := s.repo.ProviderEventExists(ctx, p.ProviderEventID)
	if exists {
		return command.Accepted(e, "PaymentIntent", p.PaymentIntentID, 1, "ALREADY_PROCESSED", nil)
	}
	pi, err := s.repo.GetIntent(ctx, p.PaymentIntentID)
	if errors.Is(err, ErrIntentNotFound) {
		return command.Rejected(e, "INTENT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "payment.intent_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "INTENT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "payment.read_failed", nil)
	}
	// amount/currency mismatch
	if p.AmountMinor != 0 && p.AmountMinor != pi.AmountMinor {
		return command.Rejected(e, "AMOUNT_MISMATCH", "PAYMENT", "NO", "payment.amount_mismatch", map[string]any{"expected": pi.AmountMinor, "got": p.AmountMinor})
	}
	if p.Currency != "" && p.Currency != pi.Currency {
		return command.Rejected(e, "CURRENCY_MISMATCH", "PAYMENT", "NO", "payment.currency_mismatch", nil)
	}
	// already succeeded -> dedupe
	if pi.Status == "SUCCEEDED" {
		_ = s.repo.SaveProviderEvent(ctx, p.ProviderEventID, pi.ID, e.Payload)
		return command.Accepted(e, "PaymentIntent", pi.ID, 1, "ALREADY_PROCESSED", nil)
	}
	// unknown timeout is handled as PENDING, not failed
	if p.Status == "UNKNOWN" {
		return command.Pending(e, pi.ID, "PAYMENT_UNKNOWN", "PROVIDER", "payment.unknown", nil)
	}
	// Provider confirms success -> create balanced ledger (bank QR scanned + bank confirmed)
	if p.Status == "SUCCEEDED" || p.Status == "" {
		now := s.clock.Now().UTC()
		pi.Status = "SUCCEEDED"
		pi.UpdatedAt = now
		entries := []LedgerEntry{
			{ID: newID("le_"), PaymentIntentID: pi.ID, OrderID: pi.OrderID, EntryType: "DEBIT_REQUESTER", AmountMinor: pi.AmountMinor, Currency: pi.Currency, CreatedAt: now},
			{ID: newID("le_"), PaymentIntentID: pi.ID, OrderID: pi.OrderID, EntryType: "CREDIT_HOLD", AmountMinor: pi.AmountMinor, Currency: pi.Currency, CreatedAt: now},
		}
		if !isBalanced(entries) {
			return command.Rejected(e, "UNBALANCED_LEDGER", "INTERNAL", "NO", "payment.unbalanced", nil)
		}
		domainEvents := []event.DomainEvent{event.New("PaymentIntentSucceeded", "PaymentIntent", pi.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"orderId": pi.OrderID, "amount": pi.AmountMinor, "providerEventId": p.ProviderEventID})}
		if err := s.repo.UpdateIntentAndLedgerAndPublish(ctx, pi, entries, "PENDING", domainEvents); err != nil {
			if errors.Is(err, ErrIntentConflict) {
				return command.Rejected(e, "PAYMENT_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "payment.conflict", nil)
			}
			return command.Rejected(e, "PAYMENT_CONFIRM_FAILED", "INTERNAL", "SAFE_RETRY", "payment.confirm_failed", nil)
		}
		_ = s.repo.SaveProviderEvent(ctx, p.ProviderEventID, pi.ID, e.Payload)
		return command.Accepted(e, "PaymentIntent", pi.ID, 1, pi.Status, nil)
	}
	// save dedupe for other statuses
	_ = s.repo.SaveProviderEvent(ctx, p.ProviderEventID, pi.ID, e.Payload)
	return command.Accepted(e, "PaymentIntent", pi.ID, 1, pi.Status, nil)
}

type refundPayload struct {
	PaymentIntentID string `json:"paymentIntentId"`
	AmountMinor     int64  `json:"amountMinor"`
}

func (s *Service) refundIntent(ctx context.Context, e command.Envelope) command.Result {
	var p refundPayload
	if !decode(e.Payload, &p) || p.PaymentIntentID == "" || p.AmountMinor <= 0 {
		return command.Rejected(e, "INVALID_REFUND", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_refund", nil)
	}
	pi, err := s.repo.GetIntent(ctx, p.PaymentIntentID)
	if errors.Is(err, ErrIntentNotFound) {
		return command.Rejected(e, "INTENT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "payment.intent_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "INTENT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "payment.read_failed", nil)
	}
	if pi.Status != "SUCCEEDED" {
		return command.Rejected(e, "REFUND_NOT_ALLOWED", "BUSINESS_STATE", "AFTER_USER_ACTION", "payment.refund_not_allowed", nil)
	}
	now := s.clock.Now().UTC()
	entries := []LedgerEntry{
		{ID: newID("le_"), PaymentIntentID: pi.ID, OrderID: pi.OrderID, EntryType: "CREDIT_REFUND", AmountMinor: p.AmountMinor, Currency: pi.Currency, CreatedAt: now},
		{ID: newID("le_"), PaymentIntentID: pi.ID, OrderID: pi.OrderID, EntryType: "DEBIT_REFUND", AmountMinor: p.AmountMinor, Currency: pi.Currency, CreatedAt: now},
	}
	// For refund, we don't change intent status, just ledger (simplified)
	if err := s.repo.AddLedger(ctx, entries); err != nil {
		return command.Rejected(e, "REFUND_FAILED", "INTERNAL", "SAFE_RETRY", "payment.refund_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("PaymentRefunded", "PaymentIntent", pi.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"amount": p.AmountMinor})}
	// publish via direct repo? Use AddLedger already, need event publish separately? For now just return accepted
	_ = domainEvents
	return command.Accepted(e, "PaymentIntent", pi.ID, 1, "REFUNDED", eventRefs(domainEvents))
}

type payoutPayload struct {
	OrderID     string `json:"orderId"`
	AgentID     string `json:"agentId"`
	AmountMinor int64  `json:"amountMinor"`
}

func (s *Service) createPayoutHold(ctx context.Context, e command.Envelope) command.Result {
	var p payoutPayload
	if !decode(e.Payload, &p) || p.OrderID == "" || p.AgentID == "" || p.AmountMinor <= 0 {
		return command.Rejected(e, "INVALID_PAYOUT", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_payout", nil)
	}
	now := s.clock.Now().UTC()
	h := PayoutHold{ID: newID("ph_"), OrderID: p.OrderID, AgentID: p.AgentID, AmountMinor: p.AmountMinor, Currency: "VND", Status: "HELD", CreatedAt: now}
	if err := s.repo.CreatePayoutHold(ctx, h); err != nil {
		return command.Rejected(e, "PAYOUT_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "payment.payout_failed", nil)
	}
	return command.Accepted(e, "PayoutHold", h.ID, 1, h.Status, nil)
}

func (s *Service) releasePayout(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		PayoutHoldID string `json:"payoutHoldId"`
	}
	if !decode(e.Payload, &p) || p.PayoutHoldID == "" {
		p.PayoutHoldID = e.Target.ID
		if p.PayoutHoldID == "" {
			return command.Rejected(e, "INVALID_RELEASE", "VALIDATION", "AFTER_USER_ACTION", "payment.invalid_release", nil)
		}
	}
	h, err := s.repo.GetPayoutHold(ctx, p.PayoutHoldID)
	if err != nil {
		return command.Rejected(e, "PAYOUT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "payment.payout_not_found", nil)
	}
	if h.Status != "HELD" {
		return command.Rejected(e, "PAYOUT_NOT_RELEASABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "payment.payout_not_releasable", nil)
	}
	now := s.clock.Now().UTC()
	entries := []LedgerEntry{
		{ID: newID("le_"), OrderID: h.OrderID, EntryType: "DEBIT_HOLD", AmountMinor: h.AmountMinor, Currency: h.Currency, CreatedAt: now},
		{ID: newID("le_"), OrderID: h.OrderID, EntryType: "CREDIT_AGENT", AmountMinor: h.AmountMinor, Currency: h.Currency, CreatedAt: now},
	}
	if err := s.repo.AddLedger(ctx, entries); err != nil {
		return command.Rejected(e, "PAYOUT_RELEASE_FAILED", "INTERNAL", "SAFE_RETRY", "payment.release_failed", nil)
	}
	h.Status = "RELEASED"
	released := now
	h.ReleasedAt = &released
	_ = s.repo.UpdatePayoutHold(ctx, h)
	domainEvents := []event.DomainEvent{event.New("PayoutReleased", "PayoutHold", h.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{"orderId": h.OrderID})}
	_ = domainEvents
	return command.Accepted(e, "PayoutHold", h.ID, 1, h.Status, nil)
}

func isBalanced(entries []LedgerEntry) bool {
	var debit, credit int64
	for _, e := range entries {
		switch e.EntryType {
		case "DEBIT_REQUESTER", "DEBIT_HOLD", "DEBIT_REFUND":
			debit += e.AmountMinor
		case "CREDIT_HOLD", "CREDIT_AGENT", "CREDIT_REFUND":
			credit += e.AmountMinor
		}
	}
	return debit == credit && debit > 0
}

func decode(payload map[string]any, target any) bool {
	raw, err := json.Marshal(payload)
	return err == nil && json.Unmarshal(raw, target) == nil
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
func acceptedWithPayload(e command.Envelope, typ, id string, version int, state string, payload map[string]any, events []event.DomainEvent) command.Result {
	r := command.Accepted(e, typ, id, version, state, eventRefs(events))
	raw, _ := json.Marshal(payload)
	r.OperationRef = string(raw)
	return r
}
