package localnet

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// SCENE-PHOTO-WALL-001：场景照片墙只收「发帖时标记了这个场景、带图、对看的人可见」的帖子。

func TestListPostsAtSceneOnlyTaggedVisiblePostsWithMedia(t *testing.T) {
	s := New()
	now := time.Now().UTC()
	tag := []ContextRef{{ContextType: ContextRealityScene, ContextID: "threebeans", RelationType: "FEATURED_AT"}}
	media := []PostMediaRef{{MediaAssetID: "ma_1", SortOrder: 0}}
	past := now.Add(-time.Hour)
	seed := []Post{
		{ID: "wall_ok", AuthorID: "user_002", Visibility: "PUBLIC", Status: "PUBLISHED", MediaRefs: media, ContextRefs: tag, CreatedAt: now},
		{ID: "wall_mine", AuthorID: "user_001", Visibility: "PUBLIC", Status: "PUBLISHED", MediaRefs: media, ContextRefs: tag, CreatedAt: now.Add(-time.Minute)},
		{ID: "wall_no_media", AuthorID: "user_002", Visibility: "PUBLIC", Status: "PUBLISHED", ContextRefs: tag, CreatedAt: now},
		{ID: "wall_other_scene", AuthorID: "user_002", Visibility: "PUBLIC", Status: "PUBLISHED", MediaRefs: media,
			ContextRefs: []ContextRef{{ContextType: ContextRealityScene, ContextID: "longbien"}}, CreatedAt: now},
		{ID: "wall_untagged", AuthorID: "user_002", Visibility: "PUBLIC", Status: "PUBLISHED", MediaRefs: media, CreatedAt: now},
		{ID: "wall_hidden", AuthorID: "user_002", Visibility: "PUBLIC", Status: "HIDDEN_TEST_DATA", MediaRefs: media, ContextRefs: tag, CreatedAt: now},
		{ID: "wall_followers", AuthorID: "user_002", Visibility: "FOLLOWERS", Status: "PUBLISHED", MediaRefs: media, ContextRefs: tag, CreatedAt: now},
		{ID: "wall_expired", AuthorID: "user_002", Visibility: "PUBLIC", Status: "PUBLISHED", MediaRefs: media, ContextRefs: tag, CreatedAt: now, EphemeralUntil: &past},
	}
	for _, p := range seed {
		p.AuthorType = "USER"
		if err := s.repository.UpsertPost(context.Background(), p); err != nil {
			t.Fatalf("seed %s: %v", p.ID, err)
		}
	}
	result := s.Handle(actorEnvelope("user_001", "ListPostsAtScene", map[string]any{"sceneId": "threebeans"}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("outcome=%s err=%+v", result.Outcome, result.Error)
	}
	var decoded struct {
		Posts []Post `json:"posts"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := postIDs(decoded.Posts)
	if len(got) != 2 || got[0] != "wall_ok" || got[1] != "wall_mine" {
		t.Fatalf("照片墙应只有标记了本场景、带图、可见的帖子（含自己的），got %v", got)
	}
}

func TestListPostsAtSceneRejectsMissingScene(t *testing.T) {
	s := New()
	result := s.Handle(actorEnvelope("user_001", "ListPostsAtScene", map[string]any{"sceneId": "  "}))
	if result.Outcome == "ACCEPTED" {
		t.Fatal("没有场景 id 必须拒绝，不能退化成返回全部帖子")
	}
}
