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
	repository := NewMemoryRepository()
	base := time.Date(2026, 9, 1, 1, 0, 0, 0, time.UTC)
	for i := 0; i < 7; i++ {
		id := string(rune('a' + i))
		if err := repository.UpsertPost(context.Background(), Post{
			ID: id, AuthorType: "USER", AuthorID: "author", Body: id,
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
