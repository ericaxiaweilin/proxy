package localnet

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// PROFILE-SAVED-001 — 收藏夹只存 postId，必须能按 ID 直接取回帖子。
//
// 这组测试钉住「按 ID 取帖子」这条读法。之前客户端只能从动态流里「捞」：
// 默认一页 25 条，收藏一条不在这一页里的帖子就等于丢了，用户会以为收藏被吞。
// 可见性口径必须与动态流完全一致，并且 fail-closed —— 不能因为「谁收藏了」
// 就把别人的 followers-only 帖子漏出来。

func actorEnvelope(actorID, commandType string, payload map[string]any) command.Envelope {
	env := envelopeFor("", commandType, payload)
	env.Actor = command.Actor{Type: "USER", ID: actorID}
	env.Principal = command.Principal{Type: "INDIVIDUAL", ID: actorID}
	return env
}

func createPostAs(t *testing.T, s *Service, actorID, body, visibility string) string {
	t.Helper()
	result := s.Handle(actorEnvelope(actorID, "CreatePost", map[string]any{
		"authorType": "USER", "body": body, "visibility": visibility,
	}))
	if result.Outcome != "ACCEPTED" || result.Aggregate == nil {
		t.Fatalf("CreatePost(%q/%s): outcome=%s err=%+v", body, visibility, result.Outcome, result.Error)
	}
	return result.Aggregate.ID
}

func listPostsByIDs(t *testing.T, s *Service, actorID string, ids []string) []Post {
	t.Helper()
	result := s.Handle(actorEnvelope(actorID, "ListPostsByIds", map[string]any{"postIds": ids}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("ListPostsByIds: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	var payload struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	return payload.Posts
}

func TestListPostsByIdsReturnsRequestedPostsInOrder(t *testing.T) {
	s := New()
	first := createPostAs(t, s, "user_001", "第一条", "PUBLIC")
	second := createPostAs(t, s, "user_001", "第二条", "PUBLIC")

	posts := listPostsByIDs(t, s, "user_001", []string{second, first})
	if len(posts) != 2 {
		t.Fatalf("expected 2 posts, got %d", len(posts))
	}
	// 收藏夹有自己的顺序（收藏时间倒序），服务端不能替用户重排。
	if posts[0].ID != second || posts[1].ID != first {
		t.Fatalf("request order must be preserved, got %q then %q", posts[0].ID, posts[1].ID)
	}
}

func TestListPostsByIdsSkipsUnknownIDsInsteadOfFailing(t *testing.T) {
	s := New()
	known := createPostAs(t, s, "user_001", "还在的帖子", "PUBLIC")

	// 帖子被删掉之后，收藏夹里还留着 id —— 不能因此整条读取失败。
	posts := listPostsByIDs(t, s, "user_001", []string{known, "post_deleted_forever"})
	if len(posts) != 1 || posts[0].ID != known {
		t.Fatalf("unknown ids must be skipped, got %+v", posts)
	}
}

func TestListPostsByIdsDeduplicatesAndTrimsIDs(t *testing.T) {
	s := New()
	id := createPostAs(t, s, "user_001", "只此一条", "PUBLIC")

	posts := listPostsByIDs(t, s, "user_001", []string{id, "  " + id + "  ", id, "", "   "})
	if len(posts) != 1 || posts[0].ID != id {
		t.Fatalf("duplicate/blank ids must collapse to one post, got %d", len(posts))
	}
}

func TestListPostsByIdsKeepsVisibilityFailClosed(t *testing.T) {
	s := New()
	followersOnly := createPostAs(t, s, "user_002", "只给关注者看的", "FOLLOWERS")

	// 作者本人当然能看到自己的帖子。
	if own := listPostsByIDs(t, s, "user_002", []string{followersOnly}); len(own) != 1 {
		t.Fatalf("the author must still see their own followers-only post, got %d", len(own))
	}
	// 别人不行 —— 关注图谱授权还没做，不能因为「谁收藏了」就漏出来。
	if leaked := listPostsByIDs(t, s, "user_001", []string{followersOnly}); len(leaked) != 0 {
		t.Fatalf("followers-only post leaked to a non-author: %+v", leaked)
	}
}

func TestListPostsByIdsReturnsEmptyArrayNotNull(t *testing.T) {
	s := New()
	result := s.Handle(actorEnvelope("user_001", "ListPostsByIds", map[string]any{"postIds": []string{}}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("empty request must still be accepted, got %s", result.Outcome)
	}
	// 客户端 zod fail-closed：null 会让整个读模型解析失败。
	if !strings.Contains(result.OperationRef, `"posts":[]`) {
		t.Fatalf("posts must serialise as [] not null: %s", result.OperationRef)
	}
}

func TestListPostsByIdsCapsTheBatch(t *testing.T) {
	s := New()
	ids := make([]string, 0, 150)
	for i := 0; i < 150; i++ {
		ids = append(ids, "post_missing_"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	// 超量请求不能被当成一次无界查询：要么拒绝，要么截断，不能照单全收。
	result := s.Handle(actorEnvelope("user_001", "ListPostsByIds", map[string]any{"postIds": ids}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("oversized batch must be handled, got %s (%+v)", result.Outcome, result.Error)
	}
	var payload struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &payload); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	if len(payload.Posts) > 100 {
		t.Fatalf("batch must be capped at 100, got %d", len(payload.Posts))
	}
}
