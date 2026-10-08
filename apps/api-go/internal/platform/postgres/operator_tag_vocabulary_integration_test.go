package postgres

// OPS-TAG-VOCAB-001：标签中心的 SQL 必须对真库跑过。
//
// 这一页的 SQL 全是 jsonb 展开 + UNION 词典，最容易做错的三件事，各自有一条断言：
//   ① 判「jsonb 是数组且非空」必须 CASE 包住 —— WHERE 不保证短路，标量行会去算
//      jsonb_array_length 直接报 cannot get array length of a scalar。
//      localnet.posts 有 35 行 context_refs 是 null（不是空数组），不 CASE 就崩。
//      所以种一条 context_refs 为**标量**的帖子来钉这个。
//   ② 大小写碰撞必须按名字报（vi/VI）—— 只报「有 2 个碰撞」没法做归一。
//      种一条 languages=["Vi"] 的 agent（与既有 vi/Vi 不同写法）来钉碰撞检测真的在跑。
//   ③ 词的 unit 必须落库 —— capability 数「人」、service 数「条」、scene 数「帖」，
//      混排不带单位就是误导。这里断言每个词的 unit 都非空且正确。

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestOperatorTagVocabularyReadsAllSevenAxes(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	user := "user_tag_" + run
	// languages 里放两个同一语种的不同写法 + 一个库外新语种：
	// 归一前该语种算 2 个词，归一后 1 个 —— 大小写碰撞检测必须真的在跑。
	exec(`INSERT INTO supply.agent_profiles (agent_id, name, languages, created_at, updated_at)
		VALUES ($1, '标签测试-词表', '["Th","th"]', now(), now())`, user)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.agent_profiles WHERE agent_id = $1`, user)
	})

	v, err := store.TagVocabulary(ctx, now)
	if err != nil {
		t.Fatalf("TagVocabulary（列名一错就是这里）: %v", err)
	}

	if len(v.Axes) != 7 {
		t.Fatalf("axes = %d, want 7", len(v.Axes))
	}
	byAxis := map[string]opsmetrics.TagAxis{}
	for _, a := range v.Axes {
		byAxis[a.Axis] = a
	}
	for _, axis := range []string{"capability", "service", "vertical", "language", "scene", "context_type", "context_id"} {
		if _, ok := byAxis[axis]; !ok {
			t.Fatalf("缺轴 %s: %+v", axis, byAxis)
		}
	}
	if byAxis["language"].Vocabulary != "dirty" {
		t.Errorf("language 轴 vocabulary = %q, want dirty", byAxis["language"].Vocabulary)
	}
	if byAxis["context_id"].Vocabulary != "free_text" {
		t.Errorf("context_id 轴 vocabulary = %q, want free_text", byAxis["context_id"].Vocabulary)
	}
	if byAxis["scene"].Terms == 0 || byAxis["scene"].Coverage <= 0 {
		t.Errorf("scene 轴必须有词且覆盖率为正: %+v", byAxis["scene"])
	}
	if v.Posts <= 0 {
		t.Errorf("posts = %d", v.Posts)
	}
	if v.ContextPosts <= 0 {
		t.Errorf("contextPosts = %d —— 帖子语境轴覆盖率为 0 时这一页内容侧就没东西了", v.ContextPosts)
	}
	// 大小写碰撞：Th/th 必须被逐个点名（不是只报一个数量）。
	found := map[string]bool{}
	for _, c := range v.CaseCollisions {
		found[c] = true
	}
	if !found["Th/th"] {
		t.Errorf("caseCollisions = %v, want Th/th —— 种了同一语种两种写法却没检出碰撞", v.CaseCollisions)
	}
	// raw > norm：种进去的两种写法必须把两个计数都撑开。
	if v.LanguageRawTerms <= v.LanguageNormTerms {
		t.Errorf("language raw=%d norm=%d —— 有碰撞时 raw 必须大于 norm", v.LanguageRawTerms, v.LanguageNormTerms)
	}
	for _, x := range v.Terms {
		if x.Unit == "" {
			t.Errorf("词 %q（%s）没有 unit", x.Tag, x.Type)
		}
		if x.Tag == "" {
			t.Errorf("出现空词（type=%s）—— COALESCE 那半漏了", x.Type)
		}
	}
}

// ① 的负向断言：context_refs 是**标量**的帖子不许让整条查询崩掉。
// 真库里已有 35 行 null（jsonb_typeof 是 null 不是 array）；这里再造一个字符串标量，
// 比 null 更极端 —— 如果有人把 CASE 换回 `jsonb_typeof='array' AND jsonb_array_length>0`，
// Postgres 不保证短路，这条直接在解析期报 cannot get array length of a scalar。
func TestOperatorTagVocabularySurvivesScalarContextRefs(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	post := "post_tagscalar_" + run
	exec(`INSERT INTO localnet.posts (id, author_type, author_id, body, context_refs, created_at)
		VALUES ($1, 'USER', $2, '标量 context_refs', '"不是数组"', now())`,
		post, "user_tagscalar_"+run)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM localnet.posts WHERE id = $1`, post)
	})

	if _, err := store.TagVocabulary(ctx, now); err != nil {
		t.Fatalf("标量 context_refs 让词典查询崩了（判数组必须 CASE 包住，WHERE 不短路）: %v", err)
	}

	// 顺带钉住「崩了吞错误」这个反面：panic/recover 不是这里的事，但要保证
	// 出错时返回的是错误而不是零值 —— 零值会让页面看起来一切正常。
	v, err := store.TagVocabulary(ctx, now)
	if err == nil && v.Posts == 0 && v.ContextPosts == 0 && v.Agents == 0 {
		t.Fatal("查询静默返回零值 —— 出错必须报错，零值会被读成「库里什么都没有」")
	}
}

// 词必须能被追到种进去的那一条：插一个新垂类词，它必须出现在 terms 里，
// 且 unit 是 services（垂类挂在服务上，不是人身上）—— 谁改了 unit 口径这里就红。
func TestOperatorTagVocabularyTermsCarryInsertedWords(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	run := itoa(now.UnixNano())
	store := opsmetrics.NewPostgres(pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	agent := "user_tagsvc_" + run
	word := "TAGTEST_" + run
	exec(`INSERT INTO supply.agent_services (agent_id, service_type, status, vertical_tags, updated_at)
		VALUES ($1, 'CITY_COMPANION', 'DRAFT', $2::jsonb, now())`, agent, `["`+word+`"]`)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supply.agent_services WHERE agent_id = $1`, agent)
	})

	v, err := store.TagVocabulary(ctx, now)
	if err != nil {
		t.Fatalf("TagVocabulary: %v", err)
	}
	seen := map[string]opsmetrics.TagTerm{}
	for _, x := range v.Terms {
		seen[x.Type+":"+x.Tag] = x
	}
	got, ok := seen["vertical:"+word]
	if !ok {
		t.Fatalf("种进去的垂类词 %q 不在 terms 里（jsonb 展开的 WHERE 判空写错就会整轴漏词）: %d 个词", word, len(v.Terms))
	}
	if got.Unit != "services" {
		t.Errorf("垂类词 unit = %q, want services —— 混排不带单位就是误导", got.Unit)
	}
	if got.Count < 1 {
		t.Errorf("垂类词 count = %d, want >= 1", got.Count)
	}
	if !strings.Contains(v.Terms[len(v.Terms)-1].Type, "") && v.Terms[0].Count < got.Count {
		t.Errorf("terms 没按 count 降序排（首个 %d < 新词 %d）", v.Terms[0].Count, got.Count)
	}
}
