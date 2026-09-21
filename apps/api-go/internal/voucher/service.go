// Package voucher implements the P0 entitlement lifecycle. Vouchers are not
// wallet value: an issued entitlement can be redeemed only against its scoped
// merchant / Experience / Activity and its redemption and settlement truths
// are deliberately separate facts.
package voucher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

type Family string

const (
	Coffee     Family = "COFFEE"
	Experience Family = "EXPERIENCE"
	Activity   Family = "ACTIVITY"
)

// Voucher is the consumer-safe entitlement projection. Funding remains a
// separate ledger concern; it is represented here only for issuer estimates.
type Voucher struct {
	ID                string  `json:"voucherId"`
	Family            Family  `json:"family"`
	DisplayValue      int     `json:"displayValue"`
	Currency          string  `json:"currency"`
	ScopeName         string  `json:"scopeName"`
	ScopeDetail       string  `json:"scopeDetail"`
	ValidFrom         string  `json:"validFrom"`
	ValidUntil        string  `json:"validUntil"`
	RedeemTimeWindow  string  `json:"redeemTimeWindow"`
	MinimumSpend      string  `json:"minimumSpend"`
	PerPersonLimit    int     `json:"perPersonLimit"`
	Status            string  `json:"status"` // AVAILABLE | REDEEMED | SETTLED | EXPIRED
	IssuerLabel       string  `json:"issuerLabel,omitempty"`
	SettlementValue   int     `json:"settlementValue"`
	Funding           Funding `json:"funding"`
	ReservationNeeded bool    `json:"reservationNeeded"`
	Version           int     `json:"version"`
}

type Funding struct {
	Proxy    int `json:"proxyFunding"`
	Creator  int `json:"creatorFunding"`
	Merchant int `json:"merchantFunding"`
}

type Redemption struct {
	ID        string
	VoucherID string
	ActorID   string
	Code      string
	ExpiresAt time.Time
	Used      bool
}

type Settlement struct {
	ID        string    `json:"settlementId"`
	VoucherID string    `json:"voucherId"`
	ActorID   string    `json:"actorId"`
	Amount    int       `json:"amount"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"createdAt"`
}

type Repository interface {
	ListVouchers(ctx context.Context, actorID string) ([]Voucher, error)
	GetVoucher(ctx context.Context, actorID, voucherID string) (*Voucher, bool, error)
	UpsertVoucher(ctx context.Context, actorID string, v Voucher) error
	EnsureDefaults(ctx context.Context, actorID string) error
	ExpireVouchers(ctx context.Context, actorID string, today string) error
	CreateRedemption(ctx context.Context, r Redemption) error
	GetRedemption(ctx context.Context, redemptionID string) (*Redemption, bool, error)
	UpdateRedemption(ctx context.Context, r Redemption) error
	CreateSettlement(ctx context.Context, s Settlement) error
	// VOUCHER-ISSUE-001: definitions are merchant-issued (step 1 of the
	// voucher-as-canon chain); reads arrive with step 2 (purchases/instances).
	CreateDefinition(ctx context.Context, d Definition) error
	// VOUCHER-PURCHASE-001: reads arrive with step 2 (order validates the
	// definition, confirm mints atomically).
	GetDefinition(ctx context.Context, id string) (*Definition, bool, error)
	CreatePurchase(ctx context.Context, p Purchase) error
	GetPurchase(ctx context.Context, id string) (*Purchase, bool, error)
	ConfirmPurchaseWithMint(ctx context.Context, purchaseID string, instances []Instance) error
}

// Service is currently an in-memory P0 adapter. Its command contract is
// production-shaped (actor scoped, idempotent at the API boundary), so a
// repository can replace this storage without changing the mobile protocol.
type SettlementCreator interface {
	CreateSettlement(ctx context.Context, voucherID, actorID string, amount int) error
}

type LogSettlementCreator struct{}

func (LogSettlementCreator) CreateSettlement(_ context.Context, voucherID, actorID string, amount int) error {
	log.Printf("voucher settlement: voucher=%s actor=%s amount=%d", voucherID, actorID, amount)
	return nil
}

type Service struct {
	mu                sync.Mutex
	vouchers          map[string]*Voucher // actor|voucherId -> projection (fallback when repo==nil)
	redemptions       map[string]*Redemption
	clock             func() time.Time
	sequence          int
	repo              Repository
	settlementCreator SettlementCreator
	benefitBridge     BenefitBridge
	definitions       map[string]*Definition // VOUCHER-ISSUE-001: in-memory fallback, mirrored to repo
	purchases         map[string]*Purchase   // VOUCHER-PURCHASE-001: same pattern
	instances         map[string]*Instance   // VOUCHER-PURCHASE-001: minted at confirm
}

func New() *Service {
	return &Service{vouchers: make(map[string]*Voucher), redemptions: make(map[string]*Redemption), clock: func() time.Time { return time.Now().UTC() }}
}

func NewWithRepository(repo Repository) *Service {
	return &Service{vouchers: make(map[string]*Voucher), redemptions: make(map[string]*Redemption), clock: func() time.Time { return time.Now().UTC() }, repo: repo}
}

func (s *Service) SetSettlementCreator(c SettlementCreator) { s.settlementCreator = c }

// SetBenefitBridge wires the read-only view onto a user's real,
// merchant-funded benefit.Claim rows (see BenefitBridge). Without this the
// wallet only ever shows whatever this package's own Repository holds,
// which — since VOUCHER-DEFAULTS-001 — is nothing for a brand-new actor.
func (s *Service) SetBenefitBridge(b BenefitBridge) { s.benefitBridge = b }

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "ListVouchers", "GetVoucher", "OpenVoucherRedemption", "ConfirmVoucherRedemption", "GetVoucherSettlement", "SettleVoucher", "CreateVoucher", "IssueVoucherDefinition", "OrderVoucherPurchase", "ConfirmVoucherPurchase":
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
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "VOUCHER_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_REAUTH", "voucher.actor_required", nil)
	}
	s.ensureDefaultsWithContext(ctx, e.Actor.ID)
	s.expireWithContext(ctx, e.Actor.ID)
	switch e.CommandType {
	case "ListVouchers":
		return s.list(ctx, e)
	case "GetVoucher":
		return s.get(ctx, e)
	case "OpenVoucherRedemption":
		return s.openRedemption(ctx, e)
	case "ConfirmVoucherRedemption":
		return s.confirmRedemption(ctx, e)
	case "GetVoucherSettlement":
		return s.settlement(ctx, e)
	case "SettleVoucher":
		return s.settle(ctx, e)
	case "CreateVoucher":
		return s.create(ctx, e)
	case "IssueVoucherDefinition":
		return s.issueDefinition(ctx, e)
	case "OrderVoucherPurchase":
		return s.orderPurchase(ctx, e)
	case "ConfirmVoucherPurchase":
		return s.confirmPurchase(ctx, e)
	default:
		return command.Rejected(e, "VOUCHER_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "voucher.unsupported_command", nil)
	}
}

type voucherRef struct {
	VoucherID string `json:"voucherId"`
}
type redemptionRef struct {
	RedemptionID string `json:"redemptionId"`
}
type createPayload struct {
	Family           Family `json:"family"`
	DisplayValue     int    `json:"displayValue"`
	Quantity         int    `json:"quantity"`
	ValidFrom        string `json:"validFrom"`
	ValidUntil       string `json:"validUntil"`
	ScopeName        string `json:"scopeName"`
	ScopeDetail      string `json:"scopeDetail"`
	RedeemTimeWindow string `json:"redeemTimeWindow"`
	MinimumSpend     string `json:"minimumSpend"`
	PerPersonLimit   int    `json:"perPersonLimit"`
}

func (s *Service) list(ctx context.Context, e command.Envelope) command.Result {
	items, err := s.listWithContext(ctx, e.Actor.ID)
	if err != nil {
		log.Printf("voucher storage: list %s: %v", e.Actor.ID, err)
		return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
	}
	if s.benefitBridge != nil {
		bridged, err := s.benefitBridge.ListWallet(ctx, e.Actor.ID)
		if err != nil {
			log.Printf("voucher benefit bridge: list %s: %v", e.Actor.ID, err)
		} else {
			items = append(items, bridged...)
		}
	}
	// Product order is intentional: the P0 wallet introduces the common
	// Coffee → Experience → Activity families in the same order as the frozen
	// prototype, rather than leaking internal voucher IDs into presentation.
	familyOrder := map[Family]int{Coffee: 0, Experience: 1, Activity: 2}
	sort.Slice(items, func(i, j int) bool {
		if familyOrder[items[i].Family] != familyOrder[items[j].Family] {
			return familyOrder[items[i].Family] < familyOrder[items[j].Family]
		}
		return items[i].ID < items[j].ID
	})
	return accepted(e, "VoucherWallet", e.Actor.ID, "LISTED", map[string]any{
		"vouchers": items,
		"policy":   map[string]bool{"cashConvertible": false, "withdrawable": false, "changeGiven": false, "canBuyVoucher": false, "transferable": false, "resaleAllowed": false},
	})
}

func (s *Service) get(ctx context.Context, e command.Envelope) command.Result {
	var p voucherRef
	if !decode(e.Payload, &p) || p.VoucherID == "" {
		return reject(e, "INVALID_VOUCHER_REF", "voucher.invalid_ref")
	}
	if isBenefitBridgeID(p.VoucherID) {
		if s.benefitBridge == nil {
			return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
		}
		v, ok, err := s.benefitBridge.GetWallet(ctx, e.Actor.ID, p.VoucherID)
		if err != nil {
			log.Printf("voucher benefit bridge: get %s/%s: %v", e.Actor.ID, p.VoucherID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
		if !ok {
			return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
		}
		return accepted(e, "Voucher", v.ID, v.Status, map[string]any{"voucher": *v})
	}
	v, ok, err := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
	if err != nil {
		log.Printf("voucher storage: get %s/%s: %v", e.Actor.ID, p.VoucherID, err)
		return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
	}
	if !ok {
		return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
	}
	return accepted(e, "Voucher", v.ID, v.Status, map[string]any{"voucher": *v})
}

func (s *Service) openRedemption(ctx context.Context, e command.Envelope) command.Result {
	var p voucherRef
	if !decode(e.Payload, &p) || p.VoucherID == "" {
		return reject(e, "INVALID_VOUCHER_REF", "voucher.invalid_ref")
	}
	if isBenefitBridgeID(p.VoucherID) {
		// See BenefitBridge's doc comment: redemption needs a real merchant
		// party in the loop, which this consumer-self-tap flow does not have.
		return reject(e, "VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE", "voucher.merchant_entry_not_available")
	}
	v, ok, err := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
	if err != nil {
		log.Printf("voucher storage: get %s/%s: %v", e.Actor.ID, p.VoucherID, err)
		return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
	}
	if !ok {
		return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
	}
	if v.Status != "AVAILABLE" {
		return reject(e, "VOUCHER_NOT_AVAILABLE", "voucher.not_available")
	}
	s.sequence++
	now := s.clock()
	r := &Redemption{ID: fmt.Sprintf("redemption_%s_%d", v.ID, s.sequence), VoucherID: v.ID, ActorID: e.Actor.ID, Code: fmt.Sprintf("PV-%04d-%02d", now.Unix()%10000, s.sequence%100), ExpiresAt: now.Add(60 * time.Second)}
	if s.repo != nil {
		if err := s.repo.CreateRedemption(ctx, *r); err != nil {
			log.Printf("voucher storage: create redemption %s: %v", r.ID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	}
	s.redemptions[r.ID] = r
	return accepted(e, "VoucherRedemption", r.ID, "ACTIVE", map[string]any{
		"voucher":    *v,
		"redemption": map[string]any{"redemptionId": r.ID, "dynamicCode": r.Code, "expiresAt": r.ExpiresAt.Format(time.RFC3339), "scopeName": v.ScopeName, "status": "ACTIVE"},
		"notice":     "动态凭证仅用于请求商家核销；扫码或展示不等于核销或结算。",
	})
}

func (s *Service) confirmRedemption(ctx context.Context, e command.Envelope) command.Result {
	var p redemptionRef
	if !decode(e.Payload, &p) || p.RedemptionID == "" {
		return reject(e, "INVALID_REDEMPTION_REF", "voucher.invalid_redemption_ref")
	}
	r, ok := s.redemptions[p.RedemptionID]
	if !ok && s.repo != nil {
		rr, ok2, err := s.repo.GetRedemption(ctx, p.RedemptionID)
		if err != nil {
			log.Printf("voucher storage: get redemption %s: %v", p.RedemptionID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
		if ok2 {
			r, ok = rr, true
			// cache for in-memory fallback
			s.redemptions[r.ID] = r
		}
	}
	if !ok || r.ActorID != e.Actor.ID {
		return reject(e, "REDEMPTION_NOT_FOUND", "voucher.redemption_not_found")
	}
	if r.Used {
		return reject(e, "REDEMPTION_ALREADY_USED", "voucher.redemption_already_used")
	}
	if !s.clock().Before(r.ExpiresAt) {
		return reject(e, "REDEMPTION_TOKEN_EXPIRED", "voucher.redemption_token_expired")
	}
	v, ok, _ := s.voucherWithContext(ctx, e.Actor.ID, r.VoucherID)
	if !ok || v.Status != "AVAILABLE" {
		return reject(e, "VOUCHER_NOT_AVAILABLE", "voucher.not_available")
	}
	r.Used = true
	if s.repo != nil {
		if err := s.repo.UpdateRedemption(ctx, *r); err != nil {
			log.Printf("voucher storage: update redemption %s: %v", r.ID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	}
	v.Status, v.Version = "REDEEMED", v.Version+1
	s.upsertWithContext(ctx, e.Actor.ID, *v)
	// VOUCHER-CONFIRM-001: this command is called by the same consumer actor
	// that opened the redemption (see the r.ActorID != e.Actor.ID check
	// above) — no merchant party is ever involved in this call, which is
	// also why the mobile client itself labels the button "模拟商家确认核销"
	// and shows a P0-only disclaimer. The receipt used to claim
	// "evidenceStatus": "MERCHANT_CONFIRMED" anyway, which is false: no
	// merchant identity (see business.Service / benefit.MerchantVerifier
	// for the real pattern) ever confirmed anything here. If this
	// evidenceStatus is ever read by a real settlement/ledger process, a
	// false "MERCHANT_CONFIRMED" could justify a payout nothing merchant-side
	// actually verified. Label it for what it truthfully is until a real
	// merchant-facing confirm surface exists.
	return accepted(e, "Voucher", v.ID, "REDEEMED", map[string]any{
		"voucher": *v,
		"receipt": map[string]any{"redemptionId": r.ID, "redeemedAt": s.clock().Format(time.RFC3339), "evidenceStatus": "SELF_REPORTED_NO_MERCHANT_VERIFICATION"},
		"notice":  "P0 模拟核销：本次确认由用户本人发起，未经任何商家身份核实。",
	})
}

func (s *Service) settlement(ctx context.Context, e command.Envelope) command.Result {
	var p voucherRef
	if !decode(e.Payload, &p) || p.VoucherID == "" {
		return reject(e, "INVALID_VOUCHER_REF", "voucher.invalid_ref")
	}
	var v *Voucher
	var ok bool
	if isBenefitBridgeID(p.VoucherID) {
		// Pure status read, not a self-tap action — safe to bridge. A
		// benefit claim is already either AVAILABLE or SETTLED (see
		// BenefitBridge.project), so this just reports that truthfully.
		if s.benefitBridge == nil {
			return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
		}
		var err error
		v, ok, err = s.benefitBridge.GetWallet(ctx, e.Actor.ID, p.VoucherID)
		if err != nil {
			log.Printf("voucher benefit bridge: settlement %s/%s: %v", e.Actor.ID, p.VoucherID, err)
			return reject(e, "VOUCHER_STORAGE_FAILED", "voucher.storage_failed")
		}
	} else {
		v, ok, _ = s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
	}
	if !ok {
		return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
	}
	settlement := "NOT_ELIGIBLE"
	risk := "NOT_STARTED"
	if v.Status == "REDEEMED" {
		settlement, risk = "PENDING", "CHECKING"
	}
	if v.Status == "SETTLED" {
		settlement, risk = "SETTLED", "PASSED"
	}
	return accepted(e, "Voucher", v.ID, settlement, map[string]any{"voucher": *v, "states": []map[string]string{{"name": "REDEEMED", "status": map[bool]string{true: "COMPLETED", false: "PENDING"}[v.Status == "REDEEMED" || v.Status == "SETTLED"]}, {"name": "RISK_CHECK", "status": risk}, {"name": "SETTLEMENT", "status": settlement}}})
}

func (s *Service) settle(ctx context.Context, e command.Envelope) command.Result {
	var p voucherRef
	if !decode(e.Payload, &p) || p.VoucherID == "" {
		return reject(e, "INVALID_VOUCHER_REF", "voucher.invalid_ref")
	}
	if isBenefitBridgeID(p.VoucherID) {
		// Same self-tap-with-no-merchant concern as openRedemption: benefit
		// already settles atomically inside RedeemBenefit, so there is
		// nothing for this consumer action to do — and it must not report
		// success for something it didn't perform.
		return reject(e, "VOUCHER_MERCHANT_ENTRY_NOT_AVAILABLE", "voucher.merchant_entry_not_available")
	}
	v, ok, _ := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
	if !ok {
		return reject(e, "VOUCHER_NOT_FOUND", "voucher.not_found")
	}
	if v.Status != "REDEEMED" {
		return reject(e, "SETTLEMENT_NOT_ELIGIBLE", "voucher.settlement_not_eligible")
	}
	// This action is intentionally a local P0 simulator. Production settlement
	// is a ledger-worker concern and is never controlled by the consumer UI.
	v.Status, v.Version = "SETTLED", v.Version+1
	s.upsertWithContext(ctx, e.Actor.ID, *v)
	if s.repo != nil {
		_ = s.repo.CreateSettlement(ctx, Settlement{ID: "stl_" + v.ID + "_" + e.Actor.ID, VoucherID: v.ID, ActorID: e.Actor.ID, Amount: v.SettlementValue, Currency: v.Currency, CreatedAt: s.clock()})
	}
	if s.settlementCreator != nil {
		_ = s.settlementCreator.CreateSettlement(ctx, v.ID, e.Actor.ID, v.SettlementValue)
	}
	return accepted(e, "Voucher", v.ID, "SETTLED", map[string]any{"voucher": *v, "receipt": map[string]any{"settledAt": s.clock().Format(time.RFC3339), "settlementValue": v.SettlementValue}, "notice": "P0 模拟结算已完成；未创建真实支付、可提现余额或商家账本分录。"})
}

func (s *Service) create(ctx context.Context, e command.Envelope) command.Result {
	var p createPayload
	if !decode(e.Payload, &p) || !validFamily(p.Family) || p.DisplayValue <= 0 || p.Quantity <= 0 || p.ScopeName == "" || p.ValidFrom == "" || p.ValidUntil == "" {
		return reject(e, "INVALID_VOUCHER_CREATE", "voucher.invalid_create")
	}
	// VOUCHER-FRAUD-001: MaxPerPerson/IsFraudBatch (fraud.go) used to be
	// declared and never called anywhere — a single CreateVoucher call could
	// mint an unbounded batch, and a business could set an arbitrarily high
	// "per person" limit that defeats the point of having one.
	if IsFraudBatch(p.Quantity) {
		return reject(e, "VOUCHER_BATCH_TOO_LARGE", "voucher.batch_too_large")
	}
	if p.PerPersonLimit <= 0 {
		p.PerPersonLimit = 1
	}
	if p.PerPersonLimit > MaxPerPerson {
		return reject(e, "VOUCHER_PER_PERSON_LIMIT_TOO_HIGH", "voucher.per_person_limit_too_high")
	}
	s.sequence++
	id := fmt.Sprintf("issued_%s_%d", strings.ToLower(string(p.Family)), s.sequence)
	v := &Voucher{ID: id, Family: p.Family, DisplayValue: p.DisplayValue, Currency: "VND", ScopeName: p.ScopeName, ScopeDetail: p.ScopeDetail, ValidFrom: p.ValidFrom, ValidUntil: p.ValidUntil, RedeemTimeWindow: p.RedeemTimeWindow, MinimumSpend: p.MinimumSpend, PerPersonLimit: p.PerPersonLimit, Status: "AVAILABLE", IssuerLabel: "当前经营主体", SettlementValue: p.DisplayValue * 60 / 100, Funding: Funding{Merchant: p.DisplayValue * 40 / 100, Creator: p.DisplayValue * 10 / 100, Proxy: p.DisplayValue * 10 / 100}, ReservationNeeded: p.Family != Coffee, Version: 1}
	s.upsertWithContext(ctx, e.Actor.ID, *v)
	return accepted(e, "VoucherIssue", id, "ISSUED", map[string]any{"voucher": *v, "issuedQuantity": p.Quantity, "estimatedBudget": p.DisplayValue * p.Quantity, "policy": map[string]bool{"cashConvertible": false, "withdrawable": false, "changeGiven": false, "canBuyVoucher": false, "transferable": false, "resaleAllowed": false}})
}

// VOUCHER-DEFAULTS-001 (2026-09-20): this used to unconditionally hand every
// actor 3 free vouchers (coffee/experience/activity) the first time they
// were seen — no merchant ever agreed to fund them, no campaign, no
// eligibility check, no budget. That is exactly the "platform gives away
// merchant-funded value without a Merchant Benefit Agreement" pattern
// flagged in the compliance review (Vietnam Nghị định 239/2026, Luật
// Thương mại điện tử 122/2025). Real issuance belongs to the benefit
// package (Campaign -> Claim -> Redemption -> Settlement, already wired to
// Postgres — see cmd/api/main.go); wiring this package's wallet to that
// pipeline is a separate, deliberately deferred task. This is intentionally
// a no-op in the meantime — not dead code to be deleted, but the documented
// boundary of what this package is still allowed to grant on its own.
// Existing already-issued rows are left untouched; only the unconditional
// future grant is turned off.
func (s *Service) ensureDefaults(_ string) {}

func (s *Service) expire(actorID string) {
	today := s.clock().Format("2006-01-02")
	for key, v := range s.vouchers {
		if strings.HasPrefix(key, actorID+"|") && v.Status == "AVAILABLE" && v.ValidUntil < today {
			v.Status, v.Version = "EXPIRED", v.Version+1
		}
	}
}
func (s *Service) ensureDefaultsWithContext(ctx context.Context, actorID string) {
	if s.repo != nil {
		if err := s.repo.EnsureDefaults(ctx, actorID); err != nil {
			log.Printf("voucher storage: ensure defaults %s: %v", actorID, err)
		}
		if err := s.repo.ExpireVouchers(ctx, actorID, s.clock().Format("2006-01-02")); err != nil {
			log.Printf("voucher storage: expire %s: %v", actorID, err)
		}
		return
	}
	s.ensureDefaults(actorID)
	s.expire(actorID)
}
func (s *Service) expireWithContext(ctx context.Context, actorID string) {
	if s.repo != nil {
		if err := s.repo.ExpireVouchers(ctx, actorID, s.clock().Format("2006-01-02")); err != nil {
			log.Printf("voucher storage: expire %s: %v", actorID, err)
		}
		return
	}
	s.expire(actorID)
}
func (s *Service) voucher(actorID, id string) (*Voucher, bool) {
	v, ok := s.vouchers[s.key(actorID, id)]
	return v, ok
}
func (s *Service) voucherWithContext(ctx context.Context, actorID, id string) (*Voucher, bool, error) {
	if s.repo != nil {
		return s.repo.GetVoucher(ctx, actorID, id)
	}
	v, ok := s.voucher(actorID, id)
	return v, ok, nil
}
func (s *Service) listWithContext(ctx context.Context, actorID string) ([]Voucher, error) {
	if s.repo != nil {
		return s.repo.ListVouchers(ctx, actorID)
	}
	items := make([]Voucher, 0)
	for prefix, voucher := range s.vouchers {
		if strings.HasPrefix(prefix, actorID+"|") {
			items = append(items, *voucher)
		}
	}
	return items, nil
}
func (s *Service) upsertWithContext(ctx context.Context, actorID string, v Voucher) error {
	if s.repo != nil {
		if err := s.repo.UpsertVoucher(ctx, actorID, v); err != nil {
			return err
		}
	}
	s.vouchers[s.key(actorID, v.ID)] = &v
	return nil
}
func (s *Service) key(actorID, id string) string { return actorID + "|" + id }
func validFamily(f Family) bool                  { return f == Coffee || f == Experience || f == Activity }
func decode(input map[string]any, target any) bool {
	raw, err := json.Marshal(input)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func reject(e command.Envelope, code, key string) command.Result {
	return command.Rejected(e, code, "BUSINESS_STATE", "AFTER_USER_ACTION", key, nil)
}
func accepted(e command.Envelope, aggregateType, aggregateID, state string, payload map[string]any) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, 1, state, nil)
	raw, _ := json.Marshal(payload)
	result.OperationRef = string(raw)
	return result
}
