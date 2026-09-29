package marketplace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/aiboundary"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// Service owns the P0 opportunity read model and its user actions. Mobile may
// render this payload, but publishing, applying and dismissing are server facts.
//
// R17.x: chat → order derivation. When a candidate accepts an offer
// (ConfirmMarketApplication), we want the resulting order to surface in
// '我的订单'. To avoid a second source of truth, marketplace Service
// delegates order creation to an injected OrderCreator (production:
// fulfillment.MemoryRepository or its PG twin). OrderCreator is a
// thin interface so tests can run with an in-memory fake without
// pulling the fulfillment package into the marketplace compile graph.
type Service struct {
	repository Repository
	// numbers 给发布的需求 / 邀约分配全数字编号（PUBLIC-NO-001）。与订单编号同一个
	// 分配器：一个号只指向一样东西。PG 仓默认用共享序列；main.go 注入同一个实例。
	numbers      ordernumber.Allocator
	orderCreator OrderCreator // nil = legacy behaviour (only stamp orderRef)
	// orderPermission：接单报名只对有接单权限（KYC 通过）的人开（ORDER-APPLY-KYC-GATE-001）。
	// 不接 = 老行为（测试 / 无库环境）；生产在 main.go 必须接。
	orderPermission func(ctx context.Context, userAccountID string) (bool, error)
	// authorNames resolves PERSON opportunity owner names from the verified
	// account profile (PROFILE-READ-001). Nil = legacy unwired behaviour.
	authorNames authorNameResolver
	// OPP-SUGGEST-001: semantic-layer adapter for the publish search
	// box (SuggestOpportunityTemplate). Unconfigured{} fail-closed;
	// production wires the real adapter via SetModelStack.
	mu         sync.Mutex
	modelStack modelstack.Port
	// CLIENT-RATING-001: resolves a listing's real Owner rating (nil =
	// unwired, no Rating/RatingCount fields get populated — same
	// "unwired means honestly absent" convention as authorNames).
	ratingLookup ratingLookup
}

// ratingLookup is the narrow consumer-side contract so marketplace does
// not import the rating package's Repository/command machinery, only the
// one read it needs. rating.Service already satisfies this.
type ratingLookup interface {
	GetUserRatingAggregate(ctx context.Context, userID string) (average float64, count int, err error)
}

// SetRatingLookup wires a client's real public rating onto their market
// listings. Unwired (nil) means every Opportunity keeps Rating/RatingCount
// empty — never a fabricated average.
func (s *Service) SetRatingLookup(lookup ratingLookup) {
	s.ratingLookup = lookup
}

// authorNameResolver is the narrow consumer-side contract so marketplace
// does not import the identity package.
type authorNameResolver interface {
	ResolveAuthorDisplayName(ctx context.Context, userAccountID string) (string, bool)
}

// SetAuthorNameResolver wires profile-backed owner resolution.
func (s *Service) SetAuthorNameResolver(resolver authorNameResolver) {
	s.authorNames = resolver
}

// OrderCreator is the narrow interface marketplace needs from
// fulfillment to materialise a real Order when an application is
// confirmed. The interface is defined here (consumer-side) so the
// marketplace package does not import fulfillment.
type OrderCreator interface {
	EnsureOrder(ctx context.Context, order OrderRecord) error
}

// OrderRecord is the wire-shape the OrderCreator accepts. It maps
// 1:1 to fulfillment.Order except for the Snapshot fields that
// marketplace does not author (duration / startTime / meetingContext
// are negotiated bilaterally after confirmation, not at confirm time).
type OrderRecord struct {
	ID          string `json:"orderId"`
	RequesterID string `json:"requesterId"`
	AgentID     string `json:"agentId"`
	NeedID      string `json:"needId"` // opportunity id; order sees it as needId for backward-compat with fulfillment listMyOrders
	// ORDER-SCENARIO-001: 机会的消费场景（ordinary/assistance/空），Confirm 时
	// 从 opportunity 回查填入，fulfillment 快照原样带到订单上。
	Scenario string `json:"scenario,omitempty"`
}

// SetOrderPermission 接上「有没有接单权限」的查询（ORDER-APPLY-KYC-GATE-001）：没有就报 KYC_REQUIRED。
// 不接 = 老行为（测试 / 无库环境）；生产在 main.go 必须接。
func (s *Service) SetOrderPermission(check func(ctx context.Context, userAccountID string) (bool, error)) {
	s.orderPermission = check
}
// Production code in cmd/api/main.go calls this once at boot; tests
// can leave it nil to exercise the legacy path.
func (s *Service) SetOrderCreator(c OrderCreator) { s.orderCreator = c }

// OfferEligibility 回答「ownerID 能不能就 opportunityID 给 agentID 发档位报价」
// （ORDER-SLOT-OWNER-001）：机会归 ownerID 所有，且 agentID 在这个机会上报过名。
// 机会不存在 / 不归本人返回 (false, nil)。
func (s *Service) OfferEligibility(ctx context.Context, opportunityID, ownerID, agentID string) (bool, error) {
	if opportunityID == "" || ownerID == "" || agentID == "" {
		return false, nil
	}
	applications, err := s.repository.ListApplications(ctx, opportunityID, ownerID)
	if errors.Is(err, ErrOpportunityNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, application := range applications {
		if application.ApplicantID == agentID {
			return true, nil
		}
	}
	return false, nil
}

// R16.11 / Master PRD v1.4 §3: 统一物化规则（Materialization Rule）
// Opportunity -> Invite -> Order -> Activity Participation 必须有唯一业务对象流向。
// 防止多 Truth：同一响应不能同时生成多个不同类型业务对象。
var materializationRule = map[string]string{
	"opportunity": "invite",
	"invite":      "order",
	"order":       "activity_participation",
}

var ErrOpportunityNotFound = errors.New("market opportunity not found")
var ErrApplicationNotFound = errors.New("market application not found")
var ErrApplicationStateConflict = errors.New("market application state conflict")

type Repository interface {
	Seed(ctx context.Context, opportunities []Opportunity) error
	List(ctx context.Context, viewerID string) ([]Opportunity, error)
	Get(ctx context.Context, id string) (Opportunity, error)
	Create(ctx context.Context, opportunity Opportunity) error
	Apply(ctx context.Context, application Application) (Application, bool, error)
	ListApplications(ctx context.Context, opportunityID, ownerID string) ([]Application, error)
	SelectApplication(ctx context.Context, opportunityID, applicationID, ownerID string) (Application, error)
	ConfirmApplication(ctx context.Context, applicationID, applicantID, orderRef string, materialize ...func(context.Context, Application) error) (Application, error)
	Dismiss(ctx context.Context, viewerID, opportunityID string) error
}

// NumberReader 由能按公共编号反查机会 / 邀约的仓储实现（PG 与内存仓都实现）。是可选
// 接口，不进 Repository —— 其他包里的测试仓不必跟着改。
type NumberReader interface {
	// GetByNumber：没有 ⇒ ErrOpportunityNotFound。
	GetByNumber(ctx context.Context, number string) (Opportunity, error)
}

// ErrNumberLookupUnsupported：仓储没有按编号反查的能力（PUBLIC-NO-LOOKUP-001）。
var ErrNumberLookupUnsupported = errors.New("opportunity number lookup not supported by repository")

// FindOpportunityByNumber 是客服 / 运营的跨当事人反查入口（PUBLIC-NO-LOOKUP-001）。
// 不做鉴权 —— 调用方（internal/numberlookup）负责运营门和审计留痕。
func (s *Service) FindOpportunityByNumber(ctx context.Context, number string) (Opportunity, error) {
	reader, ok := s.repository.(NumberReader)
	if !ok {
		return Opportunity{}, ErrNumberLookupUnsupported
	}
	return reader.GetByNumber(ctx, number)
}

type MemoryRepository struct {
	mu            sync.Mutex
	opportunities []Opportunity
	applications  map[string]map[string]Application
	dismissed     map[string]bool
}

type Opportunity struct {
	ID string `json:"id"`
	// PUBLIC-NO-001：发布时服务端分配的全数字编号（需求 / 邀约成功页展示、客服查询用）。
	// 以前成功页的 PX-N / PX-O 是客户端随机生成的，服务端查不到。老数据为空。
	Number     string `json:"number,omitempty"`
	Title      string `json:"title"`
	ShortTitle string `json:"shortTitle"`
	Theme      string `json:"theme"`
	Date       string `json:"date"`
	Time       string `json:"time"`
	Location   string `json:"location"`
	Price      string `json:"price"`
	// MoneyFlow 是"看钱方向" — 报价这一栏究竟在表达什么：
	//   EARN     — 接单者完成任务后可获得（默认，机会的主流形态）
	//   PAY      — 接单者要预先支付（不常见；通常用于代购/订位等委托）
	//   FREE     — 0₫ 免费任务（社区/试玩/同好搭子）
	//   TBD      — 费用待确认（双方面谈，公开不显示金额）
	// Server 端 normalizeOpportunityMoney() 会根据 Price 是否为空 /
	// 是否为 "0₫" 推断 MoneyFlow = FREE，并把 TBD 留给显式
	// MoneyFlow = "TBD" 的发布方。PriceLabel 是给移动端的"语义副本"
	// （"完成后你可获得" / "你需支付" / "免费" / "费用待确认"），由
	// server 强制派生，不允许客户端随意传入。
	MoneyFlow  string `json:"moneyFlow"`
	PriceLabel string `json:"priceLabel"`
	// R58 demand notes (optional free text). Stored verbatim in the JSONB
	// payload; no migration needed for the additive field.
	Desc                    string   `json:"desc,omitempty"`
	Owner                   string   `json:"owner"`
	OwnerID                 string   `json:"-"`
	OwnerType               string   `json:"ownerType"`
	Match                   string   `json:"match"`
	Responses               int      `json:"responses"`
	Posted                  string   `json:"posted"`
	Skills                  string   `json:"skills"`
	Verified                bool     `json:"verified"`
	// CLIENT-RATING-001: the owner's real public rating (providers rate
	// clients after a completed order — see internal/rating). Both are
	// omitted (not zero) when RatingCount == 0: nobody has rated this
	// owner yet, so there is no average to show, and 0 would read as a
	// real (bad) score rather than "no data".
	Rating      float64 `json:"rating,omitempty"`
	RatingCount int     `json:"ratingCount,omitempty"`
	Lens                    []string `json:"lens"`
	Travel                  *int     `json:"travel"`
	Signal                  string   `json:"signal"`
	SignalClass             string   `json:"signalClass"`
	Countdown               string   `json:"countdown"`
	Owned                   bool     `json:"ownedByViewer"`
	Applied                 bool     `json:"appliedByViewer"`
	ViewerApplicationID     string   `json:"viewerApplicationId,omitempty"`
	ViewerApplicationStatus string   `json:"viewerApplicationStatus,omitempty"`
	ViewerOrderRef          string   `json:"viewerOrderRef,omitempty"`
	// R15.x: Optional geo coordinates for the opportunity. When
	// ListMarketOpportunities is called with userLat/userLng in
	// the payload, the server recomputes Travel via haversine
	// distance. Lat/Lng stay optional because some opportunities
	// are remote (online) or the publisher didn't disclose a
	// precise venue.
	Lat          *float64 `json:"lat,omitempty"`
	Lng          *float64 `json:"lng,omitempty"`
	TravelSource string   `json:"travelSource,omitempty"` // "seeded" | "user_distance" | "unknown"
	// OPP-TARGETED-001: optional directed invitation. When set, the
	// opportunity is a private ask to one specific account (选人 → 向
	// TA 发出邀约): List only shows it to the target and the owner;
	// only the target may apply. Empty = the classic public card.
	// OwnerID keeps pointing at the publisher so Owned/接单/屏蔽 stay
	// intact; this field only narrows VISIBILITY + eligibility.
	TargetAccountID string `json:"targetAccountId,omitempty"`
	// ORDER-SCENARIO-001: 消费场景 —— ordinary 普通消费 / assistance 城市协助。
	// 发布向导按 moment 家族填；订单流程按它分档。空 = 历史数据，按金额档兜底。
	Scenario string `json:"scenario,omitempty"`
}

type Application struct {
	ID            string     `json:"applicationId"`
	OpportunityID string     `json:"opportunityId"`
	OwnerID       string     `json:"-"` // R17.x: opportunity owner, 在 apply 时快照, 用于派生 Order.RequesterID (fulfillment 侧不查 opportunity)
	ApplicantID   string     `json:"applicantId"`
	Quote         string     `json:"quote"`
	Scope         string     `json:"scope"`
	Status        string     `json:"status"`
	// ORDER-SCENARIO-001: 报名时从机会快照的消费场景（ordinary/assistance/空），
	// 确认时原样带进 OrderRecord。与 OwnerID 同一条快照 precedent —— 确认回调里
	// 不许再读仓（memory 锁重入死锁），只消费这里现成的值。
	Scenario      string     `json:"scenario,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	SelectedAt    *time.Time `json:"selectedAt,omitempty"`
	ConfirmedAt   *time.Time `json:"confirmedAt,omitempty"`
	OrderRef      string     `json:"orderRef,omitempty"`
}

func New() *Service {
	return NewWithRepository(&MemoryRepository{applications: make(map[string]map[string]Application), dismissed: make(map[string]bool)})
}

func NewWithRepository(repository Repository) *Service {
	numbers := ordernumber.Allocator(ordernumber.NewMemory())
	if source, ok := repository.(interface{ OrderNumbers() ordernumber.Allocator }); ok {
		numbers = source.OrderNumbers()
	}
	return &Service{repository: repository, numbers: numbers}
}

// SetNumbers 接上与订单共用的编号分配器（PUBLIC-NO-001）。
func (s *Service) SetNumbers(allocator ordernumber.Allocator) { s.numbers = allocator }

func (s *Service) SeedDefaults() {
	travel18, travel24, travel52, travel20 := 18, 24, 52, 20
	// R15.x: real-world lat/lng for the seeded venues. Hanoi
	// (Hoàn Kiếm ~21.0285,105.8542) is the default. Bắc Ninh
	// Yên Phong is ~21.16,105.96 (a ~20 km ride from central
	// Hanoi — the original 52 min "Travel" is consistent with
	// that). When the mobile client passes userLat/userLng to
	// ListMarketOpportunities, the server recomputes Travel via
	// haversine + a 30 km/h city-ride heuristic. When the client
	// has not (yet) granted foreground GPS, the seeded Travel
	// stands in and the row is tagged travelSource="seeded".
	hkLat, hkLng := 21.0285, 105.8542
	westLakeLat, westLakeLng := 21.0500, 105.8197
	bacNinhLat, bacNinhLng := 21.1600, 105.9600
	hkOldQuartersLat, hkOldQuartersLng := 21.0338, 105.8500
	_ = s.repository.Seed(context.Background(), []Opportunity{
		{ID: "biz_negotiation", Title: "商务谈判陪同 · 中英越沟通", ShortTitle: "谈判", Theme: "商务谈判", Date: "今天", Time: "14:00–18:00", Location: "河内 · Hoàn Kiếm", Price: "1,200,000₫", MoneyFlow: "EARN", PriceLabel: "完成后你可获得", Owner: "Nova Trading", OwnerID: "seed_nova", OwnerType: "BUSINESS", Match: "", Responses: 0, Posted: "12 分钟前", Skills: "中文 · 英语 · 商务沟通", Verified: false, Lens: []string{"NOW", "NEARBY"}, Travel: &travel18, Lat: &hkLat, Lng: &hkLng, TravelSource: "seeded", Signal: "急需", SignalClass: "", Countdown: "42m"},
		{ID: "event_photo", Title: "品牌活动摄影 / 短视频", ShortTitle: "摄影", Theme: "摄影", Date: "周六", Time: "15:00–20:00", Location: "河内 · 西湖", Price: "1,500,000₫", MoneyFlow: "EARN", PriceLabel: "完成后你可获得", Owner: "Bonsaidon", OwnerID: "seed_bonsaidon", OwnerType: "BUSINESS", Match: "", Responses: 0, Posted: "25 分钟前", Skills: "摄影 · 基础剪辑 · 活动经验", Verified: false, Lens: []string{"BOOKED", "NEARBY"}, Travel: &travel24, Lat: &westLakeLat, Lng: &westLakeLng, TravelSource: "seeded", Signal: "热门", Countdown: "3天"},
		{ID: "supplier_visit", Title: "供应商拜访 · 中文陪同", ShortTitle: "陪同", Theme: "商务陪同", Date: "明天", Time: "09:00–15:00", Location: "北宁 · Yên Phong", Price: "1,100,000₫", MoneyFlow: "EARN", PriceLabel: "完成后你可获得", Owner: "Acme VN", OwnerID: "seed_acme", OwnerType: "BUSINESS", Match: "", Responses: 0, Posted: "42 分钟前", Skills: "中文 · 制造业 · 会议记录", Verified: false, Lens: []string{"BOOKED"}, Travel: &travel52, Lat: &bacNinhLat, Lng: &bacNinhLng, TravelSource: "seeded", Signal: "新发布", Countdown: "明天"},
		{ID: "city_companion", Title: "河内半日城市同行 / 拍照", ShortTitle: "同行", Theme: "城市同行", Date: "周日", Time: "13:30–18:00", Location: "河内 · 西湖 → 老城区", Price: "950,000₫", MoneyFlow: "EARN", PriceLabel: "完成后你可获得", Owner: "Chen", OwnerID: "seed_chen", OwnerType: "PERSON", Match: "", Responses: 0, Posted: "1 小时前", Skills: "中文 · 路线 · 轻摄影", Verified: false, Lens: []string{"BOOKED", "NEARBY"}, Travel: &travel20, Lat: &hkOldQuartersLat, Lng: &hkOldQuartersLng, TravelSource: "seeded", Signal: "高响应", Countdown: "周日"},
	})
}

func (s *Service) Supports(t string) bool {
	switch t {
	case "ListOpportunityTemplates", "SuggestOpportunityTemplate", "ListMarketOpportunities", "PublishMarketOpportunity", "ApplyToMarketOpportunity", "ListMarketApplications", "SelectMarketApplication", "ConfirmMarketApplication", "DismissMarketOpportunity":
		return true
	}
	return false
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "ListOpportunityTemplates":
		// OPP-TEMPLATE-001 + OPP-CATALOG-001 (R58): the publish-flow
		// catalog. Cards + categories + per-card specs/policy/pricing
		// in one anonymous read — the client renders the two-pane
		// picker AND the Moment spec sheet from this payload.
		// Read-only, no repository involved, anonymous-safe — same tier
		// as ListMarketOpportunities, so it needs no auth and no
		// aiboundary gate (it discloses nothing about any user).
		snap := buildCatalogSnapshot()
		return payload(e, "Market", "templates", "READY", map[string]any{
			"templates":  snap.Templates,
			"categories": snap.Categories,
			"specs":      snap.Specs,
			"policies":   snap.Policies,
			"pricing":    snap.Pricing,
			// OPP-CATALOG-002 (R58 activity line): creation-flow presets
			// ride the same anonymous snapshot read.
			"activityPresets": snap.ActivityPresets,
		})
	case "SuggestOpportunityTemplate":
		// OPP-SUGGEST-001: semantic mapping of free text to a catalog
		// card (publish search box). Read-only, anonymous-safe; the
		// model stack gates itself (fail-closed when unwired).
		return s.suggestOpportunityTemplate(ctx, e)
	case "ListMarketOpportunities":
		items, err := s.repository.List(ctx, e.Actor.ID)
		if err != nil {
			return command.Rejected(e, "MARKET_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "market.list_failed", nil)
		}
		// R15.x: when the client passes a foreground-location
		// fix (userLat + userLng), the server recomputes Travel
		// via haversine. The mobile MarketExperience / list view
		// sorts NEARBY / RECOMMEND by this value, so it must
		// reflect the viewer's actual position rather than the
		// editor's "河内 18 min" placeholder. If the publisher
		// did not provide Lat/Lng, the row is left as-seeded
		// and tagged travelSource="seeded" so the UI can show
		// a "（未提供位置）" hint if it wants to.
		userLat, userLng, hasUserFix := readUserFix(e.Payload)
		if hasUserFix {
			for i := range items {
				if items[i].Lat == nil || items[i].Lng == nil {
					items[i].TravelSource = "seeded"
					continue
				}
				km := haversineKm(userLat, userLng, *items[i].Lat, *items[i].Lng)
				minutes := int(km / 30.0 * 60.0) // 30 km/h city average
				if minutes < 1 {
					minutes = 1
				}
				items[i].Travel = &minutes
				items[i].TravelSource = "user_distance"
			}
		}
		for i := range items {
			normalizeOpportunityMoney(&items[i])
			// MARKET-LEGACY-FABRICATED-001: 清扫前落库的行还带着写死的 Match /
			// 个人 owner 的 Verified，读路径必须清掉再下发。
			stripLegacyFabricatedJudgment(&items[i])
		}
		// CLIENT-RATING-001: attach each owner's real public rating.
		// count == 0 (nobody has rated them yet) leaves both fields at
		// their zero value, which json:",omitempty" then drops entirely —
		// the card must not render a 0-star badge for "no data".
		if s.ratingLookup != nil {
			for i := range items {
				if items[i].OwnerID == "" {
					continue
				}
				avg, count, err := s.ratingLookup.GetUserRatingAggregate(ctx, items[i].OwnerID)
				if err != nil || count == 0 {
					continue
				}
				items[i].Rating = avg
				items[i].RatingCount = count
			}
		}
		return payload(e, "Market", "local", "READY", map[string]any{"opportunities": items})
	case "PublishMarketOpportunity":
		if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.PublishOpportunity) {
			return rejected(e, "AI_ACTION_FORBIDDEN", "ai.action_forbidden")
		}
		// AIBOUND-001: 与 activity 对齐，写必须 USER 主体（dispatch 层已按
		// session 回填 Actor，这里是纵深，避免直接调 service 绕过）。
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		var p Opportunity
		if !decode(e.Payload, &p) || p.Title == "" || p.Location == "" {
			return rejected(e, "INVALID_OPPORTUNITY", "market.invalid_opportunity")
		}
		// R58 demand notes: trim, cap at 500 runes.
		p.Desc = strings.TrimSpace(p.Desc)
		if len([]rune(p.Desc)) > 500 {
			return rejected(e, "INVALID_OPPORTUNITY", "market.invalid_opportunity_desc")
		}
		// MoneyFlow 必须是 4 选 1，且 Price 与 MoneyFlow 一致：
		// FREE → Price 可以为空也可以是 "0₫"
		// TBD  → Price 为空（表示"双方面谈"，金额不在公开卡片上）
		// EARN/PAY → Price 必须填非 0₫ 的明确金额
		normalizeOpportunityMoney(&p)
		if p.MoneyFlow == "EARN" || p.MoneyFlow == "PAY" {
			if p.Price == "" || p.Price == "0₫" || p.Price == "0" {
				return rejected(e, "INVALID_OPPORTUNITY", "market.price_required_for_earn_or_pay")
			}
			if !priceWithinVNDLimit(p.Price) {
				return rejected(e, "INVALID_OPPORTUNITY", "market.price_outside_vnd_limits")
			}
		}
		if p.MoneyFlow == "FREE" && p.Price != "" && p.Price != "0₫" && p.Price != "0" {
			return rejected(e, "INVALID_OPPORTUNITY", "market.free_opportunity_must_have_zero_price")
		}
		if p.MoneyFlow == "TBD" && p.Price != "" {
			return rejected(e, "INVALID_OPPORTUNITY", "market.tbd_opportunity_must_have_no_price")
		}
		p.ID = newID("opp_")
		if s.numbers == nil {
			return command.Rejected(e, "NUMBER_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "market.number_unavailable", nil)
		}
		number, numberErr := s.numbers.Next(ctx, ordernumber.CategoryDemand)
		if numberErr != nil {
			return command.Rejected(e, "NUMBER_UNAVAILABLE", "INTERNAL", "SAFE_RETRY", "market.number_unavailable", nil)
		}
		p.Number = number
		p.OwnerID = e.Actor.ID
		// OPP-TARGETED-001: 定向邀约。payload 带 targetUserId = 只发给一个
		// 人（选人 → 向 TA 发出邀约）。快照进 Opportunity.TargetAccountID
		// （PG 走 payload JSONB，无迁移）；List 只对目标人和 owner 可见，
		// Apply 只收目标人。空 = 公开卡，行为不变。
		if target, _ := e.Payload["targetUserId"].(string); strings.TrimSpace(target) != "" {
			if target == e.Actor.ID {
				return rejected(e, "INVALID_OPPORTUNITY", "market.targeted_self_forbidden")
			}
			p.TargetAccountID = strings.TrimSpace(target)
		}
		// PROFILE-READ-001: PERSON owner names come from the verified
		// account profile, never hardcoded. Unresolved authors store an
		// empty owner; readers show a neutral label. Without a wired
		// resolver the legacy hardcoded label applies.
		p.Owner = "你"
		if s.authorNames != nil {
			p.Owner = ""
			if name, ok := s.authorNames.ResolveAuthorDisplayName(ctx, e.Actor.ID); ok {
				p.Owner = name
			}
		}
		p.OwnerType = "PERSON"
		// MARKET-FAKE-JUDGMENT-001: 以前这里无条件写 true —— 任何人发一条机会就带
		// 「发布方已验证」的勾，而平台对个人发布者没有做任何核验。这个勾是编出来的。
		// 只有下面 merchantStamp 命中（商家成员资格真的验过，见
		// apps/api-go/internal/api/merchant_identity.go）才算已验证。
		p.Verified = false
		// MERCHANT-PUBLISH-001: 商家注记（api 层 resolveMerchantPublish
		// 已验成员，见 apps/api-go/internal/api/merchant_identity.go，
		// 那里是 canonical）→ 以店名义发布。无注记保持个人路径不变。
		// OwnerID 保留发布人，保证 Owned/接单/屏蔽逻辑不变；读模型按
		// Owner/OwnerType 展示店名 + 商户标识。只认注记，不读 payload。
		if _, merchantName, ok := merchantStamp(e); ok {
			p.Owner = merchantName
			p.OwnerType = "BUSINESS"
			// 商家成员资格验过了 —— 这时候"已验证"才是有依据的。
			p.Verified = true
		}
		p.Posted = "刚刚"
		p.Responses = 0
		// MARKET-FAKE-JUDGMENT-001: 平台没有匹配引擎，写死一个百分比就是在编。
		// 空串 = 没有匹配度可展示；客户端据此不渲染那个"N% 匹配"标签。
		p.Match = ""
		p.Signal = "新发布"
		p.Countdown = p.Date
		p.Owned = true
		// 资金方向由发布方在 payload 里显式选 — 客户端必须传 EARN /
		// PAY / FREE / TBD 之一，不允许"裸金额"。上一步 normalize 已经
		// 把未指定的值推断完成，PriceLabel 也已派生；这里再调一次只是兜底
		//（normalize 内部对合法 MoneyFlow 是 no-op）。
		normalizeOpportunityMoney(&p)
		if p.ShortTitle == "" {
			p.ShortTitle = p.Theme
		}
		// lens 默认已收敛到 normalizeOpportunityMoney（List/Publish 单一 choke
		// 点），这里不再重复设，避免两处漂移。
		if err := s.repository.Create(ctx, p); err != nil {
			return command.Rejected(e, "MARKET_PUBLISH_FAILED", "INTERNAL", "SAFE_RETRY", "market.publish_failed", nil)
		}
		return payload(e, "MarketOpportunity", p.ID, "PUBLISHED", map[string]any{"opportunity": p})
	case "ApplyToMarketOpportunity":
		if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.ApplyOpportunity) {
			return rejected(e, "AI_ACTION_FORBIDDEN", "ai.action_forbidden")
		}
		// AIBOUND-001: 同上，报名必须 USER 主体。
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		// ORDER-APPLY-KYC-GATE-001：报名必须 KYC 通过。没接 checker（测试 / 无库）= 老行为。
		if s.orderPermission != nil {
			if ok, err := s.orderPermission(ctx, e.Actor.ID); err != nil || !ok {
				return rejected(e, "KYC_REQUIRED", "market.kyc_required")
			}
		}
		id, _ := e.Payload["opportunityId"].(string)
		quote, _ := e.Payload["quote"].(string)
		scope, _ := e.Payload["scope"].(string)
		stored, err := s.repository.Get(ctx, id)
		if errors.Is(err, ErrOpportunityNotFound) || quote == "" {
			return rejected(e, "INVALID_APPLICATION", "market.invalid_application")
		}
		if !priceWithinVNDLimit(quote) {
			return rejected(e, "INVALID_APPLICATION", "market.quote_outside_vnd_limits")
		}
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_failed", nil)
		}
		// OPP-TARGETED-001: 定向邀约只有目标人能报名——其他人连卡片都
		// 看不到，这里防的是直接拿 opportunityId 打命令的旁路。
		if stored.TargetAccountID != "" && stored.TargetAccountID != e.Actor.ID {
			return rejected(e, "APPLICATION_NOT_INVITED", "market.application_not_invited")
		}
		if stored.OwnerID == e.Actor.ID {
			return rejected(e, "OWNER_CANNOT_APPLY", "market.owner_cannot_apply")
		}
		a := Application{ID: newID("app_"), OpportunityID: id, ApplicantID: e.Actor.ID, Quote: quote, Scope: scope, Status: "SUBMITTED", CreatedAt: time.Now().UTC(), Scenario: stored.Scenario}
		a, _, err = s.repository.Apply(ctx, a)
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_failed", nil)
		}
		return payload(e, "MarketApplication", a.ID, a.Status, map[string]any{"application": a})
	case "ListMarketApplications":
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		id, _ := e.Payload["opportunityId"].(string)
		applications, err := s.repository.ListApplications(ctx, id, e.Actor.ID)
		if errors.Is(err, ErrOpportunityNotFound) {
			return rejected(e, "OPPORTUNITY_NOT_FOUND", "market.opportunity_not_found")
		}
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_list_failed", nil)
		}
		return payload(e, "MarketOpportunity", id, "APPLICATIONS_READY", map[string]any{"applications": applications})
	case "SelectMarketApplication":
		if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.SelectOpportunityApplication) {
			return rejected(e, "AI_ACTION_FORBIDDEN", "ai.action_forbidden")
		}
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		id, _ := e.Payload["opportunityId"].(string)
		applicationID, _ := e.Payload["applicationId"].(string)
		selected, err := s.repository.SelectApplication(ctx, id, applicationID, e.Actor.ID)
		if errors.Is(err, ErrOpportunityNotFound) || errors.Is(err, ErrApplicationNotFound) {
			return rejected(e, "APPLICATION_NOT_FOUND", "market.application_not_found")
		}
		if errors.Is(err, ErrApplicationStateConflict) {
			return rejected(e, "APPLICATION_STATE_CONFLICT", "market.application_state_conflict")
		}
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_SELECT_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_select_failed", nil)
		}
		return payload(e, "MarketApplication", selected.ID, selected.Status, map[string]any{"application": selected})
	case "ConfirmMarketApplication":
		if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.ConfirmOpportunityApplication) {
			return rejected(e, "AI_ACTION_FORBIDDEN", "ai.action_forbidden")
		}
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		applicationID, _ := e.Payload["applicationId"].(string)
		// R17.x: 派生真 orderId (server-unique, 不再是拼接
		// "order_"+applicationID). 如果 orderCreator 接入了
		// fulfillment, 同步创建真 Order 记录 — 这样
		// my orders 页 (走 fulfillment.listMyOrders) 能看到。
		// CHAT-ORDER-ATOMIC-001: the application id is already globally random,
		// so deriving the order id from it gives every retry the same business
		// object even when the HTTP idempotency key changes.
		orderID := "ord_" + applicationID
		var materialize []func(context.Context, Application) error
		if s.orderCreator != nil {
			materialize = append(materialize, func(txCtx context.Context, application Application) error {
				return s.orderCreator.EnsureOrder(txCtx, OrderRecord{
					ID: orderID, RequesterID: application.OwnerID,
					AgentID: application.ApplicantID, NeedID: application.OpportunityID,
					Scenario: application.Scenario,
				})
			})
		}
		confirmed, err := s.repository.ConfirmApplication(ctx, applicationID, e.Actor.ID, orderID, materialize...)
		if errors.Is(err, ErrApplicationNotFound) {
			return rejected(e, "APPLICATION_NOT_FOUND", "market.application_not_found")
		}
		if errors.Is(err, ErrApplicationStateConflict) {
			return rejected(e, "APPLICATION_STATE_CONFLICT", "market.application_state_conflict")
		}
		if err != nil {
			return command.Rejected(e, "MARKET_APPLICATION_CONFIRM_FAILED", "INTERNAL", "SAFE_RETRY", "market.application_confirm_failed", nil)
		}
		return payload(e, "Order", confirmed.OrderRef, "CONFIRMED", map[string]any{"application": confirmed, "orderRef": confirmed.OrderRef})
	case "DismissMarketOpportunity":
		// AIBOUND-001: Dismiss 之前无 gate，AI 主体可调；现与 Publish/Apply 对齐。
		if !aiboundary.Allows(aiboundary.FromCommandIdentity(e.Actor.Type, e.Principal.Type), aiboundary.DismissOpportunity) {
			return rejected(e, "AI_ACTION_FORBIDDEN", "ai.action_forbidden")
		}
		if e.Actor.Type != "USER" || e.Actor.ID == "" {
			return command.Rejected(e, "MARKET_ACTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "market.actor_required", nil)
		}
		id, _ := e.Payload["opportunityId"].(string)
		if err := s.repository.Dismiss(ctx, e.Actor.ID, id); errors.Is(err, ErrOpportunityNotFound) {
			return rejected(e, "OPPORTUNITY_NOT_FOUND", "market.opportunity_not_found")
		} else if err != nil {
			return command.Rejected(e, "MARKET_DISMISS_FAILED", "INTERNAL", "SAFE_RETRY", "market.dismiss_failed", nil)
		}
		return payload(e, "MarketOpportunity", id, "DISMISSED", map[string]any{"opportunityId": id})
	}
	return rejected(e, "MARKET_COMMAND_UNSUPPORTED", "market.unsupported_command")
}

const (
	minMarketAmountVND = 100_000
	maxMarketAmountVND = 10_000_000
)

func priceWithinVNDLimit(label string) bool {
	parts := strings.FieldsFunc(strings.TrimSpace(label), func(r rune) bool { return r == '–' || r == '—' || r == '-' })
	if len(parts) == 0 {
		return false
	}
	for _, part := range parts {
		clean := strings.ToUpper(strings.TrimSpace(part))
		clean = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(clean, "VND"), "₫"))
		multiplier := float64(1)
		if strings.HasSuffix(clean, "K") {
			multiplier = 1_000
			clean = strings.TrimSuffix(clean, "K")
		}
		if strings.HasSuffix(clean, "M") {
			multiplier = 1_000_000
			clean = strings.TrimSuffix(clean, "M")
		}
		clean = strings.ReplaceAll(clean, ",", "")
		amount, err := strconv.ParseFloat(strings.TrimSpace(clean), 64)
		if err != nil || amount*multiplier < minMarketAmountVND || amount*multiplier > maxMarketAmountVND {
			return false
		}
	}
	return true
}

// normalizeOpportunityMoney 强制把 moneyFlow / priceLabel / lens 落到合法
// 集合。读模型 (List) 写模型 (Publish) 都跑它，保证客户端无论怎么传，
// 最终下发的 MoneyFlow 都是 4 选 1，PriceLabel 永远存在，Lens 永远非空
// （contracts 要求 lens.min(1)；旧行 lens 为空必须兜底，否则整列 zod 炸）。
func normalizeOpportunityMoney(o *Opportunity) {
	switch o.MoneyFlow {
	case "EARN", "PAY", "FREE", "TBD":
		// legal
	default:
		// 未指定 / 拼错 / 客户端塞别的 — server 端推断。
		// 0₫ 或空 Price → FREE；显式传 TBD 已是上面合法分支；
		// 其他落到 EARN（最常见，机会主流是"客户预算 → 接单者赚到"）。
		if o.Price == "" || o.Price == "0₫" || o.Price == "0" {
			o.MoneyFlow = "FREE"
		} else {
			o.MoneyFlow = "EARN"
		}
	}
	if o.PriceLabel == "" {
		o.PriceLabel = opportunityPriceLabel(o.MoneyFlow)
	}
	if len(o.Lens) == 0 {
		o.Lens = []string{"BOOKED", "NEARBY"}
	}

	// R16.x: PriceLabel 是 server-authoritative 文案。client 可能传旧
	// 版本地文案（"你需支付"、"完成后你可获得"），或调试时填了错位
	// 文本，甚至为“避文案审查”贴”其它内容。无论客户端传什么，server
	// normalize 都必须推 opportunityPriceLabel(MoneyFlow)，令 wire
	// 下发的 PriceLabel 与 MoneyFlow 语义严格一致。这是 MONEYFLOW-004
	// tripwire。
	o.PriceLabel = opportunityPriceLabel(o.MoneyFlow)

	// ORDER-SCENARIO-001: scenario 只认 allowlist，其余清空 —— 历史行与
	// 非向导发布本来就没有这个字段，空值由订单侧按金额档兜底，不猜。
	if o.Scenario != "ordinary" && o.Scenario != "assistance" {
		o.Scenario = ""
	}
}

// stripLegacyFabricatedJudgment — 读路径上的存量编造值清理。
//
// MARKET-FAKE-JUDGMENT-001（2026-09-16）改的是**写**路径：PublishMarketOpportunity
// 不再无条件写 Verified=true，也不再写死 Match。但读路径
// （internal/platform/postgres/marketplace.go）是把整段 payload unmarshal 回来照发
// 的 —— 那次清扫之前发布的行，至今仍带着当时的编造值下发，客户端只能照画：
//
//   · Match  —— 平台从来没有匹配引擎，写路径现在恒为空串。任何非空 Match
//     都是存量值（活库里能看到 "100%"/"96%"），卡片会渲染成「100% 匹配」。
//   · Verified —— 只有商家成员资格真的验过（api 层 merchantStamp，见
//     merchant_identity.go）才该为 true，写路径同时把 OwnerType 置成
//     BUSINESS。存量行里 ownerType=PERSON + verified=true 这个组合是写路径
//     从来不产出的，详情页据此给个人发布者画了「商家身份已验证」。
//
// 只清「平台不产出的形态」，不新增任何判断：Verified 为 true 且 OwnerType 是
// BUSINESS 的行（真商家）原样保留；种子行的 Verified=false 也原样保留。
//
// 真接上匹配引擎 / 个人核验那天，删掉对应那一行，并把
// MARKET-LEGACY-FABRICATED-001 的钉一起改。
func stripLegacyFabricatedJudgment(o *Opportunity) {
	o.Match = ""
	if o.Verified && o.OwnerType != "BUSINESS" {
		o.Verified = false
	}
}

func opportunityPriceLabel(flow string) string {
	switch flow {
	case "FREE":
		return "免费"
	case "PAY":
		return "你需支付"
	case "TBD":
		return "费用待确认"
	default:
		return "完成后你可获得"
	}
}

func (r *MemoryRepository) Seed(_ context.Context, opportunities []Opportunity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.opportunities) == 0 {
		r.opportunities = append([]Opportunity(nil), opportunities...)
	}
	return nil
}
func (r *MemoryRepository) List(_ context.Context, viewerID string) ([]Opportunity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := make([]Opportunity, 0, len(r.opportunities))
	for _, stored := range r.opportunities {
		// OPP-TARGETED-001: a directed invitation is visible ONLY to
		// its target and its owner — never in the public feed.
		if stored.TargetAccountID != "" && stored.TargetAccountID != viewerID && stored.OwnerID != viewerID {
			continue
		}
		if r.dismissed[viewerID+"|"+stored.ID] {
			continue
		}
		item := stored
		item.Owned = stored.OwnerID == viewerID
		if application, ok := r.applications[stored.ID][viewerID]; ok {
			item.Applied = true
			item.ViewerApplicationID = application.ID
			item.ViewerApplicationStatus = application.Status
			item.ViewerOrderRef = application.OrderRef
		}
		items = append(items, item)
	}
	return items, nil
}
func (r *MemoryRepository) Get(_ context.Context, id string) (Opportunity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, item := range r.opportunities {
		if item.ID == id {
			return item, nil
		}
	}
	return Opportunity{}, ErrOpportunityNotFound
}
func (r *MemoryRepository) GetByNumber(_ context.Context, number string) (Opportunity, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if number != "" {
		for _, item := range r.opportunities {
			if item.Number == number {
				return item, nil
			}
		}
	}
	return Opportunity{}, ErrOpportunityNotFound
}
func (r *MemoryRepository) Create(_ context.Context, opportunity Opportunity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.opportunities = append([]Opportunity{opportunity}, r.opportunities...)
	return nil
}
func (r *MemoryRepository) Apply(_ context.Context, application Application) (Application, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	index := -1
	for i := range r.opportunities {
		if r.opportunities[i].ID == application.OpportunityID {
			index = i
			break
		}
	}
	if index < 0 {
		return Application{}, false, ErrOpportunityNotFound
	}
	if r.applications[application.OpportunityID] == nil {
		r.applications[application.OpportunityID] = make(map[string]Application)
	}
	if existing, ok := r.applications[application.OpportunityID][application.ApplicantID]; ok {
		return existing, false, nil
	}
	r.applications[application.OpportunityID][application.ApplicantID] = application
	r.opportunities[index].Responses++
	return application, true, nil
}
func (r *MemoryRepository) ListApplications(_ context.Context, opportunityID, ownerID string) ([]Application, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	found := false
	for _, item := range r.opportunities {
		if item.ID == opportunityID {
			found = true
			if item.OwnerID != ownerID {
				return nil, ErrOpportunityNotFound
			}
			break
		}
	}
	if !found {
		return nil, ErrOpportunityNotFound
	}
	items := []Application{}
	for _, item := range r.applications[opportunityID] {
		items = append(items, item)
	}
	return items, nil
}
func (r *MemoryRepository) SelectApplication(_ context.Context, opportunityID, applicationID, ownerID string) (Application, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	owned := false
	for _, item := range r.opportunities {
		if item.ID == opportunityID && item.OwnerID == ownerID {
			owned = true
			break
		}
	}
	if !owned {
		return Application{}, ErrOpportunityNotFound
	}
	apps := r.applications[opportunityID]
	var selected Application
	found := false
	for _, item := range apps {
		if item.ID == applicationID {
			selected, found = item, true
			break
		}
	}
	if !found {
		return Application{}, ErrApplicationNotFound
	}
	if selected.Status != "SUBMITTED" && selected.Status != "SELECTED" {
		return Application{}, ErrApplicationStateConflict
	}
	now := time.Now().UTC()
	for applicantID, item := range apps {
		if item.ID == applicationID {
			item.Status = "SELECTED"
			item.SelectedAt = &now
			selected = item
		} else if item.Status == "SUBMITTED" {
			item.Status = "NOT_SELECTED"
		}
		apps[applicantID] = item
	}
	return selected, nil
}
func (r *MemoryRepository) ConfirmApplication(ctx context.Context, applicationID, applicantID, orderRef string, callbacks ...func(context.Context, Application) error) (Application, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var materialize func(context.Context, Application) error
	if len(callbacks) > 0 {
		materialize = callbacks[0]
	}
	for opportunityID, apps := range r.applications {
		for key, item := range apps {
			if item.ID != applicationID {
				continue
			}
			if item.ApplicantID != applicantID {
				return Application{}, ErrApplicationNotFound
			}
			// R17.x: idempotent — 如果已经 CONFIRMED 且 OrderRef
			// 存在, 第二次调用不覆盖, 透传原 OrderRef. 这样
			// 同一 application 重复 confirm 不会改 orderRef
			// (避免 “我的订单” 看到两个 order). Server 侧
			// EnsureOrder 会校验并复用同一业务订单，修复旧版本可能遗留的
			// CONFIRMED-but-missing-order 半状态。
			for _, opportunity := range r.opportunities {
				if opportunity.ID == item.OpportunityID {
					item.OwnerID = opportunity.OwnerID
					break
				}
			}
			if item.OwnerID == "" {
				return Application{}, ErrOpportunityNotFound
			}
			if item.Status == "CONFIRMED" && item.OrderRef != "" {
				if materialize != nil {
					if err := materialize(ctx, item); err != nil {
						return Application{}, err
					}
				}
				return item, nil
			}
			if item.Status != "SELECTED" && item.Status != "CONFIRMED" {
				return Application{}, ErrApplicationStateConflict
			}
			now := time.Now().UTC()
			if materialize != nil {
				if err := materialize(ctx, item); err != nil {
					return Application{}, err
				}
			}
			item.Status = "CONFIRMED"
			item.ConfirmedAt = &now
			item.OrderRef = orderRef
			apps[key] = item
			r.applications[opportunityID] = apps
			return item, nil
		}
	}
	return Application{}, ErrApplicationNotFound
}
func (r *MemoryRepository) Dismiss(_ context.Context, viewerID, opportunityID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	found := false
	for _, item := range r.opportunities {
		if item.ID == opportunityID {
			found = true
			break
		}
	}
	if !found {
		return ErrOpportunityNotFound
	}
	r.dismissed[viewerID+"|"+opportunityID] = true
	return nil
}
func decode(value any, target any) bool {
	raw, err := json.Marshal(value)
	return err == nil && json.Unmarshal(raw, target) == nil
}
func rejected(e command.Envelope, code, key string) command.Result {
	return command.Rejected(e, code, "VALIDATION", "AFTER_USER_ACTION", key, nil)
}

// merchantStamp reads the verified merchant annotation stamped by the api
// layer (resolveMerchantPublish). Canonical keys live in
// apps/api-go/internal/api/merchant_identity.go — this is a read-only
// mirror (api cannot be imported here: import cycle). Never read
// payload.merchantId here: it is client-controlled.
func merchantStamp(e command.Envelope) (string, string, bool) {
	if e.AuthContext == nil {
		return "", "", false
	}
	id, _ := e.AuthContext["merchantID"].(string)
	name, _ := e.AuthContext["merchantName"].(string)
	if id == "" || name == "" {
		return "", "", false
	}
	return id, name, true
}

func rejectedWith(e command.Envelope, code, key string, reason string, extras map[string]any) command.Result {
	merged := make(map[string]any, len(extras)+1)
	for k, v := range extras {
		merged[k] = v
	}
	if reason != "" {
		merged["reason"] = reason
	}
	return command.Rejected(e, code, "INTERNAL", "SAFE_RETRY", key, merged)
}
func payload(e command.Envelope, typ, id, state string, body map[string]any) command.Result {
	r := command.Accepted(e, typ, id, 1, state, nil)
	raw, _ := json.Marshal(body)
	r.OperationRef = string(raw)
	return r
}
func newID(prefix string) string {
	var b [10]byte
	if _, err := rand.Read(b[:]); err == nil {
		return prefix + hex.EncodeToString(b[:])
	}
	return prefix + strconv.FormatInt(time.Now().UnixNano(), 36)
}

// readUserFix extracts an optional foreground-location fix from
// the ListMarketOpportunities payload. The mobile MarketExperience
// passes (userLat, userLng) once it has obtained consent via
// expo-location. Both fields must be present and finite, otherwise
// the caller falls back to the seeded Travel.
func readUserFix(payload map[string]any) (lat float64, lng float64, ok bool) {
	if payload == nil {
		return 0, 0, false
	}
	rawLat, latOk := payload["userLat"].(float64)
	rawLng, lngOk := payload["userLng"].(float64)
	if !latOk || !lngOk {
		return 0, 0, false
	}
	// Reject obvious garbage. Latitude is bounded by ±90, longitude
	// by ±180. (0,0) is in the Atlantic Ocean off the African
	// coast — not a valid Vietnamese city fix.
	if rawLat < -90 || rawLat > 90 || rawLng < -180 || rawLng > 180 {
		return 0, 0, false
	}
	if rawLat == 0 && rawLng == 0 {
		return 0, 0, false
	}
	return rawLat, rawLng, true
}

// haversineKm returns the great-circle distance between two
// (lat, lng) points in kilometres. We use the standard
// spherical-earth formula with R = 6371 km. The result is
// accurate to within ~0.5 % over the distances a city
// rider actually covers (0–50 km).
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	rad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLng := rad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}
