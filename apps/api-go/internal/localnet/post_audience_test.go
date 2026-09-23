package localnet

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// AI-TWIN-POST-AUDIENCE-001 — 帖子受众白名单（TARGETED visibility）。
//
// 用户 2026-09-21 提供的原型（小美 · AI 分身「受众调度版」）要求 AI 分身
// 能把一条帖子只投给指定的几位好友，"看不到的人，就不会出现在他们的信息
// 流里"。这组测试钉住 postVisibleTo / loadTargetedAudience / attachAudience
// Targets 这套读侧逻辑：author 与白名单里的人能看到，白名单外的人（包括
// 匿名/其他任意账号）看不到，且白名单本身不会泄露给非作者的查看者。

func createTargetedPostAs(t *testing.T, s *Service, actorID, body string, targets []string) command.Result {
	t.Helper()
	return s.Handle(actorEnvelope(actorID, "CreatePost", map[string]any{
		"authorType":        "USER",
		"body":              body,
		"visibility":        "TARGETED",
		"audienceTargetIds": targets,
	}))
}

func TestCreateTargetedPostRequiresNonEmptyAudience(t *testing.T) {
	s := New()
	result := createTargetedPostAs(t, s, "user_001", "空受众", nil)
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "POST_AUDIENCE_EMPTY" {
		t.Fatalf("expected POST_AUDIENCE_EMPTY, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
}

// 只把自己填进白名单等于没填——作者本人隐式可见，服务端会把它滤掉；
// 结果仍然是"空受众"，必须一样拒绝，而不是悄悄建出一条谁都看不到的帖子。
func TestCreateTargetedPostRejectsAudienceOfOnlyTheAuthor(t *testing.T) {
	s := New()
	result := createTargetedPostAs(t, s, "user_001", "只填了自己", []string{"user_001"})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "POST_AUDIENCE_EMPTY" {
		t.Fatalf("expected POST_AUDIENCE_EMPTY, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
}

func TestCreatePostRejectsAudienceOnNonTargetedVisibility(t *testing.T) {
	s := New()
	result := s.Handle(actorEnvelope("user_001", "CreatePost", map[string]any{
		"authorType":        "USER",
		"body":              "受众和可见度对不上",
		"visibility":        "PUBLIC",
		"audienceTargetIds": []string{"user_002"},
	}))
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "POST_AUDIENCE_REQUIRES_TARGETED" {
		t.Fatalf("expected POST_AUDIENCE_REQUIRES_TARGETED, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
}

func TestTargetedPostVisibleToAuthorAndAudienceOnly(t *testing.T) {
	s := New()
	result := createTargetedPostAs(t, s, "user_001", "只给 Alex 和 Tom", []string{"user_002", "user_003"})
	if result.Outcome != "ACCEPTED" || result.Aggregate == nil {
		t.Fatalf("CreatePost TARGETED: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	postID := result.Aggregate.ID

	// 作者本人：ListPostsByIds 与 ListFeedPosts 都能看到。
	if own := listPostsByIDs(t, s, "user_001", []string{postID}); len(own) != 1 {
		t.Fatalf("author must see their own TARGETED post via ListPostsByIds, got %d", len(own))
	}
	if feed := listFeedBodies(t, s); len(feed) != 1 {
		t.Fatalf("author's own feed must include their TARGETED post, got %v", feed)
	}

	// 白名单里的人：能看到。
	if visible := listPostsByIDs(t, s, "user_002", []string{postID}); len(visible) != 1 {
		t.Fatalf("targeted viewer must see the post via ListPostsByIds, got %d", len(visible))
	}

	// 白名单外的任意账号（包括另一个真实存在的账号）：看不到——无论是按 ID
	// 直取还是走 feed，都不能漏出来。
	if leaked := listPostsByIDs(t, s, "user_999", []string{postID}); len(leaked) != 0 {
		t.Fatalf("TARGETED post leaked to a non-audience viewer via ListPostsByIds: %+v", leaked)
	}
	feedAsOutsider := s.Handle(actorEnvelope("user_999", "ListFeedPosts", map[string]any{"limit": 50}))
	if feedAsOutsider.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts: %s", feedAsOutsider.Outcome)
	}
	var outsiderBody struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(feedAsOutsider.OperationRef), &outsiderBody); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	for _, p := range outsiderBody.Posts {
		if p.ID == postID {
			t.Fatalf("TARGETED post leaked into a non-audience viewer's feed")
		}
	}
}

// 帖文编排的受众条要真的显示"投给了谁"——但只有作者本人能看到完整名单；
// 被投放的人自己读回这条帖子时，不能从里面看出"还有谁也被投放了"。
func TestTargetedPostAudienceRosterOnlyVisibleToAuthor(t *testing.T) {
	s := New()
	result := createTargetedPostAs(t, s, "user_001", "受众条测试", []string{"user_002", "user_003"})
	if result.Outcome != "ACCEPTED" || result.Aggregate == nil {
		t.Fatalf("CreatePost TARGETED: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	postID := result.Aggregate.ID

	authorView := listPostsByIDs(t, s, "user_001", []string{postID})
	if len(authorView) != 1 {
		t.Fatalf("author must see the post, got %d", len(authorView))
	}
	roster := authorView[0].AudienceTargetIDs
	if len(roster) != 2 {
		t.Fatalf("author must see the full audience roster, got %v", roster)
	}

	targetView := listPostsByIDs(t, s, "user_002", []string{postID})
	if len(targetView) != 1 {
		t.Fatalf("targeted viewer must see the post, got %d", len(targetView))
	}
	if len(targetView[0].AudienceTargetIDs) != 0 {
		t.Fatalf("a targeted (non-author) viewer must not see the audience roster, got %v", targetView[0].AudienceTargetIDs)
	}
}

// AI-CLUSTER-BOUNDARY-001 / TAGGED tab：被提到的人如果不在受众里，同样不该
// 看到——TARGETED 不是"关注者可见"的软化版，是硬白名单。
func TestTargetedPostExcludedFromMentionsForNonAudienceViewer(t *testing.T) {
	s := New()
	result := createTargetedPostAs(t, s, "user_001", "@charlie 这条不给你看", []string{"user_002"})
	if result.Outcome != "ACCEPTED" || result.Aggregate == nil {
		t.Fatalf("CreatePost TARGETED: outcome=%s err=%+v", result.Outcome, result.Error)
	}

	res := s.Handle(actorEnvelope("charlie", "ListPostsMentioning", map[string]any{"handle": "@charlie"}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("ListPostsMentioning: %s (%+v)", res.Outcome, res.Error)
	}
	var payload struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(res.OperationRef), &payload); err != nil {
		t.Fatalf("decode operationRef: %v", err)
	}
	if len(payload.Posts) != 0 {
		t.Fatalf("TARGETED post mentioning a non-audience account must not surface in their TAGGED tab, got %+v", payload.Posts)
	}
}

// AI-TWIN-POST-AUDIENCE-003 — 已发布帖子的受众开关（帖文编排的"编辑"就是
// 切这个开关，不是另建一条帖子）。

func updateAudience(t *testing.T, s *Service, actorID, postID, visibility string, targets []string) command.Result {
	t.Helper()
	return s.Handle(actorEnvelope(actorID, "UpdatePostAudience", map[string]any{
		"postId":            postID,
		"visibility":        visibility,
		"audienceTargetIds": targets,
	}))
}

func TestUpdatePostAudienceTogglesPublicToTargeted(t *testing.T) {
	s := New()
	postID := createPostAs(t, s, "user_001", "本来公开", "PUBLIC")

	// 切换前任何人都看得到。
	if before := listPostsByIDs(t, s, "user_999", []string{postID}); len(before) != 1 {
		t.Fatalf("expected post visible before toggling, got %d", len(before))
	}

	result := updateAudience(t, s, "user_001", postID, "TARGETED", []string{"user_002"})
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("UpdatePostAudience: outcome=%s err=%+v", result.Outcome, result.Error)
	}

	if leaked := listPostsByIDs(t, s, "user_999", []string{postID}); len(leaked) != 0 {
		t.Fatalf("post must stop being visible to a non-target after toggling to TARGETED, got %+v", leaked)
	}
	if visible := listPostsByIDs(t, s, "user_002", []string{postID}); len(visible) != 1 {
		t.Fatalf("newly targeted friend must see the post, got %d", len(visible))
	}
	if own := listPostsByIDs(t, s, "user_001", []string{postID}); len(own) != 1 || own[0].Visibility != "TARGETED" {
		t.Fatalf("author must see the post with updated visibility, got %+v", own)
	}
}

func TestUpdatePostAudienceTogglesTargetedBackToPublicAndClearsOldTargets(t *testing.T) {
	s := New()
	created := createTargetedPostAs(t, s, "user_001", "先只给 Alex", []string{"user_002"})
	if created.Outcome != "ACCEPTED" || created.Aggregate == nil {
		t.Fatalf("CreatePost TARGETED: outcome=%s err=%+v", created.Outcome, created.Error)
	}
	postID := created.Aggregate.ID

	result := updateAudience(t, s, "user_001", postID, "PUBLIC", nil)
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("UpdatePostAudience to PUBLIC: outcome=%s err=%+v", result.Outcome, result.Error)
	}
	if visible := listPostsByIDs(t, s, "user_999", []string{postID}); len(visible) != 1 {
		t.Fatalf("post must be visible to everyone after toggling to PUBLIC, got %d", len(visible))
	}

	// 再切回 TARGETED 但故意不传新名单——必须拒绝，不能悄悄复活上一次的 Alex。
	empty := updateAudience(t, s, "user_001", postID, "TARGETED", nil)
	if empty.Outcome != "REJECTED" || empty.Error == nil || empty.Error.ErrorCode != "POST_AUDIENCE_EMPTY" {
		t.Fatalf("expected POST_AUDIENCE_EMPTY when re-targeting without a fresh list, got outcome=%s err=%+v", empty.Outcome, empty.Error)
	}
}

func TestUpdatePostAudienceRejectsNonAuthor(t *testing.T) {
	s := New()
	postID := createPostAs(t, s, "user_001", "别人的帖子", "PUBLIC")

	result := updateAudience(t, s, "user_002", postID, "TARGETED", []string{"user_003"})
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "NOT_POST_AUTHOR" {
		t.Fatalf("expected NOT_POST_AUTHOR, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
	// 帖子本身必须原封不动——公开可见，没有被谁的编辑请求悄悄改掉。
	if visible := listPostsByIDs(t, s, "user_999", []string{postID}); len(visible) != 1 {
		t.Fatalf("post must remain untouched (still PUBLIC) after a rejected non-author edit, got %d", len(visible))
	}
}

func TestUpdatePostAudienceRejectsUnknownPost(t *testing.T) {
	s := New()
	result := updateAudience(t, s, "user_001", "post_does_not_exist", "PUBLIC", nil)
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "POST_NOT_FOUND" {
		t.Fatalf("expected POST_NOT_FOUND, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
}

func TestUpdatePostAudienceRejectsNonSwitchVisibility(t *testing.T) {
	s := New()
	postID := createPostAs(t, s, "user_001", "测试非法档位", "PUBLIC")
	result := updateAudience(t, s, "user_001", postID, "FOLLOWERS", nil)
	if result.Outcome != "REJECTED" || result.Error == nil || result.Error.ErrorCode != "INVALID_POST_VISIBILITY" {
		t.Fatalf("expected INVALID_POST_VISIBILITY, got outcome=%s err=%+v", result.Outcome, result.Error)
	}
}
