package main

import (
	"context"
	"time"

	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/matchengine"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// MATCH-ENGINE-001：市场邀请 / 撮合预览走统一的撮合引擎（internal/matchengine）。
// 候选来自「附近」检索；资格由 Gate 链逐个判定（不通过的人带原因码留账）；排名用同一套旋钮；
// 候选集有限，且有新人探索位；整次运行是一个 snapshot，落 matching.decisions。

// engineRun 检索 → 打信号 → 跑引擎。skip 非空表示「说不出附近」之类的前置失败（不是引擎的结论）。
func (n nearbyInviter) engineRun(ctx context.Context, oppID string, exclude map[string]bool, size int) (matchengine.Result, string, error) {
	opp, err := n.market.Opportunity(ctx, oppID)
	if err != nil {
		return matchengine.Result{}, "", err
	}
	if opp.Lat == nil || opp.Lng == nil {
		return matchengine.Result{}, "opportunity_has_no_location", nil
	}
	applied, err := n.market.ApplicationsForDispatch(ctx, oppID, opp.OwnerID)
	if err != nil {
		return matchengine.Result{}, "", err
	}
	excluded := map[string]string{opp.OwnerID: matchengine.ReasonSelf}
	for id := range exclude {
		excluded[id] = matchengine.ReasonAlreadyInvited
	}
	for _, a := range applied {
		excluded[a.ApplicantID] = matchengine.ReasonAlreadyApplied
	}
	around, err := n.nearby(ctx, *opp.Lat, *opp.Lng, inviteRadiusM, 200)
	if err != nil {
		return matchengine.Result{}, "", err
	}
	if len(around) == 0 {
		return matchengine.Result{}, "nobody_suitable_nearby", nil
	}
	sigs, err := n.signals(ctx, opp.OwnerID, around, opp.Lat, opp.Lng)
	if err != nil {
		return matchengine.Result{}, "", err
	}
	cands := make([]matchengine.Candidate, 0, len(around))
	for _, id := range around {
		cands = append(cands, matchengine.Candidate{AgentID: id, Signals: sigs[id]})
	}
	engine := n.engineFor(excluded, size)
	res := engine.Run(ctx, matchengine.Subject{Kind: matchengine.SubjectOpportunity, ID: oppID, RequesterID: opp.OwnerID, Lat: opp.Lat, Lng: opp.Lng}, cands)
	return res, "", nil
}

func (n nearbyInviter) inviteViaEngine(ctx context.Context, run dispatch.Run, exclude map[string]bool, limit int) ([]string, string, error) {
	res, skip, err := n.engineRun(ctx, run.TaskID, exclude, limit)
	if err != nil || skip != "" {
		return nil, skip, err
	}
	out := []string{}
	for _, en := range res.CandidateSet {
		if len(out) >= limit {
			break
		}
		out = append(out, en.AgentID)
	}
	if len(out) == 0 {
		return nil, "nobody_suitable_nearby", nil
	}
	return out, "", nil
}

func (n nearbyInviter) previewViaEngine(ctx context.Context, oppID string, limit int, tags *tagging.Service, now time.Time) (api.MatchPreviewResult, error) {
	res := api.MatchPreviewResult{OpportunityID: oppID, TagFitWeight: matching.CurrentTunables().TagFitWeight, Candidates: []api.MatchPreviewItem{}}
	run, skip, err := n.engineRun(ctx, oppID, nil, limit)
	if err != nil {
		return res, err
	}
	if skip != "" {
		res.Reason = skip
		return res, nil
	}
	opp, _ := n.market.Opportunity(ctx, oppID)
	mine := tags.TagsFor(ctx, opp.OwnerID, tagging.UseMatching)
	res.OwnerTagCount = len(mine)
	res.SnapshotID, res.RankVersion, res.Health = run.SnapshotID, run.RankVersion, run.Health
	res.Ineligible = run.Ineligible
	if len(res.Ineligible) > 50 {
		res.Ineligible = res.Ineligible[:50]
	}
	for i, en := range run.CandidateSet {
		if i >= limit {
			break
		}
		theirs := tags.TagsFor(ctx, en.AgentID, tagging.UseMatching)
		res.Candidates = append(res.Candidates, api.MatchPreviewItem{
			Rank: en.Rank, UserID: en.AgentID, Breakdown: en.Breakdown, Reasons: en.Reasons, Exploration: en.Exploration,
			Affinity: tagging.Affinity(mine, theirs, now), Shared: tagging.SharedTags(mine, theirs, now, 5), TagCount: len(theirs),
		})
	}
	if len(res.Candidates) == 0 {
		res.Reason = "nobody_suitable_nearby"
	}
	return res, nil
}
