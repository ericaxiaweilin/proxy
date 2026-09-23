package twininsight

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

// TWIN-INSIGHT-002 的「重新总结」：真正走模型底座，底座没配置就 fail-closed。
//
// 为什么不退化成"本地拼一句话就当总结好了"：modelstack/port.go 开篇就写了
// 这条原则 —— 「底座未配置或不可用时拒绝调用，绝不伪造模型结果」。
// 这个按钮的语义是「让模型重新读一遍对话」，返回一段规则拼出来的文本
// 然后告诉用户"已重新总结"，就是把规则输出冒充模型输出，跟编数据同类。
//
// 另一个必须守的点：模型输出**不能带 HTML**。契约（twin-insight.ts）写明
// advice/summary 是纯文本，移动端用 RN Text 渲染，不做 HTML 解析 ——
// 让模型把 <strong> 之类的东西灌进 wire，要么显示成字面量，要么未来某个
// 端忍不住开了 dangerouslySetInnerHTML。所以这里在**出口**剥掉标签，
// 而不是指望 prompt 永远听话。

// ErrSummaryUnavailable：模型底座不可用 / 任务不可路由 / 输出不可用。
// HTTP 层翻成 503，客户端展示「重新总结暂不可用」，不展示英文原文。
var ErrSummaryUnavailable = errors.New("twininsight: summary generation unavailable")

// SummaryGenerator 生成对话摘要。抽成接口是为了让 Service 的测试不需要
// 一个真模型，也为了让"底座没接"这件事在类型上就表达得出来（nil）。
type SummaryGenerator interface {
	Available() bool
	Summarize(ctx context.Context, insight Insight) (string, error)
}

// SummaryTaskID 是模型底座上的业务任务 ID。Domain 只持有这个字符串，
// 具体模型 / Provider / 凭证 / failover 全归底座（modelstack 的契约）。
const SummaryTaskID = "proxy.twininsight.friend_summary"

// ModelStackSummarizer 是 SummaryGenerator 的生产实现。
type ModelStackSummarizer struct {
	port modelstack.Port
}

func NewModelStackSummarizer(port modelstack.Port) *ModelStackSummarizer {
	return &ModelStackSummarizer{port: port}
}

func (m *ModelStackSummarizer) Available() bool {
	return m != nil && m.port != nil && m.port.Available()
}

func (m *ModelStackSummarizer) Summarize(ctx context.Context, insight Insight) (string, error) {
	if !m.Available() {
		return "", ErrSummaryUnavailable
	}
	completion, err := m.port.Complete(ctx, SummaryTaskID, []modelstack.ChatMessage{
		{Role: "system", Content: summarySystemPrompt},
		{Role: "user", Content: summaryUserPrompt(insight)},
	})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrSummaryUnavailable, err)
	}
	text := stripHTML(completion.Content)
	if strings.TrimSpace(text) == "" {
		return "", ErrSummaryUnavailable
	}
	return text, nil
}

const summarySystemPrompt = "你是本地生活社交产品里的 AI 分身助手。" +
	"根据给出的 7 天行为数字，用中文写一段不超过 80 字的客观总结。" +
	"只陈述数字反映的事实，不要推测对方的心理、意图或感情。" +
	"只输出纯文本，不要使用任何 HTML 标签或 Markdown 标记。"

func summaryUserPrompt(insight Insight) string {
	s := insight.Signals
	return fmt.Sprintf(
		"好友：%s\n7 天访问主页：%d 次\n7 天消息：%d 条\n平均停留：%d 秒\n7 天点赞：%d 次",
		insight.DisplayName, s.Views7d, s.Messages7d, s.AvgStaySec, s.Likes7d)
}

// stripHTML 去掉真正的标签，保证 wire 上是纯文本。
//
// 只把「< + 字母或 /」当成标签起点，遇到 '>' 结束。为什么要这么细：
// 更粗暴的写法（见到 '<' 就吞到 '>'）会把一句普通的 "a < b" 连同后面
// 所有内容一起吃掉，而且吃掉之后**没有任何报错** —— 用户看到的是一段
// 莫名其妙被截断的总结。宁可放过一段不像标签的文本，也不能静默丢字。
// 未闭合的 '<' 原样保留（不是标签）。
func stripHTML(text string) string {
	runes := []rune(text)
	var out, pending strings.Builder
	inTag := false
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case !inTag && r == '<' && startsTag(runes, i):
			inTag = true
			pending.Reset()
			pending.WriteRune(r)
		case inTag && r == '>':
			pending.Reset()
			inTag = false
		case inTag:
			pending.WriteRune(r)
		default:
			out.WriteRune(r)
		}
	}
	if inTag {
		// 走到结尾还没闭合 —— 那不是标签，把吞掉的内容还回去。
		out.WriteString(pending.String())
	}
	return strings.TrimSpace(out.String())
}

// startsTag 判断 runes[i] 处的 '<' 是否真的是标签起点：
// 后面必须紧跟字母（<b>）或斜杠（</b>）。'< ' / '<3' 都不是标签。
func startsTag(runes []rune, i int) bool {
	if i+1 >= len(runes) {
		return false
	}
	next := runes[i+1]
	return next == '/' || unicode.IsLetter(next)
}

// RefreshSummary 重新生成某个好友的摘要。
//
// 失败一律返回 ErrSummaryUnavailable —— 调用方不得把"没生成"当成
// "生成了一段空话"，也不得沿用旧摘要然后告诉用户已重新总结。
func (s *Service) RefreshSummary(ctx context.Context, twinID, ownerID, targetID string) (Insight, error) {
	if s.summaries == nil || !s.summaries.Available() {
		return Insight{}, ErrSummaryUnavailable
	}
	insight, err := s.GetInsight(ctx, twinID, ownerID, targetID)
	if err != nil {
		return Insight{}, err
	}
	text, err := s.summaries.Summarize(ctx, insight)
	if err != nil {
		return Insight{}, err
	}
	insight.SummaryText = text
	return insight, nil
}
