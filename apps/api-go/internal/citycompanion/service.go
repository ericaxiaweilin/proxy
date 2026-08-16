package citycompanion

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

// CityCompanionNeed 是城市同行需求的聚合。
// 对齐 PRD Chapter21F：Task First, People Second；价格属于本单 Offer，不属于人的长期标价。
type CityCompanionNeed struct {
	ID             string                `json:"id"`
	OwnerUserID    string                `json:"ownerUserId"`
	Lifecycle      string                `json:"lifecycle"` // DRAFT -> CANDIDATES -> CONFIRMED -> COMPLETED / CANCELLED
	Version        int                   `json:"version"`
	Duration       string                `json:"duration"`        // 4H | 8H
	Language       string                `json:"language"`        // zh | en | vi
	GenderPref     string                `json:"genderPref"`      // any | female | male
	Interests      []string              `json:"interests"`       // 咖啡 / 拍照 / 夜生活 ...
	Meeting        string                `json:"meeting"`         // 集合点
	BudgetVND      int64                 `json:"budgetVnd"`       // 预算参考（实验值，非 Price Floor）
	Route          *CityRoute            `json:"route,omitempty"` // 行程方案（R2 §10）
	RouteChanges   []MaterialRouteChange `json:"routeChanges"`    // material_route_changes[]
	ConfirmedAgent *ConfirmedAgent       `json:"confirmedAgent,omitempty"`
	SceneVisits    []SceneCommerceVisit  `json:"sceneVisits"`
	UpdatedAt      time.Time             `json:"updatedAt"`
}

type ConfirmedAgent struct {
	AgentID  string `json:"agentId"`
	Name     string `json:"name"`
	OfferVND int64  `json:"offerVnd"` // 本单报价
	Duration string `json:"duration"`
	Currency string `json:"currency"`
}

type SceneCommerceVisit struct {
	VenueID    string    `json:"venueId"`
	VenueType  string    `json:"venueType"` // cafe | restaurant
	Attributed bool      `json:"attributed"`
	VisitedAt  time.Time `json:"visitedAt"`
}

// Candidate 是候选卡（PRD §7）：本单报价 + 履约/满意/单量/语言 + 1-3 个本单证明。
// 对齐 "不显示不可解释的 96% fit"。
type Candidate struct {
	AgentID             string   `json:"agentId"`
	Name                string   `json:"name"`
	OfferVND            int64    `json:"offerVnd"`            // 本单报价
	FulfillmentRate     float64  `json:"fulfillmentRate"`     // 履约率
	SatisfactionRate    float64  `json:"satisfactionRate"`    // 满意率
	CompletedCityOrders int      `json:"completedCityOrders"` // 已完成城市同行单量
	Languages           []string `json:"languages"`
	Style               string   `json:"style"`
	Proofs              []string `json:"proofs"` // 1-3 个本单证明：中文已验证 / 河内 26 单 ...
}

// eligibilityScore 实现 "Eligibility before Ranking"（PRD §7）：
// 主排序 = 资格 + 可用性 + 履约 + 本单适配，不是 "fit score"。
type eligibilityScore struct {
	candidate *Candidate
	score     float64
}

// candidatePool 是供给池。正式版由 Capability Graph / Availability 提供，
// P0 用本地种子供给对齐原型候选（linh / mai / minh）。
type candidatePool struct {
	candidates []*Candidate
}

func defaultCandidatePool() []*Candidate {
	return []*Candidate{
		{
			AgentID: "agent_linh", Name: "Linh", OfferVND: 1200000,
			FulfillmentRate: 0.98, SatisfactionRate: 0.97, CompletedCityOrders: 26,
			Languages: []string{"vi", "zh"}, Style: "本地生活 · 咖啡 · 拍照",
			Proofs: []string{"中文：已验证", "河内城市同行：26 单", "摄影 / 拍照协助：已验证"},
		},
		{
			AgentID: "agent_mai", Name: "Mai", OfferVND: 1350000,
			FulfillmentRate: 0.96, SatisfactionRate: 0.95, CompletedCityOrders: 18,
			Languages: []string{"vi", "en"}, Style: "美食 · 夜生活",
			Proofs: []string{"英文：已验证", "餐饮 / 夜生活熟悉度"},
		},
		{
			AgentID: "agent_minh", Name: "Minh", OfferVND: 1150000,
			FulfillmentRate: 0.94, SatisfactionRate: 0.93, CompletedCityOrders: 12,
			Languages: []string{"vi", "zh", "en"}, Style: "人文 · 历史 · 摄影",
			Proofs: []string{"中文：已验证", "摄影 / 拍照协助：已验证"},
		},
	}
}

type Repository interface {
	CreateNeed(ctx context.Context, need CityCompanionNeed) error
	GetNeed(ctx context.Context, id string) (CityCompanionNeed, error)
	UpdateNeed(ctx context.Context, need CityCompanionNeed, expectedVersion int) error
	Snapshot(ctx context.Context) ([]CityCompanionNeed, error)
}

var (
	ErrNeedNotFound    = errors.New("city companion need not found")
	ErrVersionConflict = errors.New("city companion need version conflict")
)

// maxOfferVND 是本单报价上限（fail-closed 防异常金额进入成交事实）。
const maxOfferVND = 1_000_000_000

type MemoryRepository struct {
	mu     sync.Mutex
	needs  map[string]CityCompanionNeed
	events []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{needs: make(map[string]CityCompanionNeed)}
}

func (r *MemoryRepository) CreateNeed(_ context.Context, need CityCompanionNeed) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.needs[need.ID]; exists {
		return errors.New("need already exists")
	}
	r.needs[need.ID] = cloneNeed(need)
	return nil
}

func (r *MemoryRepository) GetNeed(_ context.Context, id string) (CityCompanionNeed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	need, exists := r.needs[id]
	if !exists {
		return CityCompanionNeed{}, ErrNeedNotFound
	}
	return cloneNeed(need), nil
}

func (r *MemoryRepository) UpdateNeed(_ context.Context, need CityCompanionNeed, expectedVersion int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, exists := r.needs[need.ID]
	if !exists {
		return ErrNeedNotFound
	}
	if current.Version != expectedVersion {
		return ErrVersionConflict
	}
	r.needs[need.ID] = cloneNeed(need)
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]CityCompanionNeed, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]CityCompanionNeed, 0, len(r.needs))
	for _, need := range r.needs {
		result = append(result, cloneNeed(need))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func cloneNeed(need CityCompanionNeed) CityCompanionNeed {
	need.Interests = append([]string(nil), need.Interests...)
	need.SceneVisits = append([]SceneCommerceVisit(nil), need.SceneVisits...)
	need.RouteChanges = append([]MaterialRouteChange(nil), need.RouteChanges...)
	if need.Route != nil {
		copy := *need.Route
		copy.Stops = append([]RouteStop(nil), need.Route.Stops...)
		need.Route = &copy
	}
	if need.ConfirmedAgent != nil {
		copy := *need.ConfirmedAgent
		need.ConfirmedAgent = &copy
	}
	return need
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	pool       []*Candidate
	supplier   Supplier
	clock      clock.Clock
}

// DurationHours 把 "4H"/"8H" 解析为小时数。
func (n CityCompanionNeed) DurationHours() int {
	switch n.Duration {
	case "4H":
		return 4
	case "8H":
		return 8
	default:
		return 4
	}
}

// Supplier 是真实供给查询接口（B：由 supply 包实现）。
// nil 时回退本地 seed pool（保持向后兼容）。
type Supplier interface {
	QueryEligibleCandidates(ctx context.Context, query CandidateQuery) ([]SupplyCandidate, error)
}

// CandidateQuery 是城市同行候选查询。
type CandidateQuery struct {
	MarketID     string
	StartAt      time.Time
	DurationH    int
	Language     string
	Capabilities []string
	BudgetVND    int64
}

// SupplyCandidate 是供给侧返回的真实候选。
type SupplyCandidate struct {
	AgentID        string
	Name           string
	Languages      []string
	ReferencePrice int64
	Currency       string
	VerifiedCaps   []string
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, pool: defaultCandidatePool(), clock: clock.System{}}
}

func NewWithRepositoryAndClock(repository Repository, domainClock clock.Clock) *Service {
	s := NewWithRepository(repository)
	if domainClock != nil {
		s.clock = domainClock
	}
	return s
}

// NewWithRepositoryAndSupplier 接真实供给（B：候选来自 supply，非 seed）。
func NewWithRepositoryAndSupplier(repository Repository, supplier Supplier) *Service {
	s := NewWithRepository(repository)
	s.supplier = supplier
	return s
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateCityCompanionNeed", "ListCityCompanionCandidates",
		"ConfirmCityCompanion", "CompleteCityCompanion", "RecordSceneCommerceVisit",
		"GenerateCityCompanionRoute", "AcceptCityCompanionRoute", "RecordMaterialRouteChange":
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
	case "CreateCityCompanionNeed":
		return s.createNeed(ctx, e)
	case "ListCityCompanionCandidates":
		return s.listCandidates(ctx, e)
	case "ConfirmCityCompanion":
		return s.confirm(ctx, e)
	case "CompleteCityCompanion":
		return s.complete(ctx, e)
	case "RecordSceneCommerceVisit":
		return s.recordSceneVisit(ctx, e)
	case "GenerateCityCompanionRoute":
		return s.generateRoute(ctx, e)
	case "AcceptCityCompanionRoute":
		return s.acceptRoute(ctx, e)
	case "RecordMaterialRouteChange":
		return s.recordMaterialRouteChange(ctx, e)
	default:
		return command.Rejected(e, "CITY_COMPANION_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.unsupported_command", nil)
	}
}

// ---------- CreateCityCompanionNeed ----------

type createNeedPayload struct {
	Duration   string   `json:"duration"`
	Language   string   `json:"language"`
	GenderPref string   `json:"genderPref"`
	Interests  []string `json:"interests"`
	Meeting    string   `json:"meeting"`
	BudgetVND  int64    `json:"budgetVnd"`
}

func (s *Service) createNeed(ctx context.Context, e command.Envelope) command.Result {
	var p createNeedPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_CITY_COMPANION_NEED", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_need", nil)
	}
	if p.Duration != "4H" && p.Duration != "8H" {
		return command.Rejected(e, "INVALID_DURATION", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_duration", map[string]any{"duration": p.Duration})
	}
	if p.Language == "" {
		p.Language = "zh"
	}
	if p.Meeting == "" {
		return command.Rejected(e, "MEETING_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.meeting_required", nil)
	}
	if e.Actor.Type != "USER" {
		return command.Rejected(e, "NEED_CREATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.need_creation_not_allowed", nil)
	}
	need := CityCompanionNeed{
		ID:          newID("ccn_"),
		OwnerUserID: e.Actor.ID,
		Lifecycle:   "CANDIDATES",
		Version:     1,
		Duration:    p.Duration,
		Language:    p.Language,
		GenderPref:  p.GenderPref,
		Interests:   append([]string(nil), p.Interests...),
		Meeting:     p.Meeting,
		BudgetVND:   p.BudgetVND,
		UpdatedAt:   s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("CityCompanionNeedCreated", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"ownerUserId": need.OwnerUserID,
		"duration":    need.Duration,
		"language":    need.Language,
		"interests":   need.Interests,
		"meeting":     need.Meeting,
		"budgetVnd":   need.BudgetVND,
	})}
	if err := s.repository.CreateNeed(ctx, need); err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_create_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, 1, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- ListCityCompanionCandidates ----------
// PRD §6/§7：Eligibility before Ranking；不公开反向竞价——候选只返回本单报价，
// 不暴露彼此最低报价竞争过程。主排序 = 资格 + 可用性 + 履约 + 本单适配。

type listCandidatesPayload struct {
	ExpectedVersion int `json:"expectedVersion"`
}

func (s *Service) listCandidates(ctx context.Context, e command.Envelope) command.Result {
	var p listCandidatesPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 {
		return command.Rejected(e, "INVALID_CANDIDATE_LIST", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_candidate_list", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "CANDIDATE_LIST_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.candidate_list_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion, "actualVersion": need.Version})
	}
	candidates := s.candidatesFor(ctx, need)
	// 结果通过 Accepted 的 Payload 返回给客户端
	return acceptedWithPayload(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, map[string]any{
		"needId":          need.ID,
		"candidates":      candidates,
		"eligibilityNote": "Eligibility before Ranking：资格 + 可用性 + 履约 + 本单适配；候选来自真实供给查询（B），非公开目录。",
	}, nil)
}

// candidatesFor 优先走真实供给（supplier），无 supplier 时回退 seed pool。
func (s *Service) candidatesFor(ctx context.Context, need CityCompanionNeed) []Candidate {
	if s.supplier != nil {
		start := time.Now().Add(24 * time.Hour).UTC()
		query := CandidateQuery{
			MarketID:     need.Meeting,
			StartAt:      start,
			DurationH:    need.DurationHours(),
			Language:     need.Language,
			Capabilities: nil, // 硬要求=语言（adapter 转 ZH/VI）；CITY_GUIDE 不强制
			BudgetVND:    need.BudgetVND,
		}
		supplyCandidates, err := s.supplier.QueryEligibleCandidates(ctx, query)
		if err == nil && len(supplyCandidates) > 0 {
			result := make([]Candidate, 0, len(supplyCandidates))
			for _, sc := range supplyCandidates {
				result = append(result, Candidate{
					AgentID:             sc.AgentID,
					Name:                sc.Name,
					OfferVND:            sc.ReferencePrice, // 本单报价来自真实参考价
					FulfillmentRate:     0.97,              // 待 Outcome 数据接入后取真实履约率
					SatisfactionRate:    0.95,
					CompletedCityOrders: 0,
					Languages:           sc.Languages,
					Style:               "city_companion",
					Proofs:              verifiedProofs(sc.VerifiedCaps),
				})
			}
			return result
		}
		// supplier 无结果 → 返回空（shortage），不回退 seed（不允许 fallback 到 seed 后还显示成功）
		return []Candidate{}
	}
	return s.eligible(need)
}

func verifiedProofs(verifiedCaps []string) []string {
	proofs := make([]string, 0, len(verifiedCaps))
	for _, cap := range verifiedCaps {
		switch cap {
		case "ZH":
			proofs = append(proofs, "中文已验证")
		case "VI":
			proofs = append(proofs, "越南语已验证")
		case "PHOTOGRAPHY":
			proofs = append(proofs, "摄影能力已验证")
		default:
			proofs = append(proofs, cap+"已验证")
		}
	}
	return proofs
}

// eligible 实现 Eligibility before Ranking。
// 过滤：语言匹配 + 兴趣重叠 + 预算范围（如提供）；排序：履约率 → 满意率 → 已完成单量 → 本单适配。
func (s *Service) eligible(need CityCompanionNeed) []Candidate {
	var scored []eligibilityScore
	for _, c := range s.pool {
		if !languageMatches(c, need.Language) {
			continue
		}
		score := 0.0
		score += c.FulfillmentRate * 100.0 // 履约权重最高
		score += c.SatisfactionRate * 100.0 * 0.5
		score += float64(c.CompletedCityOrders) * 0.5
		if need.BudgetVND > 0 && c.OfferVND <= need.BudgetVND {
			score += 5.0 // 本单适配
		}
		scored = append(scored, eligibilityScore{candidate: c, score: score})
	}
	sort.Slice(scored, func(i, j int) bool { return scored[i].score > scored[j].score })
	// 最多返回 3 位（对齐原型 "找到 3 位合适的人"）
	result := make([]Candidate, 0, 3)
	for i, item := range scored {
		if i >= 3 {
			break
		}
		result = append(result, *item.candidate)
	}
	return result
}

func languageMatches(c *Candidate, language string) bool {
	if language == "" || language == "any" {
		return true
	}
	for _, l := range c.Languages {
		if strings.EqualFold(l, language) {
			return true
		}
	}
	return false
}

// ---------- ConfirmCityCompanion ----------
// PRD §5/§9：确认页把"人、时间、服务价格、沿途消费"拆开；餐厅/咖啡是可选增值，不强制绑成旅游套餐。

type confirmPayload struct {
	ExpectedVersion   int    `json:"expectedVersion"`
	AgentID           string `json:"agentId"`
	OfferVND          int64  `json:"offerVnd"`
	IncludeCafe       bool   `json:"includeCafe"` // 可选增值，不改变服务价格
	IncludeRestaurant bool   `json:"includeRestaurant"`
}

func (s *Service) confirm(ctx context.Context, e command.Envelope) command.Result {
	var p confirmPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 || p.AgentID == "" || p.OfferVND <= 0 {
		return command.Rejected(e, "INVALID_CONFIRMATION", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_confirmation", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "CONFIRMATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.confirmation_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
	}
	if need.Lifecycle != "CANDIDATES" && need.Lifecycle != "DRAFT" {
		return command.Rejected(e, "CITY_COMPANION_NOT_CONFIRMABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.not_confirmable", nil)
	}
	// 验证 Agent 在本单真实候选集中（candidatesFor：supplier 模式走真实供给，
	// 无 supplier 时回退 seed pool；两种模式统一校验，防确认候选集外的人）。
	candidates := s.candidatesFor(ctx, need)
	var candidate *Candidate
	for i := range candidates {
		if candidates[i].AgentID == p.AgentID {
			candidate = &candidates[i]
			break
		}
	}
	if candidate == nil {
		return command.Rejected(e, "AGENT_NOT_IN_CANDIDATES", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.agent_not_in_candidates", map[string]any{"agentId": p.AgentID})
	}
	// 报价以服务端候选快照为权威：客户端不得自行压价/抬价（防 offerVnd:1 成交），
	// 且受单笔金额上限约束。
	if p.OfferVND != candidate.OfferVND {
		return command.Rejected(e, "OFFER_PRICE_MISMATCH", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.offer_price_mismatch",
			map[string]any{"expectedOfferVnd": candidate.OfferVND})
	}
	if p.OfferVND > maxOfferVND {
		return command.Rejected(e, "OFFER_EXCEEDS_LIMIT", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.offer_exceeds_limit",
			map[string]any{"maxOfferVnd": maxOfferVND})
	}
	need.ConfirmedAgent = &ConfirmedAgent{
		AgentID:  candidate.AgentID,
		Name:     candidate.Name,
		OfferVND: candidate.OfferVND, // 服务端权威报价
		Duration: need.Duration,
		Currency: "VND",
	}
	need.Lifecycle = "CONFIRMED"
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CityCompanionConfirmed", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"agentId":           p.AgentID,
		"offerVnd":          p.OfferVND,
		"includeCafe":       p.IncludeCafe,
		"includeRestaurant": p.IncludeRestaurant,
		"servicePriceNote":  "本单服务价格，不属于人的长期标价",
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "CITY_COMPANION_CONFIRM_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.confirm_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- CompleteCityCompanion ----------

func (s *Service) complete(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		ExpectedVersion int `json:"expectedVersion"`
	}
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 {
		return command.Rejected(e, "INVALID_COMPLETION", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_completion", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "COMPLETION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.completion_not_allowed", nil)
	}
	if need.Lifecycle != "CONFIRMED" {
		return command.Rejected(e, "CITY_COMPANION_NOT_COMPLETABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.not_completable", map[string]any{"lifecycle": need.Lifecycle})
	}
	need.Lifecycle = "COMPLETED"
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CityCompanionCompleted", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"agentId": need.ConfirmedAgent.AgentID,
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "CITY_COMPANION_COMPLETE_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.complete_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordSceneCommerceVisit ----------
// PRD §9：城市同行后承接 Scene Commerce；商家佣金不得静默改变用户路线。

type sceneVisitPayload struct {
	ExpectedVersion int    `json:"expectedVersion"`
	VenueID         string `json:"venueId"`
	VenueType       string `json:"venueType"` // cafe | restaurant
	Attributed      bool   `json:"attributed"`
}

func (s *Service) recordSceneVisit(ctx context.Context, e command.Envelope) command.Result {
	var p sceneVisitPayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 || p.VenueID == "" || p.VenueType == "" {
		return command.Rejected(e, "INVALID_SCENE_VISIT", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_scene_visit", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "SCENE_VISIT_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.scene_visit_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
	}
	visit := SceneCommerceVisit{VenueID: p.VenueID, VenueType: p.VenueType, Attributed: p.Attributed, VisitedAt: s.clock.Now().UTC()}
	need.SceneVisits = append(need.SceneVisits, visit)
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("SceneCommerceVisitRecorded", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"venueId":    p.VenueID,
		"venueType":  p.VenueType,
		"attributed": p.Attributed,
		"note":       "商家佣金不得静默改变用户路线",
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "SCENE_VISIT_RECORD_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.scene_visit_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- 行程规划（R2 §10 履约主链：Route / Scope Preview）----------
// 对齐 PRD：AI involvement HIGH / transaction authority LOW——AI 可规划路线/场景/节奏，
// 但不能静默锁定消费、价格、人选或不可取消的商家安排。

// RouteStop 是行程中的一站（场景）。
type RouteStop struct {
	VenueID   string `json:"venueId"`
	Name      string `json:"name"`
	VenueType string `json:"venueType"` // cafe | restaurant | sight | photo | market ...
	Note      string `json:"note,omitempty"`
}

// CityRoute 是生成/确认的行程方案。
type CityRoute struct {
	Version        int         `json:"version"`
	Style          string      `json:"style"` // RELAXED | FOOD | LOCAL
	Pace           string      `json:"pace"`
	Distance       string      `json:"distance"`
	EstimatedSpend string      `json:"estimatedSpend"`
	Stops          []RouteStop `json:"stops"`
	Accepted       bool        `json:"accepted"`
}

// MaterialRouteChange 是行程重大变化记录（R2 §10 material_route_changes[]）。
type MaterialRouteChange struct {
	ChangeID    string    `json:"changeId"`
	Description string    `json:"description"`
	ReConfirmed bool      `json:"reConfirmed"`
	RecordedAt  time.Time `json:"recordedAt"`
}

// ---------- GenerateCityCompanionRoute ----------
// AI involvement HIGH / transaction authority LOW：生成路线是建议方案，不锁定任何商业安排。

type generateRoutePayload struct {
	ExpectedVersion int    `json:"expectedVersion"`
	Style           string `json:"style"` // RELAXED | FOOD | LOCAL
}

var routeSceneCatalog = map[string][]RouteStop{
	"RELAXED": {
		{VenueID: "sight_hoankiem", Name: "还剑湖", VenueType: "sight", Note: "湖边散步 + 拍照"},
		{VenueID: "cafe_oldquarter", Name: "老街咖啡馆", VenueType: "cafe", Note: "本地咖啡 · 可替换"},
		{VenueID: "photo_trainstreet", Name: "火车街", VenueType: "photo", Note: "经典拍照点"},
	},
	"FOOD": {
		{VenueID: "cafe_eggcoffee", Name: "鸡蛋咖啡", VenueType: "cafe", Note: "河内特色 · 可替换"},
		{VenueID: "rest_pho", Name: "本地 Pho", VenueType: "restaurant", Note: "非游客店 · 可替换"},
		{VenueID: "market_dongxuan", Name: "同春市场", VenueType: "market", Note: "小吃 + 本地生活"},
	},
	"LOCAL": {
		{VenueID: "street_hoan", Name: "老街巷子", VenueType: "sight", Note: "小店 · 街区"},
		{VenueID: "market_dongxuan", Name: "同春市场", VenueType: "market", Note: "本地生活"},
		{VenueID: "cafe_local", Name: "社区咖啡馆", VenueType: "cafe", Note: "本地日常 · 可替换"},
	},
}

func (s *Service) generateRoute(ctx context.Context, e command.Envelope) command.Result {
	var p generateRoutePayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 {
		return command.Rejected(e, "INVALID_ROUTE_GENERATION", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_route_generation", nil)
	}
	if p.Style != "RELAXED" && p.Style != "FOOD" && p.Style != "LOCAL" {
		p.Style = "RELAXED"
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "ROUTE_GENERATION_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.route_generation_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
	}
	if need.Lifecycle != "CANDIDATES" && need.Lifecycle != "DRAFT" {
		return command.Rejected(e, "ROUTE_GENERATION_NOT_ALLOWED_LIFECYCLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.route_generation_lifecycle", map[string]any{"lifecycle": need.Lifecycle})
	}
	stops := routeSceneCatalog[p.Style]
	nextVersion := 1
	if need.Route != nil {
		nextVersion = need.Route.Version + 1
	}
	route := CityRoute{
		Version:        nextVersion,
		Style:          p.Style,
		Pace:           paceLabel(p.Style),
		Distance:       distanceLabel(p.Style),
		EstimatedSpend: spendLabel(need.Duration, p.Style),
		Stops:          stops,
		Accepted:       false,
	}
	need.Route = &route
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CityCompanionRouteGenerated", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"routeVersion": route.Version,
		"style":        route.Style,
		"stops":        stopNames(stops),
		"note":         "AI involvement HIGH / transaction authority LOW：路线是建议方案，不锁定消费/价格/人选/商家安排",
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "ROUTE_GENERATION_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.route_generation_failed", nil)
	}
	return acceptedWithPayload(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, map[string]any{
		"needId": need.ID,
		"route":  route,
		"note":   "路线会参与匹配但不会锁死；成交后仍可调整",
	}, domainEvents)
}

// ---------- AcceptCityCompanionRoute ----------
// "用这条路线去选人"：确认路线后进入候选匹配（不锁定商业安排）。

func (s *Service) acceptRoute(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		ExpectedVersion int `json:"expectedVersion"`
	}
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 {
		return command.Rejected(e, "INVALID_ROUTE_ACCEPT", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_route_accept", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "ROUTE_ACCEPT_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.route_accept_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
	}
	if need.Route == nil {
		return command.Rejected(e, "ROUTE_NOT_GENERATED", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.route_not_generated", nil)
	}
	need.Route.Accepted = true
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CityCompanionRouteAccepted", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"routeVersion": need.Route.Version,
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "ROUTE_ACCEPT_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.route_accept_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- RecordMaterialRouteChange ----------
// R2 §10 material_route_changes[]：行程重大变化记录并重新确认。

type materialChangePayload struct {
	ExpectedVersion int    `json:"expectedVersion"`
	Description     string `json:"description"`
	ReConfirmed     bool   `json:"reConfirmed"`
}

func (s *Service) recordMaterialRouteChange(ctx context.Context, e command.Envelope) command.Result {
	var p materialChangePayload
	if !decode(e.Payload, &p) || p.ExpectedVersion <= 0 || p.Description == "" {
		return command.Rejected(e, "INVALID_MATERIAL_CHANGE", "VALIDATION", "AFTER_USER_ACTION", "citycompanion.invalid_material_change", nil)
	}
	need, err := s.repository.GetNeed(ctx, e.Target.ID)
	if errors.Is(err, ErrNeedNotFound) {
		return command.Rejected(e, "CITY_COMPANION_NEED_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.need_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "CITY_COMPANION_NEED_READ_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.need_read_failed", nil)
	}
	if !canOperate(need, e) {
		return command.Rejected(e, "MATERIAL_CHANGE_NOT_ALLOWED", "AUTHORIZATION", "AFTER_USER_ACTION", "citycompanion.material_change_not_allowed", nil)
	}
	if p.ExpectedVersion != need.Version {
		return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
	}
	change := MaterialRouteChange{
		ChangeID:    newID("chg_"),
		Description: p.Description,
		ReConfirmed: p.ReConfirmed,
		RecordedAt:  s.clock.Now().UTC(),
	}
	need.RouteChanges = append(need.RouteChanges, change)
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("MaterialRouteChangeRecorded", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"changeId":    change.ChangeID,
		"description": change.Description,
		"reConfirmed": change.ReConfirmed,
	})}
	if err := s.repository.UpdateNeed(ctx, need, p.ExpectedVersion); err != nil {
		if errors.Is(err, ErrVersionConflict) {
			return command.Rejected(e, "CITY_COMPANION_NEED_VERSION_CONFLICT", "CONCURRENCY", "SAFE_RETRY", "citycompanion.need_version_conflict", map[string]any{"expectedVersion": p.ExpectedVersion})
		}
		return command.Rejected(e, "MATERIAL_CHANGE_RECORD_FAILED", "INTERNAL", "SAFE_RETRY", "citycompanion.material_change_failed", nil)
	}
	return command.Accepted(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, eventRefs(domainEvents))
}

// ---------- helpers ----------

func paceLabel(style string) string {
	switch style {
	case "RELAXED":
		return "轻松 · 少赶路"
	case "FOOD":
		return "吃逛结合"
	default:
		return "本地节奏"
	}
}

func distanceLabel(style string) string {
	switch style {
	case "RELAXED":
		return "3–5 km"
	case "FOOD":
		return "2–4 km"
	default:
		return "1–3 km"
	}
}

func spendLabel(duration, style string) string {
	if duration == "8H" {
		return "约 400–700k VND"
	}
	return "约 200–400k VND"
}

func stopNames(stops []RouteStop) []string {
	names := make([]string, 0, len(stops))
	for _, s := range stops {
		names = append(names, s.Name)
	}
	return names
}

func canOperate(need CityCompanionNeed, e command.Envelope) bool {
	return e.Actor.Type == "USER" && e.Actor.ID == need.OwnerUserID
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

// acceptedWithPayload 返回 Accepted 结果并附带客户端负载（候选列表、路线等）。
func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
