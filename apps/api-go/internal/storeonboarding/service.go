// Package storeonboarding 是「推荐商铺进体系」的受理域（STORE-REC-001）。
//
// 原始设计（Master PRD v1.1 §15 Business/Merchant Suite + CBOS）：企业/店铺
// 是独立模块，不是账户里的附属功能。体系的增长方式是发展 builder，并让
// 小美（AI）与用户把好的场地 / 商家**推荐进体系**，由运营评估后接入。
//
// 本包只做受理留痕：任何人（已登录用户或 AI）都可以提交一条店铺推荐，
// 记录是 append-only 的举证材料 —— 平台能证明「谁、什么时候、因为什么
// 推荐了哪家店」，后续接入与否由运营在 bdash 里评估，不在此包伪造结果。
package storeonboarding

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// StoreRecommendation 是一条店铺推荐受理记录（append-only）。
type StoreRecommendation struct {
	ID            string `json:"recommendationId"`
	StoreName     string `json:"storeName"`
	City          string `json:"city"`
	Category      string `json:"category"`
	Reason        string `json:"reason"`
	RecommendedBy string `json:"recommendedByAccountId"`
	// Origin 区分「真人用户推荐」与「AI（小美）推荐」。
	Origin    string    `json:"origin"` // USER | AI
	CreatedAt time.Time `json:"createdAt"`
}

// RecommendationFilter 是运营侧的读取条件（STORE-REC-002）。
// 全部可选：不传 = 全量最新的 N 条。
type RecommendationFilter struct {
	City   string // 精确匹配城市；空 = 不限
	Origin string // USER | AI；空 = 不限
	Limit  int    // 已经过 clamp，仓储层直接用于 LIMIT
}

// Repository 落库边界。append-only：只有 Add，没有 Update/Delete。
// List 是给运营的评估队列用的读路径 —— 没有它，推荐就只进不出。
type Repository interface {
	AddRecommendation(ctx context.Context, r StoreRecommendation) error
	ListRecommendations(ctx context.Context, filter RecommendationFilter) ([]StoreRecommendation, error)
}

// ListLimitDefault / ListLimitMax：读路径必须自带上限，否则「拉全表」迟早会
// 变成一次把整张表读进内存的运维事故。
const (
	ListLimitDefault = 50
	ListLimitMax     = 200
)

// Service 是入口。命令边界保证已登录（AI 走系统账号）。
type Service struct {
	repository Repository
	clock      func() time.Time
	mu         sync.RWMutex
	// modelStack 是语义层（小美）适配器。nil 或未配置 = 该能力不可用，
	// SuggestStoreRecommendation 必须 fail-closed，不能退化为本地假结果。
	modelStack modelstack.Port
}

func New() *Service {
	return NewWithRepository(nil)
}

func NewWithRepository(repo Repository) *Service {
	return &Service{repository: repo, clock: time.Now}
}

func (s *Service) SetClock(f func() time.Time) { s.clock = f }

// SetModelStack 注入语义层适配器。nil 保持 fail-closed 的未配置语义
// （对齐 marketplace OPP-SUGGEST-001 的接法）。
func (s *Service) SetModelStack(port modelstack.Port) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.modelStack = port
}

func (s *Service) Supports(commandType string) bool {
	return commandType == "RecommendStore" ||
		commandType == "ListStoreRecommendations" ||
		commandType == "SuggestStoreRecommendation"
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case "RecommendStore":
		return s.recommendStore(ctx, e)
	case "ListStoreRecommendations":
		return s.listRecommendations(ctx, e)
	case "SuggestStoreRecommendation":
		return s.suggestRecommendation(ctx, e)
	default:
		return command.Rejected(e, "UNKNOWN_COMMAND", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.unknown_command", nil)
	}
}

type recommendStorePayload struct {
	StoreName string `json:"storeName"`
	City      string `json:"city"`
	Category  string `json:"category"`
	Reason    string `json:"reason"`
	Origin    string `json:"origin"`
}

func decodeRecommendStorePayload(payload map[string]any, out *recommendStorePayload) bool {
	blob, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(blob, out) == nil
}

func (s *Service) recommendStore(ctx context.Context, e command.Envelope) command.Result {
	var p recommendStorePayload
	if !decodeRecommendStorePayload(e.Payload, &p) {
		return command.Rejected(e, "INVALID_RECOMMENDATION", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation", nil)
	}
	if strings.TrimSpace(p.StoreName) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_STORE", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_store", nil)
	}
	if strings.TrimSpace(p.City) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_CITY", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_city", nil)
	}
	if strings.TrimSpace(p.Reason) == "" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_REASON", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_reason", nil)
	}
	origin := strings.ToUpper(strings.TrimSpace(p.Origin))
	if origin != "USER" && origin != "AI" {
		origin = "USER"
	}
	// 推荐人身份是举证链的一部分：匿名推荐无法回访、无法核实。拿不到就拒绝。
	if e.Actor.ID == "" {
		return command.Rejected(e, "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "storeonboarding.recommendation_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	rec := StoreRecommendation{
		ID:            newRecommendationID(),
		StoreName:     strings.TrimSpace(p.StoreName),
		City:          strings.TrimSpace(p.City),
		Category:      strings.TrimSpace(p.Category),
		Reason:        strings.TrimSpace(p.Reason),
		RecommendedBy: e.Actor.ID,
		Origin:        origin,
		CreatedAt:     s.clock().UTC(),
	}
	if err := s.repository.AddRecommendation(ctx, rec); err != nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	return command.Accepted(e, "StoreRecommendation", rec.ID, 1, "PENDING", nil)
}

type listRecommendationsPayload struct {
	City   string `json:"city"`
	Origin string `json:"origin"`
	Limit  int    `json:"limit"`
}

// listRecommendations 是运营的评估队列（STORE-REC-002）。
//
// 为什么必须存在：STORE-REC-001 只做了受理，记录写进 business.store_recommendations
// 后**没有任何一条读路径** —— 运营在 bdash 里评估这件事在数据层做不到，
// 于是「推荐商铺进体系」变成了一个只进不出的黑洞，写进去的举证材料谁也看不到。
// 这是本仓库反复踩过的那一类坑：**通道建好了，但没有调用方**。
//
// 权限：operator-only。白名单见 internal/api/security.go 的 operatorCommandTypes；
// 未配 PROXY_OPERATOR_PRINCIPALS 时在命令边界就被拒（FAIL-CLOSED），走不到这里。
// 推荐记录含推荐人账号 id 与推荐理由，属于个人信息，绝不能对普通用户开放。
func (s *Service) listRecommendations(ctx context.Context, e command.Envelope) command.Result {
	var p listRecommendationsPayload
	blob, err := json.Marshal(e.Payload)
	if err != nil || json.Unmarshal(blob, &p) != nil {
		return command.Rejected(e, "INVALID_RECOMMENDATION_QUERY", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_query", nil)
	}
	origin := strings.ToUpper(strings.TrimSpace(p.Origin))
	// 明确拒绝而不是静默忽略：拼错 origin 却返回「全量」，会让运营以为
	// 「AI 推荐的就是这些」，按错的结论做评估。
	if origin != "" && origin != "USER" && origin != "AI" {
		return command.Rejected(e, "INVALID_RECOMMENDATION_ORIGIN", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_origin", map[string]any{
			"origin": p.Origin,
		})
	}
	limit := p.Limit
	if limit <= 0 {
		limit = ListLimitDefault
	}
	if limit > ListLimitMax {
		limit = ListLimitMax
	}
	if s.repository == nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	rows, err := s.repository.ListRecommendations(ctx, RecommendationFilter{
		City:   strings.TrimSpace(p.City),
		Origin: origin,
		Limit:  limit,
	})
	if err != nil {
		return command.Rejected(e, "RECOMMENDATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_read_failed", nil)
	}
	// 空结果也必须是 []，不能是 null —— 客户端 fail-closed 解析要求数组。
	if rows == nil {
		rows = []StoreRecommendation{}
	}
	result := command.Accepted(e, "StoreRecommendationList", "queue", 1, "PENDING", nil)
	result.OperationRef = encodeRef(map[string]any{"recommendations": rows})
	return result
}

// suggestionTaskID 是 modelstack 的任务路由 id（pi 配置里注册后可换更便宜的模型）。
const suggestionTaskID = "proxy.storeonboarding.recommendation_suggest"

// SuggestedRecommendation 是小美把用户的话整理成的推荐草稿。
// 字段允许为空 —— 空代表「用户没说」，由 UI 提示补，服务端绝不替他填。
type SuggestedRecommendation struct {
	StoreName string `json:"storeName"`
	City      string `json:"city"`
	Category  string `json:"category"`
	Reason    string `json:"reason"`
}

// suggestRecommendation 处理「让小美整理这条推荐」（STORE-REC-003）。
//
// 为什么必须存在：origin 字段区分「真人用户推荐」与「AI（小美）推荐」，运营
// 队列也有「小美推荐」筛选与徽章 —— 但落地时 RecommendStore 唯一的调用点写死
// origin="USER"，从来没有一个能写入 AI 推荐的地方。schema、服务、筛选、UI 徽章
// 全都在，通道却是死的：队列里那个「小美推荐」筛选永远筛不出任何东西。
//
// 设计对齐 marketplace 的 OPP-SUGGEST-001：
//   - **只读**：本命令不写任何状态。写路径仍然只有 RecommendStore 一个
//     choke point —— LLM 不参与落库，也就绕不过它那套 fail-closed 校验。
//   - **fail-closed**：模型底座未配置时以 AI_NOT_CONFIGURED 明确拒绝，客户端
//     据此隐藏「让小美整理」入口，而不是摆一个点了没反应的按钮。
//   - **不许编造**：LLM 只把用户的话整理成字段，用户没提到的留空字符串。
//     模型输出非法 JSON 或幻觉字段一律拒绝，不猜、不补、不降级。
func (s *Service) suggestRecommendation(ctx context.Context, e command.Envelope) command.Result {
	note, _ := e.Payload["note"].(string)
	note = strings.TrimSpace(note)
	if note == "" {
		return command.Rejected(e, "INVALID_SUGGESTION_NOTE", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_suggestion_note", nil)
	}

	s.mu.RLock()
	stack := s.modelStack
	s.mu.RUnlock()
	if stack == nil || !stack.Available() {
		return command.Rejected(e, "AI_NOT_CONFIGURED", "PROVIDER", "AFTER_USER_ACTION", "storeonboarding.ai_not_configured", nil)
	}

	system := "你是 Proxy 的小美，负责把用户随口描述的店铺整理成一条推荐草稿。" +
		"只输出一个 JSON 对象，键固定为 storeName / city / category / reason，不要输出其他任何文字。" +
		"严格按用户说的话整理：用户没提到的字段一律填空字符串，绝不推测、绝不编造店名或城市。" +
		"city 只填城市名（例如「河内」），不要带国家或区县；reason 用一句中文说明为什么值得进体系。"
	messages := []modelstack.ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: note},
	}
	completion, err := stack.Complete(ctx, suggestionTaskID, messages)
	if err != nil || strings.TrimSpace(completion.Content) == "" {
		return command.Rejected(e, "SUGGESTION_FAILED", "PROVIDER", "SAFE_RETRY", "storeonboarding.suggestion_failed", nil)
	}
	var draft SuggestedRecommendation
	if err := json.Unmarshal([]byte(extractJSONObject(completion.Content)), &draft); err != nil {
		return command.Rejected(e, "SUGGESTION_MALFORMED", "PROVIDER", "SAFE_RETRY", "storeonboarding.suggestion_malformed", nil)
	}
	// 只裁剪，不补全：模型多给的去掉，少给的留空交给用户补。
	draft.StoreName = strings.TrimSpace(draft.StoreName)
	draft.City = strings.TrimSpace(draft.City)
	draft.Category = strings.TrimSpace(draft.Category)
	draft.Reason = strings.TrimSpace(draft.Reason)
	result := command.Accepted(e, "StoreRecommendationSuggestion", "draft", 1, "READY", nil)
	result.OperationRef = encodeRef(map[string]any{
		"storeName": draft.StoreName,
		"city":      draft.City,
		"category":  draft.Category,
		"reason":    draft.Reason,
	})
	return result
}

// extractJSONObject 从可能被散文或 markdown 代码围栏包住的回复里取出第一个 {...}。
func extractJSONObject(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return text
	}
	return text[start : end+1]
}

func encodeRef(payload map[string]any) string {
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func newRecommendationID() string {
	b := make([]byte, 9)
	if _, err := rand.Read(b); err != nil {
		return "sr_" + hex.EncodeToString([]byte(time.Now().String()))[:20]
	}
	return "sr_" + hex.EncodeToString(b)
}

var (
	ErrRecommendationStoreRequired  = errors.New("store recommendation requires a store name")
	ErrRecommendationCityRequired   = errors.New("store recommendation requires a city")
	ErrRecommendationReasonRequired = errors.New("store recommendation requires a reason")
	ErrRecommendationRepositoryDown = errors.New("store recommendation repository is unavailable")
)
