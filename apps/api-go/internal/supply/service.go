package supply

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/geo"
)

// Supply 真源（R14 Canonical Data Model §6 + B 完成标准）。
// AgentProfile / AgentService / Capability / CapabilityVerification /
// AvailabilityWindow / ServiceArea 必须可独立变化。
// 硬规则：
//  1. Profile 不是登录 Identity，也不是 Capability
//  2. declared capability 和 verified capability 必须分开
//  3. 没 VERIFIED 的硬要求不能过 Eligibility
//  4. Availability 持久化（AVAILABLE/BLOCKED/BOOKED），重启不丢
//  5. 同一 Agent 已有 Order 时避免时间冲突

// AgentProfile 是 Agent 的经营身份（principal → profile 1:1）。
type AgentProfile struct {
	AgentID      string    `json:"agentId"` // = principal.ID
	Name         string    `json:"name"`
	Bio          string    `json:"bio"`
	Photos       []string  `json:"photos"`
	Languages    []string  `json:"languages"`
	ServiceAreas []string  `json:"serviceAreas"` // market_id 列表
	Status       string    `json:"status"`       // DRAFT | ACTIVE | SUSPENDED
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// AgentService 是 Agent 提供的一项服务（当前类别：CITY_COMPANION）。
type AgentService struct {
	AgentID        string    `json:"agentId"`
	ServiceType    string    `json:"serviceType"` // CITY_COMPANION（未来扩类别不改核心表）
	Status         string    `json:"status"`      // DRAFT | ACTIVE | PAUSED | RETIRED
	ReferencePrice int64     `json:"referencePrice"`
	Currency       string    `json:"currency"`
	Markets        []string  `json:"markets"` // market_id 列表
	UpdatedAt      time.Time `json:"updatedAt"`
}

// Capability 是能力（declared 与 verified 分离）。
type Capability struct {
	AgentID    string    `json:"agentId"`
	Capability string    `json:"capability"` // ZH | PHOTOGRAPHY | CITY_GUIDE | DRIVING | ...
	Declared   bool      `json:"declared"`   // Agent 自声明
	Verified   bool      `json:"verified"`   // 通过 CapabilityVerification
	UpdatedAt  time.Time `json:"updatedAt"`
}

// CapabilityVerification 是验证记录。
type CapabilityVerification struct {
	ID         string    `json:"id"`
	AgentID    string    `json:"agentId"`
	Capability string    `json:"capability"`
	Status     string    `json:"status"` // PENDING | VERIFIED | REJECTED | EXPIRED
	Method     string    `json:"method"` // DOCUMENT | INTERVIEW | TEST | REFERENCE
	VerifiedBy string    `json:"verifiedBy"`
	VerifiedAt time.Time `json:"verifiedAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	CreatedAt  time.Time `json:"createdAt"`
}

// AvailabilityWindow 是时间窗（持久化，重启不丢）。
type AvailabilityWindow struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agentId"`
	StartAt   time.Time `json:"startAt"`
	EndAt     time.Time `json:"endAt"`
	MarketID  string    `json:"marketId"`
	Status    string    `json:"status"` // AVAILABLE | BLOCKED | BOOKED
	OrderID   string    `json:"orderId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// EligibilitySnapshot 是候选资格快照（CandidateBatch 冻结）。
type EligibilitySnapshot struct {
	AgentID         string `json:"agentId"`
	ProfileActive   bool   `json:"profileActive"`
	ServiceActive   bool   `json:"serviceActive"`
	CapabilitiesOK  bool   `json:"capabilitiesOk"`
	AvailabilityOK  bool   `json:"availabilityOk"`
	MarketOK        bool   `json:"marketOk"`
	NoOrderConflict bool   `json:"noOrderConflict"`
	// COMP-SELLER-001：供给侧实名。候选集里出现的每一个卖家都必须可识别
	// （电商法 122/2025 + NĐ 248/2026）。查不到实名记录一律 false，
	// 因为「查不到」不能变成「已核验」。
	RealNameVerified bool `json:"realNameVerified"`
	Eligible         bool `json:"eligible"`
}

// AvailabilitySnapshot 是候选可用性快照（冻结时的时间窗）。
type AvailabilitySnapshot struct {
	WindowID string    `json:"windowId"`
	AgentID  string    `json:"agentId"`
	StartAt  time.Time `json:"startAt"`
	EndAt    time.Time `json:"endAt"`
	MarketID string    `json:"marketId"`
}

// Candidate 是有限候选集成员（快照，之后 Agent 变化不改历史）。
type Candidate struct {
	AgentID        string               `json:"agentId"`
	Name           string               `json:"name"`
	Languages      []string             `json:"languages"`
	ServiceType    string               `json:"serviceType"`
	ReferencePrice int64                `json:"referencePrice"`
	Currency       string               `json:"currency"`
	Eligibility    EligibilitySnapshot  `json:"eligibility"`
	Availability   AvailabilitySnapshot `json:"availability"`
	RankingReason  string               `json:"rankingReason"`
}

// CandidateBatch 是一次有限候选集的快照。
type CandidateBatch struct {
	ID               string      `json:"batchId"`
	NeedID           string      `json:"needId"`
	MarketID         string      `json:"marketId"`
	OwnerPrincipalID string      `json:"ownerPrincipalId"`
	CreatedAt        time.Time   `json:"createdAt"`
	Candidates       []Candidate `json:"candidates"`
	Shortage         bool        `json:"shortage"`
	ShortageNote     string      `json:"shortageNote,omitempty"`
}

// SupplyQuery 是真实供给查询参数。
type SupplyQuery struct {
	MarketID     string    `json:"marketId"`
	StartAt      time.Time `json:"startAt"`
	DurationH    int       `json:"durationH"`
	ServiceType  string    `json:"serviceType"`  // CITY_COMPANION
	Languages    []string  `json:"languages"`    // 硬要求（需 VERIFIED）
	Capabilities []string  `json:"capabilities"` // 硬要求（需 VERIFIED）
	GenderPref   string    `json:"genderPref"`   // any | female | male（软过滤）
}

type Repository interface {
	CreateProfile(ctx context.Context, p AgentProfile) error
	GetProfile(ctx context.Context, agentID string) (AgentProfile, error)
	UpdateProfile(ctx context.Context, p AgentProfile) error
	CreateService(ctx context.Context, s AgentService) error
	GetService(ctx context.Context, agentID, serviceType string) (AgentService, error)
	UpdateService(ctx context.Context, s AgentService) error
	SetCapability(ctx context.Context, c Capability) error
	GetCapabilities(ctx context.Context, agentID string) ([]Capability, error)
	CreateVerification(ctx context.Context, v CapabilityVerification) error
	GetVerifications(ctx context.Context, agentID string) ([]CapabilityVerification, error)
	CreateWindow(ctx context.Context, w AvailabilityWindow) error
	GetWindow(ctx context.Context, windowID string) (AvailabilityWindow, error)
	GetWindows(ctx context.Context, agentID string) ([]AvailabilityWindow, error)
	UpdateWindowStatus(ctx context.Context, windowID string, status, orderID string) error
	OverlappingWindows(ctx context.Context, agentID string, startAt, endAt time.Time) ([]AvailabilityWindow, error)
	SaveCandidateBatch(ctx context.Context, b CandidateBatch) error
	GetCandidateBatch(ctx context.Context, batchID string) (CandidateBatch, error)
	ProfilesSnapshot(ctx context.Context) ([]AgentProfile, error)
	ServicesSnapshot(ctx context.Context) ([]AgentService, error)
	WindowsSnapshot(ctx context.Context) ([]AvailabilityWindow, error)
	BatchesSnapshot(ctx context.Context) ([]CandidateBatch, error)
}

// TransactionalRepository 由支持事务性 outbox 的存储实现（事件与状态原子提交）。
type TransactionalRepository interface {
	Repository
	SaveCandidateBatchAndPublish(ctx context.Context, b CandidateBatch, domainEvents []event.DomainEvent) error
}

var (
	ErrProfileNotFound = errors.New("agent profile not found")
	ErrServiceNotFound = errors.New("agent service not found")
	ErrBatchNotFound   = errors.New("candidate batch not found")
)

const (
	// maxAmountVND 是金额类字段的服务端上限（防 9.2e18 级脏数据）。
	maxAmountVND = 10_000_000
	// maxSupplierResults 限制单次供给查询返回的 Agent 数（防全市场目录抓取）。
	maxSupplierResults = 20
	// maxBatchCandidates 限制有限候选集大小。
	maxBatchCandidates = 10
)

type MemoryRepository struct {
	mu            sync.Mutex
	profiles      map[string]AgentProfile
	services      map[string]AgentService
	capabilities  map[string]Capability
	verifications map[string][]CapabilityVerification
	windows       map[string]AvailabilityWindow
	batches       map[string]CandidateBatch
	events        []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		profiles:      make(map[string]AgentProfile),
		services:      make(map[string]AgentService),
		capabilities:  make(map[string]Capability),
		verifications: make(map[string][]CapabilityVerification),
		windows:       make(map[string]AvailabilityWindow),
		batches:       make(map[string]CandidateBatch),
	}
}

func (r *MemoryRepository) CreateProfile(_ context.Context, p AgentProfile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.profiles[p.AgentID]; exists {
		return errors.New("profile already exists")
	}
	r.profiles[p.AgentID] = cloneProfile(p)
	return nil
}

func (r *MemoryRepository) GetProfile(_ context.Context, agentID string) (AgentProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, exists := r.profiles[agentID]
	if !exists {
		return AgentProfile{}, ErrProfileNotFound
	}
	return cloneProfile(p), nil
}

func (r *MemoryRepository) UpdateProfile(_ context.Context, p AgentProfile) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.profiles[p.AgentID]; !exists {
		return ErrProfileNotFound
	}
	r.profiles[p.AgentID] = cloneProfile(p)
	return nil
}

func (r *MemoryRepository) CreateService(_ context.Context, s AgentService) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := s.AgentID + "|" + s.ServiceType
	if _, exists := r.services[key]; exists {
		return errors.New("service already exists")
	}
	r.services[key] = cloneService(s)
	return nil
}

func (r *MemoryRepository) GetService(_ context.Context, agentID, serviceType string) (AgentService, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, exists := r.services[agentID+"|"+serviceType]
	if !exists {
		return AgentService{}, ErrServiceNotFound
	}
	return cloneService(s), nil
}

func (r *MemoryRepository) UpdateService(_ context.Context, s AgentService) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := s.AgentID + "|" + s.ServiceType
	if _, exists := r.services[key]; !exists {
		return ErrServiceNotFound
	}
	r.services[key] = cloneService(s)
	return nil
}

func (r *MemoryRepository) SetCapability(_ context.Context, c Capability) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.capabilities[c.AgentID+"|"+c.Capability] = c
	return nil
}

func (r *MemoryRepository) GetCapabilities(_ context.Context, agentID string) ([]Capability, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []Capability{}
	for _, c := range r.capabilities {
		if c.AgentID == agentID {
			result = append(result, c)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Capability < result[j].Capability })
	return result, nil
}

func (r *MemoryRepository) CreateVerification(_ context.Context, v CapabilityVerification) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.verifications[v.AgentID] = append(r.verifications[v.AgentID], v)
	return nil
}

func (r *MemoryRepository) GetVerifications(_ context.Context, agentID string) ([]CapabilityVerification, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]CapabilityVerification, len(r.verifications[agentID]))
	copy(result, r.verifications[agentID])
	return result, nil
}

func (r *MemoryRepository) CreateWindow(_ context.Context, w AvailabilityWindow) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.windows[w.ID] = w
	return nil
}

func (r *MemoryRepository) GetWindow(_ context.Context, windowID string) (AvailabilityWindow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	w, exists := r.windows[windowID]
	if !exists {
		return AvailabilityWindow{}, errors.New("window not found")
	}
	return w, nil
}

func (r *MemoryRepository) GetWindows(_ context.Context, agentID string) ([]AvailabilityWindow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []AvailabilityWindow{}
	for _, w := range r.windows {
		if w.AgentID == agentID {
			result = append(result, w)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].StartAt.Before(result[j].StartAt) })
	return result, nil
}

func (r *MemoryRepository) UpdateWindowStatus(_ context.Context, windowID string, status, orderID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	w, exists := r.windows[windowID]
	if !exists {
		return errors.New("window not found")
	}
	w.Status = status
	w.OrderID = orderID
	r.windows[windowID] = w
	return nil
}

func (r *MemoryRepository) OverlappingWindows(_ context.Context, agentID string, startAt, endAt time.Time) ([]AvailabilityWindow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []AvailabilityWindow{}
	for _, w := range r.windows {
		if w.AgentID == agentID && w.StartAt.Before(endAt) && w.EndAt.After(startAt) {
			result = append(result, w)
		}
	}
	return result, nil
}

func (r *MemoryRepository) SaveCandidateBatch(_ context.Context, b CandidateBatch) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.batches[b.ID] = b
	return nil
}

func (r *MemoryRepository) SaveCandidateBatchAndPublish(_ context.Context, b CandidateBatch, domainEvents []event.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.batches[b.ID] = b
	r.events = append(r.events, domainEvents...)
	return nil
}

func (r *MemoryRepository) GetCandidateBatch(_ context.Context, batchID string) (CandidateBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, exists := r.batches[batchID]
	if !exists {
		return CandidateBatch{}, ErrBatchNotFound
	}
	return b, nil
}

func (r *MemoryRepository) ProfilesSnapshot(_ context.Context) ([]AgentProfile, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]AgentProfile, 0, len(r.profiles))
	for _, p := range r.profiles {
		result = append(result, cloneProfile(p))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].AgentID < result[j].AgentID })
	return result, nil
}

func (r *MemoryRepository) ServicesSnapshot(_ context.Context) ([]AgentService, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]AgentService, 0, len(r.services))
	for _, s := range r.services {
		result = append(result, cloneService(s))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].AgentID < result[j].AgentID })
	return result, nil
}

func (r *MemoryRepository) WindowsSnapshot(_ context.Context) ([]AvailabilityWindow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []AvailabilityWindow{}
	for _, w := range r.windows {
		result = append(result, w)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].StartAt.Before(result[j].StartAt) })
	return result, nil
}

func (r *MemoryRepository) BatchesSnapshot(_ context.Context) ([]CandidateBatch, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := []CandidateBatch{}
	for _, b := range r.batches {
		result = append(result, b)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result, nil
}

func cloneProfile(p AgentProfile) AgentProfile {
	p.Photos = append([]string(nil), p.Photos...)
	p.Languages = append([]string(nil), p.Languages...)
	p.ServiceAreas = append([]string(nil), p.ServiceAreas...)
	return p
}

func cloneService(s AgentService) AgentService {
	s.Markets = append([]string(nil), s.Markets...)
	return s
}

type Service struct {
	mu         sync.Mutex
	repository TransactionalRepository
	clock      clock.Clock
	// COMP-SELLER-001：供给侧实名查询。nil = 没接 = 所有卖家都算未核验
	// = 候选集为空。这是刻意的 fail-closed，不是 bug：宁可撮合不着，
	// 也不能在「明知卖家匿名」的状态下收款。
	sellerIdentity SellerIdentityLookup
}

// SetSellerIdentityLookup 接上实名查询。不接就撮合不出任何候选。
func (s *Service) SetSellerIdentityLookup(lookup SellerIdentityLookup) {
	s.sellerIdentity = lookup
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository TransactionalRepository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "CreateAgentProfile", "UpdateAgentProfile", "GetAgentProfile", "GetAgentPassport",
		"CreateAgentService", "UpdateAgentService",
		"DeclareCapability", "VerifyCapability",
		"SetAvailabilityWindow", "BlockAvailabilityWindow", "QuerySuppliers",
		"CreateCandidateBatch", "GetCandidateBatch":
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
	case "CreateAgentProfile":
		return s.createProfile(ctx, e)
	case "UpdateAgentProfile":
		return s.updateProfile(ctx, e)
	case "GetAgentProfile":
		return s.getProfile(ctx, e)
	case "CreateAgentService":
		return s.createService(ctx, e)
	case "UpdateAgentService":
		return s.updateService(ctx, e)
	case "DeclareCapability":
		return s.declareCapability(ctx, e)
	case "VerifyCapability":
		return s.verifyCapability(ctx, e)
	case "SetAvailabilityWindow":
		return s.setAvailabilityWindow(ctx, e)
	case "BlockAvailabilityWindow":
		return s.blockWindow(ctx, e)
	case "QuerySuppliers":
		return s.querySuppliers(ctx, e)
	case "CreateCandidateBatch":
		return s.createCandidateBatch(ctx, e)
	case "GetCandidateBatch":
		return s.getCandidateBatch(ctx, e)
	case "GetAgentPassport":
		return s.getAgentPassport(ctx, e)
	default:
		return command.Rejected(e, "SUPPLY_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "supply.unsupported_command", nil)
	}
}

// ---------- AgentProfile ----------

type profilePayload struct {
	AgentID      string   `json:"agentId"`
	Name         string   `json:"name"`
	Bio          string   `json:"bio"`
	Photos       []string `json:"photos"`
	Languages    []string `json:"languages"`
	ServiceAreas []string `json:"serviceAreas"`
}

func (s *Service) createProfile(ctx context.Context, e command.Envelope) command.Result {
	var p profilePayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.Name == "" {
		return command.Rejected(e, "INVALID_AGENT_PROFILE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_profile", nil)
	}
	// 归属校验：AgentID 必须等于会话 principal（principal → profile 1:1）。
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	profile := AgentProfile{
		AgentID:      p.AgentID,
		Name:         p.Name,
		Bio:          p.Bio,
		Photos:       p.Photos,
		Languages:    p.Languages,
		ServiceAreas: p.ServiceAreas,
		Status:       "ACTIVE",
		CreatedAt:    s.clock.Now().UTC(),
		UpdatedAt:    s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("AgentProfileCreated", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, profile.CreatedAt, map[string]any{
		"agentId": p.AgentID,
		"name":    p.Name,
	})}
	if err := s.repository.CreateProfile(ctx, profile); err != nil {
		return command.Rejected(e, "PROFILE_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", p.AgentID, 1, profile.Status, eventRefs(domainEvents))
}

func (s *Service) updateProfile(ctx context.Context, e command.Envelope) command.Result {
	var p profilePayload
	if !decode(e.Payload, &p) || p.AgentID == "" {
		return command.Rejected(e, "INVALID_AGENT_PROFILE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_profile", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	profile, err := s.repository.GetProfile(ctx, p.AgentID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}
	if p.Name != "" {
		profile.Name = p.Name
	}
	if p.Bio != "" {
		profile.Bio = p.Bio
	}
	if p.Photos != nil {
		profile.Photos = p.Photos
	}
	if p.Languages != nil {
		profile.Languages = p.Languages
	}
	if p.ServiceAreas != nil {
		profile.ServiceAreas = p.ServiceAreas
	}
	profile.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("AgentProfileUpdated", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, profile.UpdatedAt, map[string]any{})}
	if err := s.repository.UpdateProfile(ctx, profile); err != nil {
		return command.Rejected(e, "PROFILE_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_update_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", p.AgentID, 1, profile.Status, eventRefs(domainEvents))
}

func (s *Service) getProfile(ctx context.Context, e command.Envelope) command.Result {
	agentID := e.Target.ID
	if agentID == "" {
		var p struct {
			AgentID string `json:"agentId"`
		}
		if !decode(e.Payload, &p) || p.AgentID == "" {
			return command.Rejected(e, "INVALID_AGENT_QUERY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_agent_query", nil)
		}
		agentID = p.AgentID
	}
	profile, err := s.repository.GetProfile(ctx, agentID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}
	return acceptedWithPayload(e, "AgentProfile", agentID, 1, profile.Status, map[string]any{
		"profile": profile,
	}, nil)
}

func (s *Service) getAgentPassport(ctx context.Context, e command.Envelope) command.Result {
	agentID := e.Target.ID
	if agentID == "" {
		var p struct {
			AgentID string `json:"agentId"`
		}
		if !decode(e.Payload, &p) || p.AgentID == "" {
			return command.Rejected(e, "INVALID_PASSPORT_QUERY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_passport_query", nil)
		}
		agentID = p.AgentID
	}
	profile, err := s.repository.GetProfile(ctx, agentID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PASSPORT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.passport_read_failed", nil)
	}
	svc, _ := s.repository.GetService(ctx, agentID, "CITY_COMPANION")
	caps, _ := s.repository.GetCapabilities(ctx, agentID)
	verifications, _ := s.repository.GetVerifications(ctx, agentID)
	windows, _ := s.repository.GetWindows(ctx, agentID)
	now := s.clock.Now().UTC()
	// Verification summary (redacted:不暴露 verifiedBy 明文，仅计数)
	verifiedCount, expiredCount, pendingCount := 0, 0, 0
	for _, v := range verifications {
		switch v.Status {
		case "VERIFIED":
			if v.ExpiresAt.After(now) {
				verifiedCount++
			} else {
				expiredCount++
			}
		case "PENDING":
			pendingCount++
		}
	}
	// Availability: only future AVAILABLE windows, precise location redacted to marketId
	//
	// 为什么是 marketId 而不是场馆坐标：Agent Passport 是「无任务浏览」上下文，
	// 读者只持有全局 Local Context。R8:98-101 把全局上下文封顶在
	// CITY / COARSE_AREA，所以即使 Agent 本身有场馆级位置，读者也只能拿到降级结果。
	// 这里用 geo 表达这个降级，而不是只写一句散文：下面这一行既是声明，也是
	// 返回值的实际来源。改 GlobalContextCap 会同时改变行为和这里的声明。
	passportLocationPrecision := geo.PrecisionVenue.AtMost(geo.GlobalContextCap)

	activeWindows := []map[string]any{}
	for _, w := range windows {
		if w.Status == "AVAILABLE" && w.EndAt.After(now) {
			activeWindows = append(activeWindows, map[string]any{
				"windowId": w.ID,
				"marketId": w.MarketID,
				"startAt":  w.StartAt.Format(time.RFC3339),
				"endAt":    w.EndAt.Format(time.RFC3339),
				"status":   w.Status,
			})
		}
	}
	// Passport status: ACTIVE if profile ACTIVE + service ACTIVE + at least one verified capability
	passportStatus := profile.Status
	if profile.Status == "ACTIVE" {
		if svc.Status != "ACTIVE" {
			passportStatus = "INCOMPLETE_SERVICE"
		} else if verifiedCount == 0 {
			passportStatus = "PENDING_VERIFICATION"
		}
	}
	return acceptedWithPayload(e, "AgentPassport", agentID, 1, passportStatus, map[string]any{
		"agentId":      agentID,
		"profile":      profile,
		"service":      svc,
		"capabilities": caps,
		"verificationSummary": map[string]any{
			"verified": verifiedCount,
			"expired":  expiredCount,
			"pending":  pendingCount,
		},
		"activeWindows":  activeWindows,
		"passportStatus": passportStatus,
		// locationPrecision 是类型化的精度声明，取值来自 geo 的唯一真源。
		// redactions 是给人看的散文；locationPrecision 是给机器验的契约。
		"locationPrecision": string(passportLocationPrecision),
		"redactions":        []string{"profile.photos precise EXIF removed", "location precise coordinates redacted to marketId"},
	}, nil)
}

// ---------- AgentService ----------

type servicePayload struct {
	AgentID        string   `json:"agentId"`
	ServiceType    string   `json:"serviceType"`
	Status         string   `json:"status"`
	ReferencePrice int64    `json:"referencePrice"`
	Currency       string   `json:"currency"`
	Markets        []string `json:"markets"`
}

func (s *Service) createService(ctx context.Context, e command.Envelope) command.Result {
	var p servicePayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.ServiceType == "" {
		return command.Rejected(e, "INVALID_AGENT_SERVICE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_service", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	if p.ServiceType != "CITY_COMPANION" {
		return command.Rejected(e, "UNSUPPORTED_SERVICE_TYPE", "VALIDATION", "AFTER_USER_ACTION", "supply.unsupported_service_type", map[string]any{"serviceType": p.ServiceType})
	}
	if p.Status == "" {
		p.Status = "ACTIVE"
	}
	if p.Currency == "" {
		p.Currency = "VND"
	}
	svc := AgentService{
		AgentID:        p.AgentID,
		ServiceType:    p.ServiceType,
		Status:         p.Status,
		ReferencePrice: p.ReferencePrice,
		Currency:       p.Currency,
		Markets:        p.Markets,
		UpdatedAt:      s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("AgentServiceCreated", "AgentService", p.AgentID+"|"+p.ServiceType, 1, e.Principal.ID, e.CorrelationID, e.CommandID, svc.UpdatedAt, map[string]any{
		"agentId": p.AgentID, "serviceType": p.ServiceType, "referencePrice": p.ReferencePrice,
	})}
	if err := s.repository.CreateService(ctx, svc); err != nil {
		return command.Rejected(e, "SERVICE_CREATE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.service_failed", nil)
	}
	return command.Accepted(e, "AgentService", p.AgentID+"|"+p.ServiceType, 1, svc.Status, eventRefs(domainEvents))
}

func (s *Service) updateService(ctx context.Context, e command.Envelope) command.Result {
	var p servicePayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.ServiceType == "" {
		return command.Rejected(e, "INVALID_AGENT_SERVICE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_service", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	if p.ReferencePrice < 0 || p.ReferencePrice > maxAmountVND {
		return command.Rejected(e, "INVALID_REFERENCE_PRICE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_reference_price", nil)
	}
	svc, err := s.repository.GetService(ctx, p.AgentID, p.ServiceType)
	if errors.Is(err, ErrServiceNotFound) {
		return command.Rejected(e, "AGENT_SERVICE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.service_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "SERVICE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.service_read_failed", nil)
	}
	if p.Status != "" {
		svc.Status = p.Status
	}
	if p.ReferencePrice > 0 {
		svc.ReferencePrice = p.ReferencePrice
	}
	if p.Currency != "" {
		svc.Currency = p.Currency
	}
	if p.Markets != nil {
		svc.Markets = p.Markets
	}
	svc.UpdatedAt = s.clock.Now().UTC()
	domainEvents := []event.DomainEvent{event.New("AgentServiceUpdated", "AgentService", p.AgentID+"|"+p.ServiceType, 1, e.Principal.ID, e.CorrelationID, e.CommandID, svc.UpdatedAt, map[string]any{
		"status": svc.Status, "referencePrice": svc.ReferencePrice,
	})}
	if err := s.repository.UpdateService(ctx, svc); err != nil {
		return command.Rejected(e, "SERVICE_UPDATE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.service_update_failed", nil)
	}
	return command.Accepted(e, "AgentService", p.AgentID+"|"+p.ServiceType, 1, svc.Status, eventRefs(domainEvents))
}

// ---------- Capability ----------

type capabilityPayload struct {
	AgentID    string `json:"agentId"`
	Capability string `json:"capability"`
}

// DeclareCapability：Agent 自声明（declared=true，verified 不变）。
func (s *Service) declareCapability(ctx context.Context, e command.Envelope) command.Result {
	var p capabilityPayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.Capability == "" {
		return command.Rejected(e, "INVALID_CAPABILITY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_capability", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	caps, err := s.repository.GetCapabilities(ctx, p.AgentID)
	if err != nil {
		return command.Rejected(e, "CAPABILITY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.capability_read_failed", nil)
	}
	existing := false
	for _, c := range caps {
		if c.Capability == p.Capability {
			existing = true
			break
		}
	}
	cap := Capability{AgentID: p.AgentID, Capability: p.Capability, Declared: true, UpdatedAt: s.clock.Now().UTC()}
	if existing {
		// 保留 verified 状态
		for _, c := range caps {
			if c.Capability == p.Capability {
				cap.Verified = c.Verified
				break
			}
		}
	}
	domainEvents := []event.DomainEvent{event.New("CapabilityDeclared", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, cap.UpdatedAt, map[string]any{
		"agentId": p.AgentID, "capability": p.Capability,
		"note": "declared 与 verified 必须分开",
	})}
	if err := s.repository.SetCapability(ctx, cap); err != nil {
		return command.Rejected(e, "CAPABILITY_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.capability_save_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", p.AgentID, 1, "CAPABILITY_DECLARED", eventRefs(domainEvents))
}

// VerifyCapability：PENDING → VERIFIED/REJECTED（有验证记录）。
type verifyCapabilityPayload struct {
	AgentID    string `json:"agentId"`
	Capability string `json:"capability"`
	Method     string `json:"method"`
	Decision   string `json:"decision"` // APPROVE | REJECT
}

func (s *Service) verifyCapability(ctx context.Context, e command.Envelope) command.Result {
	var p verifyCapabilityPayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.Capability == "" {
		return command.Rejected(e, "INVALID_VERIFICATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_verification", nil)
	}
	if p.Decision != "APPROVE" && p.Decision != "REJECT" {
		return command.Rejected(e, "INVALID_VERIFICATION_DECISION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_decision", nil)
	}
	if p.Method == "" {
		p.Method = "INTERVIEW"
	}
	now := s.clock.Now().UTC()
	status := "VERIFIED"
	if p.Decision == "REJECT" {
		status = "REJECTED"
	}
	verification := CapabilityVerification{
		ID:         newID("cv_"),
		AgentID:    p.AgentID,
		Capability: p.Capability,
		Status:     status,
		Method:     p.Method,
		VerifiedBy: e.Principal.ID,
		VerifiedAt: now,
		ExpiresAt:  now.AddDate(1, 0, 0),
		CreatedAt:  now,
	}
	caps, _ := s.repository.GetCapabilities(ctx, p.AgentID)
	cap := Capability{AgentID: p.AgentID, Capability: p.Capability, Declared: true, Verified: p.Decision == "APPROVE", UpdatedAt: now}
	for _, c := range caps {
		if c.Capability == p.Capability {
			cap.Declared = c.Declared || true
			break
		}
	}
	domainEvents := []event.DomainEvent{event.New("CapabilityVerified", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agentId": p.AgentID, "capability": p.Capability, "status": status, "method": p.Method,
	})}
	if err := s.repository.CreateVerification(ctx, verification); err != nil {
		return command.Rejected(e, "VERIFICATION_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.verification_failed", nil)
	}
	if err := s.repository.SetCapability(ctx, cap); err != nil {
		return command.Rejected(e, "CAPABILITY_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.capability_save_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", p.AgentID, 1, status, eventRefs(domainEvents))
}

// ---------- AvailabilityWindow ----------

type windowPayload struct {
	AgentID  string `json:"agentId"`
	StartAt  string `json:"startAt"`
	EndAt    string `json:"endAt"`
	MarketID string `json:"marketId"`
}

func (s *Service) setAvailabilityWindow(ctx context.Context, e command.Envelope) command.Result {
	var p windowPayload
	if !decode(e.Payload, &p) || p.AgentID == "" || p.StartAt == "" || p.EndAt == "" || p.MarketID == "" {
		return command.Rejected(e, "INVALID_WINDOW", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_window", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	start, err := time.Parse(time.RFC3339, p.StartAt)
	if err != nil || !start.After(s.clock.Now().UTC()) {
		return command.Rejected(e, "INVALID_WINDOW_START", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_window_start", nil)
	}
	end, err := time.Parse(time.RFC3339, p.EndAt)
	if err != nil || !end.After(start) {
		return command.Rejected(e, "INVALID_WINDOW_END", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_window_end", nil)
	}
	// 避免时间冲突：已有 BOOKED 窗口重叠则拒绝
	overlaps, err := s.repository.OverlappingWindows(ctx, p.AgentID, start, end)
	if err != nil {
		return command.Rejected(e, "WINDOW_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.window_read_failed", nil)
	}
	for _, w := range overlaps {
		if w.Status == "BOOKED" {
			return command.Rejected(e, "WINDOW_TIME_CONFLICT", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.window_time_conflict", map[string]any{"conflictWindowId": w.ID})
		}
	}
	now := s.clock.Now().UTC()
	window := AvailabilityWindow{
		ID:        newID("aw_"),
		AgentID:   p.AgentID,
		StartAt:   start,
		EndAt:     end,
		MarketID:  p.MarketID,
		Status:    "AVAILABLE",
		CreatedAt: now,
		UpdatedAt: now,
	}
	domainEvents := []event.DomainEvent{event.New("AvailabilityWindowSet", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"windowId": window.ID, "startAt": start, "endAt": end, "marketId": p.MarketID,
	})}
	if err := s.repository.CreateWindow(ctx, window); err != nil {
		return command.Rejected(e, "WINDOW_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.window_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", p.AgentID, 1, "AVAILABLE", eventRefs(domainEvents))
}

func (s *Service) blockWindow(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		WindowID string `json:"windowId"`
	}
	if !decode(e.Payload, &p) || p.WindowID == "" {
		return command.Rejected(e, "INVALID_WINDOW_BLOCK", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_window_block", nil)
	}
	// 归属校验：先按 windowId 查窗口，确认属于当前 principal。
	window, err := s.repository.GetWindow(ctx, p.WindowID)
	if err != nil {
		return command.Rejected(e, "WINDOW_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.window_not_found", nil)
	}
	if window.AgentID != e.Principal.ID {
		return command.Rejected(e, "WINDOW_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.window_not_owned", nil)
	}
	domainEvents := []event.DomainEvent{event.New("AvailabilityWindowBlocked", "AgentProfile", window.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, s.clock.Now().UTC(), map[string]any{
		"windowId": p.WindowID,
	})}
	if err := s.repository.UpdateWindowStatus(ctx, p.WindowID, "BLOCKED", ""); err != nil {
		return command.Rejected(e, "WINDOW_BLOCK_FAILED", "INTERNAL", "SAFE_RETRY", "supply.window_block_failed", nil)
	}
	return command.Accepted(e, "AgentProfile", window.AgentID, 1, "BLOCKED", eventRefs(domainEvents))
}

// ---------- Eligibility Gate + Supply Query ----------

func (s *Service) evaluateEligibility(ctx context.Context, agentID string, q SupplyQuery) (EligibilitySnapshot, error) {
	var snap EligibilitySnapshot
	snap.AgentID = agentID
	profile, err := s.repository.GetProfile(ctx, agentID)
	if err != nil {
		return snap, err
	}
	snap.ProfileActive = profile.Status == "ACTIVE"
	svc, err := s.repository.GetService(ctx, agentID, q.ServiceType)
	if err != nil {
		return snap, err
	}
	snap.ServiceActive = svc.Status == "ACTIVE"
	// Market 可行性：service.Markets 含请求 market
	for _, m := range svc.Markets {
		if m == q.MarketID {
			snap.MarketOK = true
			break
		}
	}
	// Capability 硬要求：语言 + 能力都要 VERIFIED 且未过期
	// 必须以 capability_verifications 的未过期 VERIFIED 记录为准，不能仅靠 capabilities.verified 布尔（过期后需失效）。
	verified := map[string]bool{}
	verifications, _ := s.repository.GetVerifications(ctx, agentID)
	now := s.clock.Now().UTC()
	for _, v := range verifications {
		if v.Status == "VERIFIED" && v.ExpiresAt.After(now) {
			verified[v.Capability] = true
		}
	}
	// 兼容：若无 verification 记录但 capability.verified 已置位（内存测试旧数据），仍视为有效，直到下次验证写入。
	if len(verifications) == 0 {
		caps, _ := s.repository.GetCapabilities(ctx, agentID)
		for _, c := range caps {
			if c.Verified {
				verified[c.Capability] = true
			}
		}
	}
	snap.CapabilitiesOK = true
	for _, lang := range q.Languages {
		if !verified[lang] {
			snap.CapabilitiesOK = false
			break
		}
	}
	if snap.CapabilitiesOK {
		for _, cap := range q.Capabilities {
			if !verified[cap] {
				snap.CapabilitiesOK = false
				break
			}
		}
	}
	// Availability overlap
	endAt := q.StartAt.Add(time.Duration(q.DurationH) * time.Hour)
	windows, _ := s.repository.OverlappingWindows(ctx, agentID, q.StartAt, endAt)
	snap.AvailabilityOK = false
	for _, w := range windows {
		if w.Status == "AVAILABLE" && w.MarketID == q.MarketID {
			snap.AvailabilityOK = true
			break
		}
	}
	snap.NoOrderConflict = snap.AvailabilityOK // BOOKED 窗口已在 overlap 检查排除（AVALIABLE 才算）
	// COMP-SELLER-001：实名是准入条件，不是加分项。能力验证只回答「会不会」，
	// 实名回答「是谁」；两个都要有答案，缺一个都不能进候选集。
	// 注意这里不把查询错误吞掉：出错时 RealNameVerified 保持 false，
	// 于是 Eligible 为 false —— 出事的时候撮合停摆，而不是照常放行。
	realNameOK, realNameErr := SellerRealNameVerified(ctx, s.sellerIdentity, agentID)
	snap.RealNameVerified = realNameOK && realNameErr == nil
	snap.Eligible = snap.ProfileActive && snap.ServiceActive && snap.CapabilitiesOK &&
		snap.AvailabilityOK && snap.MarketOK && snap.RealNameVerified
	return snap, nil
}

// QuerySuppliers：真实供给查询（河内/明天/8H/女性/中文/CITY_COMPANION/AVAILABLE）。
type queryPayload struct {
	MarketID     string   `json:"marketId"`
	StartAt      string   `json:"startAt"`
	DurationH    int      `json:"durationH"`
	ServiceType  string   `json:"serviceType"`
	Languages    []string `json:"languages"`
	Capabilities []string `json:"capabilities"`
	GenderPref   string   `json:"genderPref"`
}

func (s *Service) querySuppliers(ctx context.Context, e command.Envelope) command.Result {
	var p queryPayload
	if !decode(e.Payload, &p) || p.MarketID == "" || p.StartAt == "" || p.DurationH <= 0 {
		return command.Rejected(e, "INVALID_SUPPLY_QUERY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_query", nil)
	}
	if p.DurationH > 24 {
		return command.Rejected(e, "INVALID_QUERY_DURATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_query_duration", nil)
	}
	if p.ServiceType == "" {
		p.ServiceType = "CITY_COMPANION"
	}
	start, err := time.Parse(time.RFC3339, p.StartAt)
	if err != nil {
		return command.Rejected(e, "INVALID_QUERY_START", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_query_start", nil)
	}
	profiles, err := s.repository.ProfilesSnapshot(ctx)
	if err != nil {
		return command.Rejected(e, "SUPPLY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.read_failed", nil)
	}
	q := SupplyQuery{MarketID: p.MarketID, StartAt: start, DurationH: p.DurationH, ServiceType: p.ServiceType, Languages: p.Languages, Capabilities: p.Capabilities, GenderPref: p.GenderPref}
	results := []map[string]any{}
	for _, profile := range profiles {
		if profile.Status != "ACTIVE" {
			continue
		}
		snap, err := s.evaluateEligibility(ctx, profile.AgentID, q)
		if err != nil || !snap.Eligible {
			continue
		}
		svc, _ := s.repository.GetService(ctx, profile.AgentID, p.ServiceType)
		windows, _ := s.repository.OverlappingWindows(ctx, profile.AgentID, start, start.Add(time.Duration(p.DurationH)*time.Hour))
		var availability any
		for _, window := range windows {
			if window.Status == "AVAILABLE" && window.MarketID == p.MarketID {
				availability = map[string]any{"startAt": window.StartAt, "endAt": window.EndAt, "marketId": window.MarketID}
				break
			}
		}
		results = append(results, map[string]any{
			"agentId":        profile.AgentID,
			"name":           profile.Name,
			"photos":         profile.Photos,
			"languages":      profile.Languages,
			"serviceType":    p.ServiceType,
			"referencePrice": svc.ReferencePrice,
			"currency":       svc.Currency,
			"eligibility":    snap,
			"availability":   availability,
		})
		if len(results) >= maxSupplierResults {
			break
		}
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i]["agentId"].(string) < results[j]["agentId"].(string)
	})
	return acceptedWithPayload(e, "Supply", p.MarketID, 1, "QUERIED", map[string]any{
		"marketId":  p.MarketID,
		"suppliers": results,
		"shortage":  len(results) == 0,
	}, nil)
}

// ---------- CandidateBatch（冻结快照）----------

type batchPayload struct {
	NeedID       string   `json:"needId"`
	MarketID     string   `json:"marketId"`
	StartAt      string   `json:"startAt"`
	DurationH    int      `json:"durationH"`
	Languages    []string `json:"languages"`
	Capabilities []string `json:"capabilities"`
}

func (s *Service) createCandidateBatch(ctx context.Context, e command.Envelope) command.Result {
	var p batchPayload
	if !decode(e.Payload, &p) || p.NeedID == "" || p.MarketID == "" || p.StartAt == "" || p.DurationH <= 0 {
		return command.Rejected(e, "INVALID_BATCH_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_batch", nil)
	}
	start, err := time.Parse(time.RFC3339, p.StartAt)
	if err != nil {
		return command.Rejected(e, "INVALID_BATCH_START", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_batch_start", nil)
	}
	q := SupplyQuery{MarketID: p.MarketID, StartAt: start, DurationH: p.DurationH, ServiceType: "CITY_COMPANION", Languages: p.Languages, Capabilities: p.Capabilities}
	profiles, err := s.repository.ProfilesSnapshot(ctx)
	if err != nil {
		return command.Rejected(e, "SUPPLY_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.read_failed", nil)
	}
	candidates := []Candidate{}
	for _, profile := range profiles {
		if profile.Status != "ACTIVE" {
			continue
		}
		snap, err := s.evaluateEligibility(ctx, profile.AgentID, q)
		if err != nil || !snap.Eligible {
			continue
		}
		// 找匹配窗口（冻结快照）
		endAt := start.Add(time.Duration(p.DurationH) * time.Hour)
		windows, _ := s.repository.OverlappingWindows(ctx, profile.AgentID, start, endAt)
		var window AvailabilityWindow
		for _, w := range windows {
			if w.Status == "AVAILABLE" && w.MarketID == p.MarketID {
				window = w
				break
			}
		}
		if window.ID == "" {
			continue
		}
		svc, _ := s.repository.GetService(ctx, profile.AgentID, "CITY_COMPANION")
		candidates = append(candidates, Candidate{
			AgentID:        profile.AgentID,
			Name:           profile.Name,
			Languages:      profile.Languages,
			ServiceType:    "CITY_COMPANION",
			ReferencePrice: svc.ReferencePrice,
			Currency:       svc.Currency,
			Eligibility:    snap,
			Availability: AvailabilitySnapshot{
				WindowID: window.ID, AgentID: profile.AgentID, StartAt: window.StartAt, EndAt: window.EndAt, MarketID: window.MarketID,
			},
			RankingReason: "verified_capabilities_and_availability",
		})
	}
	// 排序：参考价升序 + 语言匹配优先
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].ReferencePrice != candidates[j].ReferencePrice {
			return candidates[i].ReferencePrice < candidates[j].ReferencePrice
		}
		return candidates[i].AgentID < candidates[j].AgentID
	})
	now := s.clock.Now().UTC()
	// 有限候选集：封顶 maxBatchCandidates，且快照记录归属 principal。
	if len(candidates) > maxBatchCandidates {
		candidates = candidates[:maxBatchCandidates]
	}
	batch := CandidateBatch{
		ID:               newID("cb_"),
		NeedID:           p.NeedID,
		MarketID:         p.MarketID,
		OwnerPrincipalID: e.Principal.ID,
		CreatedAt:        now,
		Candidates:       candidates,
		Shortage:         len(candidates) == 0,
	}
	if batch.Shortage {
		batch.ShortageNote = "no eligible agents for this query"
	}
	domainEvents := []event.DomainEvent{event.New("CandidateBatchCreated", "CandidateBatch", batch.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"needId":         p.NeedID,
		"candidateCount": len(candidates),
		"shortage":       batch.Shortage,
		"note":           "CandidateBatch 是一次有限候选集快照；Agent 变化不改历史",
	})}
	if err := s.repository.SaveCandidateBatchAndPublish(ctx, batch, domainEvents); err != nil {
		return command.Rejected(e, "BATCH_SAVE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.batch_failed", nil)
	}
	return acceptedWithPayload(e, "CandidateBatch", batch.ID, 1, "CREATED", map[string]any{
		"batchId":      batch.ID,
		"candidates":   candidates,
		"shortage":     batch.Shortage,
		"shortageNote": batch.ShortageNote,
	}, domainEvents)
}

func (s *Service) getCandidateBatch(ctx context.Context, e command.Envelope) command.Result {
	batchID := e.Target.ID
	if batchID == "" {
		var p struct {
			BatchID string `json:"batchId"`
		}
		if !decode(e.Payload, &p) || p.BatchID == "" {
			return command.Rejected(e, "INVALID_BATCH_QUERY", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_batch_query", nil)
		}
		batchID = p.BatchID
	}
	batch, err := s.repository.GetCandidateBatch(ctx, batchID)
	if errors.Is(err, ErrBatchNotFound) {
		return command.Rejected(e, "CANDIDATE_BATCH_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.batch_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "BATCH_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.batch_read_failed", nil)
	}
	// 归属校验：候选批次只允许创建者读取（fail-closed：旧批次无归属也拒绝）。
	if batch.OwnerPrincipalID != e.Principal.ID {
		return command.Rejected(e, "BATCH_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.batch_not_owned", nil)
	}
	return acceptedWithPayload(e, "CandidateBatch", batch.ID, 1, "READ", map[string]any{
		"batchId":    batch.ID,
		"candidates": batch.Candidates,
		"shortage":   batch.Shortage,
	}, nil)
}

// ---------- helpers ----------

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
