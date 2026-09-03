package localnet

import (
	"context"
	"encoding/json"
	"testing"
	"time"

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
