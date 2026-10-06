package main

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/matching"
)

// MARKET-INVITE-001：邀谁、不邀谁、按什么顺序。

func publishFast(t *testing.T, svc *marketplace.Service, withLocation bool) string {
	t.Helper()
	payload := map[string]any{"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00",
		"location": "河内 · 西湖", "price": "800,000₫", "skills": "中文", "matchingMode": "FAST"}
	if withLocation {
		payload["lat"], payload["lng"] = 21.05, 105.82
	}
	r := marketCmd(svc, "PublishMarketOpportunity", "owner", payload)
	var body struct {
		Opportunity marketplace.Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(r.OperationRef), &body); err != nil {
		t.Fatalf("publish: %+v", r)
	}
	return body.Opportunity.ID
}

func TestInviterInvitesTheBestRankedNearbyPeopleOnly(t *testing.T) {
	ctx := context.Background()
	svc := marketplace.New()
	opp := publishFast(t, svc, true)
	marketCmd(svc, "ApplyToMarketOpportunity", "already", map[string]any{"opportunityId": opp, "quote": "800,000₫", "scope": "中文"})
	var rankedIDs []string
	inv := nearbyInviter{
		market: svc,
		nearby: func(context.Context, float64, float64, float64, int) ([]string, error) {
			// 离得最近的排在前面 —— 但邀请顺序看撮合排名，不看距离。
			return []string{"owner", "already", "invited_before", "near_flaky", "far_reliable", "mid"}, nil
		},
		rank: func(_ context.Context, ids []string, _, _ *float64) ([]matching.Ranked, error) {
			rankedIDs = ids
			order := map[string]int{"far_reliable": 0, "mid": 1, "near_flaky": 2}
			out := make([]matching.Ranked, len(ids))
			for _, id := range ids {
				out[order[id]] = matching.Ranked{AgentID: id}
			}
			return out, nil
		},
	}
	run := dispatch.Run{TaskID: opp, RequesterID: "owner"}
	got, skip, err := inv.Invite(ctx, run, map[string]bool{"owner": true, "invited_before": true}, 2)
	if err != nil || skip != "" {
		t.Fatalf("invite: %v %q", err, skip)
	}
	if fmt.Sprint(rankedIDs) != "[near_flaky far_reliable mid]" {
		t.Fatalf("the poster, someone who already applied and someone invited before are never considered: %v", rankedIDs)
	}
	if fmt.Sprint(got) != "[far_reliable mid]" {
		t.Fatalf("invites follow the matching rank, capped at the batch size: %v", got)
	}

	noLoc := publishFast(t, svc, false)
	if _, skip, _ := inv.Invite(ctx, dispatch.Run{TaskID: noLoc, RequesterID: "owner"}, nil, 5); skip != "opportunity_has_no_location" {
		t.Fatalf("without the opportunity's coordinates there is no 'nearby': %q", skip)
	}
}

func TestFastOpportunityWithNobodyApplyingInvitesAfterTenMinutes(t *testing.T) {
	ctx := context.Background()
	svc := marketplace.New()
	now := time.Now().UTC()
	repo := dispatch.NewMemory()
	engine := &dispatch.Engine{Repo: repo, Offers: kindRouter{}, Now: func() time.Time { return now },
		NewID: func() string { return "dr_1" }}
	wireMarketDispatch(engine, svc)
	engine.Inviter = nearbyInviter{
		market: svc,
		nearby: func(context.Context, float64, float64, float64, int) ([]string, error) {
			return []string{"p1", "p2"}, nil
		},
		rank: func(_ context.Context, ids []string, _, _ *float64) ([]matching.Ranked, error) {
			out := []matching.Ranked{}
			for _, id := range ids {
				out = append(out, matching.Ranked{AgentID: id})
			}
			return out, nil
		},
	}
	opp := publishFast(t, svc, true)
	_, _ = engine.Tick(ctx)
	now = now.Add(11 * time.Minute)
	if _, err := engine.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	invited := []string{}
	for _, ev := range repo.Events() {
		if ev.EventType == "MarketOpportunityInvited" && ev.Payload["opportunityId"] == opp {
			invited = append(invited, ev.Payload["notifyPrincipalId"].(string))
		}
	}
	if fmt.Sprint(invited) != "[p1 p2]" {
		t.Fatalf("10 minutes with no applicants ⇒ nearby people are invited: %v", invited)
	}
}
