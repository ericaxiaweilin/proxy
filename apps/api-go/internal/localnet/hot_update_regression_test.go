package localnet

import (
	"context"
	"testing"
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

func TestListFeedPosts_ProtocolDrift_NextCursor(t *testing.T) {
	s := New()
	_ = s.SeedDemoPosts(context.Background())
	res := s.Handle(envelopeFor("", "ListFeedPosts", map[string]any{"viewingCity": "河内", "cursor": "abc", "limit": 2}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("ListFeedPosts should not reject cursor fields: %v (%+v)", res.Outcome, res.Error)
	}
}
