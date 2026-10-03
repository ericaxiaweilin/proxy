package supply

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
	"github.com/proxy-app/proxy-api/internal/geo"
	"github.com/proxy-app/proxy-api/internal/matching"
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
	// CREATOR-SOCIAL-001：关联社媒（展示用附属属性，migration 157）。
	Socials []AgentSocial `json:"socials,omitempty"`
	// CREATOR-HOME-001（2026-10-02，用户「不能进入proxy账户的个人公共主页」）：
	// 平台早有公开主页（OtherProfileSurface，feed 点头像走的就是它），
	// 商家横滑卡要点人脸进主页，必须给移动端 agent→user 的链路。
	// user_account_id 列本来就在表里，只是 wire 上没透出来。
	UserAccountID string `json:"userAccountId,omitempty"`
}

// AgentSocial 是一条关联社媒。只存用户名不存 URL —— 显示时的 canonical 链接
// 由客户端按平台拼（tiktok.com/@handle 等），服务端不接受任意外部地址
// （那是钓鱼链接的入口）。
type AgentSocial struct {
	// 平台，封闭集合（见 isValidSocialPlatform）。
	Platform string `json:"platform"`
	// 用户名，不含 @，不含 URL，不含空白。
	Handle string `json:"handle"`
	// 可见性，封闭集合（见 SOCIAL-VISIBILITY-001）。
	Visibility string `json:"visibility"`
	CreatedAt  time.Time `json:"createdAt"`
}

// CREATOR-SOCIAL-001：平台封闭集合。加新平台要改这里 + migration CHECK + 客户端
// 链接拼法，三处一起（漏一处就会出现"存得进、显示不出"或反过来）。
var validSocialPlatforms = map[string]bool{
	"tiktok": true, "zalo": true, "instagram": true, "facebook": true,
}

// CREATOR-SOCIAL-001：可见性封闭集合。
//   public   —— 所有人可见（含未登录的公开浏览）；
//   merchants —— 仅已验商家 + 本人可见（默认，见 LinkAgentSocial）；
//   private  —— 仅本人可见（商家页永远看不到这条，不是"隐藏后还能看到"）。
var validSocialVisibilities = map[string]bool{
	"public": true, "merchants": true, "private": true,
}

func isValidSocialPlatform(platform string) bool {
	return validSocialPlatforms[platform]
}

func isValidSocialVisibility(visibility string) bool {
	return validSocialVisibilities[visibility]
}

// CREATOR-SOCIAL-001：handle 形状。只允许字母数字下划线点横杠（各平台用户名的
// 最大公约数），1..64 字符。含 ://、/、空白、@ 的一律拒 ——
// 这些要么是 URL 冒充用户名，要么是拼链接时会坏掉的字符。
func isValidSocialHandle(handle string) bool {
	if len(handle) == 0 || len(handle) > 64 {
		return false
	}
	for _, r := range handle {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_', r == '.', r == '-':
		default:
			return false
		}
	}
	return true
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
	// CREATOR-HOME-001：同上，候选列表直接带 userAccountId，省一次 passport 查询。
	UserAccountID  string               `json:"userAccountId,omitempty"`
	Name           string               `json:"name"`
	Languages      []string             `json:"languages"`
	ServiceType    string               `json:"serviceType"`
	ReferencePrice int64                `json:"referencePrice"`
	Currency       string               `json:"currency"`
	Eligibility    EligibilitySnapshot  `json:"eligibility"`
	Availability   AvailabilitySnapshot `json:"availability"`
	RankingReason  string               `json:"rankingReason"`
	// MATCH-RANK-001：排序得分明细（可靠 / 满意 / 经验 / 响应 / 适配），只含履约与评价信号，不含任何曝光数据。
	Ranking *matching.Breakdown `json:"ranking,omitempty"`
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
	// AttestSellerRealName 是实名核验的唯一写入口（COMP-SELLER-001）。
	// 实现必须保证「同一 agent 同时只有一条 VERIFIED」：新记录落库前先把旧的
	// VERIFIED 置为 EXPIRED，否则 084 的 uq_seller_realname_verified_agent
	// 会直接拒绝第二次核验 —— 而「必须重新核」正好要求第二次能成功。
	AttestSellerRealName(ctx context.Context, v SellerRealNameVerification) error
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
	realNames     map[string][]SellerRealNameVerification
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
		realNames:     make(map[string][]SellerRealNameVerification),
		windows:       make(map[string]AvailabilityWindow),
		batches:       make(map[string]CandidateBatch),
	}
}

// AttestSellerRealName 在内存里镜像生产语义：先校验要件，再把该 agent 上
// 原有的 VERIFIED 记录置为 EXPIRED，最后追加新记录。
//
// 校验用与生产同一条规则（SellerRealNameAttestationComplete）—— 内存实现
// 放宽一格，单测就会在生产路径上骗人（这正是 COMP-REPORT-005 里
// dispositions_outcome_check 踩过的坑）。
func (r *MemoryRepository) AttestSellerRealName(_ context.Context, v SellerRealNameVerification) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := SellerRealNameAttestationComplete(v); err != nil {
		return err
	}
	existing := r.realNames[v.AgentID]
	superseded := make([]SellerRealNameVerification, 0, len(existing)+1)
	for _, prior := range existing {
		if prior.Status == SellerRealNameStatusVerified {
			prior.Status = "EXPIRED"
			prior.UpdatedAt = v.UpdatedAt
		}
		superseded = append(superseded, prior)
	}
	r.realNames[v.AgentID] = append(superseded, v)
	return nil
}

// SellerRealNameVerifications 返回某 agent 的全部核验记录（按写入顺序）。
// 内存实现专用：生产侧不暴露全量读，避免把「谁核过谁」做成可枚举的接口。
func (r *MemoryRepository) SellerRealNameVerifications(agentID string) []SellerRealNameVerification {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]SellerRealNameVerification, len(r.realNames[agentID]))
	copy(out, r.realNames[agentID])
	return out
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
	p.Socials = append([]AgentSocial(nil), p.Socials...)
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
	// MATCH-RANK-001：撮合排序的真实信号。nil = 没接 → 全员按先验分 + 价格排（不假装有履约记录）。
	rankingSignals matching.SignalSource
}

// SetRankingSignals 接上撮合排序信号（履约 / 满意 / 引力响应）。
func (s *Service) SetRankingSignals(source matching.SignalSource) {
	s.rankingSignals = source
}

// rankSignals 读候选的排序信号；读失败只记日志，按「没有记录」排（撮合不能因为排序信号挂掉而整个失败）。
func (s *Service) rankSignals(ctx context.Context, agentIDs []string) map[string]matching.Signals {
	if s.rankingSignals == nil {
		return map[string]matching.Signals{}
	}
	signals, err := s.rankingSignals.Signals(ctx, agentIDs)
	if err != nil {
		log.Printf("supply ranking signals unavailable: %v", err)
		return map[string]matching.Signals{}
	}
	return signals
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
		"LinkAgentSocial", "UnlinkAgentSocial",
		"CreateAgentService", "UpdateAgentService",
		"DeclareCapability", "VerifyCapability", "AttestSellerRealName",
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
	case "AttestSellerRealName":
		return s.attestSellerRealName(ctx, e)
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
	case "LinkAgentSocial":
		return s.linkAgentSocial(ctx, e)
	case "UnlinkAgentSocial":
		return s.unlinkAgentSocial(ctx, e)
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
	// SOCIAL-VISIBILITY-001：社媒按看的人过滤。profile 本体不动（动了就污染了
	// 写回路径），只在 payload 里放过滤后的副本。
	viewerIsSelf := e.Actor.ID != "" && e.Actor.ID == agentID
	visibleSocials := socialsVisibleToViewer(profile.Socials, viewerIsSelf, merchantViewer(e))
	profileForViewer := profile
	profileForViewer.Socials = visibleSocials
	return acceptedWithPayload(e, "AgentPassport", agentID, 1, passportStatus, map[string]any{
		"agentId":      agentID,
		"profile":      profileForViewer,
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

// ---------- AgentSocial ----------
//
// CREATOR-SOCIAL-001：关联社媒的绑定/解绑。只能本人操作自己的（p.AgentID 必须
// 等于 principal，updateProfile 同一口径 —— 不是本人的连碰都不能碰）。
//
// SOCIAL-VISIBILITY-001（可见性规则）：
//   · 本人（actor == agent）→ 全可见（含 private），管的是自己的；
//   · 已验商家（AuthContext 里有 api 层验过的 merchantID）→ public + merchants；
//   · 其他人 → 只 public。
// merchantID 是 api 层验过成员才盖的章（MERCHANT-PUBLISH-001 同一套），
// 不是调用方自称 —— 自称的不认。

func socialsVisibleToViewer(socials []AgentSocial, viewerIsSelf, viewerIsMerchant bool) []AgentSocial {
	out := []AgentSocial{}
	for _, item := range socials {
		switch item.Visibility {
		case "public":
			out = append(out, item)
		case "merchants":
			if viewerIsSelf || viewerIsMerchant {
				out = append(out, item)
			}
		case "private":
			if viewerIsSelf {
				out = append(out, item)
			}
		}
	}
	if out == nil {
		out = []AgentSocial{}
	}
	return out
}

func merchantViewer(e command.Envelope) bool {
	if e.AuthContext == nil {
		return false
	}
	id, _ := e.AuthContext["merchantID"].(string)
	return id != ""
}

func (s *Service) linkAgentSocial(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		AgentID    string `json:"agentId"`
		Platform   string `json:"platform"`
		Handle     string `json:"handle"`
		Visibility string `json:"visibility"`
	}
	if !decode(e.Payload, &p) || p.AgentID == "" {
		return command.Rejected(e, "INVALID_AGENT_SOCIAL", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_social", nil)
	}
	if p.AgentID != e.Principal.ID {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	if !isValidSocialPlatform(p.Platform) {
		return command.Rejected(e, "SOCIAL_PLATFORM_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "supply.social_platform_unsupported", nil)
	}
	if !isValidSocialHandle(p.Handle) {
		return command.Rejected(e, "SOCIAL_HANDLE_INVALID", "VALIDATION", "AFTER_USER_ACTION", "supply.social_handle_invalid", nil)
	}
	visibility := p.Visibility
	if visibility == "" {
		// 默认 merchants：找活的人挂社媒就是给商家看的；公开 feed 不默认暴露。
		visibility = "merchants"
	}
	if !isValidSocialVisibility(visibility) {
		return command.Rejected(e, "SOCIAL_VISIBILITY_INVALID", "VALIDATION", "AFTER_USER_ACTION", "supply.social_visibility_invalid", nil)
	}
	profile, err := s.repository.GetProfile(ctx, p.AgentID)
	if errors.Is(err, ErrProfileNotFound) {
		return command.Rejected(e, "AGENT_PROFILE_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.profile_not_found", nil)
	}
	if err != nil {
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}
	now := s.clock.Now().UTC()
	replaced := false
	for i := range profile.Socials {
		if profile.Socials[i].Platform == p.Platform {
			// 同平台再绑 = 换绑，不是叠加 —— 不然一个人能挂 5 个 TikTok，
			// 商家看到的"已关联"就没意义了。
			profile.Socials[i] = AgentSocial{Platform: p.Platform, Handle: p.Handle, Visibility: visibility, CreatedAt: now}
			replaced = true
			break
		}
	}
	if !replaced {
		profile.Socials = append(profile.Socials, AgentSocial{Platform: p.Platform, Handle: p.Handle, Visibility: visibility, CreatedAt: now})
	}
	profile.UpdatedAt = now
	if err := s.repository.UpdateProfile(ctx, profile); err != nil {
		return command.Rejected(e, "PROFILE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_write_failed", nil)
	}
	return acceptedWithPayload(e, "AgentProfile", p.AgentID, 1, "SOCIAL_LINKED", map[string]any{"socials": profile.Socials}, nil)
}

func (s *Service) unlinkAgentSocial(ctx context.Context, e command.Envelope) command.Result {
	var p struct {
		AgentID  string `json:"agentId"`
		Platform string `json:"platform"`
	}
	if !decode(e.Payload, &p) || p.AgentID == "" || p.Platform == "" {
		return command.Rejected(e, "INVALID_AGENT_SOCIAL", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_social", nil)
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
	kept := profile.Socials[:0]
	for _, item := range profile.Socials {
		if item.Platform != p.Platform {
			kept = append(kept, item)
		}
	}
	profile.Socials = kept
	profile.UpdatedAt = s.clock.Now().UTC()
	if err := s.repository.UpdateProfile(ctx, profile); err != nil {
		return command.Rejected(e, "PROFILE_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_write_failed", nil)
	}
	return acceptedWithPayload(e, "AgentProfile", p.AgentID, 1, "SOCIAL_UNLINKED", map[string]any{"socials": profile.Socials}, nil)
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

// ---------- SellerRealName (COMP-SELLER-001 写侧) ----------

// attestSellerRealNamePayload 是运营侧实名核验的入参。
//
// IDNumber 是**唯一**接受明文的地方：它在本函数里立刻变成哈希，明文既不入库
// （只落 IDNumberHash）也不进事件载荷（事件里只带 idType，不带号码）。
type attestSellerRealNamePayload struct {
	AgentID       string `json:"agentId"`
	LegalName     string `json:"legalName"`
	IDType        string `json:"idType"`
	IDNumber      string `json:"idNumber"`
	TaxCode       string `json:"taxCode"`
	UserAccountID string `json:"userAccountId"`
	Decision      string `json:"decision"` // APPROVE | REJECT
}

// attestSellerRealName 记录一次实名核验结论（运营门命令，见 api/security.go）。
//
// 这条命令补的是「已核验」这个状态的唯一合法来源。在此之前：
//   - 全仓没有一处 INSERT 这张表，表里的行只能是手写的；
//   - verified_by 可以填任意字符串（084 要求「具名运营人员」）；
//   - expires_at 可以留空，而读侧把 NULL 当永不过期（084 要求「必须重新核」）。
//
// 三件事合起来的效果是：一个卖家可以在没有任何人核过的情况下永久显示为
// 「已实名」，而所有守卫都是绿的（它们只钉读侧）。本命令把这三件事都变成
// 有归属、有时效、可复查的记录。
func (s *Service) attestSellerRealName(ctx context.Context, e command.Envelope) command.Result {
	var p attestSellerRealNamePayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_SELLER_REAL_NAME_ATTESTATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_real_name_attestation", nil)
	}
	if p.Decision != SellerRealNameDecisionApprove && p.Decision != SellerRealNameDecisionReject {
		return command.Rejected(e, "INVALID_SELLER_REAL_NAME_DECISION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_real_name_decision", nil)
	}
	if !ValidSellerRealNameIDType(p.IDType) {
		// 与 084 的 CHECK (id_type IN ('CCCD','VNEID','PASSPORT')) 对齐：
		// 在这里挡住，才不会把 DB 约束错误当成 500 抛给运营。
		return command.Rejected(e, "SELLER_REAL_NAME_ID_TYPE_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "supply.real_name_id_type_unsupported", nil)
	}
	if p.AgentID == "" || p.LegalName == "" || p.IDNumber == "" {
		return command.Rejected(e, "SELLER_REAL_NAME_ATTESTATION_INCOMPLETE", "VALIDATION", "AFTER_USER_ACTION", "supply.real_name_attestation_incomplete", nil)
	}
	// 「具名」是 084 的原话，也是这条记录唯一的举证价值来源：没有归属人的
	// 核验记录无法回答「谁放的」。缺它就拒绝，而不是写一条 verified_by='' 的。
	if e.Principal.ID == "" {
		return command.Rejected(e, "SELLER_REAL_NAME_ATTESTOR_REQUIRED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.real_name_attestor_required", nil)
	}
	// 被核的对象必须真实存在。否则运营打错一个 agent id 就会凭空造出一条
	// 指向「还不存在的卖家」的核验记录 —— 而之后任何用这个 id 建号的卖家
	// 会直接继承它（读侧只按 agent_id 匹配）。打错字不该等于预先放行。
	if _, err := s.repository.GetProfile(ctx, p.AgentID); err != nil {
		if errors.Is(err, ErrProfileNotFound) {
			return command.Rejected(e, "SELLER_REAL_NAME_AGENT_UNKNOWN", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.real_name_agent_unknown", nil)
		}
		return command.Rejected(e, "PROFILE_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.profile_read_failed", nil)
	}

	now := s.clock.Now().UTC()
	status := SellerRealNameStatusVerified
	var expiresAt *time.Time
	if p.Decision == SellerRealNameDecisionApprove {
		expiry := now.AddDate(0, SellerRealNameAttestationValidityMonths, 0)
		expiresAt = &expiry
	} else {
		status = SellerRealNameStatusRejected
	}

	verification := SellerRealNameVerification{
		ID:            newID("srn_"),
		AgentID:       p.AgentID,
		UserAccountID: strings.TrimSpace(p.UserAccountID),
		LegalName:     strings.TrimSpace(p.LegalName),
		IDType:        p.IDType,
		// 明文证件号到此为止：往下只有哈希。
		IDNumberHash: HashIDNumber(p.IDNumber),
		TaxCode:      strings.TrimSpace(p.TaxCode),
		Status:       status,
		Method:       SellerRealNameMethodOperatorAttestation,
		VerifiedBy:   e.Principal.ID,
		VerifiedAt:   now,
		ExpiresAt:    expiresAt,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := SellerRealNameAttestationComplete(verification); err != nil {
		// 走到这里说明上面的入参校验漏了一项 —— 仍然 fail closed，不写半条记录。
		return command.Rejected(e, "SELLER_REAL_NAME_ATTESTATION_INCOMPLETE", "VALIDATION", "AFTER_USER_ACTION", "supply.real_name_attestation_incomplete", nil)
	}

	// 事件载荷刻意不含 legalName / idNumber：事件会进 outbox 并被长期保存，
	// 把证件号或姓名写进去等于把 PII 复制到一个不受本表访问控制约束的地方。
	eventPayload := map[string]any{
		"agentId": p.AgentID, "status": status, "method": SellerRealNameMethodOperatorAttestation,
		"idType": p.IDType, "taxCodePresent": verification.TaxCode != "",
	}
	if expiresAt != nil {
		eventPayload["expiresAt"] = expiresAt.Format(time.RFC3339)
	}
	domainEvents := []event.DomainEvent{event.New("SellerRealNameAttested", "AgentProfile", p.AgentID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, eventPayload)}

	if err := s.repository.AttestSellerRealName(ctx, verification); err != nil {
		return command.Rejected(e, "SELLER_REAL_NAME_ATTESTATION_FAILED", "INTERNAL", "SAFE_RETRY", "supply.real_name_attestation_failed", nil)
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
	// MATCH-RANK-001：需求方预算（可选）。给了才算「预算适配」分，不给不猜。
	BudgetVND int64 `json:"budgetVnd"`
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
			UserAccountID:  profile.UserAccountID,
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
	// MATCH-RANK-001：以前只按价格从低到高排 —— 最便宜的永远第一，跟她靠不靠谱无关。
	// 现在按真实履约 / 需求方评价 / 经验 / 引力响应 / 预算适配打分（internal/matching），同分再按价格。
	ids := make([]string, 0, len(candidates))
	prices := map[string]int64{}
	byID := map[string]Candidate{}
	for _, c := range candidates {
		ids = append(ids, c.AgentID)
		prices[c.AgentID] = c.ReferencePrice
		byID[c.AgentID] = c
	}
	ranked := matching.Rank(ids, prices, s.rankSignals(ctx, ids), p.BudgetVND)
	candidates = candidates[:0]
	for _, r := range ranked {
		c := byID[r.AgentID]
		breakdown := r.Breakdown
		c.Ranking = &breakdown
		c.RankingReason = "verified_capabilities_and_availability; ranked_by_reliability_satisfaction_experience_response_fit"
		candidates = append(candidates, c)
	}
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
