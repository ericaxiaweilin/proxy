// Package modelstack 接入公司公共模型底座（Model Stack Control Plane）。
//
// 业务侧契约：Domain 模块只持有业务任务 ID（如 proxy.localnet.post_summary），
// 不感知具体模型、Provider、凭证与 failover；模型底座负责任务路由、Provider
// 选择、健康与凭证托管。本包是该契约的 Provider Adapter 边界，遵循项目
// fail-closed 原则：底座未配置或不可用时拒绝调用，绝不伪造模型结果。
package modelstack

import (
	"context"
	"encoding/json"
	"errors"
)

// Port 是 Domain 模块访问模型底座的唯一端口。
// Domain 只传业务任务 ID 与对话消息，路由、模型选择、failover 全部由底座决定。
type Port interface {
	// Available 表示适配器是否已配置。未配置时必须拒绝调用（fail-closed）。
	Available() bool
	// Complete 按任务 ID 发起一次非流式推理。
	Complete(ctx context.Context, taskID string, messages []ChatMessage) (Completion, error)
}

// ChatMessage 是 OpenAI 兼容对话消息的最小业务表示。
// 文本消息用 Content；多模态消息用 Parts（文本+图片），两者择一。
type ChatMessage struct {
	Role    string        `json:"role"`
	Content string        `json:"content,omitempty"`
	Parts   []ContentPart `json:"-"`
}

// ContentPart 是多模态内容片段（OpenAI Vision 兼容）。
type ContentPart struct {
	Type     string    `json:"type"` // text | image_url
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
}

// ImageURL 是图片的 data URI 或可访问 URL。
type ImageURL struct {
	URL string `json:"url"`
}

// MarshalJSON 按是否包含多模态 Parts 决定 content 的形态：
// - 仅文本： "content": "string"
// - 含图：   "content": [{"type":"text",...}, {"type":"image_url",...}]
func (m ChatMessage) MarshalJSON() ([]byte, error) {
	type raw ChatMessage
	if len(m.Parts) == 0 {
		return json.Marshal(struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{Role: m.Role, Content: m.Content})
	}
	return json.Marshal(struct {
		Role    string        `json:"role"`
		Content []ContentPart `json:"content"`
	}{Role: m.Role, Content: m.Parts})
}

func (m *ChatMessage) UnmarshalJSON(data []byte) error {
	var probe struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return err
	}
	m.Role = probe.Role
	if len(probe.Content) == 0 || string(probe.Content) == "null" {
		return nil
	}
	// 尝试按字符串解析
	var s string
	if err := json.Unmarshal(probe.Content, &s); err == nil {
		m.Content = s
		return nil
	}
	var parts []ContentPart
	if err := json.Unmarshal(probe.Content, &parts); err == nil {
		m.Parts = parts
		// 兼容：把 text 片段拼回 Content 便于日志
		for _, p := range parts {
			if p.Type == "text" && p.Text != "" {
				if m.Content != "" {
					m.Content += "\n"
				}
				m.Content += p.Text
			}
		}
		return nil
	}
	return nil
}

// Completion 是一次推理的业务侧结果。Model/Provider 仅用于审计与可观测性，
// Domain 不得基于具体模型名做业务分支。
type Completion struct {
	Content      string `json:"content"`
	TaskID       string `json:"task_id"`
	Model        string `json:"model"`
	Provider     string `json:"provider"`
	ModelOption  string `json:"model_option_id"`
	PromptTokens int    `json:"prompt_tokens"`
	OutputTokens int    `json:"output_tokens"`
}

var (
	// ErrUnconfigured 表示模型底座适配器未配置。调用方必须把该能力视为
	// 不可用，不能退化为任何本地假结果。
	ErrUnconfigured = errors.New("modelstack: adapter unconfigured (fail-closed)")
	// ErrTaskNotRoutable 表示底座判定该任务 ID 不可路由（未注册、停用或
	// 无已部署 Provider）。
	ErrTaskNotRoutable = errors.New("modelstack: task not routable")
	// ErrControlPlaneUnavailable 表示控制面不可达。
	ErrControlPlaneUnavailable = errors.New("modelstack: control plane unavailable")
	// ErrGatewayFailure 表示运行时网关调用失败（已回报 runtime-failure）。
	ErrGatewayFailure = errors.New("modelstack: gateway invocation failed")
)

// Unconfigured 是 fail-closed 的未配置适配器，与 identity
// UnconfiguredLoginChallengeProvider 的模式一致。
type Unconfigured struct{}

func (Unconfigured) Available() bool { return false }

func (Unconfigured) Complete(context.Context, string, []ChatMessage) (Completion, error) {
	return Completion{}, ErrUnconfigured
}
