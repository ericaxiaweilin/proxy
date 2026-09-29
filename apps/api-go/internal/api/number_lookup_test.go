package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/fulfillment"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/numberlookup"
	"github.com/proxy-app/proxy-api/internal/ordernumber"
)

// PUBLIC-NO-LOOKUP-GATE-001：按公共编号反查是**跨当事人**读（订单双方账号、条款、审计
// 轨迹），只给运营，且必须持有 CASE scope。这里走真实的 HTTP 分发：没会话 401、普通
// 用户 403、运营但只有别的 scope 也 403、CASE 运营才放行；被拒的请求不产生审计行、
// 也不返回任何数据。

func lookupGateServer(t *testing.T) (*Server, *numberlookup.MemoryRecorder, string) {
	t.Helper()
	repo := fulfillment.NewMemoryRepository()
	ff := fulfillment.NewWithRepository(repo)
	numbers := ordernumber.NewMemory()
	orderNo, _ := numbers.Next(context.Background(), ordernumber.CategoryService)
	order, err := fulfillment.MaterializedOrder("ord_gate_1", orderNo, "user_req", "user_agent", "need_1", fulfillment.OrderSnapshot{ServiceSKU: "cc", AgreedCompensation: 500_000}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateOrder(context.Background(), order); err != nil {
		t.Fatal(err)
	}
	recorder := numberlookup.NewMemoryRecorder()
	gate := NewStaticOperatorGate([]string{"op_case", "op_payments"}).WithPrincipalScopes(map[string]map[OperatorScope]bool{
		"op_case":     {ScopeCase: true},
		"op_payments": {ScopePayments: true},
	})
	server := &Server{
		RateLimit:    NewRateLimiter(0, 100),
		Idempotency:  command.NewMemoryIdempotencyStore(),
		Operator:     gate,
		NumberLookup: numberlookup.New(recorder, numberlookup.OrderFinder(ff)),
		Authenticator: strictAuthenticator{validTokens: map[string]identity.AuthenticatedSession{
			"case_token":     {Actor: command.Actor{Type: "USER", ID: "op_case"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "op_case"}, AuthContext: map[string]any{}},
			"payments_token": {Actor: command.Actor{Type: "USER", ID: "op_payments"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "op_payments"}, AuthContext: map[string]any{}},
			"user_token":     {Actor: command.Actor{Type: "USER", ID: "user_req"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_req"}, AuthContext: map[string]any{}},
		}},
	}
	return server, recorder, orderNo
}

func lookupRequest(server *Server, bearer, number, key string) (int, command.Result) {
	envelope := apiEnvelope("LookupPublicNumber", map[string]any{"number": number, "reason": "ticket-4213 客户来电"}, command.Target{Type: "PublicNumber", ID: number}, key)
	record := requestWithBearer(server.Handler(), http.MethodPost, "/v1/commands/LookupPublicNumber", envelope, bearer)
	var result command.Result
	_ = json.Unmarshal(record.Body.Bytes(), &result)
	return record.Code, result
}

func TestPublicNumberLookupIsOperatorOnlyAndNeedsCaseScope(t *testing.T) {
	if !requiresOperator("LookupPublicNumber") {
		t.Fatal("LookupPublicNumber must be an operator command: it reads both parties of any order")
	}
	if scope, ok := RequiredOperatorScope("LookupPublicNumber"); !ok || scope != ScopeCase {
		t.Fatalf("LookupPublicNumber must require the CASE scope, got %q ok=%v", scope, ok)
	}
	server, recorder, orderNo := lookupGateServer(t)

	if code, _ := lookupRequest(server, "", orderNo, "idem_gate_anon_1"); code != http.StatusUnauthorized {
		t.Fatalf("no session must be 401, got %d", code)
	}
	for name, token := range map[string]string{"an ordinary user (even the order's own requester)": "user_token", "an operator without the CASE scope": "payments_token"} {
		code, result := lookupRequest(server, token, orderNo, "idem_gate_denied_"+token)
		if code != http.StatusForbidden || result.Error == nil || result.Error.ErrorCode != "OPERATOR_PRIVILEGE_REQUIRED" || result.OperationRef != "" {
			t.Fatalf("%s must be refused with 403 and no data: %d %+v", name, code, result)
		}
	}
	if len(recorder.Entries()) != 0 {
		t.Fatal("refused requests must not reach the lookup (no audit row, no read)")
	}

	code, result := lookupRequest(server, "case_token", orderNo, "idem_gate_case_1")
	if code != http.StatusOK || result.Outcome != "ACCEPTED" {
		t.Fatalf("a CASE operator must be served: %d %+v", code, result.Error)
	}
	var body struct {
		Kind     string         `json:"kind"`
		EntityID string         `json:"entityId"`
		Entity   map[string]any `json:"entity"`
	}
	if err := json.Unmarshal([]byte(result.OperationRef), &body); err != nil || body.Kind != "ORDER" || body.EntityID != "ord_gate_1" || body.Entity["requesterId"] != "user_req" {
		t.Fatalf("lookup body: %s (%v)", result.OperationRef, err)
	}
	rows := recorder.Entries()
	if len(rows) != 1 || rows[0].OperatorID != "op_case" || rows[0].Outcome != numberlookup.OutcomeFound || rows[0].EntityID != "ord_gate_1" {
		t.Fatalf("the served lookup must be audited under the authenticated operator, not the envelope's actor: %+v", rows)
	}
}

// 不接服务（NumberLookup=nil）⇒ 命令按未实现处理，而不是放行或崩溃。
func TestPublicNumberLookupUnwiredIsNotImplemented(t *testing.T) {
	server, _, orderNo := lookupGateServer(t)
	server.NumberLookup = nil
	if code, result := lookupRequest(server, "case_token", orderNo, "idem_gate_unwired_1"); result.Error == nil || result.Error.ErrorCode != "COMMAND_NOT_IMPLEMENTED" {
		t.Fatalf("unwired lookup must be COMMAND_NOT_IMPLEMENTED, got %d %+v", code, result)
	}
}
