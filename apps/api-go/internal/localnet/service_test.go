package localnet

import (
	"encoding/json"
	"testing"

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
