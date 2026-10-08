package opsmetrics

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// OPS-TAG-VOCAB-001（2026-10-07）：标签中心（/v1/operator/tags）。
//
// 这一页原来是 `notConnected("标签体系（tag-service / tag-factory）")`，页面读
// d.kpis / d.top_tags —— 桩不发这两个字段，**一打开就崩**。
//
// 先把「标签体系存不存在」查清楚，再决定给什么：
//
//   - 全库只有 1 个名字带 tag 的列：supply.agent_services.vertical_tags。
//     没有任何 tag / interest / topic / category 表（activity.interests 是**事件表**，
//     记「谁对哪个活动感兴趣」，1 行，不是词典）。
//   - 所以 **tag-service / tag-factory 确实不存在**：没有受控词表、没有别名/合并/废弃
//     治理、没有「一个标签挂在多少东西上」的统一索引。
//
// 但**不是什么都没有**。今天有 7 个地方在当标签用 —— 4 个在供给侧、3 个在内容侧：
//
//	supply.capabilities.capability          能力      ZH / VI / PHOTOGRAPHY
//	supply.agent_services.service_type      服务类型  CITY_COMPANION
//	supply.agent_services.vertical_tags     垂类      RESTAURANT / TOUR
//	supply.agent_profiles.languages         语种      vi / en / zh（大小写没归一）
//	localnet.posts.scene_type               场景      COFFEE / BRUNCH / OUTDOOR …
//	localnet.posts.context_refs[].contextType  语境类型  GENERAL / VENUE / ACTIVITY …
//	localnet.posts.context_refs[].contextId    语境值    自由文本（"日常"、"Minh"、店名带地址）
//
// 所以这一页给的是**已落库的标签词典盘点**：每个轴有多少词、覆盖了多少主体、词表是
// 受控的还是自由文本。这三件事是运营今天真能用的 —— 决定「哪些轴可以先当标签用、
// 哪些得先治理」，也是将来建 tag-service 时要接管的东西。
//
// 结构上**没有**「标签热度排行」「兴趣画像」「标签关系图」：那些需要一个标签体系才有
// 意义，用 scene_type 凑一个热度榜会让人以为有内容标签系统在跑，而事实是没有。
//
// 口径说明：词典是**状态**不是事件，所以这一页全量、不带 30 天窗口。
type TagTerm struct {
	Tag   string `json:"tag"`
	Type  string `json:"type"`
	Count int64  `json:"count"`
	// Unit 说明 count 数的是什么：agents / services / posts / refs。
	// 混在一个榜里必须带单位 —— 不然「COFFEE 581」和「ZH 6」会被当成同一量级的东西比。
	Unit string `json:"unit"`
}

// TagAxis 是一个「标签轴」的盘点结果。
//
// Vocabulary 是这一页最该被看见的字段 —— 它回答「这个轴能不能直接当标签用」：
//
//	controlled  有限枚举，可以直接当词典（capability / service / vertical / scene / context_type）
//	dirty       本该受控但没管住：语种 vi 和 VI 今天算两个词
//	free_text   不是词典，是自由文本：contextId 里既有「日常」也有「岚庭餐厅 @Hanoi Train Street」
type TagAxis struct {
	Axis       string  `json:"axis"`
	Side       string  `json:"side"` // supply | content
	Vocabulary string  `json:"vocabulary"`
	Terms      int64   `json:"terms"`
	Carriers   int64   `json:"carriers"` // 带这个轴标签的主体数（agent 或 post）
	Universe   int64   `json:"universe"` // 主体总数
	Coverage   float64 `json:"coverage"` // carriers / universe，0–1
}

type TagVocabulary struct {
	Agents int64 `json:"agents"`
	Posts  int64 `json:"posts"`

	Axes  []TagAxis `json:"axes"`
	Terms []TagTerm `json:"terms"`

	// 语种轴的大小写问题：raw 是库里实际存在的 token 数，norm 是忽略大小写后的词数。
	// 本机实测 raw=5（vi/en/zh/VI/ZH）norm=3 —— 差的那两个是同一个语种写了两遍。
	LanguageRawTerms  int64    `json:"language_raw_terms"`
	LanguageNormTerms int64    `json:"language_norm_terms"`
	CaseCollisions    []string `json:"case_collisions"` // 形如 "vi/VI"，仅大小写不同的词

	// 内容侧两个脏信号：
	//   SceneUnknown   —— scene_type 被打成 UNKNOWN 的帖子数（分类器没打上）
	//   ContextPosts   —— 至少带 1 条 context_ref 的帖子数（1426 个是数组，绝大多数是空的）
	//   ContextIdTerms —— 不同 contextId 的个数（27）—— 它是自由文本，不是 8 个受控类型
	SceneUnknown   int64 `json:"scene_unknown"`
	ContextPosts   int64 `json:"context_posts"`
	ContextIdTerms int64 `json:"context_id_terms"`

	// InterestRows：activity.interests 的行数。这是**兴趣事件**表（谁对哪个活动感兴趣），
	// 不是兴趣词典。本机 1 行 —— 「需求侧兴趣」今天几乎不存在，别拿它当画像源。
	InterestRows int64 `json:"interest_rows"`
}

// jsonbArrayLen 是判「jsonb 是数组且非空」的唯一安全写法。
//
// ⚠️ 不能写 `jsonb_typeof(x)='array' AND jsonb_array_length(x)>0`：Postgres 的 WHERE
// **不保证短路求值**，标量行也会去算 jsonb_array_length，直接报
// `cannot get array length of a scalar`（本机 localnet.posts 有 35 行 null 的
// context_refs，实测必崩）。必须 CASE 包住。
const jsonbArrayLen = `CASE WHEN jsonb_typeof(%s) = 'array' THEN jsonb_array_length(%s) ELSE 0 END`

// 三条 CASE 条件在包初始化时展开列名（见 TagVocabulary 里的教训：占位符必须 Sprintf，
// 不是查询参数）。
var (
	condLanguages   = fmt.Sprintf(jsonbArrayLen, "s.languages", "s.languages")
	condVertical    = fmt.Sprintf(jsonbArrayLen, "s.vertical_tags", "s.vertical_tags")
	condContextRefs = fmt.Sprintf(jsonbArrayLen, "p.context_refs", "p.context_refs")
)

func (p *Postgres) TagVocabulary(ctx context.Context, _ time.Time) (TagVocabulary, error) {
	var out TagVocabulary

	// jsonbArrayLen 用 fmt.Sprintf 展开列名 —— 不是查询参数。这里曾经把 +jsonbArrayLen+
	// 直接拼进 SQL（里面的 %s 原样留在了语句里），Postgres 报 syntax error at or near "%"；
	// 只有对真库跑集成测试才当场抓到。
	langCond := condLanguages
	ctxCond := condContextRefs

	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM supply.agent_profiles),
			(SELECT COUNT(*) FROM localnet.posts),
			(SELECT COUNT(DISTINCT t.lang) FROM supply.agent_profiles s
			   CROSS JOIN LATERAL jsonb_array_elements_text(s.languages) AS t(lang)
			   WHERE `+langCond+` > 0),
			(SELECT COUNT(DISTINCT upper(t.lang)) FROM supply.agent_profiles s
			   CROSS JOIN LATERAL jsonb_array_elements_text(s.languages) AS t(lang)
			   WHERE `+langCond+` > 0),
			(SELECT COUNT(*) FROM localnet.posts WHERE scene_type = 'UNKNOWN'),
			(SELECT COUNT(*) FROM localnet.posts p WHERE `+ctxCond+` > 0),
			(SELECT COUNT(DISTINCT r->>'contextId') FROM localnet.posts p
			   CROSS JOIN LATERAL jsonb_array_elements(p.context_refs) AS r
			   WHERE `+ctxCond+` > 0 AND COALESCE(r->>'contextId','') <> ''),
			(SELECT COUNT(*) FROM activity.interests)`).
		Scan(&out.Agents, &out.Posts,
			&out.LanguageRawTerms, &out.LanguageNormTerms,
			&out.SceneUnknown, &out.ContextPosts, &out.ContextIdTerms, &out.InterestRows)
	if err != nil {
		return TagVocabulary{}, err
	}

	axes, err := p.tagAxes(ctx)
	if err != nil {
		return TagVocabulary{}, err
	}
	out.Axes = axes

	terms, err := p.tagTerms(ctx)
	if err != nil {
		return TagVocabulary{}, err
	}
	out.Terms = terms
	out.CaseCollisions = caseCollisions(terms)
	return out, nil
}

func (p *Postgres) tagAxes(ctx context.Context) ([]TagAxis, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT 'capability' AS axis, 'supply' AS side, 'controlled' AS vocabulary,
		       COUNT(DISTINCT capability) AS terms, COUNT(DISTINCT agent_id) AS carriers,
		       (SELECT COUNT(*) FROM supply.agent_profiles) AS universe
		FROM supply.capabilities
		UNION ALL
		SELECT 'service', 'supply', 'controlled', COUNT(DISTINCT service_type), COUNT(DISTINCT agent_id),
		       (SELECT COUNT(*) FROM supply.agent_profiles)
		FROM supply.agent_services
		UNION ALL
		SELECT 'vertical', 'supply', 'controlled', COUNT(DISTINCT t.vt), COUNT(DISTINCT s.agent_id),
		       (SELECT COUNT(*) FROM supply.agent_profiles)
		FROM supply.agent_services s
		CROSS JOIN LATERAL jsonb_array_elements_text(s.vertical_tags) AS t(vt)
		WHERE `+condVertical+` > 0
		UNION ALL
		SELECT 'language', 'supply', 'dirty', COUNT(DISTINCT t.lang), COUNT(DISTINCT s.agent_id),
		       (SELECT COUNT(*) FROM supply.agent_profiles)
		FROM supply.agent_profiles s
		CROSS JOIN LATERAL jsonb_array_elements_text(s.languages) AS t(lang)
		WHERE `+condLanguages+` > 0
		UNION ALL
		SELECT 'scene', 'content', 'controlled', COUNT(DISTINCT scene_type), COUNT(*),
		       (SELECT COUNT(*) FROM localnet.posts)
		FROM localnet.posts WHERE COALESCE(scene_type, '') <> ''
		UNION ALL
		SELECT 'context_type', 'content', 'controlled', COUNT(DISTINCT r->>'contextType'), COUNT(DISTINCT p.id),
		       (SELECT COUNT(*) FROM localnet.posts)
		FROM localnet.posts p
		CROSS JOIN LATERAL jsonb_array_elements(p.context_refs) AS r
		WHERE `+condContextRefs+` > 0 AND COALESCE(r->>'contextType', '') <> ''
		UNION ALL
		SELECT 'context_id', 'content', 'free_text', COUNT(DISTINCT r->>'contextId'), COUNT(DISTINCT p.id),
		       (SELECT COUNT(*) FROM localnet.posts)
		FROM localnet.posts p
		CROSS JOIN LATERAL jsonb_array_elements(p.context_refs) AS r
		WHERE `+condContextRefs+` > 0 AND COALESCE(r->>'contextId', '') <> ''
		ORDER BY 5 DESC, 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TagAxis
	for rows.Next() {
		var a TagAxis
		if err := rows.Scan(&a.Axis, &a.Side, &a.Vocabulary, &a.Terms, &a.Carriers, &a.Universe); err != nil {
			return nil, err
		}
		if a.Universe > 0 {
			a.Coverage = float64(a.Carriers) / float64(a.Universe)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (p *Postgres) tagTerms(ctx context.Context) ([]TagTerm, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT 'capability' AS type, capability AS tag, COUNT(DISTINCT agent_id) AS n, 'agents' AS unit
		FROM supply.capabilities GROUP BY 2
		UNION ALL
		SELECT 'service', service_type, COUNT(*), 'services'
		FROM supply.agent_services GROUP BY 2
		UNION ALL
		SELECT 'vertical', t.vt, COUNT(*), 'services'
		FROM supply.agent_services s
		CROSS JOIN LATERAL jsonb_array_elements_text(s.vertical_tags) AS t(vt)
		WHERE `+condVertical+` > 0 GROUP BY 2
		UNION ALL
		SELECT 'language', t.lang, COUNT(DISTINCT s.agent_id), 'agents'
		FROM supply.agent_profiles s
		CROSS JOIN LATERAL jsonb_array_elements_text(s.languages) AS t(lang)
		WHERE `+condLanguages+` > 0 GROUP BY 2
		UNION ALL
		SELECT 'scene', scene_type, COUNT(*), 'posts'
		FROM localnet.posts WHERE COALESCE(scene_type, '') <> '' GROUP BY 2
		UNION ALL
		SELECT 'context_type', r->>'contextType', COUNT(*), 'refs'
		FROM localnet.posts p
		CROSS JOIN LATERAL jsonb_array_elements(p.context_refs) AS r
		WHERE `+condContextRefs+` > 0 AND COALESCE(r->>'contextType', '') <> '' GROUP BY 2
		UNION ALL
		SELECT 'context_id', r->>'contextId', COUNT(*), 'refs'
		FROM localnet.posts p
		CROSS JOIN LATERAL jsonb_array_elements(p.context_refs) AS r
		WHERE `+condContextRefs+` > 0 AND COALESCE(r->>'contextId', '') <> '' GROUP BY 2
		ORDER BY 3 DESC, 1, 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TagTerm
	for rows.Next() {
		var t TagTerm
		if err := rows.Scan(&t.Type, &t.Tag, &t.Count, &t.Unit); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// caseCollisions 找出「只差大小写」的词（语种轴今天踩的这个）。
//
// 返回的是词本身（"vi/VI"），不是数量 —— 运营要做的是去库里把这些行归一，
// 给他一个可点名的清单比给一个数字有用。
func caseCollisions(terms []TagTerm) []string {
	byUpper := map[string][]string{}
	for _, t := range terms {
		if t.Type != "language" {
			continue
		}
		k := strings.ToUpper(strings.TrimSpace(t.Tag))
		if k == "" {
			continue
		}
		byUpper[k] = append(byUpper[k], t.Tag)
	}
	var out []string
	for _, variants := range byUpper {
		distinct := map[string]bool{}
		for _, v := range variants {
			distinct[v] = true
		}
		if len(distinct) > 1 {
			vs := make([]string, 0, len(distinct))
			for v := range distinct {
				vs = append(vs, v)
			}
			sort.Strings(vs)
			out = append(out, strings.Join(vs, "/"))
		}
	}
	sort.Strings(out)
	return out
}
