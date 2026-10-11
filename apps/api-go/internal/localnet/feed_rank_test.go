package localnet

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

var rankNow = time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)

func rp(id, author string, ageHours float64) Post {
	return Post{ID: id, AuthorType: "USER", AuthorID: author, Body: id, Visibility: "PUBLIC", Status: "PUBLISHED",
		CreatedAt: rankNow.Add(-time.Duration(ageHours * float64(time.Hour)))}
}

func ids(posts []Post) []string {
	out := make([]string, len(posts))
	for i, p := range posts {
		out[i] = p.ID
	}
	return out
}

func indexOf(posts []Post, id string) int {
	for i, p := range posts {
		if p.ID == id {
			return i
		}
	}
	return -1
}

// FEED-RANK-001：互动好的帖子能压过刚发、没互动、但已经被看过很多次的帖子；关注加权；「少看这个人」降权。
func TestFeedRank_ScoreUsesEngagementFollowAndReduce(t *testing.T) {
	sig := FeedSignals{
		Impressions: map[string]int{"good": 20, "fresh": 40, "followed": 40, "reduced": 40},
		Likes:       map[string]int{"good": 5},
		Following:   map[string]bool{"f": true}, ReducedAuthors: map[string]bool{"r": true},
	}
	good, fresh := rankScore(rp("good", "a", 6), sig, rankNow), rankScore(rp("fresh", "b", 0), sig, rankNow)
	if !(good > fresh) {
		t.Fatalf("6h-old post with 5 likes / 20 impressions (%.4f) must beat a fresh post seen 40 times with no engagement (%.4f)", good, fresh)
	}
	followed, reduced := rankScore(rp("followed", "f", 0), sig, rankNow), rankScore(rp("reduced", "r", 0), sig, rankNow)
	if !(followed > fresh && reduced < fresh) {
		t.Fatalf("follow must boost and reduce-author must demote: followed=%.4f fresh=%.4f reduced=%.4f", followed, fresh, reduced)
	}
	sig.ReducedTopics = map[string]bool{"VENUE:cafe_1": true}
	topical := rp("fresh", "b", 0)
	topical.ContextRefs = []ContextRef{{ContextType: "GENERAL", ContextID: "日常"}, {ContextType: "VENUE", ContextID: "cafe_1"}}
	if !(rankScore(topical, sig, rankNow) < fresh) {
		t.Fatalf("reduce-topic must demote posts on that topic")
	}
	generalOnly := rp("fresh", "b", 0)
	generalOnly.ContextRefs = []ContextRef{{ContextType: "GENERAL", ContextID: "日常"}}
	if len(TopicKeys(generalOnly)) != 0 {
		t.Fatalf("GENERAL/日常 is the classifier fallback and must not count as a topic")
	}
}

// 新帖保底：曝光不足的新帖即使分数最低也会出现在保底位（每 8 位一个，从第 3 位起）。
func TestFeedRank_ExploreSlotGivesNewPostsExposure(t *testing.T) {
	pool := []Post{}
	sig := FeedSignals{Impressions: map[string]int{}, Likes: map[string]int{}}
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("hot%d", i)
		pool = append(pool, rp(id, "author_"+id, 1))
		sig.Impressions[id] = 100
		sig.Likes[id] = 50
	}
	pool = append(pool, rp("newbie", "newbie_author", 3)) // 曝光 0、3 小时：分数远低于 hot*
	sort.SliceStable(pool, func(i, j int) bool { return pool[i].CreatedAt.After(pool[j].CreatedAt) })
	out := rankFeed(pool, sig, "viewer", rankNow, 25)
	if got := indexOf(out, "newbie"); got != rankExploreFirstSlot {
		t.Fatalf("new low-exposure post must take the explore slot at %d, got %d: %v", rankExploreFirstSlot, got, ids(out))
	}
	if len(out) != len(pool) {
		t.Fatalf("ranking must not drop posts: %d of %d", len(out), len(pool))
	}
}

// 一页一作者：刷屏作者的帖子顺延到下一页而不是挤满第一页；读者自己的帖子不受限。
func TestFeedRank_OneAuthorPerPageViewerExempt(t *testing.T) {
	pool := []Post{}
	sig := FeedSignals{Impressions: map[string]int{}}
	for i := 0; i < 4; i++ {
		pool = append(pool, rp(fmt.Sprintf("spam%d", i), "spammer", float64(i)*0.1))
		pool = append(pool, rp(fmt.Sprintf("mine%d", i), "viewer", float64(i)*0.1))
	}
	// 别人的帖子要够多：打散是「有别人可放时不放同一作者」，全剩刷屏帖时只能放它。
	for i := 0; i < 12; i++ {
		pool = append(pool, rp(fmt.Sprintf("other%d", i), fmt.Sprintf("o%d", i), 5))
	}
	for _, p := range pool {
		sig.Impressions[p.ID] = 100 // 关掉保底位，只看打散
	}
	sort.SliceStable(pool, func(i, j int) bool { return pool[i].CreatedAt.After(pool[j].CreatedAt) })
	out := rankFeed(pool, sig, "viewer", rankNow, 5)
	for page := 0; page*5 < len(out); page++ {
		end := page*5 + 5
		if end > len(out) {
			end = len(out)
		}
		spam := 0
		for _, p := range out[page*5 : end] {
			if p.AuthorID == "spammer" {
				spam++
			}
		}
		if spam > 1 {
			t.Fatalf("page %d has %d spammer posts: %v", page, spam, ids(out))
		}
	}
	mine := 0
	for _, p := range out[:5] {
		if p.AuthorID == "viewer" {
			mine++
		}
	}
	if mine < 2 {
		t.Fatalf("the viewer's own recent posts are not limited to one per page: %v", ids(out[:5]))
	}
	again := rankFeed(pool, sig, "viewer", rankNow, 5)
	for i := range out {
		if out[i].ID != again[i].ID {
			t.Fatalf("ranking must be deterministic for the same input")
		}
	}
}

// ---- 走 listFeed 的整条路径 ----

type pagedMemory struct{ *MemoryRepository }

func (m pagedMemory) ListFeedPage(ctx context.Context, _ string, before time.Time, beforeID string, limit int) ([]Post, error) {
	all, err := m.Snapshot(ctx)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].CreatedAt.Equal(all[j].CreatedAt) {
			return all[i].ID < all[j].ID
		}
		return all[i].CreatedAt.After(all[j].CreatedAt)
	})
	out := []Post{}
	for _, p := range all {
		if !before.IsZero() && !(p.CreatedAt.Before(before) || (p.CreatedAt.Equal(before) && p.ID > beforeID)) {
			continue
		}
		out = append(out, p)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

type fixedSignals struct{ s FeedSignals }

func (f fixedSignals) FeedSignals(context.Context, string, []string) (FeedSignals, error) {
	return f.s, nil
}

type fixedClock struct{ t time.Time }

func (c fixedClock) Now() time.Time { return c.t }

func rankedService(t *testing.T, n int, sig FeedSignals) *Service {
	t.Helper()
	repo := NewMemoryRepository()
	for i := 0; i < n; i++ {
		p := rp(fmt.Sprintf("p%03d", i), fmt.Sprintf("a%03d", i), float64(i)*0.25)
		if err := repo.UpsertPost(context.Background(), p); err != nil {
			t.Fatal(err)
		}
	}
	s := NewWithRepository(pagedMemory{repo})
	s.clock = fixedClock{rankNow}
	return s.WithFeedSignals(fixedSignals{sig})
}

type feedPage struct {
	Posts      []Post `json:"posts"`
	NextCursor string `json:"nextCursor"`
	HasMore    bool   `json:"hasMore"`
	Ranked     bool   `json:"ranked"`
}

func readFeed(t *testing.T, s *Service, e command.Envelope) feedPage {
	t.Helper()
	r := s.Handle(e)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("rejected: %+v", r.Error)
	}
	var p feedPage
	if err := json.Unmarshal([]byte(r.OperationRef), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestFeedRank_SignedInViewerGetsRankedPagesAnonymousStaysChronological(t *testing.T) {
	// p010 很老但互动极好；其它都没互动。
	sig := FeedSignals{Impressions: map[string]int{}, Likes: map[string]int{"p010": 40}}
	for i := 0; i < 200; i++ {
		sig.Impressions[fmt.Sprintf("p%03d", i)] = 100
	}
	s := rankedService(t, 200, sig)

	anon := readFeed(t, s, command.Envelope{CommandType: "ListFeedPosts", Actor: command.Actor{Type: "PUBLIC", ID: "anonymous_reader"}, Payload: map[string]any{"limit": 10}})
	if anon.Ranked || anon.Posts[0].ID != "p000" {
		t.Fatalf("anonymous readers keep the chronological feed: ranked=%v first=%s", anon.Ranked, anon.Posts[0].ID)
	}

	first := readFeed(t, s, envelopeFor("", "ListFeedPosts", map[string]any{"limit": 10}))
	if !first.Ranked || first.Posts[0].ID != "p010" {
		t.Fatalf("signed-in viewer: the strongly-engaged post leads the ranked feed: ranked=%v first=%v", first.Ranked, ids(first.Posts))
	}
	// 翻完整个池（150）再接回时间倒序：不重复、不漏。
	seen := map[string]bool{}
	page, pages := first, 1
	for {
		for _, p := range page.Posts {
			if seen[p.ID] {
				t.Fatalf("duplicate %s on page %d", p.ID, pages)
			}
			seen[p.ID] = true
		}
		if !page.HasMore {
			break
		}
		page = readFeed(t, s, envelopeFor("", "ListFeedPosts", map[string]any{"limit": 10, "cursor": page.NextCursor}))
		pages++
		if pages > 40 {
			t.Fatal("pagination does not terminate")
		}
	}
	if len(seen) != 200 {
		t.Fatalf("ranked pool + chronological continuation must cover all 200 posts, got %d", len(seen))
	}
}
