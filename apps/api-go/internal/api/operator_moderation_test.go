package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/moderation"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-MODERATION-001：举报处置的运营入口。钉三件事：门（非运营进不来）、处置确实走
// 命令边界的校验（已处置不写结论 / 判定不成立不写理由 → 拒绝）、处置后队列里状态变了。

func moderationServer(t *testing.T) (*Server, string) {
	t.Helper()
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all"}, nil)
	server.Moderation = moderation.New()
	res := server.Moderation.Handle(command.Envelope{
		CommandType: "ReportTarget", CommandID: "c1", IdempotencyKey: "k1", CorrelationID: "c1",
		Actor:   command.Actor{Type: "USER", ID: "reporter_1"},
		Payload: map[string]any{"targetType": moderation.TargetAccount, "targetId": "u_bad", "reason": "MINOR_SAFETY", "note": "他在问未成年人的学校"},
	})
	if res.Error != nil {
		t.Fatalf("seed report: %+v", res.Error)
	}
	return server, res.Aggregate.ID
}

func moderationPost(server *Server, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/operator/moderation/disposition", strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestModerationQueueIsOperatorOnlyAndShowsTheReport(t *testing.T) {
	server, reportID := moderationServer(t)
	if rec := consoleGet(server, "moderation", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session must be 401, got %d", rec.Code)
	}
	if rec := consoleGet(server, "moderation", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("ordinary user must be 403, got %d", rec.Code)
	}
	rec := consoleGet(server, "moderation", "op_all_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("operator read got %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Enforcement string `json:"enforcement"`
		ReportQueue struct {
			OpenCount int `json:"openCount"`
			Items     []struct {
				ReportID string `json:"reportId"`
				State    string `json:"state"`
				Note     string `json:"note"`
			} `json:"items"`
		} `json:"reportQueue"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Enforcement != "RECORD_ONLY" {
		t.Fatalf("the page must be told dispositions are record-only, got %q", body.Enforcement)
	}
	if len(body.ReportQueue.Items) != 1 || body.ReportQueue.Items[0].ReportID != reportID || body.ReportQueue.Items[0].State != "SUBMITTED" {
		t.Fatalf("queue should hold the one untouched report: %+v", body.ReportQueue)
	}
	if body.ReportQueue.Items[0].Note == "" {
		t.Fatal("the reporter's own words must reach the operator")
	}
}

func TestModerationDispositionRunsTheDomainRulesAndMovesTheQueue(t *testing.T) {
	server, reportID := moderationServer(t)
	if rec := moderationPost(server, "user_token", `{"reportId":"`+reportID+`","action":"TRIAGE"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("ordinary user must be 403, got %d", rec.Code)
	}
	// 已处置却不说处置了什么 / 判定不成立却不写理由：域里的规则必须原样挡住。
	if rec := moderationPost(server, "op_all_token", `{"reportId":"`+reportID+`","action":"ACTION_TAKEN"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("ACTION_TAKEN without an outcome must be refused, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := moderationPost(server, "op_all_token", `{"reportId":"`+reportID+`","action":"DISMISS"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("DISMISS without a note must be refused, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := moderationPost(server, "op_all_token", `{"reportId":"nope","action":"TRIAGE"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("a report that does not exist must be refused, got %d", rec.Code)
	}
	if rec := moderationPost(server, "op_all_token", `{"reportId":"`+reportID+`","action":"ACTION_TAKEN","outcome":"CONTENT_REMOVED","note":"已核实"}`); rec.Code != http.StatusOK {
		t.Fatalf("a well-formed disposition got %d %s", rec.Code, rec.Body.String())
	}
	rec := consoleGet(server, "moderation?includeClosed=1", "op_all_token")
	if !strings.Contains(rec.Body.String(), `"state":"ACTIONED"`) {
		t.Fatalf("queue should show the report as ACTIONED: %s", rec.Body.String())
	}
}

func fileAppeal(t *testing.T, server *Server, reportID string) string {
	t.Helper()
	res := server.Moderation.Handle(command.Envelope{
		CommandType: "FileAppeal", CommandID: "ca", IdempotencyKey: "ka", CorrelationID: "ca",
		Actor:   command.Actor{Type: "USER", ID: "reported_user"},
		Payload: map[string]any{"reportId": reportID, "reason": "我没有做这件事"},
	})
	if res.Error != nil {
		t.Fatalf("file appeal: %+v", res.Error)
	}
	return res.Aggregate.ID
}

// OPS-APPEALS-001：申诉队列看得见、复核走域规则（驳回必须写理由）、复核后状态变、仍是只记录。
func TestAppealQueueAndDecisionRunTheDomainRules(t *testing.T) {
	server, reportID := moderationServer(t)
	appealID := fileAppeal(t, server, reportID)
	if rec := consoleGet(server, "appeals", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("ordinary user must be 403, got %d", rec.Code)
	}
	rec := consoleGet(server, "appeals", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), appealID) || !strings.Contains(rec.Body.String(), `"state":"FILED"`) ||
		!strings.Contains(rec.Body.String(), "RECORD_ONLY") || !strings.Contains(rec.Body.String(), "MINOR_SAFETY") {
		t.Fatalf("queue should list the open appeal with the original report's reason: %d %s", rec.Code, rec.Body.String())
	}
	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/operator/appeals/decision", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer op_all_token")
		out := httptest.NewRecorder()
		server.Handler().ServeHTTP(out, req)
		return out
	}
	if r := post(`{"appealId":"` + appealID + `","decision":"REJECTED"}`); r.Code != http.StatusUnprocessableEntity {
		t.Fatalf("rejecting without a reason must be refused, got %d %s", r.Code, r.Body.String())
	}
	if r := post(`{"appealId":"nope","decision":"UPHELD"}`); r.Code != http.StatusUnprocessableEntity {
		t.Fatalf("an appeal that does not exist must be refused, got %d", r.Code)
	}
	if r := post(`{"appealId":"` + appealID + `","decision":"REJECTED","note":"证据充分"}`); r.Code != http.StatusOK {
		t.Fatalf("a well-formed decision: %d %s", r.Code, r.Body.String())
	}
	if open := consoleGet(server, "appeals", "op_all_token"); strings.Contains(open.Body.String(), appealID) {
		t.Fatal("a decided appeal must leave the open queue")
	}
	if closed := consoleGet(server, "appeals?includeClosed=1", "op_all_token"); !strings.Contains(closed.Body.String(), `"state":"REJECTED"`) {
		t.Fatalf("with includeClosed it shows as REJECTED: %s", closed.Body.String())
	}
}

// OPS-AUTHORITY-001：受理要四项核验、队列按截止排序且算出超时、响应后离开待办、普通运营（无 AUTHORITY）看不到。
func TestAuthorityRequestsAreQueuedWithDeadlinesAndNeedTheAuthorityScope(t *testing.T) {
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay"}, map[string]map[OperatorScope]bool{"op_pay": {ScopePayments: true}})
	server.Moderation = moderation.New()
	do := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		return rec
	}
	if rec := do(http.MethodGet, "/v1/operator/authority-requests", "op_pay_token", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("an operator without AUTHORITY must not see authority requests: %d", rec.Code)
	}
	incomplete := `{"requestRef":"CA-1","authority":"公安","requestKind":"USER_INFO","verifiedSubject":true,"verifiedAuthority":true,"verifiedScope":true,"verifiedLegality":false}`
	if rec := do(http.MethodPost, "/v1/operator/authority-requests", "op_all_token", incomplete); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("incomplete verification must be refused: %d %s", rec.Code, rec.Body.String())
	}
	full := `{"requestRef":"CA-1","authority":"公安","requestKind":"USER_INFO","verifiedSubject":true,"verifiedAuthority":true,"verifiedScope":true,"verifiedLegality":true}`
	rec := do(http.MethodPost, "/v1/operator/authority-requests", "op_all_token", full)
	if rec.Code != http.StatusOK {
		t.Fatalf("record: %d %s", rec.Code, rec.Body.String())
	}
	var made struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &made)
	rec = do(http.MethodGet, "/v1/operator/authority-requests", "op_all_token", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"state":"OPEN"`) || !strings.Contains(rec.Body.String(), `"hoursLeft":`) || !strings.Contains(rec.Body.String(), `"overdue":false`) {
		t.Fatalf("an open request carries its remaining hours: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(http.MethodPost, "/v1/operator/authority-requests/response", "op_all_token", `{"requestId":"`+made.ID+`","outcome":"FULFILLED"}`); rec.Code != http.StatusOK {
		t.Fatalf("response: %d %s", rec.Code, rec.Body.String())
	}
	if open := do(http.MethodGet, "/v1/operator/authority-requests", "op_all_token", ""); strings.Contains(open.Body.String(), made.ID) {
		t.Fatal("a responded request must leave the open queue")
	}
	if closed := do(http.MethodGet, "/v1/operator/authority-requests?includeClosed=1", "op_all_token", ""); !strings.Contains(closed.Body.String(), `"state":"RESPONDED"`) || !strings.Contains(closed.Body.String(), `"overdue":false`) {
		t.Fatalf("closed view shows RESPONDED and on time: %s", closed.Body.String())
	}
}
