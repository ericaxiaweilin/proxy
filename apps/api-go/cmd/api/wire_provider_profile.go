package main

import (
	"context"
	"sort"
	"time"

	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// OPS-PROVIDER-PROFILE-001：小美画像的组合根。撮合分用无报价、无坐标的口径；标签读用途是 analytics。

type userSignalsReader interface {
	UserSignals(ctx context.Context, userIDs []string) (map[string]matching.Signals, error)
}

type providerProfiles struct {
	providers insight.Source
	signals   userSignalsReader
	tags      *tagging.Service
	now       func() time.Time
}

func (p providerProfiles) item(row insight.ProviderRow, sig matching.Signals, tagCount int) api.ProviderListItem {
	b := matching.CurrentTunables().Score(sig, 0, 0)
	return api.ProviderListItem{UserID: row.UserID, Name: row.Name, Handle: row.Handle, City: row.City, Services: row.Services,
		Score: b.Total, Completed: sig.Completed, TagCount: tagCount, Breakdown: b}
}

func (p providerProfiles) List(ctx context.Context, limit int) ([]api.ProviderListItem, error) {
	rows, err := p.providers.Providers(ctx, 500)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	byID := map[string]insight.ProviderRow{}
	for _, r := range rows {
		ids = append(ids, r.UserID)
		byID[r.UserID] = r
	}
	sigs, err := p.signals.UserSignals(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]api.ProviderListItem, 0, len(ids))
	for _, id := range ids {
		out = append(out, p.item(byID[id], sigs[id], len(p.tags.TagsFor(ctx, id, tagging.UseAnalytics))))
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].UserID < out[j].UserID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	for i := range out {
		out[i].Rank = i + 1
	}
	return out, nil
}

func (p providerProfiles) Profile(ctx context.Context, userID string) (api.ProviderProfileResult, bool, error) {
	row, found, err := p.providers.Provider(ctx, userID)
	if err != nil || !found {
		return api.ProviderProfileResult{}, false, err
	}
	sigs, err := p.signals.UserSignals(ctx, []string{userID})
	if err != nil {
		return api.ProviderProfileResult{}, false, err
	}
	tags := p.tags.TagsFor(ctx, userID, tagging.UseAnalytics)
	for i := range tags {
		tags[i].UserID = ""
	}
	return api.ProviderProfileResult{Provider: p.item(row, sigs[userID], len(tags)), Profile: tagging.BuildProfile("", tags, 8)}, true, nil
}
