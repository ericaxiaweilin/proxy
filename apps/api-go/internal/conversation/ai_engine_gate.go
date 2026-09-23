package conversation

import (
	"context"
	"strings"
)

// AI-MANAGE-002 / AI-MANAGE-003：AI 管理（我的 → 账户 → AI 管理）的会话侧挂点。
//
// AI-MANAGE-003（2026-09-23）修正了**管的是谁**：
//
// 「对话管理 —— AI 怎么替你聊天」管的是：别人给你发私信时，你的 AI 替你回。
// 所以设置要读**被代表的那个人**（私聊里收消息的真人），不是发消息的人。
// AI-MANAGE-002 读的是 e.Actor（发消息的人）—— 结果是「我把对话权限关了」
// 关掉的是我自己去问 Proxy 助手时助手的回复，而别人私信我时照样有 AI 替我回，
// 「每次确认」还把替我起草的回复塞回给了**对方**。方向整个反了。
//
// 现在的规则：
//   - 只有「私聊（DM）、对面是真人账号」才是代回复，owner = 对面那个真人；
//     跟 Proxy 助手（proxy_ai）的会话、平台 AI 伴侣、群聊都不是「替谁聊天」，对话管理不管。
//   - owner 暂停 → 不回（PAUSED）；关闭 → 不回（OFF）；
//     每次确认 → 不直接回对方（AWAITING_OWNER）。草稿交给 owner 确认的那一步还没做：
//     在做之前，「每次确认」对发消息的人来说就是「对方还没回」，不会把草稿漏给对方；
//     全自动 → 用 owner 的语气 / 长度 / emoji 设置、以代回复身份回。
//   - Token 记在 owner 头上（是 owner 的 AI 在干活），不是发消息的人。
//
// 状态读取 fail-open：设置没接 / 读失败时不拦（见 AiEngineChatStateReader）。

// AiEngineChatState 是会话侧需要的最小设置切片。
// 其余字段（出图/动态偏好）不进会话域，避免会话包反向依赖 identity 全量模型。
type AiEngineChatState struct {
	// Paused 全局暂停：owner 的 AI 一律不替 TA 说话。
	Paused bool
	// ChatPermission off | confirm | auto。
	ChatPermission string
	// Tone / ReplyLength / Emoji：全自动代回复时的说话方式（对话管理 → 风格）。
	Tone        string
	ReplyLength string
	Emoji       string
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

// aiEngineChatStateFor 读设置；没接 / 读失败 = 零值（不拦）。
func (s *Service) aiEngineChatStateFor(ctx context.Context, userID string) (AiEngineChatState, bool) {
	if s == nil || s.aiEngineChatState == nil || strings.TrimSpace(userID) == "" {
		return AiEngineChatState{}, false
	}
	state, err := s.aiEngineChatState(ctx, userID)
	if err != nil {
		return AiEngineChatState{}, false
	}
	return state, true
}

// isNonHumanParticipant：平台助手、平台 AI 账号、agent —— 它们不是「被代表的真人」。
func isNonHumanParticipant(id string) bool {
	return isAssistantCounterparty(id) ||
		strings.HasPrefix(id, "ai_account_") ||
		strings.HasPrefix(id, "ai_") ||
		strings.HasPrefix(id, "agent_") ||
		id == "proxy-ai" || id == "SYSTEM"
}

// aiStandInOwner 返回这次 AI 回复是「替谁」在回；空 = 不是代回复（对话管理不管）。
func aiStandInOwner(conv Conversation, actorID string, assistantMode string) string {
	if conv.Type != "DM" {
		return ""
	}
	if _, companion := companionFor(conv, assistantMode); companion {
		return ""
	}
	owner := ""
	for _, participant := range conv.Participants {
		participant = strings.TrimSpace(participant)
		if participant == "" || participant == actorID {
			continue
		}
		if isNonHumanParticipant(participant) {
			return ""
		}
		owner = participant
	}
	return owner
}

// aiStandIn 是一次代回复判定的结果。
type aiStandIn struct {
	Owner   string
	State   AiEngineChatState
	Blocked bool
	Status  string // PAUSED | OFF | AWAITING_OWNER（Blocked 时）
}

// aiStandInFor 判定这次消息要不要、以什么方式由 owner 的 AI 代回复。
// Owner 为空 = 不是代回复，调用方走原来的助手逻辑。
func (s *Service) aiStandInFor(ctx context.Context, conv Conversation, actorID string, assistantMode string) aiStandIn {
	owner := aiStandInOwner(conv, actorID, assistantMode)
	if owner == "" {
		return aiStandIn{}
	}
	state, wired := s.aiEngineChatStateFor(ctx, owner)
	result := aiStandIn{Owner: owner, State: state}
	if !wired {
		// 设置没接：保持旧行为（直接回），不因为读不到就把所有代回复关掉。
		return result
	}
	switch {
	case state.Paused:
		result.Blocked, result.Status = true, "PAUSED"
	case state.ChatPermission == "off":
		result.Blocked, result.Status = true, "OFF"
	case state.ChatPermission == "confirm":
		result.Blocked, result.Status = true, "AWAITING_OWNER"
	}
	return result
}

type standInContextKey struct{}

// withStandIn 把代回复的 owner 与风格带进生成链路（prompt + 计量都要用）。
func withStandIn(ctx context.Context, standIn aiStandIn) context.Context {
	if standIn.Owner == "" {
		return ctx
	}
	return context.WithValue(ctx, standInContextKey{}, standIn)
}

func standInFrom(ctx context.Context) (aiStandIn, bool) {
	standIn, ok := ctx.Value(standInContextKey{}).(aiStandIn)
	return standIn, ok && standIn.Owner != ""
}

// standInSystemPrompt：代回复的人设 + owner 设置的说话方式。不冒充本人做承诺，
// 也不是平台需求助手（不介绍 Proxy、不引导填需求表单）。
func standInSystemPrompt(state AiEngineChatState) string {
	prompt := "你是这位用户的 AI 代回复助手。这是一段私聊：给你发消息的人想联系的那位真人用户暂时不在，由你先替 TA 回复。" +
		"像 TA 的朋友那样自然、友好地聊天，有来有往；不要自我介绍成平台助手，不要推销或介绍 Proxy，不要引导对方填需求表单。" +
		"你不是 TA 本人：不能替 TA 答应见面时间、地点、金钱或任何交易，涉及具体安排时说会转告 TA、等 TA 亲自确认。" +
		"对方问你是不是真人时，如实说自己是 TA 的 AI 代回复。"
	switch state.Tone {
	case "cool":
		prompt += " 语气：高冷、克制，话不多。"
	case "softer":
		prompt += " 语气：很温柔、体贴。"
	case "lively":
		prompt += " 语气：活泼、俏皮。"
	case "pro":
		prompt += " 语气：专业、干练。"
	default:
		prompt += " 语气：偏温柔。"
	}
	switch state.ReplyLength {
	case "xshort":
		prompt += " 长度：极短，每次不超过 15 个字。"
	case "medium":
		prompt += " 长度：中等，2 到 4 句。"
	case "long":
		prompt += " 长度：可以写一段较完整的话。"
	default:
		prompt += " 长度：一两句短句。"
	}
	switch state.Emoji {
	case "never":
		prompt += " 不要使用 emoji。"
	case "often":
		prompt += " 常用 emoji。"
	case "every":
		prompt += " 每句都带一个 emoji。"
	default:
		prompt += " 偶尔用一个 emoji。"
	}
	return prompt
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
