package tagging

import (
	"sort"
	"strings"
)

// 话题来自分类库（taxonomy/*.json）：受控词表 + 关键词，值是分类节点 id 去掉 "interest/" 前缀（如 outdoor/mountain）。
// 旧的小词表已经删除（分类库合入后不再需要），库里还留着的旧中文词标签会按各自的 TTL 自然过期。
//
// 刻意**没有**的话题：夜生活、按摩、KTV、陪酒这一类——陪同业务在越南有被认定为色情中介的法律风险
// （见 docs/legal 的律师清单第 7 条），平台不该给用户贴这类标签。分类库加载时由红线校验拒绝。

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}

// TopicHit 是正文命中的一个主题标签取值及其权重系数（叶 1、父 0.5、祖父 0.25…）。
type TopicHit struct {
	Value  string // 如 "outdoor/mountain"（词典节点 id 去掉 "interest/" 前缀）
	Factor float64
}

// TopicHits：正文 → 主题命中（带祖先汇总）。
func TopicHits(body string) []TopicHit {
	tx, err := DefaultTaxonomy()
	if err != nil {
		return nil // 词典加载失败 = 没有话题；不编
	}
	exp := tx.Expand(tx.Match(body))
	out := make([]TopicHit, 0, len(exp))
	for id, f := range exp {
		if id == "interest" {
			continue // 根节点太泛，不计
		}
		out = append(out, TopicHit{Value: strings.TrimPrefix(id, "interest/"), Factor: f})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Value < out[j].Value })
	return out
}

// TopicLabel：主题取值的人话名字（词典里的中文名）。
func TopicLabel(value string) string {
	if tx, err := DefaultTaxonomy(); err == nil {
		if _, ok := tx.Node("interest/" + value); ok {
			return tx.Label("interest/" + value)
		}
	}
	return value
}
