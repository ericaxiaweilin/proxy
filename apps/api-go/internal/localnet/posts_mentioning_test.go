package localnet

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// MENTION-001 — 个人主页 TAGGED tab：「提到我的帖子」必须完整、口径正确。
//
// 之前 TAGGED 是客户端拿**一页**动态（默认 25 条）做 strings.Contains 筛的：
//   1. 比你这一页更早的提及直接消失 —— 用户被提到 50 次也只看到 2 次；
//   2. 子串匹配 —— "@thanh2" 会被算成提到了 "@thanh"，看到与自己无关的帖子；
//   3. `contextType === "MENTION"` 那一支是死代码：服务端从来没有任何地方
//      写过 MENTION 这种 contextRef（分类器只会产出 DEMAND / VENUE / ...），
//      所以那个条件永远为假。
// 这组测试钉住服务端的完整扫读与 fail-closed 可见性。

func listPostsMentioning(t *testing.T, s *Service, actorID, handle string, limit int) ([]Post, bool) {
	t.Helper()
	payload := map[string]any{"handle": handle}
	if limit > 0 {
		payload["limit"] = limit
	}
	result := s.Handle(actorEnvelope(actorID, "ListPostsMentioning", payload))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ListPostsMentioning: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	var decoded struct {
		Posts   []Post `json:"posts"`
		HasMore bool   `json:"hasMore"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &decoded); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	return decoded.Posts, decoded.HasMore
}

func TestContainsMentionHandleRequiresAWholeHandle(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		handle string
		want   bool
	}{
		{"exact token", "谢谢 @thanh 帮我", "thanh", true},
		{"at start of body", "@thanh 你好", "thanh", true},
		{"at end of body", "thanks @thanh", "thanh", true},
		{"before punctuation", "cc @thanh, 一起", "thanh", true},
		{"before newline", "cc @thanh\n再来", "thanh", true},
		{"longer handle must not match", "@thanh2 你好", "thanh", false},
		{"suffix letters must not match", "@thanhnguyen 你好", "thanh", false},
		{"prefix letters must not match", "@thanh 前面的 xthanh@thanh", "thanh", true},
		{"no at sign", "thanh 你好", "thanh", false},
		{"handle with dot inside a longer token", "看 @a.b.c 吧", "a.b", false},
		{"handle with dot as its own token", "看 @a.b 吧", "a.b", true},
		{"empty handle never matches", "随便什么 @", "", false},
	}
	for _, tc := range cases {
		if got := containsMentionHandle(tc.body, tc.handle); got != tc.want {
			t.Errorf("%s: containsMentionHandle(%q, %q) = %v, want %v",
				tc.name, tc.body, tc.handle, got, tc.want)
		}
	}
}

func TestContainsMentionHandleIsCaseInsensitive(t *testing.T) {
	// handle 在库里是小写，但用户打字不会那么讲究。
	if !containsMentionHandle("谢谢 @Thanh", "thanh") {
		t.Fatal("@Thanh 应该算作提到了 @thanh")
	}
	if !containsMentionHandle("谢谢 @THANH", "thanh") {
		t.Fatal("@THANH 应该算作提到了 @thanh")
	}
}

func TestNormalizeMentionHandleStripsAtAndRejectsEmpty(t *testing.T) {
	cases := []struct {
		raw    string
		want   string
		wantOK bool
	}{
		{"@thanh", "thanh", true},
		{"thanh", "thanh", true},
		{"  @Thanh  ", "thanh", true},
		{"@@thanh", "thanh", true},
		{"", "", false},
		{"   ", "", false},
		{"@", "", false},
		{strings.Repeat("a", 61), "", false},
	}
	for _, tc := range cases {
		got, ok := normalizeMentionHandle(tc.raw)
		if got != tc.want || ok != tc.wantOK {
			t.Errorf("normalizeMentionHandle(%q) = (%q, %v), want (%q, %v)",
				tc.raw, got, ok, tc.want, tc.wantOK)
		}
	}
}

func TestMentionRegexEscapesRegexMetacharacters(t *testing.T) {
	// handle 里合法的 "." 必须变成字面量点，否则 "@a.b" 会匹配 "@axb"。
	pattern := MentionRegex("a.b")
	if !strings.Contains(pattern, `a\.b`) {
		t.Fatalf("dot must be escaped in %q", pattern)
	}
	// 普通字母不能被加反斜杠 —— \A / \b 在 POSIX ERE 里是锚点，会把语义改掉。
	if strings.Contains(pattern, `\t`) || strings.Contains(pattern, `\a`) {
		t.Fatalf("letters must not be escaped in %q", pattern)
	}
	if !strings.HasPrefix(pattern, "(^|[^") {
		t.Fatalf("pattern must anchor the left boundary, got %q", pattern)
	}
}

// TestListPostsMentioningFindsMentionsBeyondTheFirstFeedPage 是本条的核心回归：
// 提及发生在**比第一页动态更早**的时候，TAGGED 仍然必须找得到。
func TestListPostsMentioningFindsMentionsBeyondTheFirstFeedPage(t *testing.T) {
	s := New()
	// 先发的帖子 = 最旧 = 一定落在第一页之外。
	oldest := createPostAs(t, s, "user_002", "好久不见 @thanh 最近怎么样", "PUBLIC")
	for i := 0; i < 40; i++ {
		createPostAs(t, s, "user_003", "无关的日常更新", "PUBLIC")
	}

	// 先证明这个提及确实在第一页之外 —— 否则这条测试就是空转。
	page := s.Handle(actorEnvelope("user_001", "ListFeedPosts", map[string]any{"limit": 25}))
	if page.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts: outcome=%s", page.Outcome)
	}
	var feed struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(page.OperationRef), &feed); err != nil {
		t.Fatalf("decode feed: %v", err)
	}
	for _, p := range feed.Posts {
		if p.ID == oldest {
			t.Fatal("前提不成立：被提及的帖子落在第一页里，这条回归就测不到东西了")
		}
	}

	posts, _ := listPostsMentioning(t, s, "user_001", "@thanh", 30)
	if len(posts) != 1 || posts[0].ID != oldest {
		t.Fatalf("TAGGED 必须能拿到第一页之外的提及，got %d posts (%v)", len(posts), postIDs(posts))
	}
}

func TestListPostsMentioningExcludesMyOwnPosts(t *testing.T) {
	s := New()
	createPostAs(t, s, "user_001", "我自己 @thanh 出个镜", "PUBLIC")
	other := createPostAs(t, s, "user_002", "别人提到 @thanh", "PUBLIC")

	posts, _ := listPostsMentioning(t, s, "user_001", "@thanh", 30)
	if len(posts) != 1 || posts[0].ID != other {
		t.Fatalf("自己的帖子不该出现在 TAGGED，got %v", postIDs(posts))
	}
}

func TestListPostsMentioningKeepsVisibilityFailClosed(t *testing.T) {
	s := New()
	public := createPostAs(t, s, "user_002", "公开提到 @thanh", "PUBLIC")
	followers := createPostAs(t, s, "user_002", "followers-only 提到 @thanh", "FOLLOWERS")

	// 关注图谱授权还没做 —— FOLLOWERS 只有作者本人可见，不能因为「提到了我」
	// 就把别人的 followers-only 帖子漏出来。
	posts, _ := listPostsMentioning(t, s, "user_001", "@thanh", 30)
	for _, p := range posts {
		if p.ID == followers {
			t.Fatal("followers-only 的帖子不能通过 TAGGED 泄漏")
		}
	}
	if len(posts) != 1 || posts[0].ID != public {
		t.Fatalf("expected only the public post, got %v", postIDs(posts))
	}

	// 作者本人应该能通过自己的 TAGGED 看到（自帖被排除，所以这里是空的）。
	authorView, _ := listPostsMentioning(t, s, "user_002", "@thanh", 30)
	if len(authorView) != 0 {
		t.Fatalf("作者自己的帖子不该出现在自己的 TAGGED，got %v", postIDs(authorView))
	}
}

func TestListPostsMentioningSkipsUnpublishedPosts(t *testing.T) {
	s := New()
	if err := s.repository.UpsertPost(context.Background(), Post{
		ID: "post_draft_mention", AuthorType: "USER", AuthorID: "user_002",
		Body: "草稿里提到 @thanh", Visibility: "PUBLIC", Status: "DRAFT",
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	posts, _ := listPostsMentioning(t, s, "user_001", "@thanh", 30)
	if len(posts) != 0 {
		t.Fatalf("未发布的帖子不能出现在 TAGGED，got %v", postIDs(posts))
	}
}

func TestListPostsMentioningWithoutAHandleReturnsEmptyNotNull(t *testing.T) {
	s := New()
	createPostAs(t, s, "user_002", "随便一条 @thanh", "PUBLIC")

	// fail-closed：handle 缺失/为空时必须返回空，绝不能退化成「返回全部帖子」。
	// 否则任何一个客户端都能把 TAGGED 当成整个动态流的旁路。
	result := s.Handle(actorEnvelope("user_001", "ListPostsMentioning", map[string]any{}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("outcome=%s", result.Outcome)
	}
	if !strings.Contains(result.OperationRef, `"posts":[]`) {
		t.Fatalf("空 handle 必须返回空数组而不是 null 或全量，got %s", result.OperationRef)
	}

	blank := s.Handle(actorEnvelope("user_001", "ListPostsMentioning", map[string]any{"handle": "  @"}))
	if blank.Outcome != "ACCEPTED" || !strings.Contains(blank.OperationRef, `"posts":[]`) {
		t.Fatalf("空白 handle 必须返回空数组，got outcome=%s ref=%s", blank.Outcome, blank.OperationRef)
	}
}

func TestListPostsMentioningCapsTheBatch(t *testing.T) {
	s := New()
	for i := 0; i < 60; i++ {
		createPostAs(t, s, "user_002", "第 i 条提到 @thanh", "PUBLIC")
	}
	posts, hasMore := listPostsMentioning(t, s, "user_001", "@thanh", 10)
	if len(posts) != 10 {
		t.Fatalf("limit=10 必须只回 10 条，got %d", len(posts))
	}
	if !hasMore {
		t.Fatal("还有更多时必须如实报告 hasMore，而不是假装这就是全部")
	}
	// 上限 50：客户端要 500 也只能拿 50。
	posts, _ = listPostsMentioning(t, s, "user_001", "@thanh", 500)
	if len(posts) != 50 {
		t.Fatalf("上限应为 50，got %d", len(posts))
	}
}

func TestListPostsMentioningDoesNotMatchALongerHandle(t *testing.T) {
	s := New()
	createPostAs(t, s, "user_002", "这是 @thanh2 的帖子", "PUBLIC")
	createPostAs(t, s, "user_002", "这是 @thanhnguyen 的帖子", "PUBLIC")
	real := createPostAs(t, s, "user_002", "这才是 @thanh 本人", "PUBLIC")

	posts, _ := listPostsMentioning(t, s, "user_001", "@thanh", 30)
	if len(posts) != 1 || posts[0].ID != real {
		t.Fatalf("@thanh 只能匹配 @thanh，got %v", postIDs(posts))
	}
}

func TestListPostsMentioningNormalizesTheHandleItIsGiven(t *testing.T) {
	s := New()
	post := createPostAs(t, s, "user_002", "你好 @thanh", "PUBLIC")

	// 客户端可能带不带 @、可能大小写不一致，都要能命中同一条。
	for _, handle := range []string{"@thanh", "thanh", "  @Thanh  ", "@@thanh"} {
		posts, _ := listPostsMentioning(t, s, "user_001", handle, 30)
		if len(posts) != 1 || posts[0].ID != post {
			t.Errorf("handle %q 应该命中同一条帖子，got %v", handle, postIDs(posts))
		}
	}
}

func postIDs(posts []Post) []string {
	ids := make([]string, 0, len(posts))
	for _, p := range posts {
		ids = append(ids, p.ID)
	}
	return ids
}
