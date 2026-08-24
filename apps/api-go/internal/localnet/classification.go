package localnet

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/modelstack"
)

const postClassificationTaskID = "proxy.localnet.intent_extract"

// classifyPostFallback makes filtering correct immediately. It is deliberately
// conservative: classification never creates a Need, Task, order, or market listing.
func classifyPostFallback(body string) []ContextRef {
	text := strings.ToLower(strings.TrimSpace(body))
	refs := []ContextRef{}
	add := func(kind, label string) {
		refs = append(refs, ContextRef{ContextType: kind, ContextID: label, RelationType: "AUTO_CLASSIFIED"})
	}
	if containsAny(text, "找人", "需要", "招聘", "求", "预算", "报酬", "价格", "looking for", "need ", "hiring", "cần", "tìm người") {
		add("DEMAND", "需求")
	} else if containsAny(text, "可接", "有空", "档期", "接单", "available", "nhận việc", "rảnh") {
		add("AVAILABILITY", "可用时间")
	}
	if containsAny(text, "活动", "聚会", "开业", "派对", "组队", "一起", "event", "party", "meetup", "sự kiện") {
		add("ACTIVITY", "活动")
	}
	if containsAny(text, "朋友", "认识", "交友", "关系", "社交", "friend", "meet people", "bạn bè") {
		add("PEOPLE_RELATIONSHIP", "人 / 关系")
	}
	if containsAny(text, "行业", "趋势", "报告", "市场消息", "开店", "industry", "trend", "market update", "ngành") {
		add("INDUSTRY_INFO", "行业信息")
	}
	if containsAny(text, "咖啡", "餐厅", "酒吧", "spa", "酒店", "场所", "门店", "cafe", "restaurant", "venue") {
		add("VENUE", "场所")
	}
	if len(refs) == 0 {
		add("GENERAL", "日常")
	}
	return refs
}

func containsAny(text string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}

type modelClassification struct {
	ContextRefs []ContextRef `json:"context_refs"`
}

func (s *Service) enrichPostClassification(post Post) {
	if s.modelStack == nil || !s.modelStack.Available() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	system := `Classify one Proxy local-life social post. Return JSON only: {"context_refs":[{"contextType":"...","contextId":"...","relationType":"AUTO_CLASSIFIED"}]}. Allowed contextType: PEOPLE_RELATIONSHIP, DEMAND, AVAILABILITY, OPPORTUNITY, ACTIVITY, INDUSTRY_INFO, VENUE, GENERAL. Use at most 4 concise refs. Classification is metadata only; never create or imply a transaction.`
	completion, err := s.modelStack.Complete(ctx, postClassificationTaskID, []modelstack.ChatMessage{{Role: "system", Content: system}, {Role: "user", Content: post.Body}})
	if err != nil {
		log.Printf("localnet classification unavailable for post %s: %v", post.ID, err)
		return
	}
	var classified modelClassification
	raw := strings.TrimSpace(completion.Content)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &classified) != nil || len(classified.ContextRefs) == 0 {
		return
	}
	current, err := s.repository.GetPost(ctx, post.ID)
	if err != nil {
		return
	}
	current.ContextRefs = mergeClassificationRefs(current.ContextRefs, classified.ContextRefs)
	if err := s.repository.UpdatePost(ctx, current, 1); err != nil {
		log.Printf("localnet classification update failed for post %s: %v", post.ID, err)
	}
}

func mergeClassificationRefs(existing, generated []ContextRef) []ContextRef {
	result := make([]ContextRef, 0, len(existing)+len(generated))
	seen := map[string]bool{}
	for _, ref := range existing {
		if ref.RelationType == "AUTO_CLASSIFIED" {
			continue
		}
		key := ref.ContextType + "\x00" + ref.ContextID
		seen[key] = true
		result = append(result, ref)
	}
	allowed := map[string]bool{"PEOPLE_RELATIONSHIP": true, "DEMAND": true, "AVAILABILITY": true, "OPPORTUNITY": true, "ACTIVITY": true, "INDUSTRY_INFO": true, "VENUE": true, "GENERAL": true}
	generatedCount := 0
	for _, ref := range generated {
		if ref.ContextType == "" || ref.ContextID == "" {
			continue
		}
		if !allowed[ref.ContextType] || generatedCount >= 4 {
			continue
		}
		ref.RelationType = "AUTO_CLASSIFIED"
		key := ref.ContextType + "\x00" + ref.ContextID
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, ref)
		generatedCount++
	}
	return result
}
