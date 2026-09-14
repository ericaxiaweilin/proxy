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

	// STORE-REC-004: 运营对这条推荐的**最新**评估结论。
	// 结论存在另一张 append-only 表里，这里只是 LEFT JOIN 带出来的快照。
	// Decision 为空 = 还没评估；改主意靠追加新结论，所以「最新一条」为准。
	Decision       string     `json:"decision,omitempty"` // "" | ACCEPT | REJECT
	DecisionReason string     `json:"decisionReason,omitempty"`
	DecidedBy      string     `json:"decidedBy,omitempty"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
}

// Disposition 是运营对一条推荐做出的评估结论（append-only）。
//
// 为什么不直接给 StoreRecommendation 加个状态列：推荐记录是**举证材料**
// （谁、什么时候、因为什么推荐了哪家店），结论是另一件事。混在一张表里就要
// UPDATE，等于把举证链改掉了。与 moderation_reports / moderation_dispositions
// 分开两张表是同一个口径。
type Disposition struct {
	ID               string
	RecommendationID string
	// Decision 只能取 AcceptDecision / RejectDecision。
	Decision  string
	Reason    string
	DecidedBy string
	CreatedAt time.Time
}

const (
	AcceptDecision = "ACCEPT"
	RejectDecision = "REJECT"
)

// RecommendationFilter 是运营侧的读取条件（STORE-REC-002）。
// 全部可选：不传 = 全量最新的 N 条。
type RecommendationFilter struct {
	City   string // 精确匹配城市；空 = 不限
	Origin string // USER | AI；空 = 不限
	Limit  int    // 已经过 clamp，仓储层直接用于 LIMIT
	// RecommendedBy 限定「谁推荐的」（STORE-REC-007）。给「我推荐的店」用：
	// 推荐人必须能看见自己那条的进展，否则他永远不知道结果，也就不会知道
	// 「该去建店了」—— 而能完成入驻这件事的人通常就是他。
	// 空 = 不限（运营队列）。
	RecommendedBy string
	// Status 按**最新结论**筛选，见下面四个常量；空 = 不限。
	//
	// STORE-REC-005 前这里是个 PendingOnly bool，只能表达「待评估 / 全部」。
	// 那够用是因为当时队列只有这两种看法；但采纳是个死胡同 —— 一点采纳，
	// 这条推荐就只存在于「全部」里，运营看不到自己批过什么、更没法跟进。
	// 布尔值表达不了四态，所以换成 status。
	Status string
}

// 队列的四种看法。PENDING 不是一种「结论」，而是「还没有结论」——
// 之所以仍然给它一个常量，是为了让调用方能明确说「我要待评估的」，
// 而不是靠「不传 status」这种含糊的默认。
const (
	StatusAny      = ""
	StatusPending  = "PENDING"
	StatusAccepted = "ACCEPTED"
	StatusRejected = "REJECTED"
)

// Repository 落库边界。append-only：只有 Add，没有 Update/Delete。
// List 是给运营的评估队列用的读路径 —— 没有它，推荐就只进不出。
type Repository interface {
	AddRecommendation(ctx context.Context, r StoreRecommendation) error
	ListRecommendations(ctx context.Context, filter RecommendationFilter) ([]StoreRecommendation, error)
	// STORE-REC-004: 追加一条评估结论。append-only —— 没有 Update/Delete，
	// 改主意就是再追加一条。
	AddDisposition(ctx context.Context, d Disposition) error
	// STORE-REC-006: 按 id 取一条推荐。found=false = 不存在。
	// 结论必须落在一条真实存在的推荐上，否则会产生 join 不到任何东西的孤儿结论。
	FindRecommendation(ctx context.Context, id string) (StoreRecommendation, bool, error)
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
		commandType == "SuggestStoreRecommendation" ||
		commandType == "DecideStoreRecommendation" ||
		commandType == "ListMyStoreRecommendations"
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
	case "DecideStoreRecommendation":
		return s.decideStoreRecommendation(ctx, e)
	case "ListMyStoreRecommendations":
		return s.listMyRecommendations(ctx, e)
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
	Status string `json:"status"`
	// PendingOnly 是 STORE-REC-005 之前的旧字段，等价于 status=PENDING。
	// 保留是为了不让既有调用方（与 STORE-REC-004 的回归钉）突然失效；
	// 两个都传时以 status 为准，见 normalizeQueueStatus。
	PendingOnly bool `json:"pendingOnly"`
}

// normalizeQueueStatus 把队列的筛选条件收敛成一个 status。
//
// 为什么显式校验而不是静默忽略：拼错 status 却返回「全量」，运营会以为
// 「已采纳的就是这些」，照着错误的清单去跟进商家。
func normalizeQueueStatus(status string, pendingOnly bool) (string, bool) {
	s := strings.ToUpper(strings.TrimSpace(status))
	switch s {
	case StatusAny, StatusPending, StatusAccepted, StatusRejected:
		// ok
	default:
		return "", false
	}
	if s == StatusAny && pendingOnly {
		s = StatusPending
	}
	return s, true
}

// matchesStatus 判断一条推荐的最新结论是否符合筛选条件。
// decision 是 LEFT JOIN 带出来的快照，空串 = 还没评估。
func matchesStatus(status, decision string) bool {
	switch status {
	case StatusPending:
		return decision == ""
	case StatusAccepted:
		return decision == AcceptDecision
	case StatusRejected:
		return decision == RejectDecision
	default:
		return true
	}
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
	status, ok := normalizeQueueStatus(p.Status, p.PendingOnly)
	if !ok {
		return command.Rejected(e, "INVALID_RECOMMENDATION_STATUS", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_status", map[string]any{
			"status": p.Status,
		})
	}
	return s.queryQueue(ctx, e, RecommendationFilter{
		City:   strings.TrimSpace(p.City),
		Origin: origin,
		Limit:  p.Limit,
		Status: status,
	})
}

// listMyRecommendations 让推荐人看见**自己**推荐的进展（STORE-REC-007）。
//
// 为什么必须存在：采纳只代表运营批准接入，商家真正入驻是另一件事 —— 而能完成
// 那件事的人（推荐人，通常就是店主本人）**看不到自己那条推荐怎么样了**。
// 他提交完就再无回音，自然也不会知道「该去建店了」，于是「已采纳 · 待接入」
// 那一列永远等不到人。队列是给运营看的，这一条是给推荐人看的，两件事。
//
// 权限：登录即可，**不是** operator 命令。但作用域强制收敛到 e.Actor.ID ——
// 调用方传什么参数都改变不了这个条件，绝无可能看到别人的推荐。
// 推荐理由属于个人信息，跨账号读是绝不能开的口子。
func (s *Service) listMyRecommendations(ctx context.Context, e command.Envelope) command.Result {
	if e.Actor.ID == "" {
		return command.Rejected(e, "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "storeonboarding.recommendation_requires_actor", nil)
	}
	var p listRecommendationsPayload
	if blob, err := json.Marshal(e.Payload); err != nil || json.Unmarshal(blob, &p) != nil {
		return command.Rejected(e, "INVALID_RECOMMENDATION_QUERY", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_query", nil)
	}
	status, ok := normalizeQueueStatus(p.Status, p.PendingOnly)
	if !ok {
		return command.Rejected(e, "INVALID_RECOMMENDATION_STATUS", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_recommendation_status", map[string]any{
			"status": p.Status,
		})
	}
	// 城市 / 来源这类筛选对「我自己的」没有意义，也不该被外部控制：
	// 唯一生效的作用域就是调用者本人。
	return s.queryQueue(ctx, e, RecommendationFilter{
		Limit:         p.Limit,
		Status:        status,
		RecommendedBy: e.Actor.ID,
	})
}

// queryQueue 是两条读路径共用的尾巴：clamp 上限、读、并保证空结果是 []。
func (s *Service) queryQueue(ctx context.Context, e command.Envelope, filter RecommendationFilter) command.Result {
	limit := filter.Limit
	if limit <= 0 {
		limit = ListLimitDefault
	}
	if limit > ListLimitMax {
		limit = ListLimitMax
	}
	filter.Limit = limit
	if s.repository == nil {
		return command.Rejected(e, "RECOMMENDATION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.recommendation_failed", nil)
	}
	rows, err := s.repository.ListRecommendations(ctx, filter)
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
type decideRecommendationPayload struct {
	RecommendationID string `json:"recommendationId"`
	Decision         string `json:"decision"`
	Reason           string `json:"reason"`
}

// decideStoreRecommendation 处理运营的评估结论（STORE-REC-004）。
//
// 为什么必须存在：队列（STORE-REC-002）只能看、不能判 —— 运营在 App 里读完一条
// 推荐，没有任何地方记录「采纳 / 不采纳」，结论只存在于他脑子里。于是队列变成
// 一条只读的死胡同：看完了，然后呢？
//
// 权限：operator-only（与 ListStoreRecommendations 同一道门）。结论 append-only：
// 改主意不是改旧记录，而是追加一条新的，以最新一条为准。
func (s *Service) decideStoreRecommendation(ctx context.Context, e command.Envelope) command.Result {
	var p decideRecommendationPayload
	blob, err := json.Marshal(e.Payload)
	if err != nil || json.Unmarshal(blob, &p) != nil {
		return command.Rejected(e, "INVALID_DISPOSITION", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_disposition", nil)
	}
	recID := strings.TrimSpace(p.RecommendationID)
	if recID == "" {
		return command.Rejected(e, "INVALID_DISPOSITION_RECOMMENDATION", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_disposition_recommendation", nil)
	}
	decision := strings.ToUpper(strings.TrimSpace(p.Decision))
	// 明确拒绝而不是静默当 ACCEPT：拼错的 decision 若被当成采纳，运营会以为
	// 这家店已经进体系了。
	if decision != AcceptDecision && decision != RejectDecision {
		return command.Rejected(e, "INVALID_DISPOSITION_DECISION", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.invalid_disposition_decision", map[string]any{
			"decision": p.Decision,
		})
	}
	reason := strings.TrimSpace(p.Reason)
	// 不采纳必须给理由：否则举证链上会留一条无法解释的拒绝，
	// 过几个月复盘时没人知道当时为什么否掉这家店。
	if decision == RejectDecision && reason == "" {
		return command.Rejected(e, "DISPOSITION_REJECT_REQUIRES_REASON", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.disposition_reject_requires_reason", nil)
	}
	// 处置人身份同样是举证链的一部分：匿名处置无法追责。
	if e.Actor.ID == "" {
		return command.Rejected(e, "RECOMMENDATION_REQUIRES_AUTHENTICATED_ACTOR", "AUTHORIZATION", "AFTER_USER_ACTION", "storeonboarding.recommendation_requires_actor", nil)
	}
	if s.repository == nil {
		return command.Rejected(e, "DISPOSITION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.disposition_failed", nil)
	}
	// STORE-REC-006: 结论必须落在一条**真实存在**的推荐上。
	//
	// 少了这一步，id 打错（或推荐已被清理）时也会写进一条结论 —— 它永远 join
	// 不到任何推荐，于是那条推荐在队列里**永远还是「待评估」**。运营看到的是
	// 「我点了采纳但没反应」，会反复点，append-only 的举证链里就堆满一堆谁也
	// 解释不了的孤儿结论。宁可当场拒绝，也不要留一条对不上的证据。
	_, found, err := s.repository.FindRecommendation(ctx, recID)
	if err != nil {
		return command.Rejected(e, "DISPOSITION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.disposition_failed", nil)
	}
	if !found {
		return command.Rejected(e, "DISPOSITION_RECOMMENDATION_NOT_FOUND", "VALIDATION", "AFTER_USER_ACTION", "storeonboarding.disposition_recommendation_not_found", map[string]any{
			"recommendationId": recID,
		})
	}
	if err := s.repository.AddDisposition(ctx, Disposition{
		ID:               newDispositionID(),
		RecommendationID: recID,
		Decision:         decision,
		Reason:           reason,
		DecidedBy:        e.Actor.ID,
		CreatedAt:        s.clock().UTC(),
	}); err != nil {
		return command.Rejected(e, "DISPOSITION_FAILED", "INTERNAL", "SAFE_RETRY", "storeonboarding.disposition_failed", nil)
	}
	return command.Accepted(e, "StoreRecommendationDisposition", recID, 1, "PENDING", nil)
}

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

// newDispositionID 与推荐 id 分开：日志里一眼能看出这是结论还是推荐。
func newDispositionID() string {
	b := make([]byte, 9)
	if _, err := rand.Read(b); err != nil {
		return "srd_" + hex.EncodeToString([]byte(time.Now().String()))[:20]
	}
	return "srd_" + hex.EncodeToString(b)
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

	ErrDispositionRecommendationRequired = errors.New("disposition requires a recommendation id")
	ErrDispositionDecisionInvalid        = errors.New("disposition decision must be ACCEPT or REJECT")
	ErrDispositionDeciderRequired        = errors.New("disposition requires an authenticated decider")
)
