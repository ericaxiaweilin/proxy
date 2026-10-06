package main

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/marketplace"
)

// MARKET-FAST-001 端到端：真的市场服务（内存仓）+ 真的派单引擎。

func marketCmd(svc *marketplace.Service, kind, actor string, payload map[string]any) command.Result {
	return svc.HandleContext(context.Background(), command.Envelope{
		CommandID: "cmd_" + kind + actor, CommandType: kind, CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: actor}, Principal: command.Principal{Type: "INDIVIDUAL", ID: actor},
		Target: command.Target{Type: "Market", ID: "local"}, IdempotencyKey: "idem_" + kind + actor + fmt.Sprint(payload["applicationId"]),
		CorrelationID: "corr", RequestedAt: time.Now().UTC().Format(time.RFC3339), Payload: payload,
	})
}

func fastMarket(t *testing.T) (*marketplace.Service, *dispatch.Engine, *time.Time, string, map[string]string) {
	t.Helper()
	svc := marketplace.New()
	now := time.Now().UTC()
	n := 0
	engine := &dispatch.Engine{Repo: dispatch.NewMemory(), Offers: kindRouter{},
		Now: func() time.Time { return now }, NewID: func() string { n++; return fmt.Sprintf("dr_%d", n) }}
	wireMarketDispatch(engine, svc)
	pub := marketCmd(svc, "PublishMarketOpportunity", "owner", map[string]any{
		"title": "周六城市同行", "theme": "城市同行", "date": "周六", "time": "10:00", "location": "河内 · 西湖",
		"price": "800,000₫", "skills": "中文", "matchingMode": "fast",
	})
	var body struct {
		Opportunity marketplace.Opportunity `json:"opportunity"`
	}
	if err := json.Unmarshal([]byte(pub.OperationRef), &body); err != nil || body.Opportunity.MatchingMode != "FAST" {
		t.Fatalf("publish FAST: %+v", pub)
	}
	apps := map[string]string{}
	for _, who := range []string{"amy", "bao"} {
		r := marketCmd(svc, "ApplyToMarketOpportunity", who, map[string]any{"opportunityId": body.Opportunity.ID, "quote": "800,000₫", "scope": "中文"})
		var a struct {
			Application marketplace.Application `json:"application"`
		}
		_ = json.Unmarshal([]byte(r.OperationRef), &a)
		apps[who] = a.Application.ID
	}
	return svc, engine, &now, body.Opportunity.ID, apps
}

func onlyRun(t *testing.T, engine *dispatch.Engine, opp string) dispatch.Run {
	t.Helper()
	if _, err := engine.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	runs, _ := engine.Repo.TaskRuns(context.Background(), opp)
	if len(runs) != 1 {
		t.Fatalf("want one market run, got %d", len(runs))
	}
	return runs[0]
}

func TestFastMarketOpportunitySelectsWithdrawsAndAssigns(t *testing.T) {
	svc, engine, now, opp, apps := fastMarket(t)
	r := onlyRun(t, engine, opp)
	if r.Kind != dispatch.KindMarket || r.CurrentOfferID != apps["amy"] {
		t.Fatalf("the platform selects the first applicant on the owner's behalf: %+v", r)
	}
	*now = now.Add(6 * time.Minute)
	r = onlyRun(t, engine, opp)
	if r.CurrentOfferID != apps["bao"] {
		t.Fatalf("amy did not confirm in 5 minutes ⇒ withdrawn, bao selected: %+v", r)
	}
	// 被撤回的 amy 现在来确认：必须被拒（不然就是两个人同时成单）。
	if late := marketCmd(svc, "ConfirmMarketApplication", "amy", map[string]any{"applicationId": apps["amy"]}); late.Outcome != "REJECTED" {
		t.Fatalf("an expired selection cannot be confirmed: %+v", late)
	}
	if ok := marketCmd(svc, "ConfirmMarketApplication", "bao", map[string]any{"applicationId": apps["bao"]}); ok.Outcome != "ACCEPTED" {
		t.Fatalf("bao confirms: %+v", ok)
	}
	if r = onlyRun(t, engine, opp); r.Status != dispatch.StatusAssigned || r.AssignedAgentID != "bao" {
		t.Fatalf("bao confirmed ⇒ assigned: %+v", r)
	}
	listed, _ := svc.ApplicationsForDispatch(context.Background(), opp, "owner")
	got := map[string]string{}
	for _, a := range listed {
		got[a.ApplicantID] = a.Status
	}
	if got["amy"] != "SELECTION_EXPIRED" || got["bao"] != "CONFIRMED" {
		t.Fatalf("final application states: %v", got)
	}
}

func TestOwnerPickingSomeoneHimselfStopsTheFastDispatch(t *testing.T) {
	svc, engine, _, opp, apps := fastMarket(t)
	_ = onlyRun(t, engine, opp) // 平台选了 amy
	// 发单方等不及，自己把 amy 撤了改选 bao —— 这里直接用发单方自己的选择命令。
	if err := svc.ExpireSelection(context.Background(), opp, apps["amy"], "owner"); err != nil {
		t.Fatal(err)
	}
	if r := marketCmd(svc, "SelectMarketApplication", "owner", map[string]any{"opportunityId": opp, "applicationId": apps["bao"]}); r.Outcome != "ACCEPTED" {
		t.Fatalf("owner select: %+v", r)
	}
	if r := onlyRun(t, engine, opp); r.Status != dispatch.StatusCancelled {
		t.Fatalf("the owner's own pick wins; the platform stops instead of overriding him: %+v", r)
	}
}
