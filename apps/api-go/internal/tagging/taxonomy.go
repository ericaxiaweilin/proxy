package tagging

import (
	"embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// 词典（Taxonomy）——标签的唯一来源（docs/spec/personalization/Proxy_Tag_Engineering_Architecture_v1.md §2）。
//
// 文件：taxonomy/*.json，每个文件是一个域下的一批节点。加载时全量校验，任何一条不合格整本词典拒绝加载
// （测试会红），不会带着脏节点上线：
//   · id 唯一、是 `a/b/c` 路径、父节点存在、深度 ≤ 4；
//   · 三语名称齐全（zh / vi / en）；至少 2 个关键词；关键词不空、不过长；
//   · 红线：夜生活 / 按摩 / KTV / 陪酒 / 性相关 / 赌博 / 毒品……任何节点 id、名称、关键词命中都拒绝；
//   · 关键词冲突（同一个词指向两个不相关的节点）允许，但记在 Conflicts 里，测试限制占比，避免词典越长越乱。
//
// 命中规则：非 ASCII 关键词按子串；ASCII 单词按整词；ASCII 短语按带边界的子串。
// 一次命中同时给祖先记分（叶 1.0、父 0.5、祖父 0.25…），所以一个人既有细标签也有粗标签。

//go:embed taxonomy/*.json
var taxonomyFS embed.FS

// TaxonomyVersion 随词典内容变化；写进标签的 rule_version 前缀，方便回放。
const TaxonomyVersion = "2026-10-08"

type Names struct {
	ZH string `json:"zh"`
	VI string `json:"vi"`
	EN string `json:"en"`
}

type Node struct {
	ID       string   `json:"id"`
	Parent   string   `json:"parent,omitempty"`
	Name     Names    `json:"name"`
	Keywords []string `json:"keywords,omitempty"`
	// Status: ACTIVE（默认）| DEPRECATED（不再命中、旧标签自然过期）。
	Status string `json:"status,omitempty"`
}

type taxonomyFile struct {
	Domain string `json:"domain"`
	Nodes  []Node `json:"nodes"`
}

// 红线：这些词只要出现在节点 id / 名称 / 关键词里就拒绝（陪同业务的法律边界，见律师清单第 7 条）。
var redLine = []string{
	"夜生活", "按摩", "桑拿", "陪酒", "陪睡", "包夜", "约炮", "色情", "成人", "招嫖", "卖淫", "ktv", "夜店", "酒吧陪", "赌博", "博彩", "毒品",
	"nightlife", "massage", "sauna", "escort", "prostitut", "brothel", "erotic", "adult", "porn", "gambl", "casino", "betting", "drug",
	"mát xa", "massage", "gái gọi", "mại dâm", "cờ bạc", "ma túy", "sex",
}

// Taxonomy 是加载好的词典。
type Taxonomy struct {
	nodes    map[string]*Node
	order    []string
	children map[string][]string
	subs     []subMatcher        // 非 ASCII 子串关键词
	words    map[string][]string // ASCII 单词 → 节点 id
	phrases  []subMatcher        // ASCII 短语
	// Conflicts：同一个关键词指向互不相关的节点（命中时两个都记）。允许，但数量要受测试约束。
	Conflicts []string
}

type subMatcher struct {
	kw  string
	ids []string
}

// LoadTaxonomy 从内嵌文件加载并校验。
func LoadTaxonomy() (*Taxonomy, error) {
	entries, err := taxonomyFS.ReadDir("taxonomy")
	if err != nil {
		return nil, err
	}
	var all []Node
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := taxonomyFS.ReadFile("taxonomy/" + e.Name())
		if err != nil {
			return nil, err
		}
		var f taxonomyFile
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, fmt.Errorf("taxonomy/%s: %w", e.Name(), err)
		}
		all = append(all, f.Nodes...)
	}
	return BuildTaxonomy(all)
}

// BuildTaxonomy 校验并构建（测试直接用它造小词典）。
func BuildTaxonomy(all []Node) (*Taxonomy, error) {
	t := &Taxonomy{nodes: map[string]*Node{}, children: map[string][]string{}, words: map[string][]string{}}
	for i := range all {
		n := all[i]
		if err := validateNode(n); err != nil {
			return nil, err
		}
		if _, dup := t.nodes[n.ID]; dup {
			return nil, fmt.Errorf("taxonomy: duplicate id %q", n.ID)
		}
		if n.Status == "" {
			n.Status = "ACTIVE"
		}
		t.nodes[n.ID] = &n
		t.order = append(t.order, n.ID)
	}
	for _, id := range t.order {
		n := t.nodes[id]
		if n.Parent != "" {
			if _, ok := t.nodes[n.Parent]; !ok {
				return nil, fmt.Errorf("taxonomy: %q has unknown parent %q", id, n.Parent)
			}
			if !strings.HasPrefix(id, n.Parent+"/") {
				return nil, fmt.Errorf("taxonomy: %q must be a child path of its parent %q", id, n.Parent)
			}
			t.children[n.Parent] = append(t.children[n.Parent], id)
		} else if strings.Contains(id, "/") {
			return nil, fmt.Errorf("taxonomy: root node %q must not contain '/'", id)
		}
	}
	// 关键词索引 + 冲突检查：同一个关键词指向两个**互不为祖先**的节点 = 冲突。
	owners := map[string][]string{}
	for _, id := range t.order {
		n := t.nodes[id]
		if n.Status != "ACTIVE" {
			continue
		}
		for _, kw := range n.Keywords {
			k := strings.ToLower(strings.TrimSpace(kw))
			owners[k] = append(owners[k], id)
		}
	}
	for kw, ids := range owners {
		for i := 0; i < len(ids); i++ {
			for j := i + 1; j < len(ids); j++ {
				if !t.related(ids[i], ids[j]) {
					t.Conflicts = append(t.Conflicts, kw)
				}
			}
		}
		switch {
		case !isASCII(kw):
			t.subs = append(t.subs, subMatcher{kw, ids})
		case strings.ContainsAny(kw, " -'"):
			t.phrases = append(t.phrases, subMatcher{kw, ids})
		default:
			t.words[kw] = ids
		}
	}
	sort.Strings(t.Conflicts)
	sort.Slice(t.subs, func(i, j int) bool { return t.subs[i].kw < t.subs[j].kw })
	sort.Slice(t.phrases, func(i, j int) bool { return t.phrases[i].kw < t.phrases[j].kw })
	return t, nil
}

func (t *Taxonomy) related(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

func validateNode(n Node) error {
	if !validNodeID(n.ID) {
		return fmt.Errorf("taxonomy: bad id %q", n.ID)
	}
	if strings.Count(n.ID, "/") > 3 {
		return fmt.Errorf("taxonomy: %q is deeper than 4 levels", n.ID)
	}
	for lang, name := range map[string]string{"zh": n.Name.ZH, "vi": n.Name.VI, "en": n.Name.EN} {
		if strings.TrimSpace(name) == "" || len([]rune(name)) > 40 {
			return fmt.Errorf("taxonomy: %q has no usable %s name", n.ID, lang)
		}
	}
	if n.Status != "" && n.Status != "ACTIVE" && n.Status != "DEPRECATED" {
		return fmt.Errorf("taxonomy: %q has unknown status %q", n.ID, n.Status)
	}
	if n.Status != "DEPRECATED" && len(n.Keywords) < 2 && n.Parent != "" {
		return fmt.Errorf("taxonomy: leaf/branch %q needs at least 2 keywords", n.ID)
	}
	seen := map[string]bool{}
	for _, kw := range n.Keywords {
		k := strings.ToLower(strings.TrimSpace(kw))
		if k == "" || len([]rune(k)) > 40 || len([]rune(k)) < 2 {
			return fmt.Errorf("taxonomy: %q has an unusable keyword %q", n.ID, kw)
		}
		if seen[k] {
			return fmt.Errorf("taxonomy: %q repeats keyword %q", n.ID, kw)
		}
		seen[k] = true
	}
	haystack := strings.ToLower(n.ID + " " + n.Name.ZH + " " + n.Name.VI + " " + n.Name.EN + " " + strings.Join(n.Keywords, " "))
	for _, bad := range redLine {
		if strings.Contains(haystack, bad) {
			return fmt.Errorf("taxonomy: %q touches the red line (%q) — sensitive service categories never enter the profile", n.ID, bad)
		}
	}
	return nil
}

func validNodeID(id string) bool {
	if id == "" || len(id) > 48 {
		return false
	}
	for _, seg := range strings.Split(id, "/") {
		if seg == "" {
			return false
		}
		for _, r := range seg {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
				return false
			}
		}
	}
	return true
}

// Size 是 ACTIVE 节点数。
func (t *Taxonomy) Size() int {
	n := 0
	for _, node := range t.nodes {
		if node.Status == "ACTIVE" {
			n++
		}
	}
	return n
}

// Node 取一个节点；Label 取中文名（没有就回 id）。
func (t *Taxonomy) Node(id string) (Node, bool) {
	n, ok := t.nodes[id]
	if !ok {
		return Node{}, false
	}
	return *n, true
}

func (t *Taxonomy) Label(id string) string {
	if n, ok := t.nodes[id]; ok {
		return n.Name.ZH
	}
	return id
}

// Match 返回正文命中的节点 id（去重、稳定顺序）。不含祖先；要祖先用 Expand。
func (t *Taxonomy) Match(text string) []string {
	low := strings.ToLower(strings.TrimSpace(text))
	if low == "" {
		return nil
	}
	hit := map[string]bool{}
	for _, m := range t.subs {
		if strings.Contains(low, m.kw) {
			for _, id := range m.ids {
				hit[id] = true
			}
		}
	}
	for _, tok := range tokenizeASCII(low) {
		for _, id := range t.words[tok] {
			hit[id] = true
		}
	}
	for _, m := range t.phrases {
		if containsPhrase(low, m.kw) {
			for _, id := range m.ids {
				hit[id] = true
			}
		}
	}
	out := make([]string, 0, len(hit))
	for id := range hit {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// Expand 把命中的叶子展开成 {节点: 权重系数}：自己 1，父 0.5，祖父 0.25……同一节点取最大系数。
func (t *Taxonomy) Expand(ids []string) map[string]float64 {
	out := map[string]float64{}
	for _, id := range ids {
		factor := 1.0
		for cur := id; cur != ""; {
			if factor > out[cur] {
				out[cur] = factor
			}
			factor /= 2
			n, ok := t.nodes[cur]
			if !ok {
				break
			}
			cur = n.Parent
		}
	}
	return out
}

func tokenizeASCII(s string) []string {
	var out []string
	start := -1
	for i, r := range s {
		isWord := r < 0x80 && (r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
		if isWord && start < 0 {
			start = i
		} else if !isWord && start >= 0 {
			out = append(out, s[start:i])
			start = -1
		}
	}
	if start >= 0 {
		out = append(out, s[start:])
	}
	return out
}

func containsPhrase(text, phrase string) bool {
	for from := 0; ; {
		i := strings.Index(text[from:], phrase)
		if i < 0 {
			return false
		}
		i += from
		end := i + len(phrase)
		before := i == 0 || !asciiWordByte(text[i-1])
		after := end >= len(text) || !asciiWordByte(text[end])
		if before && after {
			return true
		}
		from = i + 1
	}
}

func asciiWordByte(b byte) bool { return b >= 'a' && b <= 'z' || b >= '0' && b <= '9' }

var (
	defaultTaxonomy     *Taxonomy
	defaultTaxonomyErr  error
	defaultTaxonomyOnce sync.Once
)

// DefaultTaxonomy 是进程内共享的词典；加载失败（脏节点）返回 error，由测试和启动自检抓住。
func DefaultTaxonomy() (*Taxonomy, error) {
	defaultTaxonomyOnce.Do(func() { defaultTaxonomy, defaultTaxonomyErr = LoadTaxonomy() })
	return defaultTaxonomy, defaultTaxonomyErr
}
