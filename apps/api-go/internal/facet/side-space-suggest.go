package facet

import (
	"sort"
)

// R15.52 — SideSpaceSuggestion: server 主动给"未满足"对象推 post.
//
// 设计动机: R15.43 副空间是"用户手动添加" — Phase 1.5 运营要逐个对象去挑 post
// 加进副空间, 量大了费时. R15.52 让 server 在 ListFacetObjects / List
// 返回时, 顺便对每个 sideSpaceFulfilled=false 的对象, 从 catalog 挑
// 1-3 个匹配 SideSpaceKind 的 post 推过去 (排除已加的).
//
// TikTok FYP 风: 不是 push notification, 是 UI 上"推荐添加"banner —
// 点 1 下 add, 不点 24h 后换一批.
//
// Phase 1: 启发式 (同 kind + 不同 id + 排除已加). Phase 2 接
// content-recommender service (e.g. vector similarity).

// SuggestedSideSpacePost: 单条推荐.
type SuggestedSideSpacePost struct {
	Post    SideSpaceCatalogPost `json:"post"`
	Reason  string               `json:"reason"`  // "匹配 portfolio/capability 缺口"
	Rank    int                  `json:"rank"`    // 1 = 最匹配
}

// SideSpaceSuggestions: 某对象的一组推荐.
type SideSpaceSuggestions struct {
	ObjectID    string                   `json:"objectId"`
	SideSpaceKind string                 `json:"sideSpaceKind"` // 目标 kind
	Posts       []SuggestedSideSpacePost `json:"posts"`
}

// SuggestSideSpacePosts 给一个对象, 返 top-N (按 kind 匹配) 推荐.
//
// 规则:
//   - 目标 kind = obj.SideSpaceKind (来自 reasoner)
//   - 从 catalog 挑: 1) kind 匹配 2) id 不在 sideSpacePosts (没加过)
//   - 排序: title 短 → 长 (Phase 1 简单启发式)
//   - 限制: N (默认 3)
//
// 边界:
//   - obj.SideSpaceFulfilled=true → 返空 ([]), 不推荐
//   - obj.Relation != "CREATOR_COLLAB" → 返空
//   - obj.SideSpaceKind == "" → 返空
//   - catalog 全已加 → 返空
func SuggestSideSpacePosts(obj Object, sideSpace []SideSpacePost, catalog []SideSpaceCatalogPost, limit int) SideSpaceSuggestions {
	suggestions := SideSpaceSuggestions{
		ObjectID:      obj.ID,
		SideSpaceKind: obj.SideSpaceKind,
		Posts:         []SuggestedSideSpacePost{},
	}
	// 边界
	if obj.Relation != "CREATOR_COLLAB" {
		return suggestions
	}
	if obj.SideSpaceFulfilled {
		return suggestions
	}
	if obj.SideSpaceKind == "" {
		return suggestions
	}
	if limit <= 0 {
		limit = 3
	}
	// 已有 id 集合 (去重用)
	addedIDs := make(map[string]bool, len(sideSpace))
	for _, sp := range sideSpace {
		addedIDs[sp.ID] = true
	}
	// 候选 (kind 匹配 + 未加)
	candidates := []SideSpaceCatalogPost{}
	for _, c := range catalog {
		if c.Kind != obj.SideSpaceKind {
			continue
		}
		if addedIDs[c.ID] {
			continue
		}
		candidates = append(candidates, c)
	}
	// 排序: title 短 → 长 (启发式: 短标题更像 icon / 摘要)
	sort.Slice(candidates, func(i, j int) bool {
		return len(candidates[i].Title) < len(candidates[j].Title)
	})
	// 取 top N
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	for i, c := range candidates {
		reason := "匹配 " + obj.SideSpaceKind + " 缺口"
		if obj.SideSpaceGap != "" {
			// 摘首句作 reason (e.g. "副空间还没有, 加第一个 portfolio/capability" → 简化为 "匹配 portfolio/capability 缺口")
			reason = reason + " · " + truncateForReason(obj.SideSpaceGap, 30)
		}
		suggestions.Posts = append(suggestions.Posts, SuggestedSideSpacePost{
			Post:   c,
			Reason: reason,
			Rank:   i + 1,
		})
	}
	return suggestions
}

// SuggestForAllObjects 遍历 objects, 返每对象的推荐 (空切片表示不推).
// 跟 ListFacetObjects payload 一起发给 client, 避免 N+1 请求.
func SuggestForAllObjects(objects []Object, sideSpacesByObject map[string][]SideSpacePost, catalog []SideSpaceCatalogPost, limit int) map[string]SideSpaceSuggestions {
	out := make(map[string]SideSpaceSuggestions, len(objects))
	for _, obj := range objects {
		ss := sideSpacesByObject[obj.ID]
		out[obj.ID] = SuggestSideSpacePosts(obj, ss, catalog, limit)
	}
	return out
}

// truncateForReason 截断字符串到 N rune (中文按 1 char 算, 不按 byte).
func truncateForReason(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
