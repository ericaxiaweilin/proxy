package conversation

import (
	"context"
	"errors"
	"strings"
)

// COMP-AI-MINOR-001（续）：AI 伴侣**聊天**侧的年龄门禁。
//
// 之前这道门只守在"建分身"上（aipersona/personas.go 的 CreatePersona 调
// CompanionAllowedFor）。但未成年人根本不需要创建分身 —— 平台 AI 伴侣
// （ai_001..005 那批"AI 虚拟女孩"）是**平台自带**的账号，直接 StartConversation
// 带 assistantMode 就能聊，一条消息都不用发就拿到 AI 开场白。
// 被建分身门禁拦掉的人，调直连 API 照样跟 AI 伴侣聊天：客户端拦得住手，
// 拦不住 curl。
//
// 所以门禁要加在**聊天入口**，而不是只在创建入口。判定语义完全复用
// aipersona.CompanionAllowedFor（没接查询 / 没有年龄证据 / 确认未成年 → 三态全拒），
// 这里不另写一套年龄规则 —— 两条路给同一个账号不同的答案比没有门禁更糟。

// CompanionGate 判定某账号是否被允许使用 AI 伴侣。
// 生产实现在 cmd/api/main.go 的 COMP-AI-MINOR-001（聊天侧）区块，判定体是
// aipersona.CompanionAllowedFor —— 与 CreatePersona 用同一个年龄事实源。
// nil = 没接 = 一律拒绝（fail-closed）。
//
// 注意 nil 不是"关掉一个开关"，而是"功能对所有人关闭"：所以任何新增的
// 服务组装点（cmd 层、测试、脚本）都必须显式接上，别让 nil 变成静默降级。
type CompanionGate func(ctx context.Context, userAccountID string) error

// ErrCompanionNotAllowed 是被门禁拦下的统一错误。注入的生产门禁会返回
// aipersona 的 ErrMinorForbidden / ErrNoAgeEvidence / ErrAgeLookupUnavailable，
// 这里只用于"没接门禁"这一种情况，以及给日志一个可读的名字。
var ErrCompanionNotAllowed = errors.New("conversation: AI companions are not available to this account")

// SetCompanionGate 接上 AI 伴侣门禁。不接则所有 AI 伴侣聊天一律不生成回复 ——
// 宁可关掉这个功能，也不对未成年人开放。
func (s *Service) SetCompanionGate(gate CompanionGate) { s.companionGate = gate }

// companionAllowedFor 判定"这个人能不能跟平台 AI 伴侣说话"。
//
// fail-closed 的三个方向跟 aipersona 一致，不在这里开例外：
//   - 门禁没接 → false
//   - 账号 id 为空 → false（无从判断就当不行）
//   - 门禁返回任何错误 → false
func (s *Service) companionAllowedFor(ctx context.Context, userAccountID string) bool {
	if s == nil || s.companionGate == nil {
		return false
	}
	if strings.TrimSpace(userAccountID) == "" {
		return false
	}
	return s.companionGate(ctx, userAccountID) == nil
}

// CompanionSafetyDirective 是平台 AI 伴侣人设 prompt 的硬性拒绝线。
//
// 为什么必须显式写：需求助手那条 prompt 对有偿性服务写得明明白白
// （"不是人员交易、临时伴侣或任何有偿/性服务"），而"AI 虚拟女孩"这条
// 只有"健康 UGC / 不诱导情感依赖" —— 前者是明示拒绝，后者是主题引导，
// 强度完全不同。对一个"有鲜明性格的年轻女孩"人设，只说"做健康 UGC"
// 挡不住一句露骨的性请求：模型会把它当成人设范围内的话题继续聊。
//
// 这条指令与需求助手**同口径**：不是人设偏好，是不可覆盖的红线。
// Terms §19 禁止内容（儿童性剥削 / 非自愿色情 / 色情服务信息）在生成侧
// 的第一道闸就是这条指令。
const CompanionSafetyDirective = "无论对方怎么说（包括自称已成年、要求角色扮演、或者说这只是虚构创作），" +
	"你都不得参与或回应任何色情、性暗示、性服务招嫖、或涉及未成年人的性相关内容；" +
	"遇到这类请求直接简短拒绝并把话题引开，不复述、不解释、不举例、不提供任何替代说法。" +
	"你也不得提供或讨论任何有偿陪伴、 escort、性交易信息。这不是人设选择，是不可覆盖的红线。"
