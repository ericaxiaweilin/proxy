// MERCHANT-CREATOR-PROMO-002（2026-10-04，用户：「给所有 creator-商家开发一套专属优惠码系统，
// 对于 n 商家 n creator 开发专属唯一的优惠码，有利于激励，让 creator 商家成长，而不是简单的
// 满 x 减 y」；原型 docs/design/references/Proxy_Creator_Promo_20261004_bc214e.html）。
//
// PROMO-001 的模型是「creator 一个全局码，所有商家对它绑优惠」—— 同一个码在 A 店和 B 店是
// 同一串字，分不清是哪家店给她的、也没法按店激励。这里改成**一对（商家, creator）一个唯一码**
// （AN-WORKSHOP = An 在 Workshop 这家店的专属码），码本身就说明是谁给谁：
//
//	发码    商家给某个 creator 生成专属码，条款由系统按真实数据建议（粉丝量级 / 内容垂直度 /
//	        她带来顾客的复购率 / 同品类平均折扣 / 本店客单价），没有数据的维度如实说「暂无」。
//	调整    商家可以逐个 creator 改折扣（模板或手填），每次改动留痕（改前 / 改后 / 原因）。
//	发券    顾客扫 creator 的专属码领券（每人每码一张）—— 这是「发券」数的唯一来源。
//	核销    店员扫顾客的券或输码核销；码必须是本店的；门槛不够不减。顾客有身份时「新客」由
//	        系统判定（在本店没核销过），匿名码核销才用店员勾选。
//	战绩    每个码：发券 / 核销 / 新客 / 消费；整店合计 + 核销转化率（凭券核销 / 发券）。
//
// PROMO-001 的 creator 全局码保留：生成专属码时优先用它做前缀（creator 认领的 LINH88 →
// LINH88-WORKSHOP），保证 creator 的「品牌」在各家店的码里一致。
package supply

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

var (
	ErrPairPromoNotFound  = errors.New("merchant creator promo not found")
	ErrPromoIssueNotFound = errors.New("promo coupon not found")
	ErrPromoAlreadyIssued = errors.New("promo coupon already issued to this customer")
	// ErrCouponAlreadyRedeemed：同一张券并发核销两次，存储层的唯一约束兜底时返回。
	ErrCouponAlreadyRedeemed = errors.New("promo coupon already redeemed")
	errPairCodeUnavailable   = errors.New("no free pair code")
)

// 专属码：creator 段 2–10 位 + "-" + 店段 2–10 位（+ 撞码时的 -2…-9）。
var pairCodeRe = regexp.MustCompile(`^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}(-[2-9])?$`)

const (
	PromoScopeCategory = "STORE_CATEGORY" // 仅本店 · 某品类
	PromoScopeAll      = "STORE_ALL"      // 本店全部品类
	PromoModeSuggested = "SUGGESTED"
	PromoModeManual    = "MANUAL"
	// 本店客单价没有数据时用来定门槛的参考值（会在依据里如实标「暂无数据，按 50 万估」）。
	defaultTicketVND = 500_000
)

// PromoTerms 是一张专属券的条款。ValidUntil 为空 = 长期有效。
type PromoTerms struct {
	MinSpendVND  int64  `json:"minSpendVnd"`
	FaceValueVND int64  `json:"faceValueVnd"`
	DisplayText  string `json:"displayText"`
	Scope        string `json:"scope"`
	Category     string `json:"category,omitempty"`
	ValidUntil   string `json:"validUntil"`
}

// PromoBasisItem 是系统建议的一条依据。Available=false 时 Value 说明为什么没有数据 ——
// 不拿默认值冒充真实读数（商家看到「1.2w 粉丝」就会当真）。
type PromoBasisItem struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Value     string `json:"value"`
	Available bool   `json:"available"`
	// 这一项对建议折扣的影响（百分点 × 100，可负）。没数据的项是 0。
	EffectBP int `json:"effectBp"`
}

// PromoSuggestion 是系统建议：折扣率（基点，1000 = 10%）+ 换算出的门槛 / 面额 + 依据。
type PromoSuggestion struct {
	PercentBP    int              `json:"percentBp"`
	MinSpendVND  int64            `json:"minSpendVnd"`
	FaceValueVND int64            `json:"faceValueVnd"`
	Basis        []PromoBasisItem `json:"basis"`
	ComputedAt   time.Time        `json:"computedAt"`
}

// MerchantCreatorPromo 是一对（商家, creator）的专属码。
type MerchantCreatorPromo struct {
	Code         string          `json:"code"`
	MerchantID   string          `json:"merchantId"`
	MerchantName string          `json:"merchantName"`
	AgentID      string          `json:"agentId"`
	CreatorName  string          `json:"creatorName"`
	Terms        PromoTerms      `json:"terms"`
	Status       string          `json:"status"` // ACTIVE | DISABLED
	Mode         string          `json:"mode"`   // SUGGESTED | MANUAL
	Suggestion   PromoSuggestion `json:"suggestion"`
	Note         string          `json:"note,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
	// IssuedByPrincipalID 是发这条专属码的商家成员 user account id（migration 175）。
	// 存在的理由是**收件人**：creator 报码那一刻在场的是 creator，要通知的是
	// 商家 —— 而商家成员列表可能有多个，通知「随便哪个」比不通知更糟。
	IssuedByPrincipalID string `json:"-"`
}

// PromoChange 是一次条款调整的留痕（原型「记录留痕，方便团队回看」）。只增不改。
type PromoChange struct {
	ID        string     `json:"id"`
	Code      string     `json:"code"`
	ActorID   string     `json:"actorId"`
	Before    PromoTerms `json:"before"`
	After     PromoTerms `json:"after"`
	Mode      string     `json:"mode"`
	Note      string     `json:"note,omitempty"`
	ChangedAt time.Time  `json:"changedAt"`
}

// PromoIssue 是顾客领到的一张券（发券）。每人每码一张。
type PromoIssue struct {
	ID         string    `json:"couponId"`
	Code       string    `json:"code"`
	MerchantID string    `json:"merchantId"`
	AgentID    string    `json:"agentId"`
	CustomerID string    `json:"customerId"`
	IssuedAt   time.Time `json:"issuedAt"`
}

// PairPromoStats 是一个专属码（或整店）的战绩。
type PairPromoStats struct {
	Issued       int   `json:"issued"`       // 发券
	Redeemed     int   `json:"redeemed"`     // 核销（含匿名输码）
	CouponRedeem int   `json:"couponRedeem"` // 凭券核销（转化率的分子）
	NewCustomers int   `json:"newCustomers"` // 新客
	SpendVND     int64 `json:"spendVnd"`     // 消费（核销单金额之和）
	DiscountVND  int64 `json:"discountVnd"`  // 让利
}

// ConversionBP：核销转化率（基点）= 凭券核销 / 发券。没发过券是 -1（没有分母，不写 0%）。
func (s PairPromoStats) ConversionBP() int {
	if s.Issued == 0 {
		return -1
	}
	return s.CouponRedeem * 10000 / s.Issued
}

// ---------------------------------------------------------------- 码生成

// asciiSlug 把名字压成大写字母数字：去越南语 / 中文以外的变音符（Quỳnh → QUYNH），
// 非 ASCII 字母数字丢掉。
func asciiSlug(raw string, max int) string {
	decomposed := norm.NFD.String(strings.ReplaceAll(strings.ReplaceAll(raw, "đ", "d"), "Đ", "D"))
	var b strings.Builder
	for _, r := range decomposed {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(unicode.ToUpper(r))
		}
		if b.Len() >= max {
			break
		}
	}
	return b.String()
}

func (s *Service) pairCodeFor(ctx context.Context, agentID, creatorName, merchantID, merchantName string) (string, error) {
	creatorPart := ""
	if own := activePromoCodeFor(ctx, s, agentID); own != "" {
		creatorPart = asciiSlug(own, 10)
	}
	if len(creatorPart) < 2 {
		creatorPart = asciiSlug(creatorName, 10)
	}
	if len(creatorPart) < 2 {
		creatorPart = asciiSlug(strings.TrimPrefix(agentID, "agent_"), 6)
	}
	shopPart := asciiSlug(merchantName, 10)
	if len(shopPart) < 2 {
		shopPart = asciiSlug(strings.TrimPrefix(merchantID, "merchant_"), 6)
	}
	if len(creatorPart) < 2 || len(shopPart) < 2 {
		return "", errPairCodeUnavailable
	}
	base := creatorPart + "-" + shopPart
	for i := 1; i <= 9; i++ {
		code := base
		if i > 1 {
			code = fmt.Sprintf("%s-%d", base, i)
		}
		if _, err := s.repository.GetMerchantCreatorPromo(ctx, code); errors.Is(err, ErrPairPromoNotFound) {
			return code, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", errPairCodeUnavailable
}

// ---------------------------------------------------------------- 系统建议

// SuggestionInput 是算建议用的真实读数；nil / 0 表示没有数据。
type SuggestionInput struct {
	Followers      int64    // creator 各社媒自填粉丝数的最大值；0 = 没披露
	VerticalMatch  *bool    // creator 垂类是否覆盖本店品类；nil = 有一方没填
	RepurchaseRate *float64 // 她带来的可识别顾客里，核销过 ≥2 次的占比；nil = 样本不足
	RepurchaseN    int
	CategoryAvgBP  *int  // 同品类其他店专属码的平均折扣；nil = 没有同行样本
	CategoryN      int   //
	AvgTicketVND   int64 // 本店核销单平均金额；0 = 样本不足
	Category       string
}

func roundTo(v, step int64) int64 {
	if step <= 0 {
		return v
	}
	return int64(math.Round(float64(v)/float64(step))) * step
}

func formatWan(v int64) string {
	if v >= 10_000 && v%10_000 == 0 {
		return fmt.Sprintf("%d万", v/10_000)
	}
	if v >= 10_000 {
		return fmt.Sprintf("%.1f万", float64(v)/10_000)
	}
	return fmt.Sprintf("%d", v)
}

// DefaultDisplayText：「满50万减10万」/「无门槛减5万」。
func DefaultDisplayText(minSpend, face int64) string {
	if minSpend <= 0 {
		return "无门槛减" + formatWan(face)
	}
	return "满" + formatWan(minSpend) + "减" + formatWan(face)
}

// SuggestPromo：基准 8%，按依据加减，再和同品类平均对半折中，夹在 5%–20%。
// 门槛 = 本店客单价（取整到 5 万，至少 10 万；没数据按 50 万）；面额 = 门槛 × 折扣（取整到 1 万）。
func SuggestPromo(in SuggestionInput, now time.Time) PromoSuggestion {
	pct := 800
	basis := []PromoBasisItem{}

	followers := PromoBasisItem{Key: "followers", Label: "粉丝量级"}
	switch {
	case in.Followers <= 0:
		followers.Value = "未披露粉丝数"
	case in.Followers < 5_000:
		followers.Value, followers.Available = fmt.Sprintf("%s（素人 / 尾部）", formatWan(in.Followers)), true
	case in.Followers < 50_000:
		followers.Value, followers.Available, followers.EffectBP = fmt.Sprintf("%s（中腰部）", formatFollowers(in.Followers)), true, 100
	case in.Followers < 200_000:
		followers.Value, followers.Available, followers.EffectBP = fmt.Sprintf("%s（头部）", formatFollowers(in.Followers)), true, 200
	default:
		followers.Value, followers.Available, followers.EffectBP = fmt.Sprintf("%s（大 V）", formatFollowers(in.Followers)), true, 300
	}
	basis = append(basis, followers)

	vertical := PromoBasisItem{Key: "vertical", Label: "内容垂直度"}
	switch {
	case in.VerticalMatch == nil:
		vertical.Value = "她或本店没填品类"
	case *in.VerticalMatch:
		vertical.Value, vertical.Available, vertical.EffectBP = "垂类覆盖"+in.Category, true, 100
	default:
		vertical.Value, vertical.Available = "垂类不含"+in.Category, true
	}
	basis = append(basis, vertical)

	repurchase := PromoBasisItem{Key: "repurchase", Label: "历史复购率"}
	if in.RepurchaseRate == nil {
		repurchase.Value = fmt.Sprintf("样本不足（%d 位可识别顾客，需 ≥5）", in.RepurchaseN)
	} else {
		r := *in.RepurchaseRate
		repurchase.Value, repurchase.Available = fmt.Sprintf("%.0f%%（%d 位顾客）", r*100, in.RepurchaseN), true
		switch {
		case r >= 0.30:
			repurchase.EffectBP = 100
		case r < 0.10:
			repurchase.EffectBP = -100
		}
	}
	basis = append(basis, repurchase)

	for _, b := range basis {
		pct += b.EffectBP
	}

	category := PromoBasisItem{Key: "category_avg", Label: "同品类平均折扣"}
	if in.CategoryAvgBP == nil {
		category.Value = "暂无同品类样本"
	} else {
		category.Value, category.Available = fmt.Sprintf("%.1f%%（%d 家店）", float64(*in.CategoryAvgBP)/100, in.CategoryN), true
		blended := (pct + *in.CategoryAvgBP) / 2
		category.EffectBP = blended - pct
		pct = blended
	}
	basis = append(basis, category)

	if pct < 500 {
		pct = 500
	}
	if pct > 2000 {
		pct = 2000
	}

	ticket := PromoBasisItem{Key: "avg_ticket", Label: "本店客单价"}
	threshold := int64(defaultTicketVND)
	if in.AvgTicketVND > 0 {
		threshold = roundTo(in.AvgTicketVND, 50_000)
		if threshold < 100_000 {
			threshold = 100_000
		}
		ticket.Value, ticket.Available = formatWan(in.AvgTicketVND)+" VND（门槛按它取整）", true
	} else {
		ticket.Value = "样本不足，门槛按 50万 估"
	}
	basis = append(basis, ticket)

	face := roundTo(threshold*int64(pct)/10000, 10_000)
	if face < 10_000 {
		face = 10_000
	}
	if face > maxPromoBenefitVND {
		face = maxPromoBenefitVND
	}
	return PromoSuggestion{PercentBP: pct, MinSpendVND: threshold, FaceValueVND: face, Basis: basis, ComputedAt: now}
}

func formatFollowers(n int64) string {
	if n >= 10_000 {
		return fmt.Sprintf("%.1fw", float64(n)/10_000)
	}
	return fmt.Sprintf("%d", n)
}

func pctOfTerms(t PromoTerms, avgTicket int64) (int, bool) {
	base := t.MinSpendVND
	if base <= 0 {
		base = avgTicket
	}
	if base <= 0 || t.FaceValueVND <= 0 {
		return 0, false
	}
	return int(t.FaceValueVND * 10000 / base), true
}

// suggestionInputFor 从真实数据里取建议的读数。
func (s *Service) suggestionInputFor(ctx context.Context, merchantID, agentID, category string) SuggestionInput {
	in := SuggestionInput{Category: category}
	if profile, err := s.repository.GetProfile(ctx, agentID); err == nil {
		for _, social := range profile.Socials {
			if social.FollowerCount > in.Followers {
				in.Followers = social.FollowerCount
			}
		}
	}
	if category != "" {
		if svc, err := s.repository.GetService(ctx, agentID, "CITY_COMPANION"); err == nil && len(svc.VerticalTags) > 0 {
			match := false
			for _, tag := range svc.VerticalTags {
				if verticalCoversCategory(tag, category) {
					match = true
				}
			}
			in.VerticalMatch = &match
		}
	}
	if quotes, err := s.repository.ListPromoQuotesByAgent(ctx, agentID); err == nil {
		perCustomer := map[string]int{}
		for _, q := range quotes {
			if q.CustomerID != "" {
				perCustomer[q.CustomerID]++
			}
		}
		in.RepurchaseN = len(perCustomer)
		if len(perCustomer) >= 5 {
			repeat := 0
			for _, n := range perCustomer {
				if n >= 2 {
					repeat++
				}
			}
			rate := float64(repeat) / float64(len(perCustomer))
			in.RepurchaseRate = &rate
		}
	}
	if quotes, err := s.repository.ListPromoQuotesByMerchant(ctx, merchantID); err == nil {
		var sum, n int64
		for _, q := range quotes {
			if q.AmountVND > 0 {
				sum += q.AmountVND
				n++
			}
		}
		if n >= 3 {
			in.AvgTicketVND = sum / n
		}
	}
	if category != "" {
		if peers, err := s.repository.ListMerchantCreatorPromosByCategory(ctx, category); err == nil {
			total, n := 0, 0
			for _, p := range peers {
				if p.MerchantID == merchantID || p.Status != "ACTIVE" {
					continue
				}
				if bp, ok := pctOfTerms(p.Terms, defaultTicketVND); ok {
					total += bp
					n++
				}
			}
			if n >= 2 {
				avg := total / n
				in.CategoryAvgBP, in.CategoryN = &avg, n
			}
		}
	}
	return in
}

// MerchantStoreProfile 是商家自己的店：店名 + 店主开店时填的品类原文（如「Cà phê / Bistro」）。
// 商家登录就知道自己开的什么店 —— 品类从门店资料读，不让商家在专属码页面再选一遍
// （2026-10-04 用户：「商家这个还要单独设计品类吗……本身我是商家登陆，就知道自己开的什么店」）。
type MerchantStoreProfile struct {
	Name     string
	Category string
}

// MerchantStoreLookup 由商家域实现（cmd/api 里接 business.stores）。
type MerchantStoreLookup interface {
	MerchantStore(ctx context.Context, merchantID string) (MerchantStoreProfile, error)
}

// SetMerchantStoreLookup 接上门店资料。不接时专属码按「本店全部品类」发，系统建议里的
// 内容垂直度 / 同品类平均如实写「本店没填品类」。
func (s *Service) SetMerchantStoreLookup(lookup MerchantStoreLookup) {
	s.merchantStores = lookup
}

func (s *Service) merchantStore(ctx context.Context, merchantID string) MerchantStoreProfile {
	if s.merchantStores == nil {
		return MerchantStoreProfile{}
	}
	profile, err := s.merchantStores.MerchantStore(ctx, merchantID)
	if err != nil {
		return MerchantStoreProfile{}
	}
	return profile
}

// StoreCategoryGroup 把店主填的品类原文（越南语 / 中文 / 英文自由文本）归到专属码用的大类：
// 咖啡茶饮 →「咖啡」，各种餐 →「餐饮」；归不了的原样保留（截到 12 个字），空就是没填。
func StoreCategoryGroup(raw string) string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return ""
	}
	has := func(words ...string) bool {
		for _, w := range words {
			if strings.Contains(text, w) {
				return true
			}
		}
		return false
	}
	switch {
	case has("cà phê", "ca phe", "cafe", "café", "coffee", "咖啡", "trà", "tea", "茶"):
		return "咖啡"
	case has("món", "buffet", "hải sản", "hai san", "dimsum", "bò", "bistro", "brunch", "nướng", "nhà hàng", "lẩu", "phở", "restaurant", "餐", "菜", "火锅", "烧烤", "海鲜", "面"):
		return "餐饮"
	}
	runes := []rune(strings.TrimSpace(raw))
	if len(runes) > 12 {
		runes = runes[:12]
	}
	return string(runes)
}

// verticalCoversCategory：creator 的垂类编码（agent_services.vertical_tags，如 RESTAURANT）
// 是否覆盖本店品类（商家页选的中文品类）。编码和展示名的对应与移动端
// creator-capability-labels.ts 的展示名单一致：餐厅、咖啡都归「餐饮」，咖啡店也单认 CAFE。
// 2026-10-04 模拟器实测：直接拿 RESTAURANT 去比「餐饮」，An 明明做餐饮却被说成「垂类不含餐饮」。
var verticalCategories = map[string][]string{
	// 展示时餐厅、咖啡都并成「餐饮」（creator-capability-labels.ts），所以对咖啡店也都算覆盖。
	"RESTAURANT": {"餐饮", "咖啡"},
	"CAFE":       {"餐饮", "咖啡"},
	"TOUR":       {"旅游"},
	"SPORT":      {"运动"},
}

func verticalCoversCategory(tag, category string) bool {
	for _, c := range verticalCategories[strings.ToUpper(strings.TrimSpace(tag))] {
		if c == category {
			return true
		}
	}
	return strings.TrimSpace(tag) == category // creator 自填的中文垂类
}

// ---------------------------------------------------------------- 校验

func validUntilFor(now time.Time, days int) string {
	if days <= 0 {
		return "" // 长期有效
	}
	return now.AddDate(0, 0, days).Format("2006-01-02")
}

func promoExpired(t PromoTerms, now time.Time) bool {
	return t.ValidUntil != "" && t.ValidUntil < now.Format("2006-01-02")
}

func validatePromoTerms(t PromoTerms) string {
	switch {
	case t.FaceValueVND <= 0 || t.FaceValueVND > maxPromoBenefitVND:
		return "INVALID_PROMO_VALUE"
	case t.MinSpendVND < 0 || t.MinSpendVND > maxAmountVND:
		return "INVALID_PROMO_THRESHOLD"
	case t.MinSpendVND > 0 && t.MinSpendVND < t.FaceValueVND:
		return "INVALID_PROMO_THRESHOLD" // 满 3 万减 5 万：商家自己亏
	case t.Scope != PromoScopeCategory && t.Scope != PromoScopeAll:
		return "INVALID_PROMO_SCOPE"
	case t.Scope == PromoScopeCategory && strings.TrimSpace(t.Category) == "":
		return "INVALID_PROMO_SCOPE"
	case len([]rune(t.DisplayText)) > 40:
		return "INVALID_PROMO_TEXT"
	}
	return ""
}

func pairPromoMerchantOnly(e command.Envelope) (string, *command.Result) {
	merchantID := invitationMerchantID(e)
	if merchantID == "" {
		r := command.Rejected(e, "INVITATION_MERCHANT_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.invitation_merchant_required", nil)
		return "", &r
	}
	return merchantID, nil
}

// ---------------------------------------------------------------- 商家：发码 / 调整 / 列表 / 依据

// newPairPromo：给（商家, creator）**建**专属码，条款按系统建议起步（mode=SUGGESTED）。
// 店名 / 品类读门店资料；读不到店名时用 fallbackName。
//
// 只建不写（MERCHANT-CREATOR-NOTIFY-001）：两个调用方的语义不一样 ——
// 单发命令要把「写 + 事件」放进同一事务，自动补码的循环不能发事件。
// 写和发事件的决定权因此必须留在调用方，不能藏在这个 helper 里。
func (s *Service) newPairPromo(ctx context.Context, merchantID, agentID, creatorName, fallbackName string, now time.Time) (MerchantCreatorPromo, error) {
	store := s.merchantStore(ctx, merchantID)
	category := StoreCategoryGroup(store.Category)
	merchantName := strings.TrimSpace(store.Name)
	if merchantName == "" {
		merchantName = strings.TrimSpace(fallbackName)
	}
	code, err := s.pairCodeFor(ctx, agentID, creatorName, merchantID, merchantName)
	if err != nil {
		return MerchantCreatorPromo{}, err
	}
	suggestion := SuggestPromo(s.suggestionInputFor(ctx, merchantID, agentID, category), now)
	scope := PromoScopeAll
	if category != "" {
		scope = PromoScopeCategory
	}
	promo := MerchantCreatorPromo{
		Code: code, MerchantID: merchantID, MerchantName: merchantName, AgentID: agentID, CreatorName: creatorName,
		Terms: PromoTerms{
			MinSpendVND: suggestion.MinSpendVND, FaceValueVND: suggestion.FaceValueVND,
			DisplayText: DefaultDisplayText(suggestion.MinSpendVND, suggestion.FaceValueVND),
			Scope:       scope, Category: category, ValidUntil: validUntilFor(now, 90),
		},
		Status: "ACTIVE", Mode: PromoModeSuggested, Suggestion: suggestion, CreatedAt: now, UpdatedAt: now,
	}
	return promo, nil
}

// errPromoCouponAlreadyIssued 是**事务内部**用的哨兵：同一张券并发发两次时，
// SavePromoIssue 的唯一键冲突要把整笔事务退掉（包括那条 Issued 事件 ——
// 券没发出去就不该有「已发券」的通知），但对外要回的是 ALREADY_ISSUED 这个
// 正常业务结果，不是错误。
var errPromoCouponAlreadyIssued = errors.New("promo coupon already issued")

// maxAutoIssuePerList：一次打开页面最多自动补多少个码（防一次请求太重；下次打开接着补）。
const maxAutoIssuePerList = 50

// ensurePairPromos：系统自动给本店能合作的每个 creator 发专属码（用户 2026-10-04：「不要让商家一个个
// 给 creator 生成，而是系统自动生成的，商家唯一操作就是选择下单或者调整系统自动的折扣值」）。
// 范围 = 在服务（profile ACTIVE + 该服务 ACTIVE）且服务区域覆盖本店市场的 creator。已有码的不动。
// 两个请求同时补同一对时，UNIQUE(merchant_id, agent_id) 兜底：插入失败就当已经有了。
func (s *Service) ensurePairPromos(ctx context.Context, merchantID, marketID, fallbackName string, existing []MerchantCreatorPromo) []MerchantCreatorPromo {
	have := map[string]bool{}
	for _, p := range existing {
		have[p.AgentID] = true
	}
	profiles, err := s.repository.ProfilesSnapshot(ctx)
	if err != nil {
		return existing
	}
	sort.Slice(profiles, func(i, j int) bool { return profiles[i].AgentID < profiles[j].AgentID })
	now := s.clock.Now().UTC()
	issued := 0
	for _, profile := range profiles {
		if issued >= maxAutoIssuePerList {
			break
		}
		if profile.Status != "ACTIVE" || have[profile.AgentID] {
			continue
		}
		svc, err := s.repository.GetService(ctx, profile.AgentID, "CITY_COMPANION")
		if err != nil || svc.Status != "ACTIVE" || !containsString(svc.Markets, marketID) {
			continue
		}
		promo, err := s.newPairPromo(ctx, merchantID, profile.AgentID, profile.Name, fallbackName, now)
		if err != nil {
			continue
		}
		// 自动补码**不发通知**：一次打开页面最多补 50 个码，逐个通知 creator
		// 等于用推送轰炸（用户2026-10-04 定的交互是「商家唯一操作是选下单或调
		// 折扣」，不是让人被 50 条通知追着跑）。这条在反向门禁的显式
		// no-notify 清单里写着理由，不是「忘了」。
		if err := s.repository.SaveMerchantCreatorPromo(ctx, promo); err != nil {
			continue
		}
		existing = append(existing, promo)
		have[profile.AgentID] = true
		issued++
	}
	return existing
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

type issuePairPromoPayload struct {
	AgentID string `json:"agentId"`
	// 店名优先读门店资料；读不到时用客户端带来的商家账号名（只影响码里的店名段）。
	MerchantName string `json:"merchantName"`
}

// issueMerchantCreatorPromo：单独给某个 creator 发码（运营 / 后台用；商家页不需要 ——
// 打开页面时 ensurePairPromos 已经自动发好）。已有就原样返回（幂等）。
func (s *Service) issueMerchantCreatorPromo(ctx context.Context, e command.Envelope) command.Result {
	merchantID, rejected := pairPromoMerchantOnly(e)
	if rejected != nil {
		return *rejected
	}
	var p issuePairPromoPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.AgentID) == "" {
		return command.Rejected(e, "INVALID_PAIR_PROMO", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_pair_promo", nil)
	}
	if existing, err := s.repository.GetMerchantCreatorPromoByPair(ctx, merchantID, p.AgentID); err == nil {
		return acceptedWithPayload(e, "MerchantCreatorPromo", existing.Code, 1, "EXISTS", map[string]any{"promo": existing}, nil)
	} else if !errors.Is(err, ErrPairPromoNotFound) {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	profile, err := s.repository.GetProfile(ctx, p.AgentID)
	if err != nil {
		return command.Rejected(e, "AGENT_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.agent_not_found", nil)
	}
	now := s.clock.Now().UTC()
	promo, err := s.newPairPromo(ctx, merchantID, p.AgentID, profile.Name, p.MerchantName, now)
	if errors.Is(err, errPairCodeUnavailable) {
		return command.Rejected(e, "PAIR_CODE_UNAVAILABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.pair_code_unavailable", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	// MERCHANT-CREATOR-NOTIFY-001：写专属码与「通知 creator」这个事件同一事务。
	// 收件人写死在 payload 里 —— 映射层保持纯函数，不去反查「这个 creator
	// 用哪个账号登录」。
	// 记下是谁发的（migration 175）：审计用途（这条专属码是谁建的）。
	// 注意**不是**收件人 —— 商家侧收件人是商户的 business principal id。
	promo.IssuedByPrincipalID = e.Actor.ID
	issuedEvent := event.New("MerchantCreatorPromoIssued", "MerchantCreatorPromo", promo.Code, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": p.AgentID, "code": promo.Code,
		"percentBp": promo.Suggestion.PercentBP,
		// 收件人 = creator 的 user account id（不是 agentId，见 creatorInboxRecipient）
		"notifyPrincipalId": s.creatorInboxRecipient(ctx, p.AgentID),
	})
	if err := s.writeAndPublishOrJust(ctx, func(c context.Context) error {
		return s.repository.SaveMerchantCreatorPromo(c, promo)
	}, []event.DomainEvent{issuedEvent}); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "MerchantCreatorPromo", promo.Code, 1, "ISSUED", map[string]any{"promo": promo}, []event.DomainEvent{issuedEvent})
}

type adjustPairPromoPayload struct {
	Code            string `json:"code"`
	ApplySuggestion bool   `json:"applySuggestion"`
	MinSpendVND     int64  `json:"minSpendVnd"`
	FaceValueVND    int64  `json:"faceValueVnd"`
	DisplayText     string `json:"displayText"`
	Scope           string `json:"scope"`
	ValidityDays    *int   `json:"validityDays"` // 30 / 60 / 90；0 = 长期；不传 = 不改
	Note            string `json:"note"`
	Disable         bool   `json:"disable"`
}

// adjustMerchantCreatorPromo：商家调整某个专属码的折扣。applySuggestion=true 回到系统建议
// （重新按当前数据算一遍）；否则按传入条款改成 MANUAL。每次改动写一行留痕。
func (s *Service) adjustMerchantCreatorPromo(ctx context.Context, e command.Envelope) command.Result {
	merchantID, rejected := pairPromoMerchantOnly(e)
	if rejected != nil {
		return *rejected
	}
	var p adjustPairPromoPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_PAIR_PROMO", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_pair_promo", nil)
	}
	promo, err := s.repository.GetMerchantCreatorPromo(ctx, strings.ToUpper(strings.TrimSpace(p.Code)))
	if errors.Is(err, ErrPairPromoNotFound) || (err == nil && promo.MerchantID != merchantID) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if len([]rune(p.Note)) > maxInvitationMessage {
		return command.Rejected(e, "INVALID_PROMO_NOTE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_note", nil)
	}
	now := s.clock.Now().UTC()
	before := promo.Terms
	after := promo.Terms
	mode := PromoModeManual
	switch {
	case p.Disable:
		promo.Status = "DISABLED"
		mode = promo.Mode
	case p.ApplySuggestion:
		suggestion := SuggestPromo(s.suggestionInputFor(ctx, merchantID, promo.AgentID, promo.Terms.Category), now)
		promo.Suggestion = suggestion
		after.MinSpendVND, after.FaceValueVND = suggestion.MinSpendVND, suggestion.FaceValueVND
		after.DisplayText = DefaultDisplayText(suggestion.MinSpendVND, suggestion.FaceValueVND)
		mode = PromoModeSuggested
		promo.Status = "ACTIVE"
	default:
		after.MinSpendVND, after.FaceValueVND = p.MinSpendVND, p.FaceValueVND
		after.DisplayText = strings.TrimSpace(p.DisplayText)
		if after.DisplayText == "" {
			after.DisplayText = DefaultDisplayText(after.MinSpendVND, after.FaceValueVND)
		}
		if p.Scope != "" {
			after.Scope = p.Scope
		}
		// 品类只来自门店资料（发码时记下的那个，或现在重新读一次），不收客户端传的。
		if after.Scope == PromoScopeCategory {
			if after.Category == "" {
				after.Category = StoreCategoryGroup(s.merchantStore(ctx, merchantID).Category)
			}
			if after.Category == "" {
				return command.Rejected(e, "STORE_CATEGORY_MISSING", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.store_category_missing", nil)
			}
		}
		if p.ValidityDays != nil {
			if *p.ValidityDays < 0 || *p.ValidityDays > 365 {
				return command.Rejected(e, "INVALID_PROMO_VALIDITY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_validity", nil)
			}
			after.ValidUntil = validUntilFor(now, *p.ValidityDays)
		}
		if code := validatePromoTerms(after); code != "" {
			return command.Rejected(e, code, "VALIDATION", "AFTER_USER_ACTION", "supply."+strings.ToLower(code), nil)
		}
		promo.Status = "ACTIVE"
	}
	promo.Terms, promo.Mode, promo.UpdatedAt = after, mode, now
	if strings.TrimSpace(p.Note) != "" {
		promo.Note = strings.TrimSpace(p.Note)
	}
	change := PromoChange{ID: newID("pc_"), Code: promo.Code, ActorID: e.Principal.ID, Before: before, After: after, Mode: mode, Note: strings.TrimSpace(p.Note), ChangedAt: now}
	// MERCHANT-CREATOR-NOTIFY-001：调整专属码 = 「你给这个人的折扣变了」，creator
	// 必须知道（否则他按旧折扣报价，报价和实付对不上）。三处写 + 事件同一事务。
	domainEvents := []event.DomainEvent{event.New("MerchantCreatorPromoAdjusted", "MerchantCreatorPromo", promo.Code, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": promo.AgentID, "code": promo.Code, "mode": mode,
		"minSpendVnd": after.MinSpendVND, "faceValueVnd": after.FaceValueVND,
		"notifyPrincipalId": s.creatorInboxRecipient(ctx, promo.AgentID),
	})}
	if err := s.repository.WriteAndPublish(ctx, func(c context.Context) error {
		if err := s.repository.UpdateMerchantCreatorPromo(c, promo); err != nil {
			return err
		}
		return s.repository.SavePromoChange(c, change)
	}, domainEvents); err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "MerchantCreatorPromo", promo.Code, 1, "ADJUSTED", map[string]any{"promo": promo, "change": change}, domainEvents)
}

// PairPromoView 是列表里的一项：专属码 + 战绩 + 最近一次调整。
type PairPromoView struct {
	Promo      MerchantCreatorPromo `json:"promo"`
	Stats      PairPromoStats       `json:"stats"`
	LastChange *PromoChange         `json:"lastChange,omitempty"`
}

func (s *Service) pairStats(ctx context.Context, promos []MerchantCreatorPromo, issues []PromoIssue, quotes []PromoQuote) (map[string]PairPromoStats, PairPromoStats) {
	byCode := map[string]PairPromoStats{}
	codes := map[string]bool{}
	for _, p := range promos {
		codes[p.Code] = true
		byCode[p.Code] = PairPromoStats{}
	}
	var total PairPromoStats
	for _, i := range issues {
		if !codes[i.Code] {
			continue
		}
		st := byCode[i.Code]
		st.Issued++
		byCode[i.Code] = st
		total.Issued++
	}
	for _, q := range quotes {
		if !codes[q.Code] {
			continue
		}
		st := byCode[q.Code]
		st.Redeemed++
		total.Redeemed++
		if q.IssueID != "" {
			st.CouponRedeem++
			total.CouponRedeem++
		}
		if q.FirstVisit {
			st.NewCustomers++
			total.NewCustomers++
		}
		st.SpendVND += q.AmountVND
		st.DiscountVND += q.DiscountVND
		total.SpendVND += q.AmountVND
		total.DiscountVND += q.DiscountVND
		byCode[q.Code] = st
	}
	return byCode, total
}

func sortPairViews(views []PairPromoView) {
	sort.SliceStable(views, func(i, j int) bool {
		if views[i].Stats.NewCustomers != views[j].Stats.NewCustomers {
			return views[i].Stats.NewCustomers > views[j].Stats.NewCustomers
		}
		return views[i].Promo.CreatedAt.Before(views[j].Promo.CreatedAt)
	})
}

type listPairPromosPayload struct {
	MarketID     string `json:"marketId"`
	MerchantName string `json:"merchantName"`
}

// listMerchantCreatorPromos：本店所有专属码 + 战绩（按新客数排序）+ 整店合计与核销转化率。
// 打开时先自动给本店市场里还没有码的 creator 补码 —— 商家不用逐个生成。
func (s *Service) listMerchantCreatorPromos(ctx context.Context, e command.Envelope) command.Result {
	merchantID, rejected := pairPromoMerchantOnly(e)
	if rejected != nil {
		return *rejected
	}
	var p listPairPromosPayload
	_ = decode(e.Payload, &p)
	promos, err := s.repository.ListMerchantCreatorPromosByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if market := strings.TrimSpace(p.MarketID); market != "" {
		promos = s.ensurePairPromos(ctx, merchantID, market, p.MerchantName, promos)
	}
	issues, err1 := s.repository.ListPromoIssuesByMerchant(ctx, merchantID)
	quotes, err2 := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
	if err1 != nil || err2 != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	byCode, total := s.pairStats(ctx, promos, issues, quotes)
	views := make([]PairPromoView, 0, len(promos))
	for _, p := range promos {
		view := PairPromoView{Promo: p, Stats: byCode[p.Code]}
		if changes, err := s.repository.ListPromoChanges(ctx, p.Code); err == nil && len(changes) > 0 {
			last := changes[len(changes)-1]
			view.LastChange = &last
		}
		views = append(views, view)
	}
	sortPairViews(views)
	// 本店品类（门店资料里现在填的）：没填时商家页提示去「店铺」里填，而不是让他在这里选。
	store := s.merchantStore(ctx, merchantID)
	return acceptedWithPayload(e, "MerchantCreatorPromo", merchantID, 1, "LISTED", map[string]any{
		"promos": views, "totals": total, "conversionBp": total.ConversionBP(),
		"storeCategory": StoreCategoryGroup(store.Category), "storeCategoryRaw": store.Category,
	}, nil)
}

type pairPromoCodePayload struct {
	Code string `json:"code"`
}

// getMerchantCreatorPromoBasis：「查看依据」—— 按当前真实数据重算一遍建议，和当前生效条款对照。
func (s *Service) getMerchantCreatorPromoBasis(ctx context.Context, e command.Envelope) command.Result {
	merchantID, rejected := pairPromoMerchantOnly(e)
	if rejected != nil {
		return *rejected
	}
	var p pairPromoCodePayload
	_ = decode(e.Payload, &p)
	promo, err := s.repository.GetMerchantCreatorPromo(ctx, strings.ToUpper(strings.TrimSpace(p.Code)))
	if err != nil || promo.MerchantID != merchantID {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	current := SuggestPromo(s.suggestionInputFor(ctx, merchantID, promo.AgentID, promo.Terms.Category), s.clock.Now().UTC())
	changes, _ := s.repository.ListPromoChanges(ctx, promo.Code)
	return acceptedWithPayload(e, "MerchantCreatorPromo", promo.Code, 1, "BASIS", map[string]any{
		"promo": promo, "suggestion": current, "changes": changes,
	}, nil)
}

// ---------------------------------------------------------------- 顾客：领券

// claimPromoCoupon：顾客扫 creator 的专属码领券。每人每码一张（再领返回原来那张）。
// 顾客身份来自会话（Actor），不读 payload —— 不能替别人领。
func (s *Service) claimPromoCoupon(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PROMO_CUSTOMER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.promo_customer_required", nil)
	}
	var p pairPromoCodePayload
	_ = decode(e.Payload, &p)
	code := strings.ToUpper(strings.TrimSpace(p.Code))
	if !pairCodeRe.MatchString(code) {
		return command.Rejected(e, "INVALID_PROMO_CODE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_promo_code", nil)
	}
	promo, err := s.repository.GetMerchantCreatorPromo(ctx, code)
	if errors.Is(err, ErrPairPromoNotFound) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	if promo.Status != "ACTIVE" || promoExpired(promo.Terms, now) {
		return command.Rejected(e, "PROMO_BENEFIT_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_benefit_expired", nil)
	}
	issue := PromoIssue{ID: newID("cp_"), Code: code, MerchantID: promo.MerchantID, AgentID: promo.AgentID, CustomerID: e.Actor.ID, IssuedAt: now}
	state := "ISSUED"
	var domainEvents []event.DomainEvent
	if err := s.repository.WriteAndPublish(ctx, func(c context.Context) error {
		if err := s.repository.SavePromoIssue(c, issue); errors.Is(err, ErrPromoAlreadyIssued) {
			prior, perr := s.repository.GetPromoIssueByCustomer(c, code, e.Actor.ID)
			if perr != nil {
				return perr
			}
			issue, state = prior, "ALREADY_ISSULED"
			return errPromoCouponAlreadyIssued
		} else if err != nil {
			return err
		}
		return nil
	}, []event.DomainEvent{event.New("PromoCouponIssued", "PromoIssue", issue.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		// 收件人 = creator：这张券是用**他的码**发的，他要知道。
		// user account id，不是 agentId（见 creatorInboxRecipient）。
		"merchantId": promo.MerchantID, "agentId": promo.AgentID, "code": code,
		"notifyPrincipalId": s.creatorInboxRecipient(ctx, promo.AgentID),
	})}); err != nil {
		if errors.Is(err, errPromoCouponAlreadyIssued) {
			return acceptedWithPayload(e, "PromoIssue", issue.ID, 1, state, map[string]any{
				"coupon": issue, "promo": publicPromoView(promo), "alreadyClaimed": true,
			}, nil)
		}
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "PromoIssue", issue.ID, 1, state, map[string]any{
		"coupon": issue, "promo": publicPromoView(promo), "alreadyClaimed": state == "ALREADY_ISSUED",
	}, domainEvents)
}

// publicPromoView：给顾客 / creator 看的码信息（不带系统建议的内部依据）。
func publicPromoView(p MerchantCreatorPromo) map[string]any {
	return map[string]any{
		"code": p.Code, "merchantId": p.MerchantID, "merchantName": p.MerchantName,
		"agentId": p.AgentID, "creatorName": p.CreatorName, "terms": p.Terms, "status": p.Status,
	}
}

// listMyPromoCoupons：顾客自己领到的券（带是否已核销）。
func (s *Service) listMyPromoCoupons(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.Type != "USER" || e.Actor.ID == "" {
		return command.Rejected(e, "PROMO_CUSTOMER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.promo_customer_required", nil)
	}
	issues, err := s.repository.ListPromoIssuesByCustomer(ctx, e.Actor.ID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	out := make([]map[string]any, 0, len(issues))
	for _, i := range issues {
		promo, err := s.repository.GetMerchantCreatorPromo(ctx, i.Code)
		if err != nil {
			continue
		}
		redeemed := false
		if quotes, err := s.repository.ListPromoQuotesByMerchant(ctx, i.MerchantID); err == nil {
			for _, q := range quotes {
				if q.IssueID == i.ID {
					redeemed = true
				}
			}
		}
		out = append(out, map[string]any{"coupon": i, "promo": publicPromoView(promo), "redeemed": redeemed})
	}
	return acceptedWithPayload(e, "PromoIssue", e.Actor.ID, 1, "LISTED", map[string]any{"coupons": out}, nil)
}

// ---------------------------------------------------------------- creator：我在各家店的专属码

type myPairPromosPayload struct {
	AgentID string `json:"agentId"`
}

// listMyMerchantPromos：creator 看自己在每家店的专属码和战绩（只能看自己的）。
func (s *Service) listMyMerchantPromos(ctx context.Context, e command.Envelope) command.Result {
	var p myPairPromosPayload
	_ = decode(e.Payload, &p)
	if p.AgentID == "" || e.Principal.ID != p.AgentID {
		return command.Rejected(e, "PROMO_OWNER_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.promo_owner_required", nil)
	}
	promos, err := s.repository.ListMerchantCreatorPromosByAgent(ctx, p.AgentID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	issues, err1 := s.repository.ListPromoIssuesByAgent(ctx, p.AgentID)
	quotes, err2 := s.repository.ListPromoQuotesByAgent(ctx, p.AgentID)
	if err1 != nil || err2 != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	byCode, total := s.pairStats(ctx, promos, issues, quotes)
	views := make([]map[string]any, 0, len(promos))
	for _, promo := range promos {
		views = append(views, map[string]any{"promo": publicPromoView(promo), "stats": byCode[promo.Code]})
	}
	sort.SliceStable(views, func(i, j int) bool {
		return views[i]["stats"].(PairPromoStats).NewCustomers > views[j]["stats"].(PairPromoStats).NewCustomers
	})
	return acceptedWithPayload(e, "MerchantCreatorPromo", p.AgentID, 1, "LISTED", map[string]any{"promos": views, "totals": total}, nil)
}

// ---------------------------------------------------------------- 核销（专属码）

// quotePairPromo：核销专属码。couponID 有值时凭券（顾客身份已知，新客由系统判定）；
// 否则按码匿名核销（新客用店员勾选）。码必须是本店的；一张券只能核销一次。
func (s *Service) quotePairPromo(ctx context.Context, e command.Envelope, merchantID, code, couponID string, amount int64, clerkFirstVisit bool) command.Result {
	var issue PromoIssue
	if couponID != "" {
		found, err := s.repository.GetPromoIssue(ctx, couponID)
		if errors.Is(err, ErrPromoIssueNotFound) {
			return command.Rejected(e, "COUPON_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.coupon_not_found", nil)
		}
		if err != nil {
			return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
		}
		issue, code = found, found.Code
	}
	promo, err := s.repository.GetMerchantCreatorPromo(ctx, code)
	if errors.Is(err, ErrPairPromoNotFound) {
		return command.Rejected(e, "PROMO_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	if promo.MerchantID != merchantID {
		return command.Rejected(e, "PROMO_OTHER_MERCHANT", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_other_merchant", map[string]any{"merchantName": promo.MerchantName})
	}
	now := s.clock.Now().UTC()
	if promo.Status != "ACTIVE" || promoExpired(promo.Terms, now) {
		return command.Rejected(e, "PROMO_BENEFIT_EXPIRED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_benefit_expired", nil)
	}
	if promo.Terms.MinSpendVND > 0 && amount < promo.Terms.MinSpendVND {
		return command.Rejected(e, "PROMO_BELOW_MIN_SPEND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.promo_below_min_spend", map[string]any{
			"minSpendVnd": promo.Terms.MinSpendVND, "amountVnd": amount, "faceValueVnd": promo.Terms.FaceValueVND,
		})
	}
	quotes, err := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "PROMO_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_read_failed", nil)
	}
	firstVisit, source := clerkFirstVisit, "CLERK"
	if issue.ID != "" {
		source, firstVisit = "SYSTEM", true
		for _, q := range quotes {
			if q.IssueID == issue.ID {
				return command.Rejected(e, "COUPON_ALREADY_REDEEMED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.coupon_already_redeemed", nil)
			}
			if q.CustomerID == issue.CustomerID {
				firstVisit = false // 这位顾客在本店核销过 —— 不是新客
			}
		}
	} else {
		for _, q := range quotes {
			// 防手抖只比匿名输码核销：凭券的有一券一次兜着，不该挡下一位匿名顾客。
			if q.Code == code && q.IssueID == "" && now.Sub(q.QuotedAt) < time.Minute {
				return command.Rejected(e, "DUPLICATE_QUOTE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.duplicate_quote", nil)
			}
		}
	}
	quote := PromoQuote{
		ID: newID("pq_"), MerchantID: merchantID, AgentID: promo.AgentID, Code: code,
		AmountVND: amount, DiscountVND: promo.Terms.FaceValueVND, FirstVisit: firstVisit,
		CustomerID: issue.CustomerID, IssueID: issue.ID, FirstVisitSource: source, QuotedAt: now,
	}
	// 收件人 = 商户的 business principal id（共享收件箱里那个 key；理由见 service.go
	// 里「扇出到成员」那段被删掉的注释）。查不到也不退回 recorded principal ——
	// merchant_id 本身就是收件人键，没什么可查的。
	domainEvents := []event.DomainEvent{event.New("PromoCodeQuoted", "PromoQuote", quote.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"merchantId": merchantID, "agentId": promo.AgentID, "code": code, "amountVnd": amount,
		"firstVisit": firstVisit, "firstVisitSource": source, "notifyPrincipalId": merchantID,
	})}
	if err := s.writeAndPublishOrJust(ctx, func(c context.Context) error {
		return s.repository.SavePromoQuote(c, quote)
	}, domainEvents); errors.Is(err, ErrCouponAlreadyRedeemed) {
		return command.Rejected(e, "COUPON_ALREADY_REDEEMED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.coupon_already_redeemed", nil)
	} else if err != nil {
		return command.Rejected(e, "PROMO_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.promo_write_failed", nil)
	}
	return acceptedWithPayload(e, "PromoQuote", quote.ID, 1, "QUOTED", map[string]any{
		"quote": quote,
		"benefit": map[string]any{
			"faceValueVnd": promo.Terms.FaceValueVND, "minSpendVnd": promo.Terms.MinSpendVND,
			"scopeName": promo.Terms.DisplayText, "creatorName": promo.CreatorName,
		},
	}, domainEvents)
}
