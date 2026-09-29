// Package wallet 是用户虚拟货币域（WALLET-001）。
//
// 两种货币（整数记账，无小数）：
//   - DIAMOND 钻石：充值获得；买礼物、解锁功能。原型明确“不可提现”——
//     这里没有任何提现/转账命令，结构上就转不出去，不是靠文案保证。
//   - BEAN 金豆：只能兑换钻石/券/特权（原型引用的越南法规口径），同样没有
//     转账/提现命令；来源只有系统发放（签到奖励等桥接）与运营 grant。
//
// 余额不落库：entries 追加写，余额 = SUM(delta)。对账即重放；行只增不改不删
// （用户业务数据不删：取消/退款走冲正分录，不删原行）。
package wallet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

const (
	CurrencyDiamond = "DIAMOND"
	CurrencyBean    = "BEAN"
)

const (
	ReasonRechargeCredit = "RECHARGE_CREDIT"
	ReasonExchangeOut    = "EXCHANGE_OUT"
	ReasonExchangeIn     = "EXCHANGE_IN"
	ReasonGrant          = "GRANT"
	ReasonSpend          = "SPEND"
)

// Entry 是一笔账本分录。Delta 正数为入账、负数为出账。
type Entry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Currency  string    `json:"currency"`
	Delta     int64     `json:"delta"`
	Reason    string    `json:"reason"`
	RefID     string    `json:"refId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// VipGrant 是一段 VIP 有效期。level 不在这里出现——“VIP 3”这种等级没有
// 规则来源，编不出来；客户端只展示是否生效中 + 到期时间。
type VipGrant struct {
	UserID    string    `json:"userId"`
	GrantedAt time.Time `json:"grantedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Active 报告 VIP 是否生效中。
func (g VipGrant) Active(now time.Time) bool {
	return !g.ExpiresAt.IsZero() && now.Before(g.ExpiresAt)
}

// RechargePackage 是服务端下发的充值套餐（客户端不许自定金额档位）。
// 价格单位 VND（分）；bonus 在确认时一并到账。
type RechargePackage struct {
	ID            string `json:"id"`
	Diamonds      int64  `json:"diamonds"`
	BonusDiamonds int64  `json:"bonusDiamonds"`
	PriceVND      int64  `json:"priceVND"`
	Tag           string `json:"tag,omitempty"`
}

// RechargePackages 与原型钱包“热门充值”四档一致。
var RechargePackages = []RechargePackage{
	{ID: "r120", Diamonds: 120, BonusDiamonds: 20, PriceVND: 25000, Tag: "首充"},
	{ID: "r680", Diamonds: 680, BonusDiamonds: 80, PriceVND: 189000},
	{ID: "r3280", Diamonds: 3280, BonusDiamonds: 680, PriceVND: 899000},
	{ID: "r12800", Diamonds: 12800, BonusDiamonds: 3800, PriceVND: 3299000},
}

// Provider 是充值渠道。Enabled=false 的是声明未接入（无商户凭证），
// 客户端置灰，命令层直接拒绝，不存在“点了没反应”。
type Provider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Note    string `json:"note,omitempty"`
	Enabled bool   `json:"enabled"`
}

// ExchangeItem 是一条金豆兑换。voucheru 类兑换需要 campaign 出资池，
// 在出资落定前以 enabled=false 诚实挂出（Voucher 域合规边界，不自造券）。
type ExchangeItem struct {
	ID           string `json:"id"`
	CostBeans    int64  `json:"costBeans"`
	Kind         string `json:"kind"` // DIAMONDS | VIP_DAYS | VOUCHER
	Amount       int64  `json:"amount"`
	Unit         string `json:"unit,omitempty"`
	Enabled      bool   `json:"enabled"`
	DisabledHint string `json:"disabledHint,omitempty"`
}

// ExchangeCatalog 与原型“金豆中心”比率一致：3 豆=1 钻；800 豆=礼物券；
// 5000 豆=VIP 7 天（到期后顺延）。
var ExchangeCatalog = []ExchangeItem{
	{ID: "diamonds_1", CostBeans: 3, Kind: "DIAMONDS", Amount: 1, Unit: "钻石", Enabled: true},
	{ID: "voucher_gift", CostBeans: 800, Kind: "VOUCHER", Amount: 1, Unit: "礼物券", Enabled: false, DisabledHint: "出资券池接入中"},
	{ID: "vip_7d", CostBeans: 5000, Kind: "VIP_DAYS", Amount: 7, Unit: "天", Enabled: true},
}

// CheckinBeans 是活动签到成功奖励的金豆数（政策常量，可调；发放走桥接）。
const CheckinBeans = 20

// Repository 是 wallet 的存储口。余额一律现场 SUM，不设余额列。
type Repository interface {
	AppendEntries(ctx context.Context, entries []Entry) error
	// SpendBeansAtomic 原子扣豆：余额不足返回 ErrInsufficientBeans，
	// 余额够则把 out/in 一批写入（PG 用 advisory 锁，内存用 mutex）。
	SpendBeansAtomic(ctx context.Context, userID string, costBeans int64, out Entry, ins []Entry, vip *VipGrant) error
	Balances(ctx context.Context, userID string) (map[string]int64, error)
	ListEntries(ctx context.Context, userID string, limit int) ([]Entry, error)
	GetVipGrant(ctx context.Context, userID string) (*VipGrant, error)
}

type MemoryRepository struct {
	mu      sync.Mutex
	entries []Entry
	vips    map[string]VipGrant
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{vips: map[string]VipGrant{}}
}

func (r *MemoryRepository) AppendEntries(_ context.Context, entries []Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, entries...)
	return nil
}

func (r *MemoryRepository) SpendBeansAtomic(_ context.Context, userID string, costBeans int64, out Entry, ins []Entry, vip *VipGrant) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var balance int64
	for _, e := range r.entries {
		if e.UserID == userID && e.Currency == CurrencyBean {
			balance += e.Delta
		}
	}
	if balance < costBeans {
		return ErrInsufficientBeans
	}
	r.entries = append(r.entries, out)
	r.entries = append(r.entries, ins...)
	if vip != nil {
		r.vips[userID] = *vip
	}
	return nil
}

func (r *MemoryRepository) Balances(_ context.Context, userID string) (map[string]int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[string]int64{CurrencyDiamond: 0, CurrencyBean: 0}
	for _, e := range r.entries {
		if e.UserID == userID && (e.Currency == CurrencyDiamond || e.Currency == CurrencyBean) {
			out[e.Currency] += e.Delta
		}
	}
	return out, nil
}

func (r *MemoryRepository) ListEntries(_ context.Context, userID string, limit int) ([]Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	out := make([]Entry, 0)
	for i := len(r.entries) - 1; i >= 0 && len(out) < limit; i-- {
		if r.entries[i].UserID == userID {
			out = append(out, r.entries[i])
		}
	}
	return out, nil
}

func (r *MemoryRepository) GetVipGrant(_ context.Context, userID string) (*VipGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if g, ok := r.vips[userID]; ok {
		cp := g
		return &cp, nil
	}
	return nil, nil
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// ErrInsufficientBeans 余额不够（命令层映射成业务码，不是 500；PG 实现
// 返回同一个哨兵，调用方用 == 判断）。
var ErrInsufficientBeans = errors.New("insufficient beans")

// Service 持有可选的时钟（测试注入）和模拟充值开关（环境变量，见 ConfirmRecharge）。
type Service struct {
	repository Repository
	// simulatedRechargeAllowed 为 true 才允许 SIMULATED 渠道（dev 明确打开，
	// 默认关闭；真渠道逐个配置商户凭证后才在 providers() 里置 enabled）。
	simulatedRechargeAllowed bool
	clock                    func() time.Time
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	return &Service{repository: repository, clock: time.Now}
}

// SetSimulatedRecharge 允许 SIMULATED 充值渠道（main.go 只在明确配置时打开）。
func (s *Service) SetSimulatedRecharge(allowed bool) {
	s.simulatedRechargeAllowed = allowed
}

func (s *Service) SetClock(now func() time.Time) {
	s.clock = now
}

func (s *Service) Supports(commandType string) bool {
	// openapi 扫描器只认单行 case "X": 写法（见 openapicmds 注释），多值
	// 一行会被漏掉——宁可啰嗦，不许半接线。
	switch commandType {
	case "GetWallet":
		return true
	case "ListWalletEntries":
		return true
	case "ExchangeBeans":
		return true
	case "ConfirmRecharge":
		return true
	}
	return false
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "GetWallet":
		return s.getWallet(ctx, e)
	case "ListWalletEntries":
		return s.listEntries(ctx, e)
	case "ExchangeBeans":
		return s.exchange(ctx, e)
	case "ConfirmRecharge":
		return s.confirmRecharge(ctx, e)
	}
	return command.Rejected(e, "UNKNOWN_WALLET_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "wallet.unknown_command", nil)
}

func userOf(e command.Envelope) (string, bool) {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return "", false
	}
	return e.Actor.ID, true
}

func (s *Service) providers() []Provider {
	return []Provider{
		{ID: "SIMULATED", Name: "模拟支付", Note: "开发联调", Enabled: s.simulatedRechargeAllowed},
		{ID: "MOMO", Name: "MoMo", Note: "Ví điện tử · 越南本地钱包", Enabled: false},
		{ID: "ZALOPAY", Name: "ZaloPay", Note: "Ví ZaloPay · 越南本地钱包", Enabled: false},
		{ID: "BANKCARD", Name: "银行卡", Note: "Visa / Mastercard / ATM", Enabled: false},
		{ID: "IAP", Name: "应用内购", Note: "App Store / Google Play", Enabled: false},
	}
}

func (s *Service) getWallet(ctx context.Context, e command.Envelope) command.Result {
	userID, ok := userOf(e)
	if !ok {
		return command.Rejected(e, "WALLET_LOGIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "wallet.login_required", nil)
	}
	balances, err := s.repository.Balances(ctx, userID)
	if err != nil {
		return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
	}
	grant, err := s.repository.GetVipGrant(ctx, userID)
	if err != nil {
		return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
	}
	now := s.clock()
	vip := map[string]any{"active": false}
	if grant != nil && grant.Active(now) {
		vip = map[string]any{"active": true, "expiresAt": grant.ExpiresAt.UTC().Format(time.RFC3339)}
	}
	return acceptedWithPayload(e, "Wallet", userID, 1, "WALLET_VIEWED", map[string]any{
		"diamonds":          balances[CurrencyDiamond],
		"beans":             balances[CurrencyBean],
		"vip":               vip,
		"rechargePackages":  RechargePackages,
		"exchangeCatalog":   ExchangeCatalog,
		"providers":         s.providers(),
	}, nil)
}

func (s *Service) listEntries(ctx context.Context, e command.Envelope) command.Result {
	userID, ok := userOf(e)
	if !ok {
		return command.Rejected(e, "WALLET_LOGIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "wallet.login_required", nil)
	}
	var p struct {
		Limit int `json:"limit"`
	}
	decode(e.Payload, &p)
	entries, err := s.repository.ListEntries(ctx, userID, p.Limit)
	if err != nil {
		return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
	}
	if entries == nil {
		entries = []Entry{}
	}
	return acceptedWithPayload(e, "Wallet", userID, 1, "ENTRIES_LISTED", map[string]any{"entries": entries}, nil)
}

func (s *Service) exchange(ctx context.Context, e command.Envelope) command.Result {
	userID, ok := userOf(e)
	if !ok {
		return command.Rejected(e, "WALLET_LOGIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "wallet.login_required", nil)
	}
	var p struct {
		ItemID string `json:"itemId"`
	}
	if !decode(e.Payload, &p) || p.ItemID == "" {
		return command.Rejected(e, "INVALID_EXCHANGE", "VALIDATION", "AFTER_USER_ACTION", "wallet.invalid_exchange", nil)
	}
	var item *ExchangeItem
	for i := range ExchangeCatalog {
		if ExchangeCatalog[i].ID == p.ItemID {
			item = &ExchangeCatalog[i]
			break
		}
	}
	if item == nil || !item.Enabled {
		return command.Rejected(e, "EXCHANGE_UNAVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "wallet.exchange_unavailable", nil)
	}
	now := s.clock()
	out := Entry{ID: newID("we_"), UserID: userID, Currency: CurrencyBean, Delta: -item.CostBeans, Reason: ReasonExchangeOut, RefID: item.ID, CreatedAt: now}
	var ins []Entry
	var vip *VipGrant
	switch item.Kind {
	case "DIAMONDS":
		ins = []Entry{{ID: newID("we_"), UserID: userID, Currency: CurrencyDiamond, Delta: item.Amount, Reason: ReasonExchangeIn, RefID: item.ID, CreatedAt: now}}
	case "VIP_DAYS":
		current, err := s.repository.GetVipGrant(ctx, userID)
		if err != nil {
			return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
		}
		start := now
		if current != nil && current.ExpiresAt.After(now) {
			start = current.ExpiresAt
		}
		vip = &VipGrant{UserID: userID, GrantedAt: now, ExpiresAt: start.AddDate(0, 0, int(item.Amount))}
	default:
		return command.Rejected(e, "EXCHANGE_UNAVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "wallet.exchange_unavailable", nil)
	}
	if err := s.repository.SpendBeansAtomic(ctx, userID, item.CostBeans, out, ins, vip); err != nil {
		if err == ErrInsufficientBeans {
			return command.Rejected(e, "INSUFFICIENT_BEANS", "BUSINESS_STATE", "AFTER_USER_ACTION", "wallet.insufficient_beans", map[string]any{"costBeans": item.CostBeans})
		}
		return command.Rejected(e, "EXCHANGE_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.exchange_failed", nil)
	}
	balances, err := s.repository.Balances(ctx, userID)
	if err != nil {
		return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
	}
	return acceptedWithPayload(e, "Wallet", userID, 1, "EXCHANGED", map[string]any{
		"diamonds": balances[CurrencyDiamond], "beans": balances[CurrencyBean], "itemId": item.ID,
	}, domainEvents(e, userID, now, map[string]any{"itemId": item.ID, "costBeans": item.CostBeans}))
}

func (s *Service) confirmRecharge(ctx context.Context, e command.Envelope) command.Result {
	userID, ok := userOf(e)
	if !ok {
		return command.Rejected(e, "WALLET_LOGIN_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "wallet.login_required", nil)
	}
	var p struct {
		PackageID string `json:"packageId"`
		Provider  string `json:"provider"`
	}
	if !decode(e.Payload, &p) || p.PackageID == "" || p.Provider == "" {
		return command.Rejected(e, "INVALID_RECHARGE", "VALIDATION", "AFTER_USER_ACTION", "wallet.invalid_recharge", nil)
	}
	var pack *RechargePackage
	for i := range RechargePackages {
		if RechargePackages[i].ID == p.PackageID {
			pack = &RechargePackages[i]
			break
		}
	}
	if pack == nil {
		return command.Rejected(e, "INVALID_RECHARGE", "VALIDATION", "AFTER_USER_ACTION", "wallet.invalid_recharge", nil)
	}
	// 真渠道逐个配置商户凭证后才置 enabled；SIMULATED 只在明确打开时可用，
	// 且永远只在开发联调环境打开（main.go 不读生产配置给它开绿灯）。
	if p.Provider == "SIMULATED" && !s.simulatedRechargeAllowed {
		return command.Rejected(e, "PROVIDER_UNCONFIGURED", "BUSINESS_STATE", "AFTER_USER_ACTION", "wallet.provider_unconfigured", map[string]any{"provider": p.Provider})
	}
	if p.Provider != "SIMULATED" {
		return command.Rejected(e, "PROVIDER_UNCONFIGURED", "BUSINESS_STATE", "AFTER_USER_ACTION", "wallet.provider_unconfigured", map[string]any{"provider": p.Provider})
	}
	now := s.clock()
	total := pack.Diamonds + pack.BonusDiamonds
	entry := Entry{ID: newID("we_"), UserID: userID, Currency: CurrencyDiamond, Delta: total, Reason: ReasonRechargeCredit, RefID: pack.ID, CreatedAt: now}
	if err := s.repository.AppendEntries(ctx, []Entry{entry}); err != nil {
		return command.Rejected(e, "RECHARGE_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.recharge_failed", nil)
	}
	balances, err := s.repository.Balances(ctx, userID)
	if err != nil {
		return command.Rejected(e, "WALLET_READ_FAILED", "INTERNAL", "SAFE_RETRY", "wallet.read_failed", nil)
	}
	return acceptedWithPayload(e, "Wallet", userID, 1, "RECHARGED", map[string]any{
		"diamonds": balances[CurrencyDiamond], "beans": balances[CurrencyBean],
		"packageId": pack.ID, "credited": total,
	}, domainEvents(e, userID, now, map[string]any{"packageId": pack.ID, "credited": total, "provider": p.Provider}))
}

// GrantBeans 是系统发放入口（签到奖励等桥接调用，不走命令通道，不设权限面——
// 调用方自己必须是可信的服务端内部调用）。amount 必须为正。
func (s *Service) GrantBeans(ctx context.Context, userID string, amount int64, reason, refID string) error {
	if userID == "" || amount <= 0 || reason == "" {
		return errors.New("grant beans rejected")
	}
	return s.repository.AppendEntries(ctx, []Entry{
		{ID: newID("we_"), UserID: userID, Currency: CurrencyBean, Delta: amount, Reason: reason, RefID: refID, CreatedAt: s.clock()},
	})
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

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func eventRefs(events []event.DomainEvent) []string {
	refs := make([]string, 0, len(events))
	for _, e := range events {
		refs = append(refs, e.EventID)
	}
	return refs
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func domainEvents(e command.Envelope, userID string, now time.Time, payload map[string]any) []event.DomainEvent {
	return []event.DomainEvent{event.New("WalletChanged", "Wallet", userID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, payload)}
}
