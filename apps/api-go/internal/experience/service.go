package experience

import (
	"context"
	"encoding/json"

	"github.com/proxy-app/proxy-api/internal/command"
)

const CommandGetExperienceManifest = "GetExperienceManifest"

type Service struct{}

func New() *Service {
	return &Service{}
}

func (s *Service) Supports(commandType string) bool {
	return commandType == CommandGetExperienceManifest
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

func (s *Service) HandleContext(_ context.Context, e command.Envelope) command.Result {
	if e.CommandType != CommandGetExperienceManifest {
		return command.Rejected(
			e,
			"EXPERIENCE_COMMAND_UNSUPPORTED",
			"VALIDATION",
			"AFTER_USER_ACTION",
			"experience.unsupported_command",
			nil,
		)
	}

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
					{ID: "my_orders", Icon: "diamond", Label: "我的订单", Description: "我发布的 / 我参与的已成交订单", Action: action{Type: "OPEN_SURFACE", Surface: "TASKS", Params: map[string]any{"view": "NEED"}}},
					{ID: "availability", Icon: "clock", Label: "能力与可用时间", Description: "能力、主题、区域与空闲时间", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "available"}},
					{ID: "my_activities", Icon: "ring", Label: "我的活动", Description: "已参加 / 我发起的活动", Action: action{Type: "OPEN_SURFACE", Surface: "TASKS", Params: map[string]any{"view": "ACTIVITY", "filter": "MINE"}}},
					{ID: "following", Icon: "star", Label: "关注与收藏", Description: "人、商家、动态与活动", Action: action{Type: "OPEN_REGISTERED_ROUTE", Route: "postfeed"}},
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
		}
	}

	return manifest{
		SchemaVersion: "1.0",
		Revision:      "experience_manifest_r5_personalhub_me",
		Context:       contextName,
		Me: meManifest{
			Mode:     "REPLACE",
			Sections: sections,
		},
	}
}
