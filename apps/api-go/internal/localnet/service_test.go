package localnet

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

func envelopeFor(needID, commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{
		CommandID:      "cmd_test_1",
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: "user_001"},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: "user_001"},
		Target:         command.Target{Type: "Post", ID: needID},
		IdempotencyKey: "test_key_123456",
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
}

func TestCreatePost(t *testing.T) {
	s := New()
	e := envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT",
		"body":       "明天带逛还剑湖，天气很好，咖啡和拍照都安排好了。",
		"visibility": "PUBLIC",
		"cityScope":  "河内",
		"contextRefs": []map[string]any{
			{"contextType": "ROUTE", "contextID": "ccr_1", "relationType": "MENTIONS"},
		},
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("create post: got %s (%+v)", result.Outcome, result.Error)
	}
	if result.Aggregate.State != "PUBLISHED" {
		t.Fatalf("want PUBLISHED, got %s", result.Aggregate.State)
	}
	// Post 发布后不自动创建 Task：检查事件里没有 Task 事件
	// （事件类型只应有 PostCreated）
}

func TestCreatePostEmptyContent(t *testing.T) {
	s := New()
	e := envelopeFor("", "CreatePost", map[string]any{"body": ""})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" || result.Error.ErrorCode != "POST_EMPTY_CONTENT" {
		t.Fatalf("want POST_EMPTY_CONTENT, got %s/%+v", result.Outcome, result.Error)
	}
}

func TestCreatePostRejectsInvalidMediaOrderAndAltText(t *testing.T) {
	s := New()
	for name, refs := range map[string][]map[string]any{
		"duplicate sort order": {
			{"mediaAssetId": "media_a", "sortOrder": 0},
			{"mediaAssetId": "media_b", "sortOrder": 0},
		},
		"oversized alt text": {
			{"mediaAssetId": "media_a", "sortOrder": 0, "altText": string(make([]rune, 501))},
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": "照片", "mediaRefs": refs}))
			if result.Outcome != "REJECTED" || result.Error.ErrorCode != "INVALID_POST_MEDIA_REF" {
				t.Fatalf("want INVALID_POST_MEDIA_REF, got %s/%+v", result.Outcome, result.Error)
			}
		})
	}
}

func TestCreatePostClassifiesDemandWithoutCreatingTransaction(t *testing.T) {
	s := New()
	result := s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": "周六在河内找一位活动摄影师，预算 150 万"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("create classified post: got %s (%+v)", result.Outcome, result.Error)
	}
	post, err := s.repository.GetPost(t.Context(), result.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	foundDemand, foundActivity := false, false
	for _, ref := range post.ContextRefs {
		if ref.ContextType == "DEMAND" {
			foundDemand = true
		}
		if ref.ContextType == "ACTIVITY" {
			foundActivity = true
		}
	}
	if !foundDemand || !foundActivity {
		t.Fatalf("expected demand and activity classification, got %+v", post.ContextRefs)
	}
	needs, err := s.repository.SnapshotNeeds(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(needs) != 0 {
		t.Fatal("classification must not create a Need")
	}
}

func TestFeedAndHydrationNote(t *testing.T) {
	s := New()
	// 发 2 个帖子
	s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": "第一帖"}))
	s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": "第二帖"}))

	// Feed 读取
	e := envelopeFor("", "ListFeedPosts", map[string]any{})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		Posts []Post `json:"posts"`
		Note  string `json:"note"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("parse feed: %v", err)
	}
	if len(view.Posts) != 2 {
		t.Fatalf("want 2 posts, got %d", len(view.Posts))
	}
	// 硬规则：实时交易事实读取时 Hydration，Post 不是 Source of Truth
	if view.Note == "" {
		t.Fatal("feed must carry hydration note")
	}
	// 时间排序：新的在前
	if view.Posts[0].Body != "第二帖" {
		t.Fatalf("want newest first, got %s", view.Posts[0].Body)
	}
}

func TestCreateNeedFromPost(t *testing.T) {
	s := New()
	r := s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": "本地动态"}))
	postID := r.Aggregate.ID

	// Post → DM → Need 显式转化
	e := envelopeFor("", "CreateNeedFromPost", map[string]any{
		"postId":         postID,
		"demandOrigin":   "AGENT_OWNED",
		"sourceType":     "POST_TO_DM",
		"conversationId": "conv_1",
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("need from post: got %s (%+v)", result.Outcome, result.Error)
	}
	var view struct {
		NeedID  string                   `json:"needId"`
		Lineage DemandAttributionLineage `json:"lineage"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &view); err != nil {
		t.Fatalf("parse need: %v", err)
	}
	if view.Lineage.DemandOrigin != "AGENT_OWNED" {
		t.Fatalf("AGENT_OWNED 来源必须保留，got %s", view.Lineage.DemandOrigin)
	}
	if view.Lineage.SourceType != "POST_TO_DM" {
		t.Fatalf("want POST_TO_DM, got %s", view.Lineage.SourceType)
	}
}

func TestNeedFromPostNotFound(t *testing.T) {
	s := New()
	e := envelopeFor("", "CreateNeedFromPost", map[string]any{"postId": "post_nonexistent"})
	result := s.Handle(e)
	if result.Outcome != "REJECTED" || result.Error.ErrorCode != "POST_NOT_FOUND" {
		t.Fatalf("want POST_NOT_FOUND, got %s/%+v", result.Outcome, result.Error)
	}
}

func TestRecordAttribution(t *testing.T) {
	s := New()
	e := envelopeFor("", "RecordAttribution", map[string]any{
		"demandOrigin": "PARTNER",
		"sourceType":   "PROFILE_LINK",
		"sourceId":     "src_1",
		"needId":       "need_1",
	})
	result := s.Handle(e)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("record attribution: got %s (%+v)", result.Outcome, result.Error)
	}
	// 非法来源
	e2 := envelopeFor("", "RecordAttribution", map[string]any{"demandOrigin": "EVIL"})
	r2 := s.Handle(e2)
	if r2.Outcome != "REJECTED" || r2.Error.ErrorCode != "INVALID_DEMAND_ORIGIN" {
		t.Fatalf("want INVALID_DEMAND_ORIGIN, got %s/%+v", r2.Outcome, r2.Error)
	}
}

// ── Audit closures for Pass 2 ──────────────────────────────────────────

// stubMediaLookup returns a MediaAssetInfo map keyed by mediaAssetId. The
// listFeed call only consults LookupMediaAssets + AuthorizeForPost, so the
// stub is intentionally minimal — just enough to prove that
// MediaAssetInfo.DominantColorHex is propagated to PostMediaItem.
type stubMediaLookup struct {
	assets      map[string]MediaAssetInfo
	lookupCalls int
}

func (s *stubMediaLookup) LookupMediaAssets(ctx context.Context, ids []string) (map[string]MediaAssetInfo, error) {
	s.lookupCalls++
	out := map[string]MediaAssetInfo{}
	for _, id := range ids {
		if info, ok := s.assets[id]; ok {
			out[id] = info
		}
	}
	return out, nil
}

func TestListFeedPosts_BatchesMediaHydrationAcrossPosts(t *testing.T) {
	lookup := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"a": {MediaAssetID: "a", MediaType: "IMAGE", ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
		"b": {MediaAssetID: "b", MediaType: "VIDEO", ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
	}}
	s := NewWithMediaLookup(NewMemoryRepository(), lookup)
	for _, id := range []string{"a", "b"} {
		result := s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"body": id, "visibility": "PUBLIC",
			"mediaRefs": []map[string]any{{"mediaAssetId": id, "sortOrder": 0}},
		}))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("create post %s: %+v", id, result.Error)
		}
	}
	lookup.lookupCalls = 0 // Ignore publication authorization calls.
	result := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: %+v", result.Error)
	}
	if lookup.lookupCalls != 1 {
		t.Fatalf("expected one page-wide media lookup, got %d", lookup.lookupCalls)
	}
}

// R15.95: ListFeedPosts 接受 search 字段, server 端 filter body.
func TestListFeedPosts_SearchFilterOnBody(t *testing.T) {
	s := New()
	for _, body := range []string{"西湖昨天夕阳", "河内夜市美食", "西湖水上日出"} {
		r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"body": body, "visibility": "PUBLIC",
		}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("create post %q: %+v", body, r.Error)
		}
	}
	// 搜 "西湖" 期待 2 笔
	r := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"search": "西湖"}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list feed search: %+v", r.Error)
	}
	var payload struct {
		Posts []map[string]any `json:"posts"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if len(payload.Posts) != 2 {
		t.Fatalf("expected 2 posts matching '西湖', got %d", len(payload.Posts))
	}
	// 搜 "河内" 期待 1 笔
	r2 := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"search": "河内"}))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("list feed search 2: %+v", r2.Error)
	}
	var payload2 struct {
		Posts []map[string]any `json:"posts"`
	}
	if err := json.Unmarshal([]byte(r2.OperationRef), &payload2); err != nil {
		t.Fatalf("unmarshal payload 2: %v", err)
	}
	if len(payload2.Posts) != 1 {
		t.Fatalf("expected 1 post matching '河内', got %d", len(payload2.Posts))
	}
	// 搜 "西" 大小写不敏感
	r3 := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"search": "西"}))
	if r3.Outcome != "ACCEPTED" {
		t.Fatalf("list feed search 3: %+v", r3.Error)
	}
	var payload3 struct {
		Posts []map[string]any `json:"posts"`
	}
	if err := json.Unmarshal([]byte(r3.OperationRef), &payload3); err != nil {
		t.Fatalf("unmarshal payload 3: %v", err)
	}
	if len(payload3.Posts) != 2 {
		t.Fatalf("expected 2 posts matching '西', got %d", len(payload3.Posts))
	}
}

// SEARCH-CORPUS-001：搜索必须命中「用户看得见的字段」。
//
// 回归背景：搜索框自己写的是「搜索人、机会、活动、情报…」，客户端两处 filter
// 也都 OR 了 authorDisplayName，但 server 只匹配 Body —— 正文不含关键词的帖子
// 在 server 就被丢掉了，客户端那两段 OR 永远匹配不到东西，表现为
// 「搜作者名恒返回 0 条，而代码看起来是支持的」。
//
// 这个测试把「按作者名搜 / 按城市搜」钉住，避免再退回只匹配正文。
func TestListFeedPosts_SearchMatchesAuthorNameAndCity(t *testing.T) {
	s := New()
	create := func(payload map[string]any) {
		t.Helper()
		if r := s.Handle(envelopeFor("", "CreatePost", payload)); r.Outcome != "ACCEPTED" {
			t.Fatalf("create post %+v: %+v", payload, r.Error)
		}
	}
	create(map[string]any{"body": "西湖昨天夕阳", "visibility": "PUBLIC"})
	create(map[string]any{"body": "河内夜市美食", "visibility": "PUBLIC"})
	create(map[string]any{"body": "西湖水上日出", "visibility": "PUBLIC"})
	// 这条正文完全不含「晴晴」也不含「岘港」——只有作者展示名和城市带。
	create(map[string]any{
		"body": "今天的咖啡不错", "visibility": "PUBLIC",
		"authorType": "MERCHANT", "authorDisplayName": "晴晴", "cityScope": "岘港",
	})

	count := func(query string) int {
		t.Helper()
		r := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"search": query}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("list feed search %q: %+v", query, r.Error)
		}
		var payload struct {
			Posts []map[string]any `json:"posts"`
		}
		if err := json.Unmarshal([]byte(r.OperationRef), &payload); err != nil {
			t.Fatalf("unmarshal payload for %q: %v", query, err)
		}
		return len(payload.Posts)
	}

	// R15.94 的既有行为不能回退：正文匹配
	if got := count("西湖"); got != 2 {
		t.Fatalf("body search '西湖': want 2, got %d", got)
	}
	if got := count("河内"); got != 1 {
		t.Fatalf("body search '河内': want 1, got %d", got)
	}
	// SEARCH-CORPUS-001：作者展示名可搜 —— 修复前这里是 0
	if got := count("晴晴"); got != 1 {
		t.Fatalf("author-name search '晴晴': want 1, got %d (搜索必须能按人搜)", got)
	}
	// SEARCH-CORPUS-001：城市可搜 —— 修复前这里是 0
	if got := count("岘港"); got != 1 {
		t.Fatalf("city search '岘港': want 1, got %d", got)
	}
	// 大小写/子串语义对非正文字段同样成立
	if got := count("晴"); got != 1 {
		t.Fatalf("author-name substring search '晴': want 1, got %d", got)
	}
	// 反向：不匹配任何字段的查询仍然返回空（防止 filter 被写成恒真）
	if got := count("不存在的关键词"); got != 0 {
		t.Fatalf("unrelated search: want 0, got %d", got)
	}
}

// SEARCH-CORPUS-003：feed 搜索必须命中**评论**。
//
// 回归背景：评论就显示在动态卡片里，是这个界面数据域的一部分，但搜索只认
// 正文 / 作者名 / 城市 —— 一条「正文没写、全在评论里」的帖永远搜不到。
// 难点在于评论根本不在 Post 上（存在 engagement 里），所以判定必须由外部端口
// 给进来；这个测试同时钉住「端口被真的调用了」和「没接线时不假装能搜」。
type stubReplySearch struct {
	calls     int
	lastQuery string
	// matchAll 时把**所有候选**都算命中，用来证明 listFeed 真的把结果用上了。
	matchAll bool
}

func (s *stubReplySearch) ListPostIDsWithMatchingReply(_ context.Context, postIDs []string, loweredQuery string) (map[string]bool, error) {
	s.calls++
	s.lastQuery = loweredQuery
	if !s.matchAll {
		return map[string]bool{}, nil
	}
	out := make(map[string]bool, len(postIDs))
	for _, id := range postIDs {
		out[id] = true
	}
	return out, nil
}

func TestListFeedPosts_SearchMatchesReplyBodies(t *testing.T) {
	s := New()
	create := func(payload map[string]any) {
		t.Helper()
		if r := s.Handle(envelopeFor("", "CreatePost", payload)); r.Outcome != "ACCEPTED" {
			t.Fatalf("create post %+v: %+v", payload, r.Error)
		}
	}
	// 两条正文都不含「只在评论里」—— 只有评论能命中。
	create(map[string]any{"body": "西湖昨天夕阳", "visibility": "PUBLIC"})
	create(map[string]any{"body": "河内夜市美食", "visibility": "PUBLIC"})

	count := func(query string) int {
		t.Helper()
		r := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"search": query}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("list feed search %q: %+v", query, r.Error)
		}
		var payload struct {
			Posts []map[string]any `json:"posts"`
		}
		if err := json.Unmarshal([]byte(r.OperationRef), &payload); err != nil {
			t.Fatalf("unmarshal payload for %q: %v", query, err)
		}
		return len(payload.Posts)
	}

	// 没接线时：评论不参与搜索，搜不到就是搜不到 —— 不许假装能搜。
	if got := count("只在评论里"); got != 0 {
		t.Fatalf("unwired reply search: want 0, got %d", got)
	}

	lookup := &stubReplySearch{matchAll: true}
	s.SetReplySearch(lookup)

	if got := count("只在评论里"); got != 2 {
		t.Fatalf("reply search '只在评论里': want 2, got %d", got)
	}
	if lookup.calls == 0 {
		t.Fatal("listFeed 根本没去问评论 —— 评论进搜索这件事又变成死通道了")
	}
	if lookup.lastQuery != "只在评论里" {
		t.Fatalf("reply lookup got query %q, want the normalized query", lookup.lastQuery)
	}
	// 评论没命中时必须仍然是 0 —— 防止被写成「有查询就恒真」。
	lookup.matchAll = false
	if got := count("不存在的关键词"); got != 0 {
		t.Fatalf("reply miss: want 0, got %d", got)
	}
}

// postMatchesSearch 的字段边界：正文 / 作者名 / 城市命中，
// 但**派生**的 ContextRefs 不参与 —— 否则搜索会返回用户根本没写过的词。
func TestPostMatchesSearch_ExcludesDerivedContextRefs(t *testing.T) {
	post := Post{
		ID:                "post_1",
		Body:              "西湖昨天夕阳",
		AuthorDisplayName: "晴晴",
		CityScope:         "岘港",
		// classifyPostFallback 从正文派生出来的分类标签，不是用户输入。
		ContextRefs: []ContextRef{{ContextID: "scene_rooftop_夜景"}},
	}
	cases := []struct {
		query string
		want  bool
	}{
		{"", true},         // 空查询不过滤
		{"西湖", true},       // 正文
		{"晴晴", true},       // 作者展示名
		{"岘港", true},       // 城市
		{"夜景", false},      // 派生 ContextRefs 不算
		{"rooftop", false}, // 派生 ContextRefs 不算（大小写不敏感）
		{"河内", false},      // 谁都不含
	}
	for _, c := range cases {
		if got := postMatchesSearch(post, strings.ToLower(c.query), false); got != c.want {
			t.Fatalf("postMatchesSearch(%q) = %v, want %v", c.query, got, c.want)
		}
	}
}

// SEARCH-CORPUS-003：评论命中时帖子必须出现在结果里 —— 哪怕正文、作者名、
// 城市一个都不含。评论就显示在动态卡片上，搜不到等于对这一屏的数据域撒谎。
func TestPostMatchesSearch_MatchesReplyHit(t *testing.T) {
	post := Post{ID: "post_1", Body: "西湖昨天夕阳", AuthorDisplayName: "晴晴", CityScope: "岘港"}
	if postMatchesSearch(post, "评论里才有的词", false) {
		t.Fatal("没有评论命中时不该匹配")
	}
	if !postMatchesSearch(post, "评论里才有的词", true) {
		t.Fatal("评论命中时必须匹配，否则评论里的词永远搜不到")
	}
	// 空查询恒 true —— 不搜索即不过滤，评论命中与否都不影响。
	if !postMatchesSearch(post, "", false) {
		t.Fatal("空查询必须不过滤")
	}
}

func (s *stubMediaLookup) AuthorizeForPost(ctx context.Context, ids []string, ownerPrincipalID, visibility string) error {
	return nil
}

func TestListFeedPosts_PropagatesDominantColorHex(t *testing.T) {
	// Inject a MediaLookup that returns DominantColorHex for the asset,
	// then create a Post that references it and assert the dominant
	// color appears in the mediaItems envelope.
	stub := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_001": {
			MediaAssetID:     "media_001",
			MediaType:        "IMAGE",
			Width:            1080,
			Height:           1440,
			ProcessingStatus: "READY",
			ModerationStatus: "APPROVED",
			VisibilityClass:  "PUBLIC",
			DominantColorHex: "#FFCC66",
		},
	}}
	s := NewWithMediaLookup(NewMemoryRepository(), stub)
	post := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT",
		"body":       "拍夜景试试 #FFCC66",
		"visibility": "PUBLIC",
		"cityScope":  "hanoi",
		"mediaRefs":  []map[string]any{{"mediaAssetId": "media_001", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	if post.Outcome != "ACCEPTED" {
		t.Fatalf("create post: %s (%+v)", post.Outcome, post.Error)
	}

	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: %s (%+v)", list.Outcome, list.Error)
	}
	// OperationRef is the JSON payload: {posts:[{...}], media:{<postId>:[PostMediaItem]}}
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse feed: %v\n%s", err, list.OperationRef)
	}
	if len(view.Posts) != 1 {
		t.Fatalf("want 1 post, got %d", len(view.Posts))
	}
	postID := view.Posts[0].ID
	items, ok := view.Media[postID]
	if !ok || len(items) != 1 {
		t.Fatalf("want 1 hydrated media item, got %+v", view.Media)
	}
	if got, want := items[0]["dominantColorHex"], "#FFCC66"; got != want {
		t.Fatalf("dominantColorHex not propagated: want %s, got %v", want, got)
	}
}

// LC-06 显示侧（2026-09-21 产品决定「AI 做的就标注，法规要求要满足」）：
// 资产级 AI 溯源必须真的走到 feed wire。
//
// 这一跳以前是缺的 —— media_assets.ai_generation_source 在库里活着（migration 108），
// 但 mediaAssetInfo() 不拷它、PostMediaItem 也没这个字段，于是「按资产的 AI 溯源」
// 对任何用户都不可见。只断言「结构体里有这个字段」证明不了这件事：真正会坏的是
// hydrate 那一跳被删掉，而那种改动不会让编译失败，只会让标注静默消失。
func TestListFeedPosts_PropagatesAIGenerationSourceToMediaWire(t *testing.T) {
	stub := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_ai": {
			MediaAssetID:       "media_ai",
			MediaType:          "IMAGE",
			Width:              1080,
			Height:             1440,
			ProcessingStatus:   "READY",
			ModerationStatus:   "APPROVED",
			VisibilityClass:    "PUBLIC",
			AIGenerationSource: "AI_PERSONA",
		},
		"media_human": {
			MediaAssetID:       "media_human",
			MediaType:          "IMAGE",
			Width:              1080,
			Height:             1440,
			ProcessingStatus:   "READY",
			ModerationStatus:   "APPROVED",
			VisibilityClass:    "PUBLIC",
			AIGenerationSource: "USER_UPLOADED",
		},
	}}
	s := NewWithMediaLookup(NewMemoryRepository(), stub)
	for _, id := range []string{"media_ai", "media_human"} {
		post := s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "AGENT",
			"body":       id,
			"visibility": "PUBLIC",
			"mediaRefs":  []map[string]any{{"mediaAssetId": id, "mediaType": "IMAGE", "sortOrder": 0}},
		}))
		if post.Outcome != "ACCEPTED" {
			t.Fatalf("create post %s: %s (%+v)", id, post.Outcome, post.Error)
		}
	}

	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: %s (%+v)", list.Outcome, list.Error)
	}
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse feed: %v\n%s", err, list.OperationRef)
	}
	// 用 body（就是 mediaAssetId）找回来，不依赖 feed 排序。
	got := map[string]string{}
	for _, p := range view.Posts {
		items := view.Media[p.ID]
		if len(items) != 1 {
			t.Fatalf("post %s: want 1 hydrated media item, got %d", p.ID, len(items))
		}
		raw, ok := items[0]["aiGenerationSource"]
		if !ok {
			t.Fatalf("post %s: aiGenerationSource 没上 wire —— 客户端无从判定该不该标注", p.ID)
		}
		str, ok := raw.(string)
		if !ok {
			t.Fatalf("post %s: aiGenerationSource 不是字符串: %T", p.ID, raw)
		}
		got[p.Body] = str
	}
	if v := got["media_ai"]; v != "AI_PERSONA" {
		t.Fatalf("AI_PERSONA 资产的溯源在 hydrate 那一跳丢了: got %q", v)
	}
	if v := got["media_human"]; v != "USER_UPLOADED" {
		t.Fatalf("USER_UPLOADED 资产被误报: got %q", v)
	}
}

func TestListFeedPosts_EmptyDominantColorHex_Omitted(t *testing.T) {
	// omitempty contract: an empty DominantColorHex must NOT appear in
	// the JSON (otherwise clients see "#" or "" and may render a white
	// background). Tripwire it.
	s := New()
	stub := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_no_color": {
			MediaAssetID:     "media_no_color",
			MediaType:        "IMAGE",
			Width:            1080,
			Height:           1440,
			ProcessingStatus: "READY",
			ModerationStatus: "APPROVED",
			VisibilityClass:  "PUBLIC",
			// DominantColorHex deliberately empty
		},
	}}
	s = NewWithMediaLookup(NewMemoryRepository(), stub)
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT",
		"body":       "no color",
		"visibility": "PUBLIC",
		"cityScope":  "hanoi",
		"mediaRefs":  []map[string]any{{"mediaAssetId": "media_no_color", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse feed: %v", err)
	}
	postID := view.Posts[0].ID
	items := view.Media[postID]
	if _, present := items[0]["dominantColorHex"]; present {
		t.Fatalf("empty dominantColorHex must be omitted (omitempty), but was present: %+v", items[0])
	}
}

// ── R15.13 P4 tripwires: Memory → Feed aesthetic backdrop ─────────

// stubSceneAesthetic returns a fixed backdrop for the (city, type)
// tuple it was constructed with. Anything else returns the zero
// value so the caller falls back to the hard-coded frame color.
//
// R15.15 P1: 加 byKey (按 sceneType 返不同色) + calls (计数
// 调 调用 — 验证 cache 避免 N+1)。老调用 (hex + sampleCount)
// 仍然走.
type stubSceneAesthetic struct {
	hex         string
	sampleCount int
	// byKey 映射 sceneType → hex。cityScope 任意, sceneType 匹配
	// 就返这色。默认 sampleCount=2 (在阈值上)。
	byKey map[string]string
	// calls 记录 city+"\x00"+scene 调用次数 (判断 cache 是否生效)。
	calls map[string]int
}

func (s *stubSceneAesthetic) GetAestheticBackdrop(ctx context.Context, cityScope, sceneType string) (SceneAestheticBackdrop, error) {
	if s.calls == nil {
		s.calls = map[string]int{}
	}
	s.calls[cityScope+"\x00"+sceneType]++
	if s.byKey != nil {
		if hex, ok := s.byKey[sceneType]; ok {
			return SceneAestheticBackdrop{Hex: hex, SampleCount: 2, Confidence: 1.0}, nil
		}
	}
	return SceneAestheticBackdrop{Hex: s.hex, SampleCount: s.sampleCount, Confidence: 1.0}, nil
}

func TestListFeedPosts_SceneAestheticBackdrop_Stamped(t *testing.T) {
	// When the provider has signal (SampleCount >= 2), the first
	// media item in the post envelope must carry the recommended
	// frame color so the client can render contain-mode backgrounds
	// from real data, not a hard-coded purple.
	stubML := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_b1": {MediaAssetID: "media_b1", MediaType: "IMAGE", ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC", Width: 100, Height: 100},
	}}
	stubA := &stubSceneAesthetic{hex: "#AABBCC", sampleCount: 5}
	s := NewWithAll(NewMemoryRepository(), stubML, nil, stubA)
	_ = s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER",
		"authorId":   "u_aesthetic_a",
		"body":       "tripwire backdrop",
		"visibility": "PUBLIC",
		"cityScope":  "hanoi",
		"mediaRefs":  []map[string]any{{"mediaAssetId": "media_b1", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse: %v", err)
	}
	postID := view.Posts[0].ID
	items := view.Media[postID]
	if len(items) == 0 {
		t.Fatal("expected media items")
	}
	got, _ := items[0]["sceneAestheticBackdrop"].(string)
	if got != "#AABBCC" {
		t.Fatalf("expected sceneAestheticBackdrop #AABBCC, got %q", got)
	}
}

func TestListFeedPosts_SceneAestheticBackdrop_BelowThreshold_Omitted(t *testing.T) {
	// The provider contract is: SampleCount < 2 → no signal. The
	// field must be omitted from the wire (omitempty) so the client
	// falls back to its hard-coded frame color, not to a value
	// plucked from a single, possibly anomalous memory.
	stubML := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_b2": {MediaAssetID: "media_b2", MediaType: "IMAGE", ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC", Width: 100, Height: 100},
	}}
	stubA := &stubSceneAesthetic{hex: "#112233", sampleCount: 1} // below threshold
	s := NewWithAll(NewMemoryRepository(), stubML, nil, stubA)
	_ = s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER",
		"authorId":   "u_aesthetic_b",
		"body":       "tripwire below threshold",
		"visibility": "PUBLIC",
		"cityScope":  "hanoi",
		"mediaRefs":  []map[string]any{{"mediaAssetId": "media_b2", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse: %v", err)
	}
	postID := view.Posts[0].ID
	items := view.Media[postID]
	if _, present := items[0]["sceneAestheticBackdrop"]; present {
		t.Fatalf("SampleCount<2 must omit sceneAestheticBackdrop, but was present: %+v", items[0])
	}
}

func TestListFeedPosts_SceneAestheticBackdrop_NilProvider_StillWorks(t *testing.T) {
	// The provider is optional — a feed hydrated without the
	// aesthetic provider must continue to work and must not leak
	// a zero value into the wire (which would be "#000000" — a
	// valid hex the client would happily render as a black frame).
	stubML := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_b3": {MediaAssetID: "media_b3", MediaType: "IMAGE", ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC", Width: 100, Height: 100},
	}}
	s := NewWithAll(NewMemoryRepository(), stubML, nil, nil)
	_ = s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER",
		"authorId":   "u_aesthetic_c",
		"body":       "tripwire nil provider",
		"visibility": "PUBLIC",
		"cityScope":  "hanoi",
		"mediaRefs":  []map[string]any{{"mediaAssetId": "media_b3", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse: %v", err)
	}
	postID := view.Posts[0].ID
	items := view.Media[postID]
	if _, present := items[0]["sceneAestheticBackdrop"]; present {
		t.Fatalf("nil provider must omit sceneAestheticBackdrop, but was present: %+v", items[0])
	}
}

// ── Feed ALL is global and independent from LocationContext ─────────
// CityScope is metadata for an explicit nearby filter. Legacy callers may
// still send viewingCity, but ListFeedPosts must ignore it and return the
// complete visible timeline.

func TestListFeedPosts_ViewingCity_DoesNotFilterAll(t *testing.T) {
	s := New()
	posts := []map[string]any{
		{"authorType": "AGENT", "body": "河内·还剑湖清早", "visibility": "PUBLIC", "cityScope": "河内"},
		{"authorType": "AGENT", "body": "HCM·Bitexco 夜景", "visibility": "PUBLIC", "cityScope": "胡志明市"},
		{"authorType": "AGENT", "body": "河内·西湖老店", "visibility": "PUBLIC", "cityScope": "河内"},
		{"authorType": "AGENT", "body": "岘港·海云岭", "visibility": "PUBLIC", "cityScope": "岘港"},
	}
	for _, p := range posts {
		r := s.Handle(envelopeFor("", "CreatePost", p))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("seed post: %s (%+v)", r.Outcome, r.Error)
		}
	}
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内"}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: %s (%+v)", list.Outcome, list.Error)
	}
	var view struct {
		Posts       []Post                      `json:"posts"`
		ViewingCity string                      `json:"viewingCity"`
		Unfiltered  bool                        `json:"unfiltered"`
		Media       map[string][]map[string]any `json:"media"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse: %v\n%s", err, list.OperationRef)
	}
	if len(view.Posts) != 4 {
		t.Fatalf("ALL must include every city, got %d posts: %+v", len(view.Posts), view.Posts)
	}
	if !view.Unfiltered {
		t.Fatalf("ALL must always report unfiltered")
	}
}

func TestListFeedPosts_ViewingCity_AcceptsHistoricalAliases(t *testing.T) {
	s := New()
	for _, city := range []string{"河内", "hn", "Hanoi", "Hà Nội"} {
		r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "AGENT", "body": city, "visibility": "PUBLIC", "cityScope": city,
		}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("seed alias %q: %s", city, r.Outcome)
		}
	}
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "HCMC", "visibility": "PUBLIC", "cityScope": "hcm",
	}))

	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内"}))
	var view struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse aliases: %v", err)
	}
	if len(view.Posts) != 5 {
		t.Fatalf("city aliases must not affect ALL, got %d: %+v", len(view.Posts), view.Posts)
	}
}

func TestListFeedPosts_EmptyViewingCity_FallsBackToUnfiltered(t *testing.T) {
	// 客户端没传 viewingCity (legacy 路径) 或传空字符串 — 服务端
	// 不应该静默过滤到 0 帖，而是 echo unfiltered=true 让老调用方
	// 走全量 feed。
	s := New()
	for _, body := range []string{"河内·还剑湖", "HCM·Bitexco", "岘港·海云岭"} {
		s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "AGENT", "body": body, "visibility": "PUBLIC", "cityScope": "任意",
		}))
	}
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("list feed: %s", list.Outcome)
	}
	var view struct {
		Posts       []Post `json:"posts"`
		ViewingCity string `json:"viewingCity"`
		Unfiltered  bool   `json:"unfiltered"`
	}
	if err := json.Unmarshal([]byte(list.OperationRef), &view); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(view.Posts) != 3 {
		t.Fatalf("want 3 posts unfiltered, got %d", len(view.Posts))
	}
	if !view.Unfiltered {
		t.Fatalf("unfiltered flag must be true when viewingCity absent")
	}
	if view.ViewingCity != "" {
		t.Fatalf("viewingCity should echo empty, got %q", view.ViewingCity)
	}

	// Explicit empty string should also fall back to unfiltered —
	// location-store load failure / blank state should not zero out feed.
	list2 := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": ""}))
	var view2 struct {
		Posts      []Post `json:"posts"`
		Unfiltered bool   `json:"unfiltered"`
	}
	_ = json.Unmarshal([]byte(list2.OperationRef), &view2)
	if len(view2.Posts) != 3 {
		t.Fatalf("empty viewingCity must not filter, got %d posts", len(view2.Posts))
	}
	if !view2.Unfiltered {
		t.Fatalf("empty viewingCity must set unfiltered=true")
	}
}

func TestListFeedPosts_ViewingCity_WhitespacesAreTrimmed(t *testing.T) {
	// "   河内  " 应该等同 "河内" — location-store 可能从 secure
	// store 读出时多带个空格；服务器必须 trim，不能让空格静默
	// 造成 0 帖。
	s := New()
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "河内·还剑湖", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "HCM·Bitexco", "visibility": "PUBLIC", "cityScope": "胡志明市",
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "   河内   "}))
	var view struct {
		Posts []Post `json:"posts"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if len(view.Posts) != 2 {
		t.Fatalf("viewingCity whitespace must not filter ALL, got %d posts: %+v", len(view.Posts), view.Posts)
	}
}

func TestListFeedPosts_ViewingCity_PostsWithoutCityScopePassThrough(t *testing.T) {
	// 帖子未设 CityScope (老发布路径) — 顶 chip 选任何 city
	// 都不应过滤掉这种帖子，避免误伤老内容。
	s := New()
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "没标 city", "visibility": "PUBLIC",
		// no cityScope
	}))
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "河内", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "胡志明市"}))
	var view struct {
		Posts []Post `json:"posts"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if len(view.Posts) != 2 {
		t.Fatalf("ALL must include scoped and unscoped posts, got %d", len(view.Posts))
	}
}

func TestMemorySnapshot_StableNewestFirstOrder(t *testing.T) {
	repository := NewMemoryRepository()
	stamp := time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)
	for _, id := range []string{"post_c", "post_a", "post_b"} {
		if err := repository.CreatePost(t.Context(), Post{ID: id, Status: "PUBLISHED", Visibility: "PUBLIC", CreatedAt: stamp}); err != nil {
			t.Fatal(err)
		}
	}
	posts, err := repository.Snapshot(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"post_a", "post_b", "post_c"}
	for index, id := range want {
		if posts[index].ID != id {
			t.Fatalf("stable order[%d]=%s, want %s", index, posts[index].ID, id)
		}
	}
}

func TestListFeedPosts_ViewingCity_MalformedPayloadFallsBackToUnfiltered(t *testing.T) {
	// 客户端发了 garbage payload (e.g. viewingCity=123 数字，不是
	// string) — decode 失败不应被 reject 整个请求，而应走全量。
	// 这条是 fail-closed vs fail-open 选型 — 我们选 fail-open 在
	// 过滤这一层，让 view 不会突然空白。
	s := New()
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "河内", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": 12345}))
	if list.Outcome != "ACCEPTED" {
		t.Fatalf("garbage payload must not reject: %s (%+v)", list.Outcome, list.Error)
	}
	var view struct {
		Posts      []Post `json:"posts"`
		Unfiltered bool   `json:"unfiltered"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if len(view.Posts) != 1 {
		t.Fatalf("want 1 post, got %d", len(view.Posts))
	}
	if !view.Unfiltered {
		t.Fatalf("malformed viewingCity must fall back to unfiltered")
	}
}

// ── R15.15 P1 Post.SceneType + per-(city,sceneType) backdrop ─────────
//
// R15.13 P4 走全局 一色 ("", "")。R15.15 解锁 Post.SceneType
// 后可以 per-(city, sceneType) 取样，3 个 tripwires 验证:
//   1. CreatePost 接受合法 SceneType + 在 Post struct 跟读
//   2. CreatePost 拒绝未知 SceneType (fail-closed)
//   3. listFeed 按 post.SceneType 调 GetAestheticBackdrop

func TestCreatePost_AcceptsSceneType(t *testing.T) {
	// 发布者填 ROOFTOP 应当走到 Post.SceneType 字段，被 listFeed
	// 读出。
	s := New()
	r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT",
		"body":       "露台拍摄", "visibility": "PUBLIC", "cityScope": "河内",
		"sceneType": "ROOFTOP",
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create with sceneType=ROOFTOP: %s (%+v)", r.Outcome, r.Error)
	}
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post `json:"posts"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if len(view.Posts) != 1 {
		t.Fatalf("want 1 post, got %d", len(view.Posts))
	}
	if view.Posts[0].SceneType != "ROOFTOP" {
		t.Fatalf("want SceneType=ROOFTOP, got %q", view.Posts[0].SceneType)
	}
}

func TestCreatePost_RejectsUnknownSceneType(t *testing.T) {
	// 不在白名单的 SceneType 应当被 reject。不准静默跳成 UNKNOWN
	// — 发布者拼错了会一直被误推荐到 UNKNOWN bucket。
	s := New()
	r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT",
		"body":       "x", "visibility": "PUBLIC", "cityScope": "河内",
		"sceneType": "WHATEVER_THIS_IS",
	}))
	if r.Outcome != "REJECTED" {
		t.Fatalf("unknown sceneType must reject, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_POST_SCENE_TYPE" {
		t.Fatalf("want INVALID_POST_SCENE_TYPE, got %+v", r.Error)
	}
}

func TestCreatePost_EmptySceneTypeDefaultsToUnknown(t *testing.T) {
	// 老 client 路径不传 sceneType — 服务端应该默认值成
	// UNKNOWN（不报 reject），保持 wire 兼容。
	s := New()
	r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "x", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("legacy no sceneType must accept, got %s", r.Outcome)
	}
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post `json:"posts"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if view.Posts[0].SceneType != "UNKNOWN" {
		t.Fatalf("want default UNKNOWN, got %q", view.Posts[0].SceneType)
	}
}

func TestListFeedPosts_PerSceneTypeBackdrop(t *testing.T) {
	// 两个不同 SceneType 的帖应当拿不同的背景色。需要一个
	// 返色 provider 返两不同背景代表 ROOFTOP vs BRUNCH。
	stub := &stubSceneAesthetic{
		byKey: map[string]string{
			"ROOFTOP": "#2A1A0F", // warm dark
			"BRUNCH":  "#FFF4E0", // soft cream
		},
	}
	media := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"media_a": {MediaAssetID: "media_a", MediaType: "IMAGE", Width: 100, Height: 100, ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
		"media_b": {MediaAssetID: "media_b", MediaType: "IMAGE", Width: 100, Height: 100, ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
	}}
	s := NewWithAll(NewMemoryRepository(), media, nil, stub)
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "rooftop", "visibility": "PUBLIC", "cityScope": "河内",
		"sceneType": "ROOFTOP", "mediaRefs": []map[string]any{{"mediaAssetId": "media_a", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "body": "brunch", "visibility": "PUBLIC", "cityScope": "河内",
		"sceneType": "BRUNCH", "mediaRefs": []map[string]any{{"mediaAssetId": "media_b", "mediaType": "IMAGE", "sortOrder": 0}},
	}))
	list := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	var view struct {
		Posts []Post                      `json:"posts"`
		Media map[string][]map[string]any `json:"media"`
	}
	_ = json.Unmarshal([]byte(list.OperationRef), &view)
	if len(view.Posts) != 2 {
		t.Fatalf("want 2 posts, got %d", len(view.Posts))
	}
	// 同一 cityScope="河内" 下, 背垊色按 sceneType 区分。
	colors := map[string]string{}
	for _, p := range view.Posts {
		items := view.Media[p.ID]
		if len(items) != 1 {
			t.Fatalf("post %s: want 1 media item, got %d", p.ID, len(items))
		}
		bd, present := items[0]["sceneAestheticBackdrop"]
		if !present {
			t.Fatalf("post %s (sceneType=%s): missing sceneAestheticBackdrop", p.ID, p.SceneType)
		}
		colors[p.SceneType] = bd.(string)
	}
	if colors["ROOFTOP"] == colors["BRUNCH"] {
		t.Fatalf("ROOFTOP and BRUNCH must get different backdrops, both got %q", colors["ROOFTOP"])
	}
	if colors["ROOFTOP"] != "#2A1A0F" {
		t.Fatalf("ROOFTOP backdrop wrong: %q", colors["ROOFTOP"])
	}
	if colors["BRUNCH"] != "#FFF4E0" {
		t.Fatalf("BRUNCH backdrop wrong: %q", colors["BRUNCH"])
	}
}

func TestListFeedPosts_BackdropCacheAvoidsN1(t *testing.T) {
	// 三个同 (city="河内", sceneType="ROOFTOP") 的帖 — 期待
	// GetAestheticBackdrop 只调一次 (不是 3 次)。这是性能
	// contract，不竟 3 个帖 3 个调用会让 O(n) 调用压到 Scene service。
	stub := &stubSceneAesthetic{
		byKey: map[string]string{"ROOFTOP": "#2A1A0F"},
	}
	media := &stubMediaLookup{assets: map[string]MediaAssetInfo{
		"ma": {MediaAssetID: "ma", MediaType: "IMAGE", Width: 100, Height: 100, ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
		"mb": {MediaAssetID: "mb", MediaType: "IMAGE", Width: 100, Height: 100, ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
		"mc": {MediaAssetID: "mc", MediaType: "IMAGE", Width: 100, Height: 100, ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "PUBLIC"},
	}}
	s := NewWithAll(NewMemoryRepository(), media, nil, stub)
	for i, ma := range []string{"ma", "mb", "mc"} {
		s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "AGENT", "body": "rooftop", "visibility": "PUBLIC", "cityScope": "河内",
			"sceneType":  "ROOFTOP",
			"mediaRefs":  []map[string]any{{"mediaAssetId": ma, "mediaType": "IMAGE", "sortOrder": 0}},
			"_iteration": i,
		}))
	}
	_ = s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{}))
	if got := stub.calls["河内\x00ROOFTOP"]; got != 1 {
		// 第一个是 "河内"+ROOFTOP — 期望1次调用
		t.Fatalf("expected 1 GetAestheticBackdrop call for shared (city, sceneType), got %d", got)
	}
}

func TestListFeedPosts_CursorIsSignedAndTamperIsRejected(t *testing.T) {
	t.Setenv("PROXY_CURSOR_HMAC_KEY", "test-cursor-key-123")
	s := New()
	for i := 0; i < 3; i++ {
		s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "AGENT", "body": "post", "visibility": "PUBLIC",
			"mediaRefs": []map[string]any{},
		}))
	}
	first := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"limit": 1}))
	if first.Outcome != "ACCEPTED" {
		t.Fatalf("first page: %v", first.Error)
	}
	var firstPayload struct {
		NextCursor string `json:"nextCursor"`
		HasMore    bool   `json:"hasMore"`
	}
	_ = json.Unmarshal([]byte(first.OperationRef), &firstPayload)
	if firstPayload.NextCursor == "" || !firstPayload.HasMore {
		t.Fatal("expected nextCursor")
	}
	// 篡改：改一个字符，签名应失效并返回 INVALID_CURSOR
	tampered := firstPayload.NextCursor[:len(firstPayload.NextCursor)-1] + "x"
	secondTampered := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"cursor": tampered, "limit": 1}))
	if secondTampered.Outcome != "REJECTED" || secondTampered.Error == nil || secondTampered.Error.ErrorCode != "INVALID_CURSOR" {
		t.Fatalf("tampered cursor must be REJECTED INVALID_CURSOR, got %+v", secondTampered)
	}
	// 正常游标应翻到第二页
	second := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"cursor": firstPayload.NextCursor, "limit": 1}))
	if second.Outcome != "ACCEPTED" {
		t.Fatalf("second page: %v", second.Error)
	}
}

type stubAuthorNames struct{ names map[string]string }

func (s stubAuthorNames) ResolveAuthorDisplayName(_ context.Context, userID string) (string, bool) {
	name, ok := s.names[userID]
	return name, ok
}

// PROFILE-READ-001: USER posts resolve the display name from the verified
// account profile; the client-supplied value (historically a hardcoded
// viewer-relative label) is never stored.
func TestCreatePostResolvesUserDisplayNameFromProfile(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(stubAuthorNames{names: map[string]string{"user_001": "NguyenThanhHuyen"}})
	result := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER", "authorDisplayName": "你", "body": "hello", "visibility": "PUBLIC",
	}))
	if result.Outcome != "ACCEPTED" || result.Aggregate == nil {
		t.Fatalf("create post: got %s (%+v)", result.Outcome, result.Error)
	}
	post, err := s.repository.GetPost(context.Background(), result.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if post.AuthorDisplayName != "NguyenThanhHuyen" {
		t.Fatalf("display name must come from profile, got %q", post.AuthorDisplayName)
	}
}

// PROFILE-READ-001: unresolved authors store an empty display (readers show
// a neutral label); non-USER author types keep caller-supplied names.
func TestCreatePostDisplayNameFallbacks(t *testing.T) {
	s := New()
	s.SetAuthorNameResolver(stubAuthorNames{names: map[string]string{}})
	unresolved := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER", "authorDisplayName": "你", "body": "hello", "visibility": "PUBLIC",
	}))
	post, err := s.repository.GetPost(context.Background(), unresolved.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if post.AuthorDisplayName != "" {
		t.Fatalf("unresolved author must store empty display, got %q", post.AuthorDisplayName)
	}
	agent := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "AGENT", "authorDisplayName": "Linh", "body": "tour", "visibility": "PUBLIC",
	}))
	agentPost, err := s.repository.GetPost(context.Background(), agent.Aggregate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if agentPost.AuthorDisplayName != "Linh" {
		t.Fatalf("non-USER names stay caller-supplied, got %q", agentPost.AuthorDisplayName)
	}
}

// AI-POSTS-001: 5 小美开屏帖种子。一人一条 AI_NATIVE + 写真 mediaRef；
// Upsert 幂等，可重跑。
func TestSeedXiaomeiPosts(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.SeedXiaomeiPosts(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.SeedXiaomeiPosts(ctx); err != nil {
		t.Fatal("reseed must be idempotent")
	}
	items, err := s.repository.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, item := range items {
		if len(item.ID) < 12 || item.ID[:12] != "post_xiaomei" {
			continue
		}
		seen[item.ID] = true
		if item.AuthorType != "AI_NATIVE" {
			t.Fatalf("xiaomei post %s must be AI_NATIVE, got %q", item.ID, item.AuthorType)
		}
		if len(item.MediaRefs) != 1 || item.MediaRefs[0].MediaAssetID == "" {
			t.Fatalf("xiaomei post %s must carry exactly one photo ref: %+v", item.ID, item)
		}
		if item.Visibility != "PUBLIC" || item.Status != "PUBLISHED" {
			t.Fatalf("xiaomei post %s must be PUBLIC+PUBLISHED: %+v", item.ID, item)
		}
	}
	if len(seen) != 5 {
		t.Fatalf("expected 5 xiaomei posts, got %d", len(seen))
	}
}

// ---------- GHOST-24H-001: 临时动态（24h）的到期必须真的生效 ----------
//
// 这组测试钉住的是一条**对用户撒谎**的路径。修复前 `ephemeralUntil` 只存在于
// contracts 的 zod schema 和 mobile 的发布 payload 里，api-go 一次都没出现过：
// Post 没这个字段、createPostPayload 不解析、数据库没列、feed 没过期条件。于是
// 用户打开「24h 临时动态」发帖 → 客户端算好 now+24h 发上来 → Go 的 JSON 解码
// 静默忽略未知字段 → 客户端弹 toast「24h 动态已发布」→ 帖子**永久存在**。
//
// 用户正是因为相信它会消失才发那些内容，所以它带隐私含义：承诺了会过期却永久
// 留存，比一开始就没提供这个功能严重得多。

func newGhostClockService(t *testing.T, now time.Time) (*Service, *clock.Fixed) {
	t.Helper()
	fixed := clock.NewFixed(now)
	return NewWithRepositoryAndClock(NewMemoryRepository(), fixed), fixed
}

func listFeedBodies(t *testing.T, s *Service) []string {
	t.Helper()
	res := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"limit": 50}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts: %s (%+v)", res.Outcome, res.Error)
	}
	var body struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &body); err != nil {
		t.Fatalf("decode feed: %v", err)
	}
	out := make([]string, 0, len(body.Posts))
	for _, p := range body.Posts {
		out = append(out, p.Body)
	}
	return out
}

func containsBody(bodies []string, want string) bool {
	for _, b := range bodies {
		if strings.Contains(b, want) {
			return true
		}
	}
	return false
}

// 核心断言：发一条 24h 临时动态，到期前在 feed 里，到期后不在。
func TestEphemeralPostDisappearsFromFeedWhenExpired(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, clk := newGhostClockService(t, now)

	marker := "GHOST24H_EPHEMERAL_MARKER"
	e := envelopeFor("", "CreatePost", map[string]any{
		"body":           marker,
		"visibility":     "PUBLIC",
		"ephemeralUntil": now.Add(24 * time.Hour).Format(time.RFC3339),
	})
	if res := s.Handle(e); res.Outcome != "ACCEPTED" {
		t.Fatalf("create ephemeral post: %s (%+v)", res.Outcome, res.Error)
	}

	if !containsBody(listFeedBodies(t, s), marker) {
		t.Fatal("an unexpired 24h post must still be in the feed")
	}

	clk.Advance(25 * time.Hour)
	if containsBody(listFeedBodies(t, s), marker) {
		t.Error("an expired 24h post must be gone from the feed — this is the whole point of the feature")
	}
}

// 不传 ephemeralUntil = 永久动态。存量数据全是这个形态，不能被回归伤到。
func TestPostWithoutEphemeralUntilIsPermanent(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, clk := newGhostClockService(t, now)

	marker := "GHOST24H_PERMANENT_MARKER"
	if res := s.Handle(envelopeFor("", "CreatePost", map[string]any{"body": marker, "visibility": "PUBLIC"})); res.Outcome != "ACCEPTED" {
		t.Fatalf("create post: %s (%+v)", res.Outcome, res.Error)
	}
	clk.Advance(30 * 24 * time.Hour)
	if !containsBody(listFeedBodies(t, s), marker) {
		t.Error("a post with no ephemeralUntil must never expire")
	}
}

// 到期时刻必须是将来。静默忽略一个过去的值 = 用户以为临时、实际永久 —— 正是这次修的 bug。
func TestCreatePostRejectsPastEphemeralUntil(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)

	e := envelopeFor("", "CreatePost", map[string]any{
		"body":           "GHOST24H_PAST",
		"visibility":     "PUBLIC",
		"ephemeralUntil": now.Add(-time.Hour).Format(time.RFC3339),
	})
	res := s.Handle(e)
	if res.Outcome != "REJECTED" {
		t.Fatalf("a past ephemeralUntil must be rejected, got %s", res.Outcome)
	}
	if res.Error == nil || res.Error.ErrorCode != "INVALID_POST_EPHEMERAL_UNTIL" {
		t.Fatalf("want INVALID_POST_EPHEMERAL_UNTIL, got %+v", res.Error)
	}
	// 绝不能产出一条「发出即可见」的幽灵帖：客户端以为发布成功，用户翻遍 feed 找不到。
	if containsBody(listFeedBodies(t, s), "GHOST24H_PAST") {
		t.Error("rejected post must not have been published")
	}
}

// 格式不对要响亮地失败，不能像以前那样被 Go 的 JSON 解码静默丢掉。
func TestCreatePostRejectsMalformedEphemeralUntil(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)

	res := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"body":           "GHOST24H_MALFORMED",
		"visibility":     "PUBLIC",
		"ephemeralUntil": "tomorrow-ish",
	}))
	if res.Outcome != "REJECTED" {
		t.Fatalf("a malformed ephemeralUntil must be rejected, got %s", res.Outcome)
	}
}

// 按 ID 直取不能把已过期的临时动态捞回来 —— 收藏夹里躺着一条 24h 帖，过期后
// 再点进去应该「没有了」，而不是把它从后门复活。
func TestListPostsByIdsHidesExpiredEphemeralPost(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, clk := newGhostClockService(t, now)

	res := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"body":           "GHOST24H_BYIDS",
		"visibility":     "PUBLIC",
		"ephemeralUntil": now.Add(time.Hour).Format(time.RFC3339),
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", res.Outcome, res.Error)
	}
	postID := res.Aggregate.ID

	byID := func() int {
		t.Helper()
		r := s.Handle(envelopeFor("", "ListPostsByIds", map[string]any{"postIds": []string{postID}}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("ListPostsByIds: %s (%+v)", r.Outcome, r.Error)
		}
		var body struct {
			Posts []Post `json:"posts"`
		}
		if err := json.Unmarshal([]byte(r.OperationRef), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return len(body.Posts)
	}

	if got := byID(); got != 1 {
		t.Fatalf("unexpired post must be fetchable by id, got %d", got)
	}
	clk.Advance(2 * time.Hour)
	if got := byID(); got != 0 {
		t.Errorf("expired post must not be resurrected by id, got %d", got)
	}
}

// 到期时刻必须真的**落库**，不是只在 payload 里路过一趟。
// 修复前它连 Post 结构体上的字段都没有，服务端无处可存 —— 这条断言正是那个空洞。
func TestCreatePostPersistsEphemeralUntil(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	s, _ := newGhostClockService(t, now)
	until := now.Add(24 * time.Hour).UTC()

	res := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"body":           "GHOST24H_PERSISTED",
		"visibility":     "PUBLIC",
		"ephemeralUntil": until.Format(time.RFC3339),
	}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", res.Outcome, res.Error)
	}
	stored, err := s.repository.GetPost(context.Background(), res.Aggregate.ID)
	if err != nil {
		t.Fatalf("GetPost: %v", err)
	}
	if stored.EphemeralUntil == nil {
		t.Fatal("ephemeralUntil was not persisted — the field is only travelling on the wire again")
	}
	if !stored.EphemeralUntil.Equal(until) {
		t.Errorf("stored expiry = %s, want %s", stored.EphemeralUntil.UTC().Format(time.RFC3339), until.Format(time.RFC3339))
	}
}

// postIsExpired 的边界：nil 永不到期；正好等于 now 算已到期（不是「之后」）。
func TestPostIsExpiredBoundaries(t *testing.T) {
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	if postIsExpired(Post{}, now) {
		t.Error("a permanent post (nil) must never be expired")
	}
	exactly := now
	if !postIsExpired(Post{EphemeralUntil: &exactly}, now) {
		t.Error("expiry == now must count as expired (otherwise it lingers for a tick)")
	}
	future := now.Add(time.Second)
	if postIsExpired(Post{EphemeralUntil: &future}, now) {
		t.Error("a future expiry must not count as expired")
	}
}

// TWIN-SIGNALS-001: 曝光带停留毫秒入库（负数按 0 计），战绩读侧按作者聚合
// （impressions / viewers / totalWatchMs），只能查自己的帖子。
func TestPostImpressionStatsRoundTrip(t *testing.T) {
	s := New()
	create := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER", "body": "今晚西湖夜跑，有人一起吗", "visibility": "PUBLIC", "cityScope": "河内",
	}))
	if create.Outcome != "ACCEPTED" {
		t.Fatalf("create post: got %s (%+v)", create.Outcome, create.Error)
	}
	posts, err := s.repository.Snapshot(context.Background())
	if err != nil || len(posts) != 1 {
		t.Fatalf("snapshot = %d posts, err = %v", len(posts), err)
	}
	postID := posts[0].ID

	impress := func(actor string, watchMs int64) command.Result {
		e := envelopeFor("", "RecordPostImpression", map[string]any{"targetId": postID, "watchMs": watchMs})
		e.Actor = command.Actor{Type: "USER", ID: actor}
		return s.Handle(e)
	}
	if res := impress("viewer_9", 5200); res.Outcome != "ACCEPTED" {
		t.Fatalf("impression: got %s (%+v)", res.Outcome, res.Error)
	}
	// 负停留按 0 计，不拒绝整条事件。
	if res := impress("viewer_7", -5); res.Outcome != "ACCEPTED" {
		t.Fatalf("negative watch impression: got %s (%+v)", res.Outcome, res.Error)
	}

	statsRes := s.Handle(envelopeFor("", "ListPostImpressionStats", map[string]any{}))
	if statsRes.Outcome != "ACCEPTED" {
		t.Fatalf("stats: got %s (%+v)", statsRes.Outcome, statsRes.Error)
	}
	var payload struct {
		Stats []PostImpressionStats `json:"stats"`
	}
	if err := json.Unmarshal([]byte(statsRes.OperationRef), &payload); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if len(payload.Stats) != 1 {
		t.Fatalf("stats rows = %d, want 1", len(payload.Stats))
	}
	row := payload.Stats[0]
	if row.PostID != postID || row.Impressions != 2 || row.Viewers != 2 || row.TotalWatchMs != 5200 {
		t.Fatalf("row = %+v, want {post, 2 impressions, 2 viewers, 5200ms}", row)
	}

	// 别人的帖子数据不暴露。
	forbidden := s.Handle(envelopeFor("", "ListPostImpressionStats", map[string]any{"authorId": "user_other"}))
	if forbidden.Outcome != "REJECTED" {
		t.Fatalf("other author stats: got %s, want REJECTED (STATS_FORBIDDEN)", forbidden.Outcome)
	}

	// 没帖子的作者拿 []，不是 null。
	empty := envelopeFor("", "ListPostImpressionStats", map[string]any{})
	empty.Actor = command.Actor{Type: "USER", ID: "user_nothing"}
	emptyRes := s.Handle(empty)
	if emptyRes.Outcome != "ACCEPTED" {
		t.Fatalf("empty stats: got %s", emptyRes.Outcome)
	}
	if !strings.Contains(emptyRes.OperationRef, `"stats":[]`) {
		t.Fatalf("ref = %s, want empty stats array, never null", emptyRes.OperationRef)
	}
}

// TestProfileViewStatsRoundTrip: PROFILE-VISIT-001 —— 打开了多少次、多少个
//不同的人打开过；只能查自己的，别人的主页数据不暴露。
func TestProfileViewStatsRoundTrip(t *testing.T) {
	s := New()
	open := func(actor, ownerID string) command.Result {
		e := envelopeFor("", "RecordProfileOpen", map[string]any{"targetId": ownerID})
		e.Actor = command.Actor{Type: "USER", ID: actor}
		return s.Handle(e)
	}
	if res := open("viewer_1", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open 1: got %s (%+v)", res.Outcome, res.Error)
	}
	if res := open("viewer_2", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open 2: got %s (%+v)", res.Outcome, res.Error)
	}
	// 同一个人再看一次：opens 累加，uniqueViewers 不变。
	if res := open("viewer_1", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open 3 (repeat viewer): got %s (%+v)", res.Outcome, res.Error)
	}

	statsRes := s.Handle(envelopeFor("", "ListProfileViewStats", map[string]any{}))
	if statsRes.Outcome != "ACCEPTED" {
		t.Fatalf("stats: got %s (%+v)", statsRes.Outcome, statsRes.Error)
	}
	var payload struct {
		Opens         int64 `json:"opens"`
		UniqueViewers int64 `json:"uniqueViewers"`
	}
	if err := json.Unmarshal([]byte(statsRes.OperationRef), &payload); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if payload.Opens != 3 || payload.UniqueViewers != 2 {
		t.Fatalf("stats = %+v, want {opens: 3, uniqueViewers: 2}", payload)
	}

	// 别人的主页数据不暴露。
	forbidden := s.Handle(envelopeFor("", "ListProfileViewStats", map[string]any{"ownerId": "user_other"}))
	if forbidden.Outcome != "REJECTED" {
		t.Fatalf("other owner stats: got %s, want REJECTED (STATS_FORBIDDEN)", forbidden.Outcome)
	}

	// 没人看过的主页拿 {0, 0}，不是拒绝。
	nothing := envelopeFor("", "ListProfileViewStats", map[string]any{})
	nothing.Actor = command.Actor{Type: "USER", ID: "user_nobody_viewed"}
	nothingRes := s.Handle(nothing)
	if nothingRes.Outcome != "ACCEPTED" {
		t.Fatalf("empty stats: got %s", nothingRes.Outcome)
	}
	if !strings.Contains(nothingRes.OperationRef, `"opens":0`) || !strings.Contains(nothingRes.OperationRef, `"uniqueViewers":0`) {
		t.Fatalf("ref = %s, want opens=0 uniqueViewers=0", nothingRes.OperationRef)
	}
}

// TestProfileViewersRoundTrip: PROFILE-VIEWERS-001 —— 汇总数字("3 次访问")
// 回答不了"是谁"；这条测试锁住按人分组的明细：谁看了几次、最近一次是什么
// 时候，按最近访问时间倒序。
func TestProfileViewersRoundTrip(t *testing.T) {
	s := New()
	open := func(actor, ownerID string) command.Result {
		e := envelopeFor("", "RecordProfileOpen", map[string]any{"targetId": ownerID})
		e.Actor = command.Actor{Type: "USER", ID: actor}
		return s.Handle(e)
	}
	if res := open("viewer_1", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open by viewer_1: got %s (%+v)", res.Outcome, res.Error)
	}
	if res := open("viewer_2", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open by viewer_2: got %s (%+v)", res.Outcome, res.Error)
	}
	// viewer_1 看了两次——次数要按人累加，不是按事件平铺。
	if res := open("viewer_1", "user_001"); res.Outcome != "ACCEPTED" {
		t.Fatalf("open by viewer_1 (2nd): got %s (%+v)", res.Outcome, res.Error)
	}

	viewersRes := s.Handle(envelopeFor("", "ListProfileViewers", map[string]any{}))
	if viewersRes.Outcome != "ACCEPTED" {
		t.Fatalf("viewers: got %s (%+v)", viewersRes.Outcome, viewersRes.Error)
	}
	var payload struct {
		Viewers []ProfileViewerStat `json:"viewers"`
	}
	if err := json.Unmarshal([]byte(viewersRes.OperationRef), &payload); err != nil {
		t.Fatalf("decode viewers: %v", err)
	}
	if len(payload.Viewers) != 2 {
		t.Fatalf("viewers = %d, want 2 (one row per person, not per event)", len(payload.Viewers))
	}
	byActor := map[string]ProfileViewerStat{}
	for _, v := range payload.Viewers {
		byActor[v.ActorID] = v
	}
	if byActor["viewer_1"].Opens != 2 {
		t.Fatalf("viewer_1 opens = %d, want 2", byActor["viewer_1"].Opens)
	}
	if byActor["viewer_2"].Opens != 1 {
		t.Fatalf("viewer_2 opens = %d, want 1", byActor["viewer_2"].Opens)
	}

	// 别人的主页访客明细不暴露。
	forbidden := s.Handle(envelopeFor("", "ListProfileViewers", map[string]any{"ownerId": "user_other"}))
	if forbidden.Outcome != "REJECTED" {
		t.Fatalf("other owner viewers: got %s, want REJECTED (STATS_FORBIDDEN)", forbidden.Outcome)
	}

	// 没人看过的主页拿 []，不是拒绝。
	nothing := envelopeFor("", "ListProfileViewers", map[string]any{})
	nothing.Actor = command.Actor{Type: "USER", ID: "user_nobody_viewed_2"}
	nothingRes := s.Handle(nothing)
	if nothingRes.Outcome != "ACCEPTED" {
		t.Fatalf("empty viewers: got %s", nothingRes.Outcome)
	}
	if !strings.Contains(nothingRes.OperationRef, `"viewers":[]`) {
		t.Fatalf("ref = %s, want empty viewers array, never null", nothingRes.OperationRef)
	}
}

// TestMediaImpressionStatsRoundTrip: MEDIA-DWELL-001 —— 同一个帖子里的两张
// 照片，曝光数字必须能分开，不能都记成帖子一个总数。
func TestMediaImpressionStatsRoundTrip(t *testing.T) {
	s := New()
	create := s.Handle(envelopeFor("", "CreatePost", map[string]any{
		"authorType": "USER", "body": "西湖两张照片", "visibility": "PUBLIC", "cityScope": "河内",
		"mediaRefs": []map[string]any{
			{"mediaAssetId": "media_a", "mediaType": "IMAGE", "sortOrder": 0},
			{"mediaAssetId": "media_b", "mediaType": "IMAGE", "sortOrder": 1},
		},
	}))
	if create.Outcome != "ACCEPTED" {
		t.Fatalf("create post: got %s (%+v)", create.Outcome, create.Error)
	}
	posts, err := s.repository.Snapshot(context.Background())
	if err != nil || len(posts) != 1 {
		t.Fatalf("snapshot = %d posts, err = %v", len(posts), err)
	}
	postID := posts[0].ID

	impress := func(actor, mediaAssetID string, watchMs int64) command.Result {
		e := envelopeFor("", "RecordMediaImpression", map[string]any{"targetId": mediaAssetID, "watchMs": watchMs})
		e.Actor = command.Actor{Type: "USER", ID: actor}
		return s.Handle(e)
	}
	// media_a: 划过去，1 秒都没到。media_b: 停留久，两个人看过。
	if res := impress("viewer_1", "media_a", 800); res.Outcome != "ACCEPTED" {
		t.Fatalf("impress media_a: got %s (%+v)", res.Outcome, res.Error)
	}
	if res := impress("viewer_1", "media_b", 6500); res.Outcome != "ACCEPTED" {
		t.Fatalf("impress media_b (1): got %s (%+v)", res.Outcome, res.Error)
	}
	if res := impress("viewer_2", "media_b", 4200); res.Outcome != "ACCEPTED" {
		t.Fatalf("impress media_b (2): got %s (%+v)", res.Outcome, res.Error)
	}

	statsRes := s.Handle(envelopeFor("", "ListMediaImpressionStats", map[string]any{}))
	if statsRes.Outcome != "ACCEPTED" {
		t.Fatalf("stats: got %s (%+v)", statsRes.Outcome, statsRes.Error)
	}
	var payload struct {
		Stats []MediaImpressionStats `json:"stats"`
	}
	if err := json.Unmarshal([]byte(statsRes.OperationRef), &payload); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if len(payload.Stats) != 2 {
		t.Fatalf("stats rows = %d, want 2 (one per photo)", len(payload.Stats))
	}
	byMedia := map[string]MediaImpressionStats{}
	for _, row := range payload.Stats {
		if row.PostID != postID {
			t.Fatalf("row %+v has wrong postID, want %s", row, postID)
		}
		byMedia[row.MediaAssetID] = row
	}
	a, b := byMedia["media_a"], byMedia["media_b"]
	if a.Impressions != 1 || a.Viewers != 1 || a.TotalWatchMs != 800 {
		t.Fatalf("media_a = %+v, want {1 impression, 1 viewer, 800ms}", a)
	}
	if b.Impressions != 2 || b.Viewers != 2 || b.TotalWatchMs != 10700 {
		t.Fatalf("media_b = %+v, want {2 impressions, 2 viewers, 10700ms}", b)
	}

	// 别人帖子里的媒体数据不暴露。
	forbidden := s.Handle(envelopeFor("", "ListMediaImpressionStats", map[string]any{"authorId": "user_other"}))
	if forbidden.Outcome != "REJECTED" {
		t.Fatalf("other author stats: got %s, want REJECTED (STATS_FORBIDDEN)", forbidden.Outcome)
	}

	// VIEWER-ACTIVITY-001: viewer_1 看了两张（media_a 划过去 800ms，media_b
	// 停留 6500ms）——这个查询接的就是"这个人具体看了什么"，两张都要出现，
	// 各自的时长要对得上，不能混到一起。viewer_2 只看了 media_b，media_a
	// 完全不该出现在 viewer_2 的活动里。
	viewer1Activity := s.Handle(envelopeFor("", "ListMediaActivityForViewer", map[string]any{"viewerActorId": "viewer_1"}))
	if viewer1Activity.Outcome != "ACCEPTED" {
		t.Fatalf("viewer_1 activity: got %s (%+v)", viewer1Activity.Outcome, viewer1Activity.Error)
	}
	var activityPayload struct {
		Activity []ViewerMediaActivity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(viewer1Activity.OperationRef), &activityPayload); err != nil {
		t.Fatalf("decode activity: %v", err)
	}
	if len(activityPayload.Activity) != 2 {
		t.Fatalf("viewer_1 activity rows = %d, want 2 (media_a + media_b)", len(activityPayload.Activity))
	}
	byMediaV1 := map[string]ViewerMediaActivity{}
	for _, row := range activityPayload.Activity {
		if row.PostID != postID {
			t.Fatalf("row %+v has wrong postID, want %s", row, postID)
		}
		byMediaV1[row.MediaAssetID] = row
	}
	if byMediaV1["media_a"].Opens != 1 || byMediaV1["media_a"].TotalWatchMs != 800 {
		t.Fatalf("viewer_1 on media_a = %+v, want {1 open, 800ms}", byMediaV1["media_a"])
	}
	if byMediaV1["media_b"].Opens != 1 || byMediaV1["media_b"].TotalWatchMs != 6500 {
		t.Fatalf("viewer_1 on media_b = %+v, want {1 open, 6500ms}", byMediaV1["media_b"])
	}

	// viewer_2 只看过 media_b，活动列表里不该出现 media_a。
	viewer2Activity := s.Handle(envelopeFor("", "ListMediaActivityForViewer", map[string]any{"viewerActorId": "viewer_2"}))
	if viewer2Activity.Outcome != "ACCEPTED" {
		t.Fatalf("viewer_2 activity: got %s (%+v)", viewer2Activity.Outcome, viewer2Activity.Error)
	}
	var v2Payload struct {
		Activity []ViewerMediaActivity `json:"activity"`
	}
	if err := json.Unmarshal([]byte(viewer2Activity.OperationRef), &v2Payload); err != nil {
		t.Fatalf("decode activity: %v", err)
	}
	if len(v2Payload.Activity) != 1 || v2Payload.Activity[0].MediaAssetID != "media_b" {
		t.Fatalf("viewer_2 activity = %+v, want exactly [media_b]", v2Payload.Activity)
	}

	// viewerActorId 缺失必须拒绝——这个接口存在的意义就是"查这个人"，没
	// 给人就没有查询目标。
	missingViewer := s.Handle(envelopeFor("", "ListMediaActivityForViewer", map[string]any{}))
	if missingViewer.Outcome != "REJECTED" {
		t.Fatalf("missing viewerActorId: got %s, want REJECTED (INVALID_VIEWER_ACTOR_ID)", missingViewer.Outcome)
	}

	// 别人帖子上的访客活动不暴露。
	forbiddenActivity := s.Handle(envelopeFor("", "ListMediaActivityForViewer", map[string]any{"authorId": "user_other", "viewerActorId": "viewer_1"}))
	if forbiddenActivity.Outcome != "REJECTED" {
		t.Fatalf("other author activity: got %s, want REJECTED (STATS_FORBIDDEN)", forbiddenActivity.Outcome)
	}
}
