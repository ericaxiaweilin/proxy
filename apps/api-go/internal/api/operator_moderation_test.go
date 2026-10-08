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
