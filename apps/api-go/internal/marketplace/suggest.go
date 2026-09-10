package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// OPP-SUGGEST-001: 发布搜索"生成"——把自由文本（"今晚想找人喝咖啡"）
// 语义映射到目录卡。意图判定归语义层（LLM），不做关键词正则——这是
// 仓库既定规则（程序规则②：意图识别不用正则）。
//
// 设计对齐 conversation 服务：marketplace 持有 modelstack.Port，
// Unconfigured{} fail-closed（Available()==false 时明确拒绝而不是猜），
// 主进程注入真适配器。输出必须是目录内真实存在的模板 id（服务端
// 校验，LLM 幻觉 id 会被拒），LLM 只做"文本 → 目录卡"的映射，不发明
// 新场景——写路径仍只有 PublishMarketOpportunity 单一 choke point。

// suggestionTaskID 是 modelstack 任务路由 id（pi 配置里注册后可换
// 更便宜的模型）。
const suggestionTaskID = "proxy.marketplace.template_suggest"

// SetModelStack wires the semantic-layer adapter. Nil keeps the
// fail-closed Unconfigured{} default.
func (s *Service) SetModelStack(port modelstack.Port) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.modelStack = port
}

// suggestOpportunityTemplate handles SuggestOpportunityTemplate: the
// publish-flow search box. Read-only, no repository state, anonymous
// callers allowed (it discloses nothing about any user — same tier as
// ListOpportunityTemplates). Requires a configured model stack; when
// the stack is not wired it rejects with a distinct error code so the
// mobile client can hide the "生成" affordance instead of showing a
// broken button.
func (s *Service) suggestOpportunityTemplate(ctx context.Context, e command.Envelope) command.Result {
	query, _ := e.Payload["query"].(string)
	query = strings.TrimSpace(query)
	if query == "" {
		return rejected(e, "INVALID_SUGGESTION_QUERY", "market.invalid_suggestion_query")
	}

	s.mu.Lock()
	stack := s.modelStack
	s.mu.Unlock()
	if stack == nil || !stack.Available() {
		return command.Rejected(e, "AI_NOT_CONFIGURED", "PROVIDER", "AFTER_USER_ACTION", "market.ai_not_configured", nil)
	}

	// 目录卡目录注入 prompt：LLM 只能从白名单 id 里选。
	ids := make([]string, 0, len(opportunityTemplates))
	titles := make([]string, 0, len(opportunityTemplates))
	for _, tpl := range opportunityTemplates {
		ids = append(ids, tpl.ID)
		titles = append(titles, fmt.Sprintf("%s（%s）", tpl.Title, tpl.Sub))
	}
	system := fmt.Sprintf(
		"你是 Proxy 发布需求的场景路由助手。用户描述想约的活动，你从下面的场景目录里选出最匹配的一张卡。"+
			"只输出一个 JSON 对象：{\"templateId\": \"<目录里的 id>\", \"reason\": \"<10字以内为什么匹配>\"}，不要输出其他任何文字。"+
			"如果没有任何一张卡匹配（例如涉及不当或违法活动），输出 {\"templateId\": \"\", \"reason\": \"不匹配\"}。"+
			"目录（id — 标题）：%s",
		strings.Join(zipTemplateLabels(ids, titles), "；"),
	)
	messages := []modelstack.ChatMessage{
		{Role: "system", Content: system},
		{Role: "user", Content: query},
	}
	completion, err := stack.Complete(ctx, suggestionTaskID, messages)
	if err != nil || strings.TrimSpace(completion.Content) == "" {
		return command.Rejected(e, "SUGGESTION_FAILED", "PROVIDER", "SAFE_RETRY", "market.suggestion_failed", nil)
	}

	// LLM 输出必须是合法 JSON 且 id 在目录内——幻觉 id 直接拒。
	var parsed struct {
		TemplateID string `json:"templateId"`
		Reason     string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(extractJSON(strings.TrimSpace(completion.Content))), &parsed); err != nil {
		return command.Rejected(e, "SUGGESTION_MALFORMED", "PROVIDER", "SAFE_RETRY", "market.suggestion_malformed", nil)
	}
	if parsed.TemplateID == "" {
		return rejected(e, "SUGGESTION_NO_MATCH", "market.suggestion_no_match")
	}
	var matched *OpportunityTemplate
	for i := range opportunityTemplates {
		if opportunityTemplates[i].ID == parsed.TemplateID {
			matched = &opportunityTemplates[i]
			break
		}
	}
	if matched == nil {
		return command.Rejected(e, "SUGGESTION_MALFORMED", "PROVIDER", "SAFE_RETRY", "market.suggestion_malformed", nil)
	}
	return payload(e, "Market", "suggest", "READY", map[string]any{
		"template": *matched,
		"reason":   parsed.Reason,
	})
}

// extractJSON pulls the first {...} block out of an LLM reply that
// might have wrapped it in prose or markdown fences.
func extractJSON(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return text
	}
	return text[start : end+1]
}

func zipTemplateLabels(ids, titles []string) []string {
	labels := make([]string, 0, len(ids))
	for i := range ids {
		labels = append(labels, fmt.Sprintf("%s — %s", ids[i], titles[i]))
	}
	return labels
}
