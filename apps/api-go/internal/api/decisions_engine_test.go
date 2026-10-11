package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/decisionengine"
)

type stubDecisionSource struct{}

func (stubDecisionSource) RestrictionLevel(context.Context, string) (string, error) { return "", nil }
func (stubDecisionSource) NudgesOptedOut(context.Context, string) (bool, error)     { return false, nil }
func (stubDecisionSource) InterventionsSince(context.Context, string, time.Time) (int, error) {
	return 0, nil
}
func (stubDecisionSource) GravityState(context.Context, string, string) (*decisionengine.GravityState, error) {
	return nil, nil
}

type captureLedger struct{ rows []decisionengine.Decision }

func (c *captureLedger) Record(_ context.Context, d decisionengine.Decision) error {
	c.rows = append(c.rows, d)
	return nil
}

type stubDecisionStats struct{}

func (stubDecisionStats) Stats(context.Context, time.Time) (decisionengine.Stats, error) {
	p50, p95 := 120.0, 480.0
	return decisionengine.Stats{WindowDays: 30, Calls: 12, Calls24h: 3, Allowed: 5, P50Micros: &p50, P95Micros: &p95,
		Blocks:   []decisionengine.ReasonCount{{Step: "INTERVENTION_BUDGET", Reason: "BUDGET_EXHAUSTED", Count: 7}},
		ByCaller: []decisionengine.CallerCount{{Caller: "guidance_worker", Action: "NUDGE", Calls: 12, Allowed: 5}},
		ByState:  []decisionengine.ReasonCount{}, PolicyVersion: decisionengine.PolicyVersion}, nil
}

// DECISION-ENGINE-001：试算口只对运营；caller 由服务端写死，调用方传什么都不算。
func TestOperatorDecisionEvaluateIsOperatorOnlyAndCallerIsServerSide(t *testing.T) {
	server := operatorConsoleServer()
	ledger := &captureLedger{}
	server.Decisions = decisionengine.New(stubDecisionSource{}, ledger)
	body := `{"userId":"user_x","action":"NUDGE","subject":"FIRST_POST","caller":"guidance_worker"}`
	if rec := consolePost(server, "decisions/evaluate", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d", rec.Code)
	}
	if rec := consolePost(server, "decisions/evaluate", "user_token", body); rec.Code != http.StatusForbidden {
		t.Fatalf("non-operator: %d", rec.Code)
	}
	rec := consolePost(server, "decisions/evaluate", "ops_token", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("operator: %d %s", rec.Code, rec.Body.String())
	}
	var d decisionengine.Decision
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if !d.Allowed || len(d.Steps) != 5 {
		t.Fatalf("decision: %+v", d)
	}
	if len(ledger.rows) != 1 || ledger.rows[0].Request.Caller != "operator_console" {
		t.Fatalf("every trial is recorded with caller=operator_console (not what the body claims): %+v", ledger.rows)
	}
	if rec := consolePost(server, "decisions/evaluate", "ops_token", `{"userId":"user_x","action":"PUSH_EVERYONE"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown action must be 400, got %d", rec.Code)
	}
}

func TestOperatorDecisionEngineServesRuntimeFromTheLedger(t *testing.T) {
	server := operatorConsoleServer()
	server.DecisionStats = stubDecisionStats{}
	rec := consoleGet(server, "decision-engine", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var p struct {
		Runtime *decisionengine.Stats `json:"runtime"`
		Notes   []string              `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Runtime == nil || p.Runtime.Calls != 12 || p.Runtime.P95Micros == nil || len(p.Runtime.Blocks) != 1 {
		t.Fatalf("runtime: %+v", p.Runtime)
	}
	if strings.Contains(strings.Join(p.Notes, "\n"), "不给数") {
		t.Fatalf("with the ledger connected the page must not say it has no numbers: %q", p.Notes)
	}
}
