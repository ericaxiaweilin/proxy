package experience

import (
	"context"
	"encoding/json"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

const CommandGetExperienceManifest = "GetExperienceManifest"

const CommandCompileExperienceSurface = "CompileExperienceSurface"

// R15.49 — ListExperiences: 拉取所有可见体验。request home "体验"计数从 24 hardcode
// 改走 server。client 匿名可调（跟 ListMarketOpportunities / ListActivities 同策略）。
const CommandListExperiences = "ListExperiences"

// ExperienceSummary — R15.49 拉“可见体验”列表的轻量 DTO。
// 不走 runtime.SurfacePlan (那会调用 Decision Engine 拼 schema，太重)。
// 列出“体验名/类别/位置/状态”，client 用来:
//   - Home tab 计数 (体验 24/机会 18/活动 46 → 从 server 拉)
//   - future: 体验列表 UI (类似 activities 列表)
//
// Origin: PLATFORM (平台预置) | MERCHANT (商家发布) | USER (用户自建)
type ExperienceSummary struct {
	ExperienceID string  `json:"experienceId"`
	Title        string  `json:"title"`
	Category     string  `json:"category"`
	Origin       string  `json:"origin"`
	City         string  `json:"city,omitempty"`
	StartTime    *string `json:"startTime,omitempty"`
	Price        string  `json:"price,omitempty"`
	Status       string  `json:"status,omitempty"`
	Capacity     int     `json:"capacity,omitempty"`
	Interested   int     `json:"interested"`
}

type Repository interface {
	CreateIntent(ctx context.Context, intent runtime.ExperienceIntent) error
	CreateSurfacePlan(ctx context.Context, plan runtime.SurfacePlan) error
	// R15.49 — ListExperiences 的数据源。
	// 返 ExperienceSummary 列表，列表为”可见体验”子集，client 不需 filter。
	ListExperiences(ctx context.Context) ([]ExperienceSummary, error)
}

type Service struct {
	compiler     *runtime.SurfaceCompiler
	orchestrator *runtime.ExperienceOrchestrator
	repository   Repository
}

func New() *Service {
	c := runtime.NewSurfaceCompiler("surface_policy_v5")
	return &Service{compiler: c, orchestrator: runtime.NewOrchestrator(c)}
}

func NewWithRepository(repo Repository) *Service {
	c := runtime.NewSurfaceCompiler("surface_policy_v5")
	return &Service{compiler: c, orchestrator: runtime.NewOrchestrator(c), repository: repo}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == CommandGetExperienceManifest || commandType == CommandCompileExperienceSurface || commandType == CommandListExperiences
}

type getManifestPayload struct {
	Context string `json:"context"`
}

type action struct {
	Type    string         `json:"type"`
	Surface string         `json:"surface,omitempty"`
	Route   string         `json:"route,omitempty"`
	Params  map[string]any `json:"params,omitempty"`
}

type menuItem struct {
	ID          string `json:"id"`
	Icon        string `json:"icon"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Accent      bool   `json:"accent,omitempty"`
	Action      action `json:"action"`
}

type menuSection struct {
	ID    string     `json:"id"`
	Title string     `json:"title"`
	Hint  string     `json:"hint,omitempty"`
	Items []menuItem `json:"items"`
}

type meManifest struct {
	Mode     string        `json:"mode,omitempty"`
	Sections []menuSection `json:"sections"`
}

type manifest struct {
	SchemaVersion string     `json:"schemaVersion"`
	Revision      string     `json:"revision"`
	Context       string     `json:"context"`
	Me            meManifest `json:"me"`
}

func (s *Service) Handle(e command.Envelope) command.Result {
	return s.HandleContext(context.Background(), e)
}

func (s *Service) HandleContext(ctx context.Context, e command.Envelope) command.Result {
	switch e.CommandType {
	case CommandGetExperienceManifest:
		return s.handleGetManifest(e)
	case CommandCompileExperienceSurface:
		return s.handleCompileSurface(ctx, e)
	case CommandListExperiences:
		return s.listExperiences(ctx, e)
	default:
		return command.Rejected(
			e,
			"EXPERIENCE_COMMAND_UNSUPPORTED",
			"VALIDATION",
			"AFTER_USER_ACTION",
			"experience.unsupported_command",
			nil,
		)
	}
}

func (s *Service) handleGetManifest(e command.Envelope) command.Result {
	var payload getManifestPayload
	rawPayload, err := json.Marshal(e.Payload)
	if err != nil || json.Unmarshal(rawPayload, &payload) != nil {
		return command.Rejected(
			e,
			"INVALID_EXPERIENCE_MANIFEST_REQUEST",
			"VALIDATION",
			"AFTER_USER_ACTION",
			"experience.invalid_manifest_request",
			nil,
		)
	}

	switch payload.Context {
	case "REQUESTER", "BUSINESS":
	default:
		return command.Rejected(
			e,
			"INVALID_EXPERIENCE_CONTEXT",
			"VALIDATION",
			"AFTER_USER_ACTION",
			"experience.invalid_context",
			map[string]any{"context": payload.Context},
		)
	}

	value := manifestFor(payload.Context)

	result := command.Accepted(
		e,
		"ExperienceManifest",
		payload.Context,
		1,
		"READY",
		nil,
	)

	raw, _ := json.Marshal(value)
	result.OperationRef = string(raw)

	return result
}

// CompileExperienceSurface — §7/§8 Experience Orchestrator + Surface Compiler
type compileSurfacePayload struct {
	Intent                map[string]any `json:"experience_intent"`
	Capability            map[string]any `json:"client_capability"`
	CurrentSurfaceVersion *int           `json:"current_surface_version,omitempty"`
	PolicyVersion         string         `json:"policy_version,omitempty"`
}

func (s *Service) handleCompileSurface(ctx context.Context, e command.Envelope) command.Result {
	var payload compileSurfacePayload
	raw, err := json.Marshal(e.Payload)
	if err != nil || json.Unmarshal(raw, &payload) != nil {
		return command.Rejected(e, "INVALID_COMPILE_REQUEST", "VALIDATION", "AFTER_USER_ACTION", "experience.invalid_compile_request", nil)
	}
	if payload.Intent == nil || payload.Capability == nil {
		return command.Rejected(e, "MISSING_INTENT_OR_CAPABILITY", "VALIDATION", "AFTER_USER_ACTION", "experience.missing_intent_or_capability", nil)
	}
	intent, err := parseIntent(payload.Intent)
	if err != nil {
		return command.Rejected(e, "INVALID_INTENT", "VALIDATION", "AFTER_USER_ACTION", "experience.invalid_intent", map[string]any{"error": err.Error()})
	}
	capability, err := parseCapability(payload.Capability)
	if err != nil {
		return command.Rejected(e, "INVALID_CAPABILITY", "VALIDATION", "AFTER_USER_ACTION", "experience.invalid_capability", map[string]any{"error": err.Error()})
	}
	req := runtime.CompileRequest{
		Intent:                intent,
		ClientCapability:      capability,
		CurrentSurfaceVersion: payload.CurrentSurfaceVersion,
		PolicyVersion:         payload.PolicyVersion,
	}
	result, compileErr := s.compiler.Compile(req)
	if compileErr != nil {
		// §18.2/§18.4 — compiler fallback or NO_UI_CHANGE
		if compileErr.Error() == "NO_UI_CHANGE: priority below intervention threshold" || contains(compileErr.Error(), "NO_UI_CHANGE") {
			// NO_UI_CHANGE is a valid legal result — ACCEPTED with marker
			accepted := command.Accepted(e, "ExperienceSurface", intent.IntentID, 1, "NO_UI_CHANGE", nil)
			accepted.OperationRef = mustMarshal(map[string]any{
				"result": "NO_UI_CHANGE",
				"reason": compileErr.Error(),
				"intent_id": intent.IntentID,
			})
			return accepted
		}
		// otherwise return fallback plan id
		fb := "fallback_stable_home"
		if result != nil && result.FallbackPlanID != nil {
			fb = *result.FallbackPlanID
		}
		rejected := command.Rejected(e, "SURFACE_COMPILE_FALLBACK", "BUSINESS_STATE", "SAFE_RETRY", "experience.compile_fallback", map[string]any{"fallback_plan_id": fb, "error": compileErr.Error()})
		// still surface fallback id in OperationRef for observability
		rejected.OperationRef = mustMarshal(map[string]any{"fallback_plan_id": fb})
		return rejected
	}
	if s.repository != nil {
		// 持久化意图与计划，供后续审计/回放；失败不阻塞编译结果（soft persist）
		_ = s.repository.CreateIntent(ctx, intent)
		_ = s.repository.CreateSurfacePlan(ctx, result.SurfacePlan)
	}
	accepted := command.Accepted(e, "ExperienceSurface", result.SurfacePlan.SurfacePlanID, result.SurfacePlan.SurfaceVersion, "READY", nil)
	accepted.OperationRef = mustMarshal(result)
	return accepted
}

func parseIntent(raw map[string]any) (runtime.ExperienceIntent, error) {
	b, _ := json.Marshal(raw)
	// runtime.ExperienceIntent has time.Time expires_at — handle string parse
	var tmp struct {
		IntentID          string   `json:"intent_id"`
		Type              string   `json:"type"`
		Objective         string   `json:"objective"`
		Priority          float64  `json:"priority"`
		InterventionLevel string   `json:"intervention_level"`
		ContextSnapshotID string   `json:"context_snapshot_id"`
		DecisionID        string   `json:"decision_id"`
		AllowedActions    []string `json:"allowed_actions"`
		ForbiddenActions  []string `json:"forbidden_actions"`
		RequiredInfo      []string `json:"required_information"`
		ExpiresAt         string   `json:"expires_at"`
		ReasonCodes       []string `json:"reason_codes"`
	}
	if err := json.Unmarshal(b, &tmp); err != nil {
		return runtime.ExperienceIntent{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339, tmp.ExpiresAt)
	if err != nil {
		return runtime.ExperienceIntent{}, err
	}
	return runtime.ExperienceIntent{
		IntentID: tmp.IntentID, Type: tmp.Type, Objective: tmp.Objective, Priority: tmp.Priority,
		InterventionLevel: tmp.InterventionLevel, ContextSnapshotID: tmp.ContextSnapshotID, DecisionID: tmp.DecisionID,
		AllowedActions: tmp.AllowedActions, ForbiddenActions: tmp.ForbiddenActions, RequiredInfo: tmp.RequiredInfo,
		ExpiresAt: expiresAt, ReasonCodes: tmp.ReasonCodes,
	}, nil
}

func parseCapability(raw map[string]any) (runtime.ClientCapability, error) {
	b, _ := json.Marshal(raw)
	var cap runtime.ClientCapability
	if err := json.Unmarshal(b, &cap); err != nil {
		return runtime.ClientCapability{}, err
	}
	return cap, nil
}

func mustMarshal(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// ---------- R15.49 ListExperiences ----------

// listExperiences 拉所有可见体验。匿名可调 — context 由 server.auth.go 放行。
// 返体格式: { experiences: ExperienceSummary[] } 走 Accepted.OperationRef (跟
// ListActivities / ListMarketOpportunities 一致)。
func (s *Service) listExperiences(ctx context.Context, e command.Envelope) command.Result {
	if s.repository == nil {
		return command.Rejected(e, "EXPERIENCE_LIST_NO_REPOSITORY", "INTERNAL", "AFTER_USER_ACTION", "experience.list_no_repository", nil)
	}
	list, err := s.repository.ListExperiences(ctx)
	if err != nil {
		return command.Rejected(e, "EXPERIENCE_LIST_FAILED", "INTERNAL", "SAFE_RETRY", "experience.list_failed", nil)
	}
	if list == nil {
		list = []ExperienceSummary{}
	}
	accepted := command.Accepted(e, "Experience", "", 0, "LISTED", nil)
	accepted.OperationRef = mustMarshal(map[string]any{
		"experiences": list,
		"count":       len(list),
	})
	return accepted
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || indexOf(s, substr) >= 0)
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func manifestFor(contextName string) manifest {
	// Server-owned composition: the mobile shell owns only registered components
	// and registered route implementations. Ordering, copy, accent and icon tokens
	// live here, so these changes do not require an Android/iOS rebuild.
	sections := []menuSection{}

	if contextName == "REQUESTER" {
		sections = []menuSection{
			{
				ID: "personal_profile", Title: "个人主页", Hint: "你掌控展示方式",
				Items: []menuItem{
					{
						ID:          "personal_hub",
						Icon:        "profile-ring",
						Label:       "个人主页",
						Description: "名片、关于我、能力、可用时间与对外展示",
						Accent:      true,
						Action:      action{Type: "OPEN_REGISTERED_ROUTE", Route: "personalhub"},
					},
					{
						ID: "social_identity", Icon: "arrow-up-right", Label: "社媒与联系",
						Description: "TikTok、Zalo、Instagram 与可见范围",
						Action:      action{Type: "OPEN_REGISTERED_ROUTE", Route: "socialidentity"},
					},
					{
						ID: "social_analytics", Icon: "route", Label: "访问与转化",
						Description: "渠道 → 主页 → 聊天 → 订单",
						Action:      action{Type: "OPEN_REGISTERED_ROUTE", Route: "socialanalytics"},
					},
				},
			},
			{
				ID: "relationships", Title: "关系", Hint: "真人网络 · 个人轻 CRM 关系图",
				Items: []menuItem{
					{ID: "friend_relationships", Icon: "target", Label: "好友与关系", Description: "关系图 · 轻 CRM · 标签、备注、来源与互动记录", Accent: true, Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "friendcrm"}},
				},
			},
			{
				ID: "my_market", Title: "我的市场", Hint: "个人资产",
				Items: []menuItem{
					{ID: "my_orders", Icon: "diamond", Label: "我的订单", Description: "我发布的 / 我参与的订单与交易记录", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "myorders"}},
					{ID: "availability", Icon: "clock", Label: "能力与可用时间", Description: "能力、主题、区域与空闲时间", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "available"}},
					{ID: "my_activities", Icon: "ring", Label: "我的活动", Description: "已参加 / 我发起的活动", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "myactivities"}},
					{ID: "favorites", Icon: "star", Label: "收藏", Description: "商家、Creator、动态与活动", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "favorites"}},
				},
			},
			{
				ID: "account", Title: "账户", Hint: "安全与结算",
				Items: []menuItem{
					{ID: "wallet", Icon: "coin", Label: "钱包与结算", Description: "付款、收入、退款与记录", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "wallet"}},
					{ID: "settings", Icon: "gear", Label: "设置与隐私", Description: "推荐、通知、权限与隐私", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "appbehavior"}},
					{ID: "business_workspace", Icon: "store-lines", Label: "我的企业 / 店铺", Description: "有经营权限时进入 Business Workspace", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "bdash"}},
				},
			},
			// R15.40.3: FACET 是 ME tab 内的深度模块（不是第 6 个 root）。
			//   me.tsx REQUESTER_ME.sections 里有 facet section，但 server
			//   manifestFor REQUESTER 之前没返 — REPLACE 模式把整段覆盖，
			//   facet 入口在 iPhone 上消失。补回与 mobile persona 同步。
			{
				ID: "facet", Title: "对象化运营", Hint: "FACET · 同一份真实素材，按对象重新组织",
				Items: []menuItem{
					{ID: "facet_home", Icon: "spark", Label: "FACET", Description: "对象列表 · 关系目标 · 缺口判定", Accent: true, Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "facet"}},
				},
			},
		}
	}

	return manifest{
		SchemaVersion: "1.0",
		Revision:      "experience_manifest_r6_my_market_v5",
		Context:       contextName,
		Me: meManifest{
			Mode:     "REPLACE",
			Sections: sections,
		},
	}
}
