package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/accountstatus"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-RESTRICT-001：举报处置真的生效。

func restrictionServer() *Server {
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay"}, map[string]map[OperatorScope]bool{"op_pay": {ScopePayments: true}})
	server.AccountStatus = &accountstatus.Service{Store: &accountstatus.Memory{}}
	return server
}

func asUser(commandType, user string) command.Envelope {
	return command.Envelope{CommandType: commandType, CommandID: "c", IdempotencyKey: "k", CorrelationID: "c", Actor: command.Actor{Type: "USER", ID: user}, Principal: command.Principal{Type: "INDIVIDUAL", ID: user}}
}

func postJSON(server *Server, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestRestrictionsAreEnforcedAtTheCommandBoundaryAndLiftable(t *testing.T) {
	server := restrictionServer()
	ctx := context.Background()
	if res := server.dispatchCommand(ctx, asUser("CreatePost", "bad_user")); res.Error != nil && strings.HasPrefix(res.Error.ErrorCode, "ACCOUNT_") {
		t.Fatalf("an unrestricted account is never blocked by this gate: %+v", res.Error)
	}
	if rec := postJSON(server, "/v1/operator/restrictions", "op_pay_token", `{"userId":"bad_user","level":"RESTRICTED","reason":"x"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("an operator without MODERATION must not restrict accounts: %d", rec.Code)
	}
	if rec := postJSON(server, "/v1/operator/restrictions", "op_all_token", `{"userId":"bad_user","level":"RESTRICTED"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("no reason must be refused: %d", rec.Code)
	}
	if rec := postJSON(server, "/v1/operator/restrictions", "op_all_token", `{"userId":"bad_user","level":"FOREVER","reason":"x"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown level must be refused: %d", rec.Code)
	}
	if rec := postJSON(server, "/v1/operator/restrictions", "op_all_token", `{"userId":"bad_user","level":"RESTRICTED","reason":"多次骚扰","reportId":"rep_1"}`); rec.Code != http.StatusOK {
		t.Fatalf("set: %d", rec.Code)
	}
	if res := server.dispatchCommand(ctx, asUser("CreatePost", "bad_user")); res.Error == nil || res.Error.ErrorCode != "ACCOUNT_RESTRICTED" {
		t.Fatalf("a restricted account cannot publish: %+v", res.Error)
	}
	if res := server.dispatchCommand(ctx, asUser("ListFeedPosts", "bad_user")); res.Error != nil && strings.HasPrefix(res.Error.ErrorCode, "ACCOUNT_") {
		t.Fatalf("restricted still reads: %+v", res.Error)
	}
	if res := server.dispatchCommand(ctx, asUser("CreatePost", "someone_else")); res.Error != nil && strings.HasPrefix(res.Error.ErrorCode, "ACCOUNT_") {
		t.Fatalf("other people are untouched: %+v", res.Error)
	}
	if rec := postJSON(server, "/v1/operator/restrictions", "op_all_token", `{"userId":"bad_user","level":"SUSPENDED","reason":"升级"}`); rec.Code != http.StatusOK {
		t.Fatalf("escalate: %d", rec.Code)
	}
	if res := server.dispatchCommand(ctx, asUser("ListFeedPosts", "bad_user")); res.Error == nil || res.Error.ErrorCode != "ACCOUNT_SUSPENDED" {
		t.Fatalf("a suspended account cannot even read: %+v", res.Error)
	}
	if res := server.dispatchCommand(ctx, asUser("FileAppeal", "bad_user")); res.Error != nil && strings.HasPrefix(res.Error.ErrorCode, "ACCOUNT_") {
		t.Fatalf("a suspended account can still appeal: %+v", res.Error)
	}
	rec := consoleGet(server, "restrictions", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"level":"SUSPENDED"`) || !strings.Contains(rec.Body.String(), "不会自动取消进行中的订单") {
		t.Fatalf("list shows the active suspension and the order caveat: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postJSON(server, "/v1/operator/restrictions/lift", "op_all_token", `{"userId":"bad_user"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("lifting without a reason must be refused: %d", rec.Code)
	}
	if rec := postJSON(server, "/v1/operator/restrictions/lift", "op_all_token", `{"userId":"bad_user","reason":"申诉成立"}`); rec.Code != http.StatusOK {
		t.Fatalf("lift: %d", rec.Code)
	}
	if res := server.dispatchCommand(ctx, asUser("CreatePost", "bad_user")); res.Error != nil && strings.HasPrefix(res.Error.ErrorCode, "ACCOUNT_") {
		t.Fatalf("after lifting the account is free again: %+v", res.Error)
	}
	if rec := postJSON(server, "/v1/operator/restrictions/lift", "op_all_token", `{"userId":"bad_user","reason":"again"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("lifting a clean account is refused: %d", rec.Code)
	}
}
