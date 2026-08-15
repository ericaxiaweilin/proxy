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
	ID             string            `json:"id"`
	OwnerUserID    string            `json:"ownerUserId"`
	Lifecycle      string            `json:"lifecycle"` // DRAFT -> CANDIDATES -> CONFIRMED -> COMPLETED / CANCELLED
	Version        int               `json:"version"`
	Duration       string            `json:"duration"`        // 4H | 8H
	Language       string            `json:"language"`        // zh | en | vi
	GenderPref     string            `json:"genderPref"`      // any | female | male
	Interests      []string          `json:"interests"`       // 咖啡 / 拍照 / 夜生活 ...
	Meeting        string            `json:"meeting"`         // 集合点
	BudgetVND      int64             `json:"budgetVnd"`       // 预算参考（实验值，非 Price Floor）
	ConfirmedAgent *ConfirmedAgent   `json:"confirmedAgent,omitempty"`
	SceneVisits    []SceneCommerceVisit `json:"sceneVisits"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

type ConfirmedAgent struct {
	AgentID   string `json:"agentId"`
	Name      string `json:"name"`
	OfferVND  int64  `json:"offerVnd"` // 本单报价
	Duration  string `json:"duration"`
	Currency  string `json:"currency"`
}

type SceneCommerceVisit struct {
	VenueID     string    `json:"venueId"`
	VenueType   string    `json:"venueType"` // cafe | restaurant
	Attributed  bool      `json:"attributed"`
	VisitedAt   time.Time `json:"visitedAt"`
}

// Candidate 是候选卡（PRD §7）：本单报价 + 履约/满意/单量/语言 + 1-3 个本单证明。
// 对齐 "不显示不可解释的 96% fit"。
type Candidate struct {
	AgentID              string   `json:"agentId"`
	Name                 string   `json:"name"`
	OfferVND             int64    `json:"offerVnd"`           // 本单报价
	FulfillmentRate      float64  `json:"fulfillmentRate"`    // 履约率
	SatisfactionRate     float64  `json:"satisfactionRate"`   // 满意率
	CompletedCityOrders  int      `json:"completedCityOrders"` // 已完成城市同行单量
	Languages            []string `json:"languages"`
	Style                string   `json:"style"`
	Proofs               []string `json:"proofs"` // 1-3 个本单证明：中文已验证 / 河内 26 单 ...
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
	ErrNeedNotFound   = errors.New("city companion need not found")
	ErrVersionConflict = errors.New("city companion need version conflict")
)

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
	clock      clock.Clock
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

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateCityCompanionNeed", "ListCityCompanionCandidates",
		"ConfirmCityCompanion", "CompleteCityCompanion", "RecordSceneCommerceVisit":
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
	candidates := s.eligible(need)
	// 结果通过 Accepted 的 Payload 返回给客户端
	return acceptedWithPayload(e, "CityCompanionNeed", need.ID, need.Version, need.Lifecycle, map[string]any{
		"needId":     need.ID,
		"candidates": candidates,
		"eligibilityNote": "Eligibility before Ranking：资格 + 可用性 + 履约 + 本单适配；候选来自本单需求，非公开目录。",
	})
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
	ExpectedVersion int    `json:"expectedVersion"`
	AgentID         string `json:"agentId"`
	OfferVND        int64  `json:"offerVnd"`
	IncludeCafe     bool   `json:"includeCafe"` // 可选增值，不改变服务价格
	IncludeRestaurant bool `json:"includeRestaurant"`
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
	// 验证 Agent 在候选池中（防止确认不在本单候选里的人）
	if !s.inPool(p.AgentID) {
		return command.Rejected(e, "AGENT_NOT_IN_CANDIDATES", "BUSINESS_STATE", "AFTER_USER_ACTION", "citycompanion.agent_not_in_candidates", map[string]any{"agentId": p.AgentID})
	}
	candidate := s.findCandidate(p.AgentID)
	need.ConfirmedAgent = &ConfirmedAgent{
		AgentID:  candidate.AgentID,
		Name:     candidate.Name,
		OfferVND: p.OfferVND,
		Duration: need.Duration,
		Currency: "VND",
	}
	need.Lifecycle = "CONFIRMED"
	need.Version++
	need.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("CityCompanionConfirmed", "CityCompanionNeed", need.ID, need.Version, e.Principal.ID, e.CorrelationID, e.CommandID, need.UpdatedAt, map[string]any{
		"agentId":         p.AgentID,
		"offerVnd":        p.OfferVND,
		"includeCafe":     p.IncludeCafe,
		"includeRestaurant": p.IncludeRestaurant,
		"servicePriceNote": "本单服务价格，不属于人的长期标价",
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

// ---------- helpers ----------

func (s *Service) inPool(agentID string) bool {
	for _, c := range s.pool {
		if c.AgentID == agentID {
			return true
		}
	}
	return false
}

func (s *Service) findCandidate(agentID string) *Candidate {
	for _, c := range s.pool {
		if c.AgentID == agentID {
			return c
		}
	}
	return nil
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

// acceptedWithPayload 返回 Accepted 结果并附带客户端负载（候选列表等）。
func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, nil)
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
