// Package voucher implements the P0 entitlement lifecycle. Vouchers are not
// wallet value: an issued entitlement can be redeemed only against its scoped
// merchant / Experience / Activity and its redemption and settlement truths
// are deliberately separate facts.
package voucher

import (
	"context"
	"encoding/json"
	"fmt"
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

type Repository interface {
	ListVouchers(ctx context.Context, actorID string) ([]Voucher, error)
	GetVoucher(ctx context.Context, actorID, voucherID string) (*Voucher, bool, error)
	UpsertVoucher(ctx context.Context, actorID string, v Voucher) error
	EnsureDefaults(ctx context.Context, actorID string) error
	ExpireVouchers(ctx context.Context, actorID string, today string) error
	CreateRedemption(ctx context.Context, r Redemption) error
	GetRedemption(ctx context.Context, redemptionID string) (*Redemption, bool, error)
	UpdateRedemption(ctx context.Context, r Redemption) error
}

// Service is currently an in-memory P0 adapter. Its command contract is
// production-shaped (actor scoped, idempotent at the API boundary), so a
// repository can replace this storage without changing the mobile protocol.
type Service struct {
	mu          sync.Mutex
	vouchers    map[string]*Voucher // actor|voucherId -> projection (fallback when repo==nil)
	redemptions map[string]*Redemption
	clock       func() time.Time
	sequence    int
	repo        Repository
}

func New() *Service {
	return &Service{vouchers: make(map[string]*Voucher), redemptions: make(map[string]*Redemption), clock: func() time.Time { return time.Now().UTC() }}
}

func NewWithRepository(repo Repository) *Service {
	return &Service{vouchers: make(map[string]*Voucher), redemptions: make(map[string]*Redemption), clock: func() time.Time { return time.Now().UTC() }, repo: repo}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "ListVouchers", "GetVoucher", "OpenVoucherRedemption", "ConfirmVoucherRedemption", "GetVoucherSettlement", "SettleVoucher", "CreateVoucher":
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
	items := s.listWithContext(ctx, e.Actor.ID)
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
	v, ok := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
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
	v, ok := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
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
		_ = s.repo.CreateRedemption(ctx, *r)
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
		if rr, ok2, _ := s.repo.GetRedemption(ctx, p.RedemptionID); ok2 {
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
	v, ok := s.voucherWithContext(ctx, e.Actor.ID, r.VoucherID)
	if !ok || v.Status != "AVAILABLE" {
		return reject(e, "VOUCHER_NOT_AVAILABLE", "voucher.not_available")
	}
	r.Used = true
	if s.repo != nil {
		_ = s.repo.UpdateRedemption(ctx, *r)
	}
	v.Status, v.Version = "REDEEMED", v.Version+1
	s.upsertWithContext(ctx, e.Actor.ID, *v)
	return accepted(e, "Voucher", v.ID, "REDEEMED", map[string]any{
		"voucher": *v,
		"receipt": map[string]any{"redemptionId": r.ID, "redeemedAt": s.clock().Format(time.RFC3339), "evidenceStatus": "MERCHANT_CONFIRMED"},
	})
}

func (s *Service) settlement(ctx context.Context, e command.Envelope) command.Result {
	var p voucherRef
	if !decode(e.Payload, &p) || p.VoucherID == "" {
		return reject(e, "INVALID_VOUCHER_REF", "voucher.invalid_ref")
	}
	v, ok := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
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
	v, ok := s.voucherWithContext(ctx, e.Actor.ID, p.VoucherID)
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
	return accepted(e, "Voucher", v.ID, "SETTLED", map[string]any{"voucher": *v, "receipt": map[string]any{"settledAt": s.clock().Format(time.RFC3339), "settlementValue": v.SettlementValue}, "notice": "P0 模拟结算已完成；未创建真实支付、可提现余额或商家账本分录。"})
}

func (s *Service) create(ctx context.Context, e command.Envelope) command.Result {
	var p createPayload
	if !decode(e.Payload, &p) || !validFamily(p.Family) || p.DisplayValue <= 0 || p.Quantity <= 0 || p.ScopeName == "" || p.ValidFrom == "" || p.ValidUntil == "" {
		return reject(e, "INVALID_VOUCHER_CREATE", "voucher.invalid_create")
	}
	if p.PerPersonLimit <= 0 {
		p.PerPersonLimit = 1
	}
	s.sequence++
	id := fmt.Sprintf("issued_%s_%d", strings.ToLower(string(p.Family)), s.sequence)
	v := &Voucher{ID: id, Family: p.Family, DisplayValue: p.DisplayValue, Currency: "VND", ScopeName: p.ScopeName, ScopeDetail: p.ScopeDetail, ValidFrom: p.ValidFrom, ValidUntil: p.ValidUntil, RedeemTimeWindow: p.RedeemTimeWindow, MinimumSpend: p.MinimumSpend, PerPersonLimit: p.PerPersonLimit, Status: "AVAILABLE", IssuerLabel: "当前经营主体", SettlementValue: p.DisplayValue * 60 / 100, Funding: Funding{Merchant: p.DisplayValue * 40 / 100, Creator: p.DisplayValue * 10 / 100, Proxy: p.DisplayValue * 10 / 100}, ReservationNeeded: p.Family != Coffee, Version: 1}
	s.upsertWithContext(ctx, e.Actor.ID, *v)
	return accepted(e, "VoucherIssue", id, "ISSUED", map[string]any{"voucher": *v, "issuedQuantity": p.Quantity, "estimatedBudget": p.DisplayValue * p.Quantity, "policy": map[string]bool{"cashConvertible": false, "withdrawable": false, "changeGiven": false, "canBuyVoucher": false, "transferable": false, "resaleAllowed": false}})
}

func (s *Service) ensureDefaults(actorID string) {
	if _, ok := s.vouchers[s.key(actorID, "CV2508210001")]; ok {
		return
	}
	defaults := []Voucher{
		{ID: "CV2508210001", Family: Coffee, DisplayValue: 50000, Currency: "VND", ScopeName: "Cafe A", ScopeDetail: "Bắc Ninh", ValidFrom: "2026-08-21", ValidUntil: "2026-08-31", RedeemTimeWindow: "14:00 – 18:00", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "Cafe A", SettlementValue: 30000, Funding: Funding{Proxy: 10000, Creator: 10000, Merchant: 10000}, Version: 1},
		{ID: "EV2508210001", Family: Experience, DisplayValue: 299000, Currency: "VND", ScopeName: "Rooftop Photo Walk", ScopeDetail: "Hanoi · 60 min", ValidFrom: "2026-08-21", ValidUntil: "2026-09-15", RedeemTimeWindow: "预约后使用", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "Proxy Experience", SettlementValue: 180000, Funding: Funding{Proxy: 59000, Creator: 60000, Merchant: 60000}, ReservationNeeded: true, Version: 1},
		{ID: "AV2508210001", Family: Activity, DisplayValue: 120000, Currency: "VND", ScopeName: "Sunset Yoga", ScopeDetail: "West Lake · Hanoi", ValidFrom: "2026-08-21", ValidUntil: "2026-09-10", RedeemTimeWindow: "活动开始前预约", MinimumSpend: "无", PerPersonLimit: 1, Status: "AVAILABLE", IssuerLabel: "West Lake Studio", SettlementValue: 72000, Funding: Funding{Proxy: 24000, Creator: 24000, Merchant: 24000}, ReservationNeeded: true, Version: 1},
	}
	for i := range defaults {
		copy := defaults[i]
		s.vouchers[s.key(actorID, copy.ID)] = &copy
	}
}

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
		_ = s.repo.EnsureDefaults(ctx, actorID)
		_ = s.repo.ExpireVouchers(ctx, actorID, s.clock().Format("2006-01-02"))
		return
	}
	s.ensureDefaults(actorID)
	s.expire(actorID)
}
func (s *Service) expireWithContext(ctx context.Context, actorID string) {
	if s.repo != nil {
		_ = s.repo.ExpireVouchers(ctx, actorID, s.clock().Format("2006-01-02"))
		return
	}
	s.expire(actorID)
}
func (s *Service) voucher(actorID, id string) (*Voucher, bool) {
	v, ok := s.vouchers[s.key(actorID, id)]
	return v, ok
}
func (s *Service) voucherWithContext(ctx context.Context, actorID, id string) (*Voucher, bool) {
	if s.repo != nil {
		if v, ok, _ := s.repo.GetVoucher(ctx, actorID, id); ok {
			return v, true
		}
		return nil, false
	}
	return s.voucher(actorID, id)
}
func (s *Service) listWithContext(ctx context.Context, actorID string) []Voucher {
	if s.repo != nil {
		if items, err := s.repo.ListVouchers(ctx, actorID); err == nil {
			return items
		}
	}
	items := make([]Voucher, 0)
	for prefix, voucher := range s.vouchers {
		if strings.HasPrefix(prefix, actorID+"|") {
			items = append(items, *voucher)
		}
	}
	return items
}
func (s *Service) upsertWithContext(ctx context.Context, actorID string, v Voucher) {
	if s.repo != nil {
		_ = s.repo.UpsertVoucher(ctx, actorID, v)
	}
	s.vouchers[s.key(actorID, v.ID)] = &v
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
