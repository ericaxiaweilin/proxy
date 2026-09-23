package conversation

import (
	"context"
	"strings"
)

// AI-MANAGE-002：AI 引擎暂停 / 对话权限 / Token 计量的会话侧挂点。
//
// 为什么挂这里而不是只做客户端开关：客户端暂停挡不住 curl —— 服务端
// 不在 generateAIReply 前认设置，暂停就是假的。计量必须在真实推理成功
// 之后记（PromptTokens/OutputTokens 来自底座 usage），不能在客户端估。

// AiEngineChatState 是会话侧需要的最小设置切片。
// 其余字段（出图/动态偏好）不进会话域，避免会话包反向依赖 identity 全量模型。
type AiEngineChatState struct {
	// Paused 全局暂停：挡一切 AI 生成（开场白 + 回复）。
	Paused bool
	// ChatPermission off=不生成 | confirm=生成草稿不落库 | auto=现行直回。
	ChatPermission string
}

// AiEngineChatStateReader 按用户读会话侧设置。nil = 没接 = 不拦（与
// companionGate 的 fail-open 相反：伴侣门禁关掉的是合规风险，设置没接
// 时若 fail-closed 会把所有人的 AI 聊天静默关掉，且无法区分"没接"和
// "故意关"）。生产接线在 cmd/api。
type AiEngineChatStateReader func(ctx context.Context, userAccountID string) (AiEngineChatState, error)

// TokenMeter 在一次真实推理成功后累加当月用量。nil = 不记（计量失败
// 不得打断聊天主路径）。
type TokenMeter func(ctx context.Context, userAccountID string, promptTokens, outputTokens int)

// SetAiEngineChatStateReader 接上 AI 管理页的暂停/权限读取。
func (s *Service) SetAiEngineChatStateReader(reader AiEngineChatStateReader) {
	s.aiEngineChatState = reader
}

// SetTokenMeter 接上 Token 计量。
func (s *Service) SetTokenMeter(meter TokenMeter) { s.tokenMeter = meter }

// aiEngineChatStateFor 读设置；没接 = 不拦（见 AiEngineChatStateReader 注释）。
func (s *Service) aiEngineChatStateFor(ctx context.Context, userID string) AiEngineChatState {
	if s == nil || s.aiEngineChatState == nil || strings.TrimSpace(userID) == "" {
		return AiEngineChatState{}
	}
	state, err := s.aiEngineChatState(ctx, userID)
	if err != nil {
		// 读设置失败不拦：与 fail-open 一致，避免仓抖把所有 AI 聊天关掉。
		return AiEngineChatState{}
	}
	return state
}

// aiGenerationBlocked 返回非空 = 这次不该生成 AI 回复，以及该回的 assistantStatus。
// 与 companionGated 并列：伴侣年龄门优先（GATED），暂停/权限其次。
func (s *Service) aiGenerationBlocked(ctx context.Context, userID string) (blocked bool, status string) {
	state := s.aiEngineChatStateFor(ctx, userID)
	if state.Paused {
		return true, "PAUSED"
	}
	if state.ChatPermission == "off" {
		return true, "OFF"
	}
	return false, ""
}

// aiRequiresDraftConfirm 为 true 时：生成内容只进 payload（aiDraft），
// 不 AppendMessage —— 对应权限「每次确认」：AI 起草，你点发才发。
func (s *Service) aiRequiresDraftConfirm(ctx context.Context, userID string) bool {
	state := s.aiEngineChatStateFor(ctx, userID)
	return state.ChatPermission == "confirm"
}

// recordAiTokens 记一次成功推理的 token；没接 meter 或全是 0 则跳过。
func (s *Service) recordAiTokens(ctx context.Context, userID string, prompt, output int) {
	if s == nil || s.tokenMeter == nil || strings.TrimSpace(userID) == "" {
		return
	}
	if prompt <= 0 && output <= 0 {
		return
	}
	if prompt < 0 {
		prompt = 0
	}
	if output < 0 {
		output = 0
	}
	s.tokenMeter(ctx, userID, prompt, output)
}
