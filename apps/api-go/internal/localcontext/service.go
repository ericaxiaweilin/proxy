package localcontext

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
)

// Global Local Context（R13.2 PRD Chapter21H R2 §2.1 + Acceptance R8 Gate B）。
// 硬规则：
//  1. LocalContext 决定 Feed/Nearby/Activity/Merchant/local supply 读取范围
//  2. 用户可手动浏览另一城市 → LocalContext ≠ device_location
//  3. ExactLocation 不得作为全局 Social/Feed 上下文长期暴露
//  4. 精确地址只在具体 Task/Order 目的下单独授权
//  5. 已创建 Task 的地点是真源事实，不因切换全局浏览城市而静默变化
//
// 五个对象必须分离，不得混成一个字段：
//   LocalContext / Device Location / Task Location / Order Meeting Point / Exact GPS Grant

// LocalContext 是浏览与发现上下文（不是订单精确地点）。
type LocalContext struct {
	MarketID    string    `json:"marketId"`
	MarketLabel string    `json:"marketLabel"`
	AreaID      string    `json:"areaId,omitempty"`
	AreaLabel   string    `json:"areaLabel,omitempty"`
	Source      string    `json:"source"`    // DEVICE | MANUAL | DEEP_LINK | TASK_INHERITED
	Precision   string    `json:"precision"` // CITY | COARSE_AREA
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ExactLocationGrant 是精确位置的单独授权（R2 硬规则 3/4）。
// 只在具体 Task / Order 目的下授权；不是全局上下文。
type ExactLocationGrant struct {
	GrantID     string    `json:"grantId"`
	Purpose     string    `json:"purpose"` // TASK | ORDER | MEETING_POINT
	ReferenceID string    `json:"referenceId"`
	ExpiresAt   time.Time `json:"expiresAt"`
	GrantedAt   time.Time `json:"grantedAt"`
}

// Market 是市场目录（P0 演示标签，不冻结正式市场）。
type Market struct {
	MarketID    string   `json:"marketId"`
	MarketLabel string   `json:"marketLabel"`
	Areas       []MarketArea `json:"areas"`
}

type MarketArea struct {
	AreaID    string `json:"areaId"`
	AreaLabel string `json:"areaLabel"`
}

var defaultMarkets = []Market{
	{MarketID: "hanoi", MarketLabel: "河内", Areas: []MarketArea{
		{AreaID: "hoankiem", AreaLabel: "还剑湖附近"},
		{AreaID: "ba-dinh", AreaLabel: "巴亭"},
		{AreaID: "tay-ho", AreaLabel: "西湖"},
	}},
	{MarketID: "bacninh", MarketLabel: "北宁", Areas: []MarketArea{
		{AreaID: "downtown", AreaLabel: "市中心"},
	}},
	{MarketID: "hcmc", MarketLabel: "胡志明市", Areas: []MarketArea{
		{AreaID: "district1", AreaLabel: "第一郡"},
		{AreaID: "district3", AreaLabel: "第三郡"},
	}},
}

type Repository interface {
	GetContext(ctx context.Context, actorID string) (LocalContext, error)
	SetContext(ctx context.Context, actorID string, lc LocalContext) error
	Snapshot(ctx context.Context) ([]LocalContext, error)
}

var ErrContextNotFound = errors.New("local context not found")

type MemoryRepository struct {
	mu      sync.Mutex
	contexts map[string]LocalContext
	events  []event.DomainEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{contexts: make(map[string]LocalContext)}
}

func (r *MemoryRepository) GetContext(_ context.Context, actorID string) (LocalContext, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, exists := r.contexts[actorID]
	if !exists {
		return LocalContext{}, ErrContextNotFound
	}
	return c, nil
}

func (r *MemoryRepository) SetContext(_ context.Context, actorID string, lc LocalContext) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.contexts[actorID] = lc
	return nil
}

func (r *MemoryRepository) Snapshot(_ context.Context) ([]LocalContext, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]LocalContext, 0, len(r.contexts))
	for _, c := range r.contexts {
		result = append(result, c)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].MarketID < result[j].MarketID })
	return result, nil
}

type Service struct {
	mu         sync.Mutex
	repository Repository
	clock      clock.Clock
}

func New() *Service {
	return NewWithRepository(NewMemoryRepository())
}

func NewWithRepository(repository Repository) *Service {
	if repository == nil {
		repository = NewMemoryRepository()
	}
	return &Service{repository: repository, clock: clock.System{}}
}

func (s *Service) Supports(commandType string) bool {
	switch commandType {
	case "SetLocalContext", "GetLocalContext", "GrantExactLocation":
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
	case "SetLocalContext":
		return s.setContext(ctx, e)
	case "GetLocalContext":
		return s.getContext(ctx, e)
	case "GrantExactLocation":
		return s.grantExactLocation(ctx, e)
	default:
		return command.Rejected(e, "LOCAL_CONTEXT_COMMAND_UNSUPPORTED", "VALIDATION", "AFTER_USER_ACTION", "localcontext.unsupported_command", nil)
	}
}

// ---------- SetLocalContext ----------
// R2 硬规则 1/2：LocalContext 决定读取范围；≠ device_location（可 MANUAL 浏览另一城市）。

type setContextPayload struct {
	MarketID string `json:"marketId"`
	AreaID   string `json:"areaId"`
	Source   string `json:"source"` // DEVICE | MANUAL | DEEP_LINK | TASK_INHERITED
}

func (s *Service) setContext(ctx context.Context, e command.Envelope) command.Result {
	var p setContextPayload
	if !decode(e.Payload, &p) || p.MarketID == "" {
		return command.Rejected(e, "INVALID_LOCAL_CONTEXT", "VALIDATION", "AFTER_USER_ACTION", "localcontext.invalid_context", nil)
	}
	if p.Source == "" {
		p.Source = "MANUAL"
	}
	if p.Source != "DEVICE" && p.Source != "MANUAL" && p.Source != "DEEP_LINK" && p.Source != "TASK_INHERITED" {
		return command.Rejected(e, "INVALID_CONTEXT_SOURCE", "VALIDATION", "AFTER_USER_ACTION", "localcontext.invalid_source", nil)
	}
	market := findMarket(p.MarketID)
	if market == nil {
		return command.Rejected(e, "MARKET_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "localcontext.market_not_found", map[string]any{"marketId": p.MarketID})
	}
	precision := "CITY"
	var areaLabel string
	if p.AreaID != "" {
		if !marketHasArea(market, p.AreaID) {
			return command.Rejected(e, "AREA_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "localcontext.area_not_found", map[string]any{"areaId": p.AreaID})
		}
		precision = "COARSE_AREA"
		areaLabel = areaLabelOf(market, p.AreaID)
	}
	context := LocalContext{
		MarketID:    market.MarketID,
		MarketLabel: market.MarketLabel,
		AreaID:      p.AreaID,
		AreaLabel:   areaLabel,
		Source:      p.Source,
		Precision:   precision,
		UpdatedAt:   s.clock.Now().UTC(),
	}
	domainEvents := []event.DomainEvent{event.New("LocalContextSet", "LocalContext", e.Actor.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, context.UpdatedAt, map[string]any{
		"marketId":  context.MarketID,
		"areaId":    context.AreaID,
		"source":    context.Source,
		"precision": context.Precision,
		"note":      "LocalContext ≠ device_location；ExactLocation 不作为全局上下文暴露",
	})}
	if err := s.repository.SetContext(ctx, e.Actor.ID, context); err != nil {
		return command.Rejected(e, "LOCAL_CONTEXT_SET_FAILED", "INTERNAL", "SAFE_RETRY", "localcontext.set_failed", nil)
	}
	return acceptedWithPayload(e, "LocalContext", e.Actor.ID, 1, "SET", map[string]any{
		"context":   context,
		"available": defaultMarkets,
	}, domainEvents)
}

// ---------- GetLocalContext ----------
// R8 Gate B：返回独立 LocalContext 状态 + 市场目录。

func (s *Service) getContext(ctx context.Context, e command.Envelope) command.Result {
	context, err := s.repository.GetContext(ctx, e.Actor.ID)
	if errors.Is(err, ErrContextNotFound) {
		// 未设置时返回默认市场目录 + 提示（首次进入）
		return acceptedWithPayload(e, "LocalContext", e.Actor.ID, 0, "UNSET", map[string]any{
			"context":   nil,
			"available": defaultMarkets,
			"note":      "LocalContext / Device Location / Task Location / Order Meeting Point / Exact GPS Grant 为五个独立对象",
		}, nil)
	}
	if err != nil {
		return command.Rejected(e, "LOCAL_CONTEXT_READ_FAILED", "INTERNAL", "SAFE_RETRY", "localcontext.read_failed", nil)
	}
	return acceptedWithPayload(e, "LocalContext", e.Actor.ID, 1, "SET", map[string]any{
		"context":   context,
		"available": defaultMarkets,
	}, nil)
}

// ---------- GrantExactLocation ----------
// R2 硬规则 3/4：精确位置只在具体 Task/Order 目的下单独授权，有有效期。

type grantPayload struct {
	Purpose     string `json:"purpose"` // TASK | ORDER | MEETING_POINT
	ReferenceID string `json:"referenceId"`
}

func (s *Service) grantExactLocation(ctx context.Context, e command.Envelope) command.Result {
	var p grantPayload
	if !decode(e.Payload, &p) || p.Purpose == "" || p.ReferenceID == "" {
		return command.Rejected(e, "INVALID_EXACT_GRANT", "VALIDATION", "AFTER_USER_ACTION", "localcontext.invalid_exact_grant", nil)
	}
	if p.Purpose != "TASK" && p.Purpose != "ORDER" && p.Purpose != "MEETING_POINT" {
		return command.Rejected(e, "INVALID_GRANT_PURPOSE", "VALIDATION", "AFTER_USER_ACTION", "localcontext.invalid_grant_purpose", nil)
	}
	grant := ExactLocationGrant{
		GrantID:     newID("loc_"),
		Purpose:     p.Purpose,
		ReferenceID: p.ReferenceID,
		GrantedAt:   s.clock.Now().UTC(),
		ExpiresAt:   s.clock.Now().Add(24 * time.Hour).UTC(), // 单日授权，不长期暴露
	}
	domainEvents := []event.DomainEvent{event.New("ExactLocationGranted", "ExactLocationGrant", grant.GrantID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, grant.GrantedAt, map[string]any{
		"purpose":     grant.Purpose,
		"referenceId": grant.ReferenceID,
		"expiresAt":   grant.ExpiresAt,
		"note":        "精确地址只在具体 Task/Order 目的下单独授权，24h 过期",
	})}
	return command.Accepted(e, "ExactLocationGrant", grant.GrantID, 1, "GRANTED", eventRefs(domainEvents))
}

// ---------- helpers ----------

func findMarket(marketID string) *Market {
	for i := range defaultMarkets {
		if defaultMarkets[i].MarketID == marketID {
			return &defaultMarkets[i]
		}
	}
	return nil
}

func marketHasArea(market *Market, areaID string) bool {
	for _, a := range market.Areas {
		if a.AreaID == areaID {
			return true
		}
	}
	return false
}

func areaLabelOf(market *Market, areaID string) string {
	for _, a := range market.Areas {
		if a.AreaID == areaID {
			return a.AreaLabel
		}
	}
	return ""
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

func acceptedWithPayload(e command.Envelope, aggregateType, aggregateID string, version int, state string, payload map[string]any, domainEvents []event.DomainEvent) command.Result {
	result := command.Accepted(e, aggregateType, aggregateID, version, state, eventRefs(domainEvents))
	result.OperationRef = encodeRef(payload)
	return result
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}
