package tagging

import (
	"math"
	"sort"
	"strings"
	"time"
)

// 画像 = 标签的结构化汇总 + 一个稀疏向量。标签是事实性的细颗粒，画像才是「建模」：
//   - Profile：按轴分组、每轴取最强的几条，给人看（用户自己看 / 运营看覆盖）；
//   - Vector：稀疏向量（标签 id → 权重），给撮合算相似度。不用稠密 embedding：稀疏向量每一维都能
//     说出是哪个标签，撮合排名的理由可以逐条解释（规格 §3「Tag = 可解释状态」），embedding 做不到。

// Dimension 是画像里一个轴的汇总。
type Dimension struct {
	Axis     string `json:"axis"`
	Label    string `json:"label"`
	Polarity string `json:"polarity"`
	Tags     []Tag  `json:"tags"`
}

// Profile 是一个人的画像。
type Profile struct {
	UserID     string      `json:"userId,omitempty"`
	TagCount   int         `json:"tagCount"`
	AxisCount  int         `json:"axisCount"`
	Dimensions []Dimension `json:"dimensions"`
	// Summary 是一句给人看的话，只拼已有的标签，不加形容词、不下结论。
	Summary string `json:"summary"`
}

// BuildProfile 按词表顺序分轴，每轴最多留 perAxis 条（强度 × 置信度最高的）。没有标签返回空画像。
func BuildProfile(userID string, tags []Tag, perAxis int) Profile {
	if perAxis <= 0 {
		perAxis = 5
	}
	p := Profile{UserID: userID, TagCount: len(tags), Dimensions: []Dimension{}}
	byAxis := map[string][]Tag{}
	for _, t := range tags {
		byAxis[t.Axis] = append(byAxis[t.Axis], t)
	}
	var phrases []string
	for _, axis := range Axes() {
		list := byAxis[axis.Axis]
		if len(list) == 0 {
			continue
		}
		sort.SliceStable(list, func(i, j int) bool {
			si, sj := list[i].Strength*list[i].Confidence, list[j].Strength*list[j].Confidence
			if si != sj {
				return si > sj
			}
			return list[i].Value < list[j].Value
		})
		if len(list) > perAxis {
			list = list[:perAxis]
		}
		p.Dimensions = append(p.Dimensions, Dimension{Axis: axis.Axis, Label: axis.Label, Polarity: axis.Polarity, Tags: list})
		p.AxisCount++
		if axis.Polarity == "POSITIVE" && len(phrases) < 4 {
			vals := make([]string, 0, 2)
			for i := 0; i < len(list) && i < 2; i++ {
				vals = append(vals, strings.ReplaceAll(list[i].Value, "_", " "))
			}
			phrases = append(phrases, axis.Label+"："+strings.Join(vals, "、"))
		}
	}
	p.Summary = strings.Join(phrases, "；")
	return p
}

// Vectorize 把标签变成稀疏向量：标签 id → 权重 = 强度 × 置信度 × 轴的性质系数。
// 正向 1.0；中性（区 / 价位 / 时段…）0.5——它们说「在哪、花多少、什么时候」，相似但不等于志趣相投；
// 回避（负向）取负，并落在对应的正向 id 上（回避「SPA」会抵消对「SPA」的兴趣）。
func Vectorize(tags []Tag, now time.Time) map[string]float64 {
	v := map[string]float64{}
	for _, t := range tags {
		if !t.ExpiresAt.After(now) {
			continue
		}
		axis, ok := LookupAxis(t.Axis)
		if !ok {
			continue
		}
		w := t.Strength * t.Confidence
		switch axis.Polarity {
		case "POSITIVE":
		case "NEUTRAL":
			w *= 0.5
		case "NEGATIVE":
			w = -w
			v[AxisInterestTopic+":"+t.Value] += w
			continue
		}
		v[t.ID()] += w
	}
	return v
}

// Affinity 是两个人标签向量的余弦相似度，夹在 [0,1]：标签越多越细，它越能区分「真合拍」和「只撞了一个大类」。
// 任一方没有标签返回 0——「没数据」不是「不合」，调用方（撮合）把 0 当作不加分。
func Affinity(a, b []Tag, now time.Time) float64 {
	va, vb := Vectorize(a, now), Vectorize(b, now)
	var dot, na, nb float64
	for k, x := range va {
		na += x * x
		dot += x * vb[k]
	}
	for _, y := range vb {
		nb += y * y
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return round3(clamp01(dot / (math.Sqrt(na) * math.Sqrt(nb))))
}

// SharedTag 是两个人都有的一个标签：撮合理由里「你们都……」的那一条。
type SharedTag struct {
	Axis     string  `json:"axis"`
	Label    string  `json:"label"`
	Value    string  `json:"value"`
	Strength float64 `json:"strength"` // 两人强度的较小者：只有两边都强才算强
}

// SharedTags 返回两个人共有的未过期标签，按 (较小强度 × 轴性质系数) 从高到低，最多 limit 条。
// 回避标签不算共有；中性轴（区 / 价位 / 时段）系数 0.5，排在同强度的正向标签之后。
func SharedTags(a, b []Tag, now time.Time, limit int) []SharedTag {
	index := map[string]Tag{}
	for _, t := range b {
		if t.ExpiresAt.After(now) {
			index[t.ID()] = t
		}
	}
	type scored struct {
		s     SharedTag
		score float64
	}
	var list []scored
	for _, ta := range a {
		if !ta.ExpiresAt.After(now) {
			continue
		}
		axis, ok := LookupAxis(ta.Axis)
		if !ok || axis.Polarity == "NEGATIVE" {
			continue
		}
		tb, ok := index[ta.ID()]
		if !ok {
			continue
		}
		strength := math.Min(ta.Strength, tb.Strength)
		weight := 1.0
		if axis.Polarity == "NEUTRAL" {
			weight = 0.5
		}
		list = append(list, scored{SharedTag{Axis: ta.Axis, Label: axis.Label, Value: ta.Value, Strength: strength}, strength * weight})
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		if list[i].s.Axis != list[j].s.Axis {
			return list[i].s.Axis < list[j].s.Axis
		}
		return list[i].s.Value < list[j].s.Value
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	out := make([]SharedTag, 0, len(list))
	for _, l := range list {
		out = append(out, l.s)
	}
	return out
}
