package main

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

type fakeProviders struct{ rows []insight.ProviderRow }

func (f fakeProviders) Providers(context.Context, int) ([]insight.ProviderRow, error) {
	return f.rows, nil
}
func (f fakeProviders) Provider(_ context.Context, id string) (insight.ProviderRow, bool, error) {
	for _, r := range f.rows {
		if r.UserID == id {
			return r, true, nil
		}
	}
	return insight.ProviderRow{}, false, nil
}
func (fakeProviders) TopInterests(context.Context, time.Time, int) ([]insight.InterestRow, error) {
	return nil, nil
}
func (fakeProviders) Sources(context.Context, time.Time) ([]insight.SourceCount, error) {
	return nil, nil
}
func (fakeProviders) DemandGap(context.Context, time.Time, int) (insight.DemandGap, error) {
	return insight.DemandGap{}, nil
}
func (fakeProviders) Segments(context.Context, time.Time, string, string, string) (insight.Segments, error) {
	return insight.Segments{}, nil
}

type fakeSignals map[string]matching.Signals

func (f fakeSignals) UserSignals(_ context.Context, ids []string) (map[string]matching.Signals, error) {
	return f, nil
}

func TestProviderListIsRankedByTheirOwnTrackRecordAndShowsTagCountsNotTags(t *testing.T) {
	ctx := context.Background()
	mem := tagging.NewMemory()
	now := time.Now().UTC()
	_ = mem.ReplaceUserTags(ctx, "veteran", []tagging.Tag{
		{Axis: tagging.AxisInterestTopic, Value: "摄影", Strength: .7, Confidence: .8, ExpiresAt: now.Add(time.Hour)},
		{Axis: tagging.AxisSkill, Value: "CITY_COMPANION", Strength: .9, Confidence: .9, ExpiresAt: now.Add(time.Hour)},
	})
	p := providerProfiles{
		providers: fakeProviders{rows: []insight.ProviderRow{{UserID: "rookie", Name: "新人"}, {UserID: "veteran", Name: "老手", Services: []string{"CITY_COMPANION"}}}},
		signals:   fakeSignals{"veteran": {Completed: 30, OnTime: 29, Rated: 20, SatisfactionSum: 19, WouldReuse: 18}, "rookie": {}},
		tags:      &tagging.Service{Store: mem},
	}
	list, err := p.List(ctx, 10)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: %v %v", list, err)
	}
	if list[0].UserID != "veteran" || list[0].Rank != 1 || list[1].Rank != 2 || list[0].Score <= list[1].Score {
		t.Fatalf("the proven provider ranks first: %+v", list)
	}
	if list[0].TagCount != 2 || list[1].TagCount != 0 || list[0].Completed != 30 {
		t.Fatalf("tag count (not tags) and completed orders are shown: %+v", list)
	}
	if one, _ := p.List(ctx, 1); len(one) != 1 {
		t.Fatal("limit applies")
	}

	res, found, err := p.Profile(ctx, "veteran")
	if err != nil || !found || res.Profile.TagCount != 2 || res.Profile.AxisCount != 2 || res.Profile.Summary == "" {
		t.Fatalf("profile groups the tags by axis: %+v found=%v err=%v", res, found, err)
	}
	for _, d := range res.Profile.Dimensions {
		for _, tg := range d.Tags {
			if tg.UserID != "" {
				t.Fatal("tags must not echo the user id")
			}
		}
	}
	if _, found, _ := p.Profile(ctx, "nobody"); found {
		t.Fatal("unknown provider is not found")
	}
}
