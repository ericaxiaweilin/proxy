package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/tagging"
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
		market:    svc,
		permitted: everyoneOptedIn,
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
		market:    svc,
		permitted: everyoneOptedIn,
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

// 2026-10-08 仓库审核：没开通接单的人不能被平台邀进别人的单里。
func TestInvitesOnlyReachPeopleWhoOptedIntoOrders(t *testing.T) {
	permitted := func(_ context.Context, id string) (bool, error) {
		switch id {
		case "kyc_ok":
			return true, nil
		case "broken":
			return false, errors.New("db down")
		}
		return false, nil
	}
	got := onlyPermitted(context.Background(), []string{"stranger", "kyc_ok", "broken"}, permitted)
	if len(got) != 1 || got[0] != "kyc_ok" {
		t.Fatalf("only the KYC-approved person may be invited (unreadable = no): %v", got)
	}
	if onlyPermitted(context.Background(), []string{"kyc_ok"}, nil) != nil {
		t.Fatal("no permission source at all must invite nobody")
	}
}

// 这两个既有用例测的是排序 / 顺延，不是权限：假设候选人都已开通接单。权限本身在上面那条用例里钉。
func everyoneOptedIn(context.Context, string) (bool, error) { return true, nil }

// OPS-MATCH-PREVIEW-001：预览与真邀请同一批候选、同一个排序；不发邀约；每个候选带「你们都……」的共同标签。
func TestMatchPreviewShowsTheSameCandidatesAsInvitingAndTheirSharedTags(t *testing.T) {
	ctx := context.Background()
	svc := marketplace.New()
	opp := publishFast(t, svc, true)
	marketCmd(svc, "ApplyToMarketOpportunity", "already", map[string]any{"opportunityId": opp, "quote": "800,000₫", "scope": "中文"})
	now := time.Now().UTC()
	mem := tagging.NewMemory()
	live := func(axis, value string, strength float64) tagging.Tag {
		return tagging.Tag{Axis: axis, Value: value, Strength: strength, Confidence: 1, ExpiresAt: now.Add(time.Hour), ComputedAt: now}
	}
	_ = mem.ReplaceUserTags(ctx, "owner", []tagging.Tag{live(tagging.AxisInterestTopic, "摄影", .9), live(tagging.AxisInterestTopic, "徒步", .5)})
	_ = mem.ReplaceUserTags(ctx, "photo_fan", []tagging.Tag{live(tagging.AxisInterestTopic, "摄影", .8), live(tagging.AxisInterestTopic, "徒步", .6)})
	inv := nearbyInviter{
		market:    svc,
		permitted: func(_ context.Context, id string) (bool, error) { return id != "no_permission", nil },
		nearby: func(context.Context, float64, float64, float64, int) ([]string, error) {
			return []string{"owner", "already", "no_permission", "stranger", "photo_fan"}, nil
		},
		rank: func(_ context.Context, ids []string, _, _ *float64) ([]matching.Ranked, error) {
			out := []matching.Ranked{}
			for _, want := range []string{"photo_fan", "stranger"} { // 引擎的排名：photo_fan 在前
				for _, id := range ids {
					if id == want {
						out = append(out, matching.Ranked{AgentID: id})
					}
				}
			}
			return out, nil
		},
	}
	res, err := inv.Preview(ctx, opp, 10, &tagging.Service{Store: mem, Now: func() time.Time { return now }}, now)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(res.Candidates) != 2 || res.Candidates[0].UserID != "photo_fan" || res.Candidates[1].UserID != "stranger" {
		t.Fatalf("same pool as inviting (no owner, no applicant, no one without order permission), engine order kept: %+v", res.Candidates)
	}
	top := res.Candidates[0]
	if top.Rank != 1 || len(top.Shared) != 2 || top.Shared[0].Value != "摄影" || top.Affinity <= 0.9 {
		t.Fatalf("the best fit shares both interests and says so: %+v", top)
	}
	if res.Candidates[1].TagCount != 0 || len(res.Candidates[1].Shared) != 0 || res.Candidates[1].Affinity != 0 {
		t.Fatalf("a person with no tags has nothing shared and is not punished: %+v", res.Candidates[1])
	}
	if res.OwnerTagCount != 2 {
		t.Fatalf("owner tags counted: %d", res.OwnerTagCount)
	}
	// 预览不发邀约：没有任何副作用可观察 —— nearby/rank 之外没有写入口（inviter 本身没有 sender）。
	noLoc := publishFast(t, svc, false)
	if r, _ := inv.Preview(ctx, noLoc, 10, nil, now); r.Reason != "opportunity_has_no_location" || len(r.Candidates) != 0 {
		t.Fatalf("no coordinates, no 'nearby', and it says why: %+v", r)
	}
}
