// MERCHANT-CREATOR-PROMO-001（2026-10-04，用户「带新客应该是专属营销码」）：
// creator 的 UGC 挂自己的专属码（LINH88 这类她自己选的），顾客到店报码拿
// 专属优惠，每一笔报码记到她头上 —— 带没带新客从核销数里数出来，不靠她自己说。
//
// 四节：码（creator 认领，全局唯一）→ 优惠（商家绑定，直减 terms，商家承诺）
// → 报码（店员在商家端输码+金额，落 attribution 行）→ 归因（RESULTS 接数）。
// v1 不碰 voucher 域：券定义没有生效流，优惠由商家在绑定时直接声明
// （跟粉丝数一个性质 —— 商家承诺、平台记录，钱在商家自己的收银台动）。
// 新客识别：报码时店员勾「新客」（顾客自述，平台不核验身份），
// firstVisit 如实存，RESULTS 的新客数就是这么来的 —— 不是扫身份证扫出来的。
package supply

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrPromoCodeNotFound   = errors.New("promo code not found")
	ErrPromoNotBound       = errors.New("promo code not bound by merchant")
	ErrAutoBenefitNotFound = errors.New("auto benefit not set")
)

// promoCodeRe：4–16 位大写字母数字。归一化（去空格转大写）后校验 ——
// linh88 和 LINH88 是同一个码，不许占两次。
var promoCodeRe = regexp.MustCompile(`^[A-Z0-9]{4,16}$`)

func normalizePromoCode(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// maxPromoBenefitVND：单笔报码优惠上限 1,000,000 VND —— 报码减的是商家的钱，
// 上限防手滑多输一个零（真要搞大促走券体系，不走报码）。
const maxPromoBenefitVND = 1_000_000

// PromoCode 是 creator 的专属营销码：全局唯一，归她所有。
type PromoCode struct {
	Code      string    `json:"code"`
	AgentID   string    `json:"agentId"`
	Status    string    `json:"status"` // ACTIVE | DISABLED
	CreatedAt time.Time `json:"createdAt"`
}

// PromoBenefit 是商家对某个码的优惠承诺：直减 faceValueVND，scopeName 写适用范围
// （比如"全场饮品"），validUntil 是 YYYY-MM-DD。同一商家对同一码同时只认一条。
// Source 记这条哪来的：MANUAL（逐个绑）/ AUTO（自动档报码时建的）——
// 账上能分清，商家才知道哪些是自己点的、哪些是自动进来的。
type PromoBenefit struct {
	MerchantID   string    `json:"merchantId"`
	Code         string    `json:"code"`
	FaceValueVND int64     `json:"faceValueVnd"`
	ScopeName    string    `json:"scopeName"`
	ValidUntil   string    `json:"validUntil"`
	Status       string    `json:"status"` // ACTIVE | DISABLED
	Source       string    `json:"source"` // MANUAL | AUTO
	CreatedAt    time.Time `json:"createdAt"`
}

// PromoAutoBenefit 是商家的默认优惠（自动档）：开一次，以后本家没绑过的码
// 来报码，自动按默认建 ACTIVE 绑定再走报码 —— 商家不用逐个码手工绑。
// 关掉只停"以后自动建"，已经建出来的绑定不受影响（要停逐个停）。
type PromoAutoBenefit struct {
	MerchantID   string    `json:"merchantId"`
	Enabled      bool      `json:"enabled"`
	FaceValueVND int64     `json:"faceValueVnd"`
	ScopeName    string    `json:"scopeName"`
	ValidityDays int       `json:"validityDays"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// PromoQuote 是一笔报码归因行：谁（code→agent）在谁家（merchant）什么时候，
// 单子多少钱（amountVND，店员填，不填记 0）、减了多少（discountVND，绑定快照）、
// 是不是新客（firstVisit，店员按顾客自述勾，平台不核验）。
type PromoQuote struct {
	ID          string    `json:"id"`
	MerchantID  string    `json:"merchantId"`
	AgentID     string    `json:"agentId"`
	Code        string    `json:"code"`
	AmountVND   int64     `json:"amountVnd"`
	DiscountVND int64     `json:"discountVnd"`
	FirstVisit  bool      `json:"firstVisit"`
	QuotedAt    time.Time `json:"quotedAt"`
}

// activePromoCodeFor：QuerySuppliers 给商家带码 —— 该 agent 的 ACTIVE 码，
// 没有返回 ""。码是传播物不是秘密，商家可见是设计不是泄漏。
func activePromoCodeFor(ctx context.Context, s *Service, agentID string) string {
	codes, err := s.repository.ListPromoCodesByAgent(ctx, agentID)
	if err != nil {
		return ""
	}
	for _, c := range codes {
		if c.Status == "ACTIVE" {
			return c.Code
		}
	}
	return ""
}

// PromoStats：按码聚合 + 商家合计。attributedVND 是归因 GMV（报码单金额之和，
// 没填金额的不计）；firstVisits 是店员确认新客数；quotes 是报码单数。
type PromoStats struct {
	ByCode map[string]PromoCodeStats `json:"byCode"`
	Quotes int                       `json:"quotes"`
	// 新客（店员确认）：顾客自述首访，平台不核验身份 —— 数是这么来的，不多说。
	FirstVisits      int   `json:"firstVisits"`
	AttributedVND    int64 `json:"attributedVnd"`
	DiscountGivenVND int64 `json:"discountGivenVnd"`
}

type PromoCodeStats struct {
	Quotes           int   `json:"quotes"`
	FirstVisits      int   `json:"firstVisits"`
	AttributedVND    int64 `json:"attributedVnd"`
	DiscountGivenVND int64 `json:"discountGivenVnd"`
}

type claimPromoCodePayload struct {
	Code string `json:"code"`
}

// claimPromoCode：creator 认领自己的专属码。只能认领自己的
// （Principal.ID == agentID，和绑社媒同一口径）；一人同时只持一个 ACTIVE。
func (s *Service) claimPromoCode(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		AgentID string `json:"agentId"`
		Code    string `json:"code"`
	}
	if !decode(e.Payload, &p) || p.AgentID == "" {
		return command.Rejected(e, "INVALID_PROMO_CLAIM", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_claim", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	code := normalizePromoCode(p.Code)
	if !promoCodeRe.MatchString(code) {
		return command.Rejected(e, "INVALID_PROMO_CODE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_code", nil)
	}
	if _, err := s.repository.GetProfile(ctx, p.AgentID); err != nil {
		if errors.Is(err, ErrProfileNotFound) {
			return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
		}
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}
	existing, err := s.repository.GetPromoCode(ctx, code)
	if err != nil && !errors.Is(err, ErrPromoCodeNotFound) {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if err == nil && existing.Status == "ACTIVE" {
		return command.Rejected(e, "PROMO_CODE_TAKEN", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_code_taken", nil)
	}
	mine, err := s.repository.ListPromoCodesByAgent(ctx, p.AgentID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	for _, c := range mine {
		if c.Status == "ACTIVE" {
			return command.Rejected(e, "PROMO_ALREADY_CLAIMED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_already_claimed", nil)
		}
	}
	now := s.clock.Now().UTC()
	promo := PromoCode{Code: code, AgentID: p.AgentID, Status: "ACTIVE", CreatedAt: now}
	if err := s.repository.SavePromoCode(ctx, promo); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("PromoCodeClaimed", "PromoCode", code, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agentId": p.AgentID,
	})}
	return acceptedWithPayload(e, "PromoCode", code, 1, "CLAIMED", map[string]any{"promoCode": promo}, domainEvents)
}

// disablePromoCode：creator 停用自己的码（换码先停旧的，不许同时持两个 ACTIVE）。
func (s *Service) disablePromoCode(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Code string `json:"code"`
	}
	if !decode(e.Payload, &p) || p.Code == "" {
		return command.Rejected(e, "INVALID_PROMO_DISABLE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_disable", nil)
	}
	code := normalizePromoCode(p.Code)
	promo, err := s.repository.GetPromoCode(ctx, code)
	if errors.Is(err, ErrPromoCodeNotFound) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if promo.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	if promo.Status != "ACTIVE" {
		return command.Rejected(e, "PROMO_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_active", nil)
	}
	promo.Status = "DISABLED"
	if err := s.repository.UpdatePromoCode(ctx, promo); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "PromoCode", code, 2, "DISABLED", map[string]any{"promoCode": promo}, nil)
}

type bindPromoBenefitPayload struct {
	Code         string `json:"code"`
	FaceValueVND int64  `json:"faceValueVnd"`
	ScopeName    string `json:"scopeName"`
	ValidUntil   string `json:"validUntil"`
}

// bindPromoBenefit：商家对某个码承诺优惠。merchantID 只读 AuthContext 标注。
// 码必须存在且 ACTIVE（没人认领的码绑了也没意义）；同一商家对同一码同时
// 只认一条 ACTIVE（改优惠先禁旧的）。validUntil 是 YYYY-MM-DD Closed interval。
func (s *Service) bindPromoBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p bindPromoBenefitPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROMO_BENEFIT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_benefit", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	code := normalizePromoCode(p.Code)
	if !promoCodeRe.MatchString(code) {
		return command.Rejected(e, "INVALID_PROMO_CODE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_code", nil)
	}
	promo, err := s.repository.GetPromoCode(ctx, code)
	if errors.Is(err, ErrPromoCodeNotFound) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if promo.Status != "ACTIVE" {
		return command.Rejected(e, "PROMO_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_active", nil)
	}
	if p.FaceValueVND <= 0 || p.FaceValueVND > maxPromoBenefitVND {
		return command.Rejected(e, "INVALID_PROMO_VALUE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_value", nil)
	}
	scope := strings.TrimSpace(p.ScopeName)
	if scope == "" {
		return command.Rejected(e, "INVALID_PROMO_SCOPE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_scope", nil)
	}
	if len(p.ValidUntil) != 10 {
		return command.Rejected(e, "INVALID_PROMO_VALIDITY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_validity", nil)
	}
	now := s.clock.Now().UTC()
	today := now.Format("2006-01-02")
	if p.ValidUntil < today {
		return command.Rejected(e, "INVALID_PROMO_VALIDITY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_validity", nil)
	}
	existing, err := s.repository.ListPromoBenefitsByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	for _, b := range existing {
		if b.Code == code && b.Status == "ACTIVE" {
			return command.Rejected(e, "PROMO_ALREADY_BOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_already_bound", nil)
		}
	}
	benefit := PromoBenefit{
		MerchantID: merchantID, Code: code, FaceValueVND: p.FaceValueVND,
		ScopeName: scope, ValidUntil: p.ValidUntil, Status: "ACTIVE",
		Source: "MANUAL", CreatedAt: now,
	}
	if err := s.repository.SavePromoBenefit(ctx, benefit); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("PromoBenefitBound", "PromoBenefit", merchantID+"/"+code, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "code": code, "faceValueVnd": p.FaceValueVND,
	})}
	return acceptedWithPayload(e, "PromoBenefit", merchantID+"/"+code, 1, "BOUND", map[string]any{"benefit": benefit}, domainEvents)
}

// disablePromoBenefit：商家停自己绑的优惠（改优惠先停旧的）。
func (s *Service) disablePromoBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		Code string `json:"code"`
	}
	if !decode(e.Payload, &p) || p.Code == "" {
		return command.Rejected(e, "INVALID_PROMO_UNBIND", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_unbind", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	code := normalizePromoCode(p.Code)
	benefit, err := s.repository.GetPromoBenefit(ctx, merchantID, code)
	if errors.Is(err, ErrPromoNotBound) {
		return command.Rejected(e, "PROMO_NOT_BOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_bound", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if benefit.Status != "ACTIVE" {
		return command.Rejected(e, "PROMO_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_active", nil)
	}
	benefit.Status = "DISABLED"
	if err := s.repository.UpdatePromoBenefit(ctx, benefit); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "PromoBenefit", merchantID+"/"+code, 2, "DISABLED", map[string]any{"benefit": benefit}, nil)
}

type setAutoPromoBenefitPayload struct {
	Enabled      bool   `json:"enabled"`
	FaceValueVND int64  `json:"faceValueVnd"`
	ScopeName    string `json:"scopeName"`
	ValidityDays int    `json:"validityDays"`
}

// setAutoPromoBenefit：商家设默认优惠（自动档开关）。开着时，本家没绑过的码
// 来报码自动按默认建绑定；关掉只停以后自动建，已经建出来的不受影响。
// validityDays 1..365（默认优惠的有效期从建绑定那天算）。
func (s *Service) setAutoPromoBenefit(ctx context.Context, e command.Envelope) command.Result {
	var p setAutoPromoBenefitPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_AUTO_BENEFIT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_auto_benefit", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	if p.Enabled {
		if p.FaceValueVND <= 0 || p.FaceValueVND > maxPromoBenefitVND {
			return command.Rejected(e, "INVALID_PROMO_VALUE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_value", nil)
		}
		if strings.TrimSpace(p.ScopeName) == "" {
			return command.Rejected(e, "INVALID_PROMO_SCOPE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_scope", nil)
		}
		if p.ValidityDays < 1 || p.ValidityDays > 365 {
			return command.Rejected(e, "INVALID_PROMO_VALIDITY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_validity", nil)
		}
	}
	now := s.clock.Now().UTC()
	auto := PromoAutoBenefit{
		MerchantID: merchantID, Enabled: p.Enabled, FaceValueVND: p.FaceValueVND,
		ScopeName: strings.TrimSpace(p.ScopeName), ValidityDays: p.ValidityDays, UpdatedAt: now,
	}
	if err := s.repository.SaveAutoPromoBenefit(ctx, auto); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "PromoAutoBenefit", merchantID, 1, "SET", map[string]any{"autoBenefit": auto}, nil)
}

// autoBindPromoBenefit：自动档建绑定。默认没设或关着就回 ErrPromoNotBound，
// 调用方原样拒掉（PROMO_NOT_BOUND），和手工没绑一个说法。
func (s *Service) autoBindPromoBenefit(ctx context.Context, merchantID, code string, now time.Time) (PromoBenefit, error) {
	auto, err := s.repository.GetAutoPromoBenefit(ctx, merchantID)
	if err != nil || !auto.Enabled {
		return PromoBenefit{}, ErrPromoNotBound
	}
	benefit := PromoBenefit{
		MerchantID: merchantID, Code: code, FaceValueVND: auto.FaceValueVND,
		ScopeName:  auto.ScopeName,
		ValidUntil: now.AddDate(0, 0, auto.ValidityDays).Format("2006-01-02"),
		Status:     "ACTIVE", Source: "AUTO", CreatedAt: now,
	}
	if err := s.repository.SavePromoBenefit(ctx, benefit); err != nil {
		return PromoBenefit{}, err
	}
	return benefit, nil
}

type quotePromoCodePayload struct {
	Code       string `json:"code"`
	AmountVND  int64  `json:"amountVnd"`
	FirstVisit bool   `json:"firstVisit"`
}

// quotePromoCode：店员在商家端输码报码。merchantID 只读 AuthContext 标注
// （店员以商家身份报，顾客本人报不上来 —— 报码是商家收银动作）。
// 校验：码 ACTIVE + 本家绑定 ACTIVE + 没过期 → 落 attribution 行，
// 返回优惠 terms（店员按这个减钱）。同一码 60 秒内连报两笔算重手，
// 直接拒（DUPLICATE_QUOTE），不是 feature 是防抖。
func (s *Service) quotePromoCode(ctx context.Context, e command.Envelope) command.Result {
	var p quotePromoCodePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROMO_QUOTE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_quote", nil)
	}
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
	}
	code := normalizePromoCode(p.Code)
	if !promoCodeRe.MatchString(code) {
		return command.Rejected(e, "INVALID_PROMO_CODE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_code", nil)
	}
	if p.AmountVND < 0 || p.AmountVND > maxAmountVND {
		return command.Rejected(e, "INVALID_PROMO_AMOUNT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_amount", nil)
	}
	promo, err := s.repository.GetPromoCode(ctx, code)
	if errors.Is(err, ErrPromoCodeNotFound) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if promo.Status != "ACTIVE" {
		return command.Rejected(e, "PROMO_NOT_ACTIVE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_active", nil)
	}
	benefit, err := s.repository.GetPromoBenefit(ctx, merchantID, code)
	if errors.Is(err, ErrPromoNotBound) {
		// 自动档：本家没绑过这个码，但默认优惠开着 —— 按默认建一条
		// ACTIVE 绑定（source=AUTO）再往下走。默认关着就原样拒掉，
		// 不猜商家愿不愿意认这个码。
		benefit, err = s.autoBindPromoBenefit(ctx, merchantID, code, s.clock.Now().UTC())
		if err != nil {
			return command.Rejected(e, "PROMO_NOT_BOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_bound", nil)
		}
	} else if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	if benefit.Status != "ACTIVE" || benefit.ValidUntil < now.Format("2006-01-02") {
		return command.Rejected(e, "PROMO_BENEFIT_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_benefit_expired", nil)
	}
	recent, err := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	for _, q := range recent {
		if q.Code == code && now.Sub(q.QuotedAt) < time.Minute {
			return command.Rejected(e, "DUPLICATE_QUOTE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.duplicate_quote", nil)
		}
	}
	quote := PromoQuote{
		ID: newID("pq_"), MerchantID: merchantID, AgentID: promo.AgentID, Code: code,
		AmountVND: p.AmountVND, DiscountVND: benefit.FaceValueVND, FirstVisit: p.FirstVisit,
		QuotedAt: now,
	}
	if err := s.repository.SavePromoQuote(ctx, quote); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	domainEvents := []event.DomainEvent{event.New("PromoCodeQuoted", "PromoQuote", quote.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": promo.AgentID, "code": code,
		"amountVnd": p.AmountVND, "firstVisit": p.FirstVisit,
	})}
	return acceptedWithPayload(e, "PromoQuote", quote.ID, 1, "QUOTED", map[string]any{
		"quote": quote,
		"benefit": map[string]any{
			"faceValueVnd": benefit.FaceValueVND, "scopeName": benefit.ScopeName,
		},
	}, domainEvents)
}

type promoListPayload struct {
	Role string `json:"role"`
}

// listPromoAssets：my 查我的码（creator，Principal 口径），
// bound 查本家绑的优惠（merchant 标注口径），
// quotes 查本家的报码行（merchant 标注口径）。
func (s *Service) listPromoAssets(ctx context.Context, e command.Envelope) command.Result {
	var p promoListPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROMO_LIST", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_list", nil)
	}
	switch p.Role {
	case "my":
		if e.Principal.ID == "" {
			return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
		}
		codes, err := s.repository.ListPromoCodesByAgent(ctx, e.Principal.ID)
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		if codes == nil {
			codes = []PromoCode{}
		}
		return acceptedWithPayload(e, "PromoCode", e.Principal.ID, 1, "LISTED", map[string]any{"promoCodes": codes}, nil)
	case "bound":
		merchantID := invitationMerchantID(e)
		if merchantID == "" {
			return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
		}
		benefits, err := s.repository.ListPromoBenefitsByMerchant(ctx, merchantID)
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		if benefits == nil {
			benefits = []PromoBenefit{}
		}
		// 自动档配置一起带出来（没设过就是 null，调用方按"没开"处理）。
		auto, err := s.repository.GetAutoPromoBenefit(ctx, merchantID)
		if err != nil && !errors.Is(err, ErrAutoBenefitNotFound) {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		payload := map[string]any{"benefits": benefits}
		if err == nil {
			payload["autoBenefit"] = auto
		}
		return acceptedWithPayload(e, "PromoBenefit", merchantID, 1, "LISTED", payload, nil)
	case "quotes":
		merchantID := invitationMerchantID(e)
		if merchantID == "" {
			return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
		}
		quotes, err := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		if quotes == nil {
			quotes = []PromoQuote{}
		}
		return acceptedWithPayload(e, "PromoQuote", merchantID, 1, "LISTED", map[string]any{"quotes": quotes}, nil)
	default:
		return command.Rejected(e, "INVALID_PROMO_ROLE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_role", nil)
	}
}

// getPromoStats：归因统计。merchant 看本家合计 + 按码拆（战绩榜）；
// creator 看自己的码合计（她带了几单）。第一版只读报码行，不碰订单/券。
func (s *Service) getPromoStats(ctx context.Context, e command.Envelope) command.Result {
	var p promoListPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PROMO_LIST", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_list", nil)
	}
	accumulate := func(quotes []PromoQuote) PromoStats {
		stats := PromoStats{ByCode: map[string]PromoCodeStats{}}
		for _, q := range quotes {
			entry := stats.ByCode[q.Code]
			entry.Quotes++
			if q.FirstVisit {
				entry.FirstVisits++
				stats.FirstVisits++
			}
			entry.AttributedVND += q.AmountVND
			stats.AttributedVND += q.AmountVND
			entry.DiscountGivenVND += q.DiscountVND
			stats.DiscountGivenVND += q.DiscountVND
			stats.Quotes++
			stats.ByCode[q.Code] = entry
		}
		return stats
	}
	switch p.Role {
	case "merchant":
		merchantID := invitationMerchantID(e)
		if merchantID == "" {
			return command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
		}
		quotes, err := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		return acceptedWithPayload(e, "PromoStats", merchantID, 1, "COMPUTED", map[string]any{"stats": accumulate(quotes)}, nil)
	case "mine":
		if e.Principal.ID == "" {
			return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
		}
		quotes, err := s.repository.ListPromoQuotesByAgent(ctx, e.Principal.ID)
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		return acceptedWithPayload(e, "PromoStats", e.Principal.ID, 1, "COMPUTED", map[string]any{"stats": accumulate(quotes)}, nil)
	default:
		return command.Rejected(e, "INVALID_PROMO_ROLE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_role", nil)
	}
}
