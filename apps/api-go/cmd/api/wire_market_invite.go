package main

import (
	"context"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
	"github.com/proxy-app/proxy-api/internal/matching"
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
}

func (n nearbyInviter) Invite(ctx context.Context, run dispatch.Run, exclude map[string]bool, limit int) ([]string, string, error) {
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
	if len(ids) == 0 {
		return nil, "", nil // 附近没有可邀的人：引擎记 nobody_suitable_nearby
	}
	ranked, err := n.rank(ctx, ids, opp.Lat, opp.Lng)
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
