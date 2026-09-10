package marketplace

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// stubSuggestStack is a canned modelstack.Port: Available() reports
// wired, Complete returns the scripted reply.
type stubSuggestStack struct {
	reply string
	err   error
}

func (s stubSuggestStack) Available() bool { return true }
func (s stubSuggestStack) Complete(_ context.Context, _ string, _ []modelstack.ChatMessage) (modelstack.Completion, error) {
	if s.err != nil {
		return modelstack.Completion{}, s.err
	}
	return modelstack.Completion{Content: s.reply}, nil
}

// wiredUnavailableStack simulates the Unconfigured{} fail-closed path.
type wiredUnavailableStack struct{}

func (wiredUnavailableStack) Available() bool { return false }
func (wiredUnavailableStack) Complete(context.Context, string, []modelstack.ChatMessage) (modelstack.Completion, error) {
	return modelstack.Completion{}, nil
}

// OPP-SUGGEST-001: 发布搜索"生成"——LLM 把自由文本映射到目录卡。
// 三个关键行为：①命中目录内 id → 返回整张卡；②LLM 幻觉出目录外
// id → SUGGESTION_MALFORMED 拒（服务端白名单校验，不信模型）；
// ③modelstack 未配置 → AI_NOT_CONFIGURED 明确拒绝（fail-closed，
// 前端据此隐藏生成入口，而不是挂一个坏按钮）。意图判定归语义层，
// 无关键词正则。
func TestSuggestOpportunityTemplate(t *testing.T) {
	s := New()
	s.SeedDefaults()

	// 1. 命中：LLM 选了目录内的 coffee 卡。
	s.SetModelStack(stubSuggestStack{reply: `{"templateId":"coffee","reason":"喝咖啡"}`})
	result := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{
		"query": "今晚想找人喝咖啡",
	}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("suggest hit: %+v", result)
	}
	var body struct {
		Template OpportunityTemplate `json:"template"`
		Reason   string              `json:"reason"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if body.Template.ID != "coffee" || body.Template.Group != "HOT" {
		t.Fatalf("suggested card wrong: %+v", body.Template)
	}

	// 1b. LLM 回复包了 markdown 围栏也能抽出 JSON。
	s.SetModelStack(stubSuggestStack{reply: "```json\n{\"templateId\":\"ktv\",\"reason\":\"唱歌\"}\n```"})
	fenced := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "想去唱歌"}))
	if fenced.Outcome != "ACCEPTED" {
		t.Fatalf("fenced reply: %+v", fenced)
	}

	// 2. 幻觉 id：目录外 → 拒（SUGGESTION_MALFORMED）。
	s.SetModelStack(stubSuggestStack{reply: `{"templateId":"paragliding","reason":"不存在"}`})
	hallucinated := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "想玩滑翔伞"}))
	if hallucinated.Outcome != "REJECTED" || hallucinated.Error == nil || hallucinated.Error.ErrorCode != "SUGGESTION_MALFORMED" {
		t.Fatalf("hallucinated id must be rejected: %+v", hallucinated)
	}

	// 2b. LLM 明确说不匹配（templateId 空）→ SUGGESTION_NO_MATCH。
	s.SetModelStack(stubSuggestStack{reply: `{"templateId":"","reason":"不匹配"}`})
	noMatch := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "帮我代写论文"}))
	if noMatch.Outcome != "REJECTED" || noMatch.Error == nil || noMatch.Error.ErrorCode != "SUGGESTION_NO_MATCH" {
		t.Fatalf("no-match must be rejected distinctly: %+v", noMatch)
	}

	// 3. 未配置 → AI_NOT_CONFIGURED（fail-closed，不猜）。
	unwired := New()
	unwired.SeedDefaults()
	notConfigured := unwired.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "喝咖啡"}))
	if notConfigured.Outcome != "REJECTED" || notConfigured.Error == nil || notConfigured.Error.ErrorCode != "AI_NOT_CONFIGURED" {
		t.Fatalf("unwired stack must fail closed: %+v", notConfigured)
	}

	// 3b. 配了但 Available()==false（如 Unconfigured{} 被显式注入）同样拒。
	wiredFalse := New()
	wiredFalse.SetModelStack(wiredUnavailableStack{})
	unavailable := wiredFalse.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "喝咖啡"}))
	if unavailable.Outcome != "REJECTED" || unavailable.Error == nil || unavailable.Error.ErrorCode != "AI_NOT_CONFIGURED" {
		t.Fatalf("unavailable stack must fail closed: %+v", unavailable)
	}

	// 4. 空 query → 参数校验拒。
	s.SetModelStack(stubSuggestStack{reply: `{"templateId":"coffee","reason":"x"}`})
	empty := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": "   "}))
	if empty.Outcome != "REJECTED" {
		t.Fatalf("empty query must be rejected: %+v", empty)
	}
}

// 白名单校验必须覆盖全部三组（HOT/THEME/MORE）——LLM 选 theme/more 卡
// 也一样直通。
func TestSuggestAcceptsAllGroups(t *testing.T) {
	s := New()
	s.SeedDefaults()
	for _, tpl := range opportunityTemplates {
		s.SetModelStack(stubSuggestStack{reply: `{"templateId":"` + tpl.ID + `","reason":"` + tpl.Title + `"}`})
		result := s.HandleContext(t.Context(), marketEnvelope("SuggestOpportunityTemplate", "anyone", map[string]any{"query": tpl.Title}))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("suggest for %s (%s): %+v", tpl.ID, tpl.Group, result)
		}
		if !strings.Contains(result.OperationRef, tpl.ID) {
			t.Fatalf("suggest result missing template %s", tpl.ID)
		}
	}
}
