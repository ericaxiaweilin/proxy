package tagging

import (
	"context"
	"testing"
	"time"
)

func TestRecomputeClearsTagsOfPeopleWhoNoLongerHaveEvidence(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	m.Evidence["alice"] = Evidence{Signals: []Signal{{Axis: AxisInterestTopic, Value: "咖啡", Weight: 3, N: 3, First: ago(time.Hour), Last: ago(time.Hour)}}}
	n, err := Recompute(ctx, m, now)
	if err != nil || n != 1 {
		t.Fatalf("first pass: n=%d err=%v", n, err)
	}
	tags, _ := m.TagsOf(ctx, "alice")
	if len(tags) != 1 || tags[0].Axis != AxisInterestTopic {
		t.Fatalf("alice should have one interest tag: %v", tags)
	}
	// 同意撤回：证据过滤之后她什么都没有了。她不在 LoadEvidence 的结果里，但她还有旧标签。
	delete(m.Evidence, "alice")
	n, err = Recompute(ctx, m, now)
	if err != nil || n != 0 {
		t.Fatalf("second pass: n=%d err=%v", n, err)
	}
	if tags, _ := m.TagsOf(ctx, "alice"); len(tags) != 0 {
		t.Fatalf("withdrawn evidence must clear her tags, still have %v", tags)
	}
}

func TestServiceReadFiltersByUseAndSwallowsStoreFailure(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	_ = m.ReplaceUserTags(ctx, "u", []Tag{{Axis: AxisInterestTopic, Value: "咖啡", ExpiresAt: now.Add(time.Hour)}})
	svc := &Service{Store: m, Now: func() time.Time { return now }}
	if got := svc.TagsFor(ctx, "u", UseMatching); len(got) != 1 {
		t.Fatalf("matching may read it: %v", got)
	}
	if got := svc.TagsFor(ctx, "u", Use("merchant_targeting")); len(got) != 0 {
		t.Fatalf("merchant targeting must read nothing: %v", got)
	}
	var nilSvc *Service
	if nilSvc.TagsFor(ctx, "u", UseMatching) != nil {
		t.Fatal("a missing tag layer reads as no tags, not a crash")
	}
}

func TestStatsCountPeopleAndSkipExpiredTags(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	_ = m.ReplaceUserTags(ctx, "a", []Tag{
		{Axis: AxisInterestTopic, Value: "咖啡", Confidence: 0.8, ExpiresAt: now.Add(time.Hour), ComputedAt: now},
		{Axis: AxisInterestTopic, Value: "摄影", Confidence: 0.4, ExpiresAt: now.Add(-time.Hour), ComputedAt: now},
	})
	_ = m.ReplaceUserTags(ctx, "b", []Tag{{Axis: AxisInterestTopic, Value: "咖啡", Confidence: 0.6, ExpiresAt: now.Add(time.Hour), ComputedAt: now}})
	st, _ := m.Stats(ctx, now)
	if st.UsersWithTags != 2 || st.TotalTags != 2 {
		t.Fatalf("expired tags must not count: %+v", st)
	}
	var scene AxisStat
	for _, a := range st.Axes {
		if a.Axis == AxisInterestTopic {
			scene = a
		}
	}
	if scene.Users != 2 || scene.AvgConfidence != 0.7 || len(scene.Top) != 1 || scene.Top[0].Value != "咖啡" || scene.Top[0].Users != 2 {
		t.Fatalf("scene axis stat: %+v", scene)
	}
	if len(st.Axes) != len(Axes()) {
		t.Fatal("every registered axis must be listed, including the empty ones")
	}
}
