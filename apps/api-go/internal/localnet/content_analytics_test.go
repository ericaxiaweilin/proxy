package localnet

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
	"github.com/proxy-app/proxy-api/internal/command"
)

// CONTENT-ANALYTICS-001：用户侧只看近 30 天、只看聚合；逐人明细（谁 / 几秒 / 放大）只给运营；事件全量保存。

func analyticsFixture(t *testing.T) (*Service, *clock.Fixed, string, string) {
	t.Helper()
	fixed := clock.NewFixed(time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))
	s := NewWithRepositoryAndClock(NewMemoryRepository(), fixed)
	create := func(body, media string) string {
		r := s.Handle(envelopeFor("", "CreatePost", map[string]any{
			"authorType": "USER", "body": body, "visibility": "PUBLIC", "cityScope": "河内",
			"mediaRefs": []map[string]any{{"mediaAssetId": media, "mediaType": "IMAGE", "sortOrder": 0}},
		}))
		if r.Outcome != "ACCEPTED" {
			t.Fatalf("create: %+v", r.Error)
		}
		posts, _ := s.repository.Snapshot(context.Background())
		for _, p := range posts {
			if p.Body == body {
				return p.ID
			}
		}
		t.Fatalf("post %q not found", body)
		return ""
	}
	oldPost := create("两个月前的帖子", "media_old")
	fixed.Advance(60 * 24 * time.Hour)
	newPost := create("今天好忙", "media_new")
	return s, fixed, oldPost, newPost
}

func as(s *Service, actor, cmd string, payload map[string]any) command.Result {
	e := envelopeFor("", cmd, payload)
	e.Actor = command.Actor{Type: "USER", ID: actor}
	e.Principal = command.Principal{Type: "INDIVIDUAL", ID: actor}
	return s.Handle(e)
}

func TestUserStatsOnlyLoadTheLastMonthButEveryEventIsKept(t *testing.T) {
	s, _, oldPost, newPost := analyticsFixture(t)
	for _, viewer := range []string{"viewer_a", "viewer_b", "viewer_a"} {
		as(s, viewer, "RecordPostImpression", map[string]any{"targetId": newPost, "watchMs": 3000})
	}
	as(s, "viewer_c", "RecordPostImpression", map[string]any{"targetId": oldPost, "watchMs": 9000})

	var stats struct {
		Stats []PostImpressionStats `json:"stats"`
	}
	res := s.Handle(envelopeFor("", "ListPostImpressionStats", map[string]any{}))
	_ = json.Unmarshal([]byte(res.OperationRef), &stats)
	if len(stats.Stats) != 1 || stats.Stats[0].PostID != newPost || stats.Stats[0].Impressions != 3 || stats.Stats[0].Viewers != 2 {
		t.Fatalf("user side loads only posts from the last 30 days: %+v", stats.Stats)
	}
	var panel struct {
		Analytics ContentAnalytics `json:"analytics"`
	}
	res = s.Handle(envelopeFor("", "GetContentAnalytics", map[string]any{}))
	_ = json.Unmarshal([]byte(res.OperationRef), &panel)
	a := panel.Analytics
	if a.SinceDays != 30 || a.Posts != 1 || a.Impressions != 3 || a.UniqueViewers != 2 || a.TotalWatchMs != 9000 || a.TopPostID != newPost {
		t.Fatalf("panel is the 30-day aggregate: %+v", a)
	}
	// 服务端全量：两个月前那条的事件还在，运营能查。
	var audience struct {
		Audience []PostAudienceRow `json:"audience"`
	}
	res = s.Handle(envelopeFor("", "ListPostAudience", map[string]any{"postId": oldPost}))
	_ = json.Unmarshal([]byte(res.OperationRef), &audience)
	if len(audience.Audience) != 1 || audience.Audience[0].ActorID != "viewer_c" {
		t.Fatalf("the server keeps the full history for operations: %+v", audience.Audience)
	}
}

func TestOperationsAudienceHasDwellAndZoomPerPerson(t *testing.T) {
	s, _, _, newPost := analyticsFixture(t)
	as(s, "viewer_a", "RecordPostImpression", map[string]any{"targetId": newPost, "watchMs": 2000})
	as(s, "viewer_a", "RecordMediaImpression", map[string]any{"targetId": "media_new", "watchMs": 12000})
	as(s, "viewer_a", "RecordMediaZoom", map[string]any{"targetId": "media_new"})
	as(s, "viewer_a", "RecordMediaZoom", map[string]any{"targetId": "media_new"})
	as(s, "viewer_b", "RecordPostImpression", map[string]any{"targetId": newPost, "watchMs": 500})

	var audience struct {
		Audience []PostAudienceRow `json:"audience"`
	}
	res := s.Handle(envelopeFor("", "ListPostAudience", map[string]any{"postId": newPost}))
	if res.Outcome != "ACCEPTED" {
		t.Fatalf("audience: %+v", res.Error)
	}
	_ = json.Unmarshal([]byte(res.OperationRef), &audience)
	if len(audience.Audience) != 2 {
		t.Fatalf("two viewers: %+v", audience.Audience)
	}
	top := audience.Audience[0]
	if top.ActorID != "viewer_a" || top.PostImpressions != 1 || top.MediaOpens != 1 || top.TotalWatchMs != 14000 || top.Zooms != 2 {
		t.Fatalf("per-person detail must carry dwell and zooms, sorted by dwell: %+v", top)
	}
}
