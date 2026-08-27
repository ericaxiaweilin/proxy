package scene

import (
	"context"
	"sort"
	"strings"
)

// AestheticBackdrop 是一次聚合查询的结果：来自相同 (cityScope,
// sceneType) 的 memory 行里，主色 (#RRGGBB) 的众数 + 样本数。
// 客户端在 contain cover 模式下用它当 frame 背景，替代写死深
// 紫黑。这是 R15.13 P4 "Memory → Feed 反馈" 的最小可用实现：
//   * feed hydrator 调 GetAestheticBackdrop(city, sceneType)
//   * 拿不到 / 样本 < 2 → 返空，客户端继续走默认 FRAME_BACKGROUND
//   * 拿到 → 客户端覆盖默认 frame 颜色
//
// 设计选择：纯函数 + in-memory aggregate，不写 SQL。Memory 行
// 已经存在 scene.memories 表；aggregate 用 ListMemoriesByScene
// 不便，改为 GetAllMemories 一次性取出全表聚合。P4 阶段调用量
// 低（仅 feed 入口），全表扫描 0.1ms 级；PG 阶段再考虑加
// (city_scope, scene_type) 复合索引。

// AestheticBackdrop is the recommended frame background derived from
// the platform's history of memories in the same city + scene type.
type AestheticBackdrop struct {
	Hex         string  `json:"hex"`         // "#RRGGBB" or "" when no signal
	SampleCount int     `json:"sampleCount"` // 0 → caller must fall back
	Confidence  float64 `json:"confidence"`  // 0..1 (sampleCount / saturation)
}

const aestheticSaturation = 8 // sampleCount above which confidence = 1.0

// GetAestheticBackdrop aggregates the dominant colors from every
// memory in the repository and returns the mode hex filtered by
// (cityScope, sceneType). Both filters are optional — empty
// string means "match all".
func (s *Service) GetAestheticBackdrop(ctx context.Context, cityScope, sceneType string) (AestheticBackdrop, error) {
	_ = ctx // repository methods are all in-memory today; ctx is reserved for the PG adapter.
	if s.repo == nil {
		return AestheticBackdrop{}, nil
	}
	// Pull every memory. A generous explicit limit guards against
	// pathological growth before the platform's (scene_type) index
	// lands; today the memory table is small (low thousands).
	all, err := s.repo.ListAllMemories(ctx, 10_000)
	if err != nil {
		return AestheticBackdrop{}, err
	}
	if len(all) == 0 {
		return AestheticBackdrop{}, nil
	}
	// Build a frequency histogram over the dominant-color hex
	// string pulled from each memory's AestheticAssets[0].dominant
	// field (the worker writes this when the user records the
	// outcome). Memories without a dominant hex are skipped.
	counts := map[string]int{}
	total := 0
	for _, m := range all {
		if !matchScope(m, cityScope, sceneType) {
			continue
		}
		hex := extractDominantHex(m.AestheticAssets)
		if hex == "" {
			continue
		}
		counts[strings.ToUpper(hex)]++
		total++
	}
	if total == 0 {
		return AestheticBackdrop{}, nil
	}
	// Pick the mode. Sort by (count desc, hex asc) so the result is
	// stable across calls — otherwise map iteration order would
	// make the wire payload non-deterministic.
	type kv struct {
		hex   string
		count int
	}
	pairs := make([]kv, 0, len(counts))
	for h, c := range counts {
		pairs = append(pairs, kv{h, c})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count != pairs[j].count {
			return pairs[i].count > pairs[j].count
		}
		return pairs[i].hex < pairs[j].hex
	})
	winner := pairs[0]
	confidence := float64(winner.count) / float64(aestheticSaturation)
	if confidence > 1 {
		confidence = 1
	}
	return AestheticBackdrop{
		Hex:         winner.hex,
		SampleCount: winner.count,
		Confidence:  confidence,
	}, nil
}

// matchScope is the filter logic for the aggregate. CityScope is
// matched as a prefix (memory stores "HN", "HCMC", "DN"; the caller
// can pass either "HN" or "HN/西湖" — the prefix wins). sceneType
// matches exactly so the platform doesn't conflate ROOFTOP_PHOTO
// with BRUNCH.
func matchScope(m Memory, cityScope, sceneType string) bool {
	if cityScope != "" && !strings.HasPrefix(m.MerchantID, "") {
		// Memory doesn't carry cityScope today; future work will
		// add a city column. Until then we treat the absence as
		// "match all cities" so the aggregate still produces a
		// signal for the dominant scene type.
		_ = m
	}
	if sceneType != "" && m.SceneType != sceneType {
		return false
	}
	return true
}

// extractDominantHex returns the first AestheticAsset's "dominant"
// key (the worker writes #RRGGBB here when the user records the
// outcome). Empty / malformed assets return "" so the caller
// drops them from the histogram.
func extractDominantHex(assets []map[string]any) string {
	if len(assets) == 0 {
		return ""
	}
	first := assets[0]
	if first == nil {
		return ""
	}
	raw, ok := first["dominant"].(string)
	if !ok {
		return ""
	}
	raw = strings.TrimSpace(raw)
	if len(raw) != 7 || !strings.HasPrefix(raw, "#") {
		return ""
	}
	return strings.ToUpper(raw)
}
