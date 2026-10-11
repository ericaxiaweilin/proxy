package localnet

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestHotUpdate_RetrievesPostsAfterCacheClear(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.SeedDemoPosts(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// First fetch — simulate app launch
	res1 := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内"}))
	if res1.Outcome != "ACCEPTED" {
		t.Fatalf("first ListFeedPosts failed: %v (%+v)", res1.Outcome, res1.Error)
	}
	// Second fetch after hot update — must still return posts (repo still has data)
	res2 := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内"}))
	if res2.Outcome != "ACCEPTED" {
		t.Fatalf("second ListFeedPosts after hot-update failed: %v (%+v)", res2.Outcome, res2.Error)
	}
	// If this fails, the P0 hot-update gate should block release
}

func TestListFeedPosts_CursorPagesAreStableAndComplete(t *testing.T) {
	// 每条帖子不同作者：这里钉的是游标稳定 / 完整；同作者折叠另见 FEED-AUTHOR-DISPERSE-001 的测试。
	repository := NewMemoryRepository()
	base := time.Date(2026, 9, 1, 1, 0, 0, 0, time.UTC)
	for i := 0; i < 7; i++ {
		id := string(rune('a' + i))
		if err := repository.UpsertPost(context.Background(), Post{
			ID: id, AuthorType: "USER", AuthorID: "author_" + id, Body: id,
			Visibility: "PUBLIC", Status: "PUBLISHED", CreatedAt: base.Add(-time.Duration(i) * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}
	service := NewWithRepository(repository)
	readPage := func(cursor string) struct {
		Posts      []Post `json:"posts"`
		NextCursor string `json:"nextCursor"`
		HasMore    bool   `json:"hasMore"`
	} {
		result := service.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"cursor": cursor, "limit": 3}))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("page rejected: %+v", result.Error)
		}
		var page struct {
			Posts      []Post `json:"posts"`
			NextCursor string `json:"nextCursor"`
			HasMore    bool   `json:"hasMore"`
		}
		if err := json.Unmarshal([]byte(result.OperationRef), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	first := readPage("")
	second := readPage(first.NextCursor)
	third := readPage(second.NextCursor)
	ids := []string{}
	for _, page := range [][]Post{first.Posts, second.Posts, third.Posts} {
		for _, post := range page {
			ids = append(ids, post.ID)
		}
	}
	if got, want := len(ids), 7; got != want {
		t.Fatalf("got %d posts across pages, want %d: %v", got, want, ids)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("duplicate post across cursor pages: %s", id)
		}
		seen[id] = true
	}
	if !first.HasMore || !second.HasMore || third.HasMore || third.NextCursor != "" {
		t.Fatalf("bad pagination flags: first=%+v second=%+v third=%+v", first, second, third)
	}
}

func TestListFeedPosts_ProtocolDrift_NextCursor(t *testing.T) {
	s := New()
	_ = s.SeedDemoPosts(context.Background())
	res := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内", "cursor": "abc", "limit": 2}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts should not reject cursor fields: %v (%+v)", res.Outcome, res.Error)
	}
}

// FEED-AUTHOR-DISPERSE-001：全局时间流里同一作者一页只露最新一条，其余计进 moreFromAuthor；
// 时间顺序不变；游标停在扫到的最后一条，跨页不重复、不漏（被折叠的也算扫过）。
// 「关注」tab 和搜索不打散。
func TestListFeedPosts_DispersesSameAuthorWithinAPage(t *testing.T) {
	repository := NewMemoryRepository()
	base := time.Date(2026, 9, 1, 1, 0, 0, 0, time.UTC)
	// 时间从新到旧：spam×3, b, spam, c, d
	authors := []string{"spam", "spam", "spam", "b", "spam", "c", "d"}
	for i, a := range authors {
		id := string(rune('a' + i))
		if err := repository.UpsertPost(context.Background(), Post{
			ID: id, AuthorType: "USER", AuthorID: a, Body: "hello " + id,
			Visibility: "PUBLIC", Status: "PUBLISHED", CreatedAt: base.Add(-time.Duration(i) * time.Minute),
		}); err != nil {
			t.Fatal(err)
		}
	}
	service := NewWithRepository(repository)
	type page struct {
		Posts      []Post `json:"posts"`
		NextCursor string `json:"nextCursor"`
		HasMore    bool   `json:"hasMore"`
	}
	read := func(payload map[string]any) page {
		result := service.Handle(envelopeFor("", "ListFeedPosts", payload))
		if result.Outcome != "ACCEPTED" {
			t.Fatalf("rejected: %+v", result.Error)
		}
		var p page
		if err := json.Unmarshal([]byte(result.OperationRef), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	first := read(map[string]any{"limit": 2})
	if len(first.Posts) != 2 || first.Posts[0].ID != "a" || first.Posts[0].MoreFromAuthor != 2 || first.Posts[1].ID != "d" {
		t.Fatalf("page 1 must be [a(+2 collapsed), d(author b)]: %+v", first.Posts)
	}
	if !first.HasMore || first.NextCursor == "" {
		t.Fatalf("page 1 must have more: %+v", first)
	}
	second := read(map[string]any{"limit": 2, "cursor": first.NextCursor})
	// 游标在 d 之后：e(spam) 是新的一页，可以再露一次；然后 f(c)。
	if len(second.Posts) != 2 || second.Posts[0].ID != "e" || second.Posts[1].ID != "f" {
		t.Fatalf("page 2 must continue right after the last scanned post: %+v", second.Posts)
	}
	third := read(map[string]any{"limit": 2, "cursor": second.NextCursor})
	if len(third.Posts) != 1 || third.Posts[0].ID != "g" || third.HasMore {
		t.Fatalf("page 3: %+v", third)
	}
	// 关注 tab 与搜索：用户点名要看的，不打散。
	if f := read(map[string]any{"limit": 10, "authorIds": []string{"spam"}}); len(f.Posts) != 4 {
		t.Fatalf("following tab must show all 4 spam posts, got %d", len(f.Posts))
	}
	if s := read(map[string]any{"limit": 10, "search": "hello"}); len(s.Posts) != 7 {
		t.Fatalf("search must not collapse results, got %d", len(s.Posts))
	}
}
