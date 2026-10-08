package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/incentive"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

type memIncentives struct {
	rules map[string]incentive.Rule
}

func (m *memIncentives) ListRules(context.Context) ([]incentive.Rule, error) {
	out := []incentive.Rule{}
	for _, r := range m.rules {
		out = append(out, r)
	}
	return out, nil
}
func (m *memIncentives) UpsertRule(_ context.Context, r incentive.Rule) error {
	if old, ok := m.rules[r.ID]; ok && old.Active {
		return nil // 生效中不改（与 Postgres 的 WHERE active=false 同义）
	}
	m.rules[r.ID] = r
	return nil
}
func (m *memIncentives) SetActive(_ context.Context, id string, active bool, _ time.Time) (bool, error) {
	r, ok := m.rules[id]
	r.Active = active
	m.rules[id] = r
	return ok, nil
}
func (m *memIncentives) Candidates(context.Context, incentive.Rule, time.Time, int) ([]string, error) {
	return nil, nil
}
func (m *memIncentives) RecordGrant(context.Context, incentive.Grant) (bool, error)  { return true, nil }
func (m *memIncentives) GrantsOf(context.Context, string) ([]incentive.Grant, error) { return nil, nil }
func (m *memIncentives) Stats(context.Context) ([]incentive.RuleStat, error)         { return nil, nil }

// OPS-INCENTIVE-001：要 PAYMENTS；现金类奖励在 API 边界就被拒；新建的规则默认不生效。
func TestIncentiveRulesNeedPaymentsScopeRefuseCashAndStartInactive(t *testing.T) {
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay", "op_none"},
		map[string]map[OperatorScope]bool{"op_pay": {ScopePayments: true}, "op_none": {ScopeModeration: true}})
	server.IncentiveStore = &memIncentives{rules: map[string]incentive.Rule{}}
	if rec := postJSON(server, "/v1/operator/incentives", "op_none_token", `{}`); rec.Code != http.StatusForbidden {
		t.Fatalf("an operator without PAYMENTS must not touch the budget: %d", rec.Code)
	}
	cash := `{"label":"首帖现金","trigger":"FIRST_POST","rewardKind":"CASH","points":50}`
	if rec := postJSON(server, "/v1/operator/incentives", "op_pay_token", cash); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "never cash") {
		t.Fatalf("cash must be refused at the API: %d %s", rec.Code, rec.Body.String())
	}
	good := `{"id":"r1","label":"首帖咖啡券","trigger":"FIRST_POST","rewardKind":"BENEFIT_CLAIM","campaignId":"c1","benefitId":"b1","active":true}`
	if rec := postJSON(server, "/v1/operator/incentives", "op_pay_token", good); rec.Code != http.StatusOK {
		t.Fatalf("a coffee voucher rule: %d %s", rec.Code, rec.Body.String())
	}
	rec := consoleGet(server, "incentives", "op_pay_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"active":false`) || !strings.Contains(rec.Body.String(), "现金违规") {
		t.Fatalf("a client-supplied active=true is ignored; rules start off: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postJSON(server, "/v1/operator/incentives/active", "op_pay_token", `{"id":"nope","active":true}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown rule: %d", rec.Code)
	}
	if rec := postJSON(server, "/v1/operator/incentives/active", "op_pay_token", `{"id":"r1","active":true}`); rec.Code != http.StatusOK {
		t.Fatalf("turn on: %d", rec.Code)
	}
}
