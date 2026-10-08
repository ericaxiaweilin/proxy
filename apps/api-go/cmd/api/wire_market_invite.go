package main

import (
	"context"
	"time"

	"github.com/proxy-app/proxy-api/internal/api"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/matchengine"
	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// MARKET-INVITE-001：快速发单迟迟没人报名时，邀请附近合适的服务者来报名。
//
// 谁算「附近」：与 App「附近」同一条查询（有坐标的人，30km —— 2026-10-04 用户：30km 骑摩托可接受）。
// 谁先被邀：同一套撮合口径（可靠 / 距离 / 新人 / 负载…），不是谁离得近谁先。
// 不邀谁：发单方自己、已经报了名的、之前邀过的。发单没有坐标 ⇒ 不邀（说不出「附近」）。
const inviteRadiusM = 30_000

type nearbyInviter struct {
	market *marketplace.Service
	nearby func(ctx context.Context, lat, lng, maxDistanceM float64, limit int) ([]string, error)
	rank   func(ctx context.Context, ids []string, lat, lng *float64) ([]matching.Ranked, error)
	// permitted：这个人有没有接单权限（KYC 通过）。没有就不邀 —— 她没主动开通过接单，
	// 平台不能替她出现在别人的邀约里（2026-10-08 仓库审核：未经同意被曝光）；而且没通过 KYC
	// 的人本来也报不了名。读不出来 = 当作没有（fail-closed）。
	permitted func(ctx context.Context, userID string) (bool, error)
	// MATCH-ENGINE-001：配了这两个就走统一撮合引擎（资格门链 + 审计 + 探索位 + 版本）；没配走下面的旧路径（单测用）。
	engineFor func(excluded map[string]string, size int) *matchengine.Engine
	signals   func(ctx context.Context, requesterID string, ids []string, lat, lng *float64) (map[string]matching.Signals, error)
}

// onlyPermitted 留下有接单权限的人；任何一个人的权限读不出来都当作没有。
func onlyPermitted(ctx context.Context, ids []string, permitted func(context.Context, string) (bool, error)) []string {
	if permitted == nil {
		return nil
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if ok, err := permitted(ctx, id); err == nil && ok {
			out = append(out, id)
		}
	}
	return out
}

func (n nearbyInviter) Invite(ctx context.Context, run dispatch.Run, exclude map[string]bool, limit int) ([]string, string, error) {
	if n.engineFor != nil && n.signals != nil {
		return n.inviteViaEngine(ctx, run, exclude, limit)
	}
	opp, err := n.market.Opportunity(ctx, run.TaskID)
	if err != nil {
		return nil, "", err
	}
	if opp.Lat == nil || opp.Lng == nil {
		return nil, "opportunity_has_no_location", nil
	}
	applied, err := n.market.ApplicationsForDispatch(ctx, run.TaskID, run.RequesterID)
	if err != nil {
		return nil, "", err
	}
	skip := map[string]bool{}
	for id := range exclude {
		skip[id] = true
	}
	for _, a := range applied {
		skip[a.ApplicantID] = true
	}
	around, err := n.nearby(ctx, *opp.Lat, *opp.Lng, inviteRadiusM, 200)
	if err != nil {
		return nil, "", err
	}
	ids := []string{}
	for _, id := range around {
		if !skip[id] {
			ids = append(ids, id)
		}
	}
	ids = onlyPermitted(ctx, ids, n.permitted)
	if len(ids) == 0 {
		return nil, "", nil // 附近没有可邀的人：引擎记 nobody_suitable_nearby
	}
	ranked, err := n.rank(matching.WithRequester(ctx, run.RequesterID), ids, opp.Lat, opp.Lng)
	if err != nil {
		return nil, "", err
	}
	out := []string{}
	for _, r := range ranked {
		if len(out) >= limit {
			break
		}
		out = append(out, r.AgentID)
	}
	return out, "", nil
}

// Preview 是撮合预览：与 Invite 同一套候选与排名，但不发任何邀约，并带上每个候选的明细与共同标签。
func (n nearbyInviter) Preview(ctx context.Context, opportunityID string, limit int, tags *tagging.Service, now time.Time) (api.MatchPreviewResult, error) {
	if n.engineFor != nil && n.signals != nil {
		return n.previewViaEngine(ctx, opportunityID, limit, tags, now)
	}
	res := api.MatchPreviewResult{OpportunityID: opportunityID, TagFitWeight: matching.CurrentTunables().TagFitWeight, Candidates: []api.MatchPreviewItem{}}
	opp, err := n.market.Opportunity(ctx, opportunityID)
	if err != nil {
		return res, err
	}
	if opp.Lat == nil || opp.Lng == nil {
		res.Reason = "opportunity_has_no_location"
		return res, nil
	}
	skip := map[string]bool{opp.OwnerID: true}
	applied, err := n.market.ApplicationsForDispatch(ctx, opportunityID, opp.OwnerID)
	if err != nil {
		return res, err
	}
	for _, a := range applied {
		skip[a.ApplicantID] = true
	}
	around, err := n.nearby(ctx, *opp.Lat, *opp.Lng, inviteRadiusM, 200)
	if err != nil {
		return res, err
	}
	ids := []string{}
	for _, id := range around {
		if !skip[id] {
			ids = append(ids, id)
		}
	}
	ids = onlyPermitted(ctx, ids, n.permitted)
	if len(ids) == 0 {
		res.Reason = "nobody_suitable_nearby"
		return res, nil
	}
	rctx := matching.WithRequester(ctx, opp.OwnerID)
	ranked, err := n.rank(rctx, ids, opp.Lat, opp.Lng)
	if err != nil {
		return res, err
	}
	mine := tags.TagsFor(ctx, opp.OwnerID, tagging.UseMatching)
	res.OwnerTagCount = len(mine)
	for i, r := range ranked {
		if i >= limit {
			break
		}
		theirs := tags.TagsFor(ctx, r.AgentID, tagging.UseMatching)
		res.Candidates = append(res.Candidates, api.MatchPreviewItem{
			Rank: i + 1, UserID: r.AgentID, Breakdown: r.Breakdown,
			Affinity: tagging.Affinity(mine, theirs, now), Shared: tagging.SharedTags(mine, theirs, now, 5), TagCount: len(theirs),
		})
	}
	return res, nil
}
