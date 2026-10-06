package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
)

// MARKET-FAST-001：快速市场发单接到派单引擎上。
//
// 「发邀约」= 以发单方本人身份（Actor USER = 机会主人）选中一位报名人 —— 走的是同一条
// SelectMarketApplication，同一道主人校验；他发单时选了「快速」就是同意平台这样代选。
// 「等回复」= 读她的报名状态：CONFIRMED ⇒ 接了；SELECTED ⇒ 还在等；其它 ⇒ 不等了。
// 「超时」= 撤回选中（SELECTION_EXPIRED），其余落选的人恢复可选。
type marketOfferPort struct {
	svc *marketplace.Service
}

func (m marketOfferPort) Send(ctx context.Context, run dispatch.Run, c dispatch.Candidate, ttl time.Duration) (string, time.Time, string, error) {
	res := m.svc.HandleContext(ctx, command.Envelope{
		CommandID: "dispatch_select_" + run.ID + "_" + c.Ref, CommandType: "SelectMarketApplication", CommandVersion: 1,
		Actor:     command.Actor{Type: "USER", ID: run.RequesterID},
		Principal: command.Principal{Type: "INDIVIDUAL", ID: run.RequesterID},
		Target:    command.Target{Type: "MarketOpportunity", ID: run.TaskID}, IdempotencyKey: "dispatch_select_" + run.ID + "_" + c.Ref,
		AuthContext: map[string]any{"delegatedBy": "dispatch", "dispatchRunId": run.ID, "consent": "opportunity.matchingMode=FAST"},
		Purpose:     "auto_dispatch", CorrelationID: run.ID, RequestedAt: time.Now().UTC().Format(time.RFC3339),
		Payload: map[string]any{"opportunityId": run.TaskID, "applicationId": c.Ref},
	})
	if res.Outcome == "REJECTED" {
		if res.Error != nil && res.Error.Retryability == "SAFE_RETRY" {
			return "", time.Time{}, "", errors.New(res.Error.ErrorCode)
		}
		code := "REJECTED"
		if res.Error != nil {
			code = res.Error.ErrorCode
		}
		return "", time.Time{}, code, nil
	}
	return c.Ref, time.Now().Add(ttl), "", nil
}

func (m marketOfferPort) Status(ctx context.Context, run dispatch.Run, applicationID string) (string, error) {
	apps, err := m.svc.ApplicationsForDispatch(ctx, run.TaskID, run.RequesterID)
	if err != nil {
		return "", err
	}
	for _, a := range apps {
		if a.ID != applicationID {
			continue
		}
		switch a.Status {
		case "CONFIRMED":
			return "ACCEPTED", nil
		case "SELECTED":
			return "OFFERED", nil
		}
		return "CANCELLED", nil
	}
	return "CANCELLED", nil
}

func (m marketOfferPort) Withdraw(ctx context.Context, run dispatch.Run, applicationID string) error {
	err := m.svc.ExpireSelection(ctx, run.TaskID, applicationID, run.RequesterID)
	if errors.Is(err, marketplace.ErrApplicationStateConflict) {
		return nil // 她抢先确认了（或已经不是 SELECTED）：引擎接着会重读状态
	}
	return err
}

// marketCandidates 每一轮给出「还没试过、仍在等结果」的报名人，按发单方看到的同一份撮合排序。
type marketCandidates struct {
	svc *marketplace.Service
}

func (m marketCandidates) Candidates(ctx context.Context, run dispatch.Run, tried map[string]bool) ([]dispatch.Candidate, string, error) {
	apps, err := m.svc.ApplicationsForDispatch(ctx, run.TaskID, run.RequesterID)
	if err != nil {
		return nil, "", err
	}
	out := []dispatch.Candidate{}
	for _, a := range apps {
		// 发单方自己选了人（不是平台这一轮正在等的那位）：他接手了，平台停。
		if (a.Status == "SELECTED" || a.Status == "CONFIRMED") && a.ID != run.CurrentOfferID {
			return nil, "owner_selected_manually", nil
		}
		if a.Status == "SUBMITTED" && !tried[a.ApplicantID] {
			out = append(out, dispatch.Candidate{AgentID: a.ApplicantID, Ref: a.ID})
		}
	}
	return out, "", nil
}

// kindRouter 让一个引擎同时派需求档位（履约邀约）与市场单（代选报名人）。
type kindRouter struct {
	task   dispatch.OfferPort
	market marketOfferPort
}

func (k kindRouter) port(run dispatch.Run) dispatch.OfferPort {
	if run.Kind == dispatch.KindMarket {
		return k.market
	}
	return k.task
}

func (k kindRouter) Send(ctx context.Context, run dispatch.Run, c dispatch.Candidate, ttl time.Duration) (string, time.Time, string, error) {
	return k.port(run).Send(ctx, run, c, ttl)
}

func (k kindRouter) Status(ctx context.Context, run dispatch.Run, offerID string) (string, error) {
	return k.port(run).Status(ctx, run, offerID)
}

// Withdraw 只对市场单有意义：履约邀约按 TTL 自己过期。
func (k kindRouter) Withdraw(ctx context.Context, run dispatch.Run, offerID string) error {
	if run.Kind == dispatch.KindMarket {
		return k.market.Withdraw(ctx, run, offerID)
	}
	return nil
}

// wireMarketDispatch 把市场的两个钩子接到引擎上，并让引擎会派市场单。
func wireMarketDispatch(engine *dispatch.Engine, svc *marketplace.Service) {
	if engine == nil || svc == nil {
		return
	}
	engine.Offers = kindRouter{task: engine.Offers, market: marketOfferPort{svc: svc}}
	if engine.Sources == nil {
		engine.Sources = map[string]dispatch.CandidateSource{}
	}
	engine.Sources[dispatch.KindMarket] = marketCandidates{svc: svc}
	svc.SetDispatchHooks(
		func(ctx context.Context, opp marketplace.Opportunity) {
			if _, err := engine.StartMarket(ctx, opp.ID, opp.OwnerID); err != nil {
				log.Printf("market dispatch: start failed opportunity=%s: %v", opp.ID, err)
			}
		},
		func(ctx context.Context, opportunityID, applicantID string) {
			if err := engine.Reopen(ctx, opportunityID, applicantID); err != nil {
				log.Printf("market dispatch: reopen failed opportunity=%s: %v", opportunityID, err)
			}
		},
	)
}
