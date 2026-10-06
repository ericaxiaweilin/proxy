package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// DISPATCH-LOOP-001：派单调度工作台。这里钉门、理由、留痕、规则拒绝的说法；
// 派单规则本身在 internal/dispatch，SQL 在 internal/platform/postgres 的集成测试。

type apiFakeOffers struct{ n int }

func (f *apiFakeOffers) Send(context.Context, dispatch.Run, dispatch.Candidate, time.Duration) (string, time.Time, string, error) {
	f.n++
	return "off_api_" + string(rune('a'+f.n)), time.Now().Add(dispatch.OfferTTL), "", nil
}
func (f *apiFakeOffers) Status(context.Context, dispatch.Run, string) (string, error) {
	return "OFFERED", nil
}

func dispatchServer(t *testing.T, audit *operatoraudit.Recorder) (*Server, *dispatch.Engine) {
	t.Helper()
	server := accessServer(audit, []string{"op_all", "op_pay"}, map[string]map[OperatorScope]bool{
		"op_pay": {ScopePayments: true},
	})
	engine := &dispatch.Engine{Repo: dispatch.NewMemory(), Offers: &apiFakeOffers{}, NewID: func() string { return "run_1" }}
	// 一张候选为空的 FAST 需求：一建就 EXHAUSTED，正是「待人工」那一栏要露出来的单。
	if _, err := engine.Start(context.Background(), dispatch.Task{TaskID: "task_1", RequesterID: "req_1", SlotIDs: []string{"s1"},
		MatchingMode: "FAST", AutoDispatch: true, BudgetVND: 1_000_000, BatchID: "cb_1"}); err != nil {
		t.Fatal(err)
	}
	server.Dispatch = engine
	return server, engine
}

func TestDispatchWorkbenchShowsTheShortageAndExplainsMissingWiring(t *testing.T) {
	server, _ := dispatchServer(t, operatoraudit.NewRecorder(&fakeAuditStore{}))
	rec := consoleGet(server, "dispatch", "op_all_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("read got %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string `json:"dataSource"`
		Runs       []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"runs"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.DataSource != OperatorLiveSource || len(body.Runs) != 1 || body.Runs[0].Status != dispatch.StatusExhausted {
		t.Fatalf("the exhausted run is on the default view: %s", rec.Body.String())
	}
	run := consoleGet(server, "dispatch/run?id=run_1", "op_all_token")
	if run.Code != http.StatusOK || !strings.Contains(run.Body.String(), `"EXHAUSTED"`) || !strings.Contains(run.Body.String(), "no_eligible_candidates") {
		t.Fatalf("the run page says why it is stuck: %d %s", run.Code, run.Body.String())
	}

	bare := accessServer(operatoraudit.NewRecorder(nil), []string{"op_all"}, nil)
	if rec := consoleGet(bare, "dispatch", "op_all_token"); !strings.Contains(rec.Body.String(), OperatorNotConnectedSource) {
		t.Fatalf("without a database the page says so instead of showing an empty list: %s", rec.Body.String())
	}
}

func TestDispatchActionsNeedMarketplaceAndAReasonAndAreAudited(t *testing.T) {
	auditStore := &fakeAuditStore{}
	server, engine := dispatchServer(t, operatoraudit.NewRecorder(auditStore))

	if rec := postOperatorJSON(server, "dispatch/actions", "op_pay_token", map[string]any{"runId": "run_1", "action": "retry", "reason": "x"}); rec.Code != http.StatusForbidden {
		t.Fatalf("PAYMENTS-only operator got %d, want 403", rec.Code)
	}
	if rec := postOperatorJSON(server, "dispatch/actions", "op_all_token", map[string]any{"runId": "run_1", "action": "retry"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("no reason got %d, want 400", rec.Code)
	}
	// 点名超预算：规则拒绝，说清楚为什么，也留痕。
	rec := postOperatorJSON(server, "dispatch/actions", "op_all_token", map[string]any{
		"runId": "run_1", "action": "assign", "agentId": "agent_z", "price": 2_000_000, "reason": "电话里说可以"})
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "budget") {
		t.Fatalf("over-budget assign got %d %s", rec.Code, rec.Body.String())
	}
	rec = postOperatorJSON(server, "dispatch/actions", "op_all_token", map[string]any{
		"runId": "run_1", "action": "assign", "agentId": "agent_z", "price": 900_000, "reason": "电话确认过有空"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"currentAgentId":"agent_z"`) {
		t.Fatalf("assign within budget offers her right away: %d %s", rec.Code, rec.Body.String())
	}
	r, steps, _ := engine.Repo.Get(context.Background(), "run_1")
	if r.Status != dispatch.StatusRunning || steps[len(steps)-1].Kind != dispatch.StepOfferSent || steps[len(steps)-2].Actor != "op_all" {
		t.Fatalf("the operator's pick is in the run's own trail, attributed: %+v %+v", r, steps)
	}
	if len(auditStore.rows) != 2 {
		t.Fatalf("both the refused and the accepted action are audited, got %d rows", len(auditStore.rows))
	}
	if auditStore.rows[0].Outcome != operatoraudit.OutcomeDenied || auditStore.rows[1].Outcome != operatoraudit.OutcomeOK ||
		auditStore.rows[1].Action != "DISPATCH_RUN_ACTION" || auditStore.rows[1].Scope != string(ScopeMarketplace) {
		t.Fatalf("audit rows = %+v", auditStore.rows)
	}
	if rec := postOperatorJSON(server, "dispatch/actions", "op_all_token", map[string]any{"runId": "run_1", "action": "cancel", "reason": "需求方说不要了"}); rec.Code != http.StatusOK {
		t.Fatalf("cancel got %d %s", rec.Code, rec.Body.String())
	}
}
