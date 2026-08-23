package conversation

import "strings"

// TemporaryUI 是服务器在一次对话回复中附带的短期交互契约。
// 客户端只负责通用渲染，不内置任何业务问题、敏感场景或选项。
// 它不是业务事实；用户提交的内容仍作为普通对话消息，由后续明确确认建立事实。
type TemporaryUI struct {
	ID          string             `json:"id"`
	Kind        string             `json:"kind"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	SubmitLabel string             `json:"submitLabel"`
	Fields      []TemporaryUIField `json:"fields"`
}

type TemporaryUIField struct {
	ID          string                   `json:"id"`
	Label       string                   `json:"label"`
	Type        string                   `json:"type"`
	Required    bool                     `json:"required"`
	Placeholder string                   `json:"placeholder,omitempty"`
	Options     []TemporaryUIFieldOption `json:"options,omitempty"`
}

type TemporaryUIFieldOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// temporaryUIFor is deliberately server-side. The model receives a hint that a
// form is available, but cannot invent client-side flows or require numbered
// answers. New scenarios can be introduced by returning another descriptor.
func temporaryUIFor(userText string) *TemporaryUI {
	text := strings.ToLower(strings.TrimSpace(userText))
	if isTranslationRequest(text) {
		return &TemporaryUI{
			ID:          "translation_brief.v1",
			Kind:        "SHORT_FORM",
			Title:       "补充翻译需求",
			Description: "点选或简短填写即可，我会据此继续帮你匹配。",
			SubmitLabel: "继续",
			Fields: []TemporaryUIField{
				{ID: "languages", Label: "语言", Type: "SINGLE_SELECT", Required: true, Options: []TemporaryUIFieldOption{{ID: "zh-en", Label: "中 ↔ 英"}, {ID: "zh-vi", Label: "中 ↔ 越"}, {ID: "vi-en", Label: "越 ↔ 英"}, {ID: "other", Label: "其他"}}},
				{ID: "format", Label: "方式", Type: "SINGLE_SELECT", Required: true, Options: []TemporaryUIFieldOption{{ID: "interpretation", Label: "现场口译"}, {ID: "accompanied", Label: "陪同翻译"}, {ID: "documents", Label: "文件翻译"}, {ID: "online", Label: "线上"}}},
				{ID: "when_where", Label: "时间与地点", Type: "SHORT_TEXT", Required: true, Placeholder: "如：周六 14:00，西湖附近"},
			},
		}
	}
	if isRelationshipIntroductionRequest(text) {
		return &TemporaryUI{
			ID:          "relationship_introduction_brief.v1",
			Kind:        "SHORT_FORM",
			Title:       "交友介绍",
			Description: "仅展示自愿开启介绍、且资料范围由本人选择的成年用户；不涉及交易或临时伴侣。",
			SubmitLabel: "继续",
			Fields: []TemporaryUIField{
				{ID: "intent", Label: "你想认识的方式", Type: "SINGLE_SELECT", Required: true, Options: []TemporaryUIFieldOption{{ID: "social", Label: "认识新朋友"}, {ID: "dating", Label: "认真交往"}, {ID: "activity", Label: "一起参加活动"}}},
				{ID: "area", Label: "所在或希望的区域", Type: "SHORT_TEXT", Required: true, Placeholder: "如：河内 · 还剑湖附近"},
				{ID: "intro", Label: "简单介绍自己", Type: "SHORT_TEXT", Required: false, Placeholder: "兴趣、语言或想一起做的事"},
			},
		}
	}
	return nil
}

func isTranslationRequest(text string) bool {
	for _, token := range []string{"translator", "translation", "翻译", "口译", "笔译"} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func isRelationshipIntroductionRequest(text string) bool {
	for _, token := range []string{"need girlfriend", "find girlfriend", "want a girlfriend", "找女朋友", "交女朋友", "恋爱介绍", "想认识女生"} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}
