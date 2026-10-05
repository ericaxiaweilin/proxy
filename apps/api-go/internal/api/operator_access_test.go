package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/gravity"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-ACCESS-001：运营权限要有可观测面，而且它报的必须是**代码真的在执行**的那一套。
//
// 词汇表的每个 scope 解锁哪些命令，从 requiredOperatorScope 现算，不另抄一份 ——
// 抄一份就是让页面去描述一个后端并不执行的权限模型。这两条钉双向一致。

func TestOperatorScopeDescriptionsCoverTheVocabulary(t *testing.T) {
	known := map[OperatorScope]bool{}
	for _, scope := range allOperatorScopes {
		known[scope] = true
		if operatorScopeDescription[scope] == "" {
			t.Errorf("scope %q has no description — the console would render it blank, "+
				"so an operator cannot tell what they are being granted", string(scope))
		}
	}
	for scope := range operatorScopeDescription {
		if !known[scope] {
			t.Errorf("description for %q but that scope is not in allOperatorScopes — "+
				"documenting a power nobody has", string(scope))
		}
	}
}

func TestCommandsByScopeIsDerivedNotCopied(t *testing.T) {
	byScope := commandsByScope()

	known := map[OperatorScope]bool{}
	for _, scope := range allOperatorScopes {
		known[scope] = true
	}
	for scope := range byScope {
		if !known[scope] {
			t.Errorf("commandsByScope has unknown scope %q", string(scope))
		}
	}

	seen := map[string]int{}
	for scope, commands := range byScope {
		for _, c := range commands {
			want, gated := RequiredOperatorScope(c)
			if !gated {
				t.Errorf("scope %q lists %q which is not a gated command", string(scope), c)
			}
			if want != scope {
				t.Errorf("%q is listed under %q but its required scope is %q", c, string(scope), string(want))
			}
			seen[c]++
		}
	}
	if len(seen) != len(requiredOperatorScope) {
		t.Fatalf("commandsByScope covers %d commands, requiredOperatorScope has %d — "+
			"a gated command nobody lists is invisible in the console", len(seen), len(requiredOperatorScope))
	}
	for c, n := range seen {
		if n != 1 {
			t.Errorf("%q is listed under %d scopes, want exactly 1", c, n)
		}
	}
}

type fakeAuditStore struct {
	mu   sync.Mutex
	rows []operatoraudit.Entry
	fail bool
}

func (f *fakeAuditStore) Append(_ context.Context, e operatoraudit.Entry) error {
	if f.fail {
		return errors.New("audit store down")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows = append(f.rows, e)
	return nil
}

func (f *fakeAuditStore) Recent(_ context.Context, _ int) ([]operatoraudit.Entry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]operatoraudit.Entry(nil), f.rows...), nil
}

func (f *fakeAuditStore) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.rows)
}

func accessServer(audit *operatoraudit.Recorder, principals []string, scoped map[string]map[OperatorScope]bool) *Server {
	tokens := map[string]identity.AuthenticatedSession{
		"op_all_token":  {Actor: command.Actor{Type: "USER", ID: "op_all"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "op_all"}},
		"op_pay_token":  {Actor: command.Actor{Type: "USER", ID: "op_pay"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "op_pay"}},
		"op_none_token": {Actor: command.Actor{Type: "USER", ID: "op_none"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "op_none"}},
		"user_token":    {Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_xiaomei"}},
	}
	return &Server{
		RateLimit:     NewRateLimiter(0, 100),
		Operator:      NewStaticOperatorGate(principals).WithPrincipalScopes(scoped),
		Gravity:       gravity.NewMemory(),
		Audit:         audit,
		Authenticator: strictAuthenticator{validTokens: tokens},
	}
}

func TestOperatorAccessIsOperatorOnlyButNeedsNoSpecificScope(t *testing.T) {
	server := accessServer(nil, []string{"op_all", "op_pay", "op_none"}, map[string]map[OperatorScope]bool{
		"op_pay":  {ScopePayments: true},
		"op_none": {},
	})

	if rec := consoleGet(server, "access", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session must be 401, got %d", rec.Code)
	}
	if rec := consoleGet(server, "access", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("an ordinary user must be 403, got %d", rec.Code)
	}
	// op_pay holds only PAYMENTS. The page must still open: an operator who cannot see
	// their own permissions has to guess them, which is what a broken model looks like.
	if rec := consoleGet(server, "access", "op_pay_token"); rec.Code != http.StatusOK {
		t.Fatalf("a narrowed operator must still read the access page, got %d %s", rec.Code, rec.Body.String())
	}
	// ...while the analytics-gated pages stay closed to them. That contrast is the point.
	if rec := consoleGet(server, "gravity", "op_pay_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("PAYMENTS-only must not read the per-person gravity page, got %d", rec.Code)
	}
	if rec := consoleGet(server, "access", "op_none_token"); rec.Code != http.StatusOK {
		t.Fatalf("an explicitly empty scope set is still an operator, got %d", rec.Code)
	}
}

func TestOperatorAccessDescribesTheEnforcedModel(t *testing.T) {
	server := accessServer(nil, []string{"op_all", "op_pay", "op_none"}, map[string]map[OperatorScope]bool{
		"op_pay":  {ScopePayments: true},
		"op_none": {},
	})
	rec := consoleGet(server, "access", "op_pay_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string `json:"dataSource"`
		Scopes     []struct {
			Scope       string   `json:"scope"`
			Description string   `json:"description"`
			Commands    []string `json:"commands"`
		} `json:"scopes"`
		Principals []struct {
			PrincipalID string   `json:"principalId"`
			Scopes      []string `json:"scopes"`
			Narrowed    bool     `json:"narrowed"`
			Source      string   `json:"source"`
		} `json:"principals"`
		Me struct {
			PrincipalID string   `json:"principalId"`
			Scopes      []string `json:"scopes"`
			Narrowed    bool     `json:"narrowed"`
		} `json:"me"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.DataSource != "LIVE" {
		t.Fatalf("dataSource = %q, want LIVE — this page describes the running config, not a fixture", body.DataSource)
	}
	if len(body.Scopes) != len(allOperatorScopes) {
		t.Fatalf("scopes = %d, want %d", len(body.Scopes), len(allOperatorScopes))
	}
	byName := map[string][]string{}
	for _, s := range body.Scopes {
		if s.Description == "" {
			t.Errorf("scope %s has an empty description", s.Scope)
		}
		byName[s.Scope] = s.Commands
	}
	// PAYMENTS really does unlock the payment commands, and only those.
	if len(byName["PAYMENTS"]) == 0 {
		t.Error("PAYMENTS lists no commands — the page would describe a scope that does nothing")
	}
	for _, c := range byName["PAYMENTS"] {
		if scope, _ := RequiredOperatorScope(c); scope != ScopePayments {
			t.Errorf("PAYMENTS lists %q whose required scope is %q", c, string(scope))
		}
	}

	// "No entry" and "entry with zero scopes" are opposite outcomes and must not render
	// the same: the first holds everything, the second denies everything.
	got := map[string]struct {
		narrowed bool
		scopes   int
	}{}
	for _, p := range body.Principals {
		got[p.PrincipalID] = struct {
			narrowed bool
			scopes   int
		}{p.Narrowed, len(p.Scopes)}
	}
	if g := got["op_all"]; g.narrowed || g.scopes != len(allOperatorScopes) {
		t.Errorf("op_all (no env entry) = %+v, want unnarrowed with all %d scopes", g, len(allOperatorScopes))
	}
	if g := got["op_pay"]; !g.narrowed || g.scopes != 1 {
		t.Errorf("op_pay = %+v, want narrowed to exactly 1 scope", g)
	}
	if g := got["op_none"]; !g.narrowed || g.scopes != 0 {
		t.Errorf("op_none = %+v, want narrowed to an explicit empty set (deny all), not 'all scopes'", g)
	}

	if body.Me.PrincipalID != "op_pay" || len(body.Me.Scopes) != 1 || !body.Me.Narrowed {
		t.Errorf("me = %+v, want op_pay with its single scope", body.Me)
	}
}

// OPS-AUDIT-001：运营的写操作要留痕，而审计写不进去时缺口要看得见。
func TestOperatorWritesAreAudited(t *testing.T) {
	store := &fakeAuditStore{}
	server := accessServer(operatoraudit.NewRecorder(store), []string{"op_all"}, nil)

	req := httptest.NewRequest(http.MethodPost, "/v1/operator/gravity/recompute", nil)
	req.Header.Set("Authorization", "Bearer op_all_token")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("recompute status %d %s", rec.Code, rec.Body.String())
	}
	if store.count() != 1 {
		t.Fatalf("recompute wrote %d audit rows, want 1", store.count())
	}
	row := store.rows[0]
	if row.Action != "GRAVITY_RECOMPUTE" || row.OperatorID != "op_all" || row.Outcome != operatoraudit.OutcomeOK {
		t.Errorf("audit row = %+v", row)
	}
	if row.Scope != string(ScopeAnalytics) {
		t.Errorf("scope = %q, want ANALYTICS — the row must name the authority actually exercised", row.Scope)
	}

	// The access page then reports the row back, so "who touched what" is answerable.
	var body struct {
		Audit struct {
			Connected   bool                  `json:"connected"`
			Recorded    int64                 `json:"recorded"`
			WriteFailed int64                 `json:"writeFailed"`
			Recent      []operatoraudit.Entry `json:"recent"`
		} `json:"audit"`
	}
	_ = json.Unmarshal(consoleGet(server, "access", "op_all_token").Body.Bytes(), &body)
	if !body.Audit.Connected || body.Audit.Recorded != 1 || len(body.Audit.Recent) != 1 {
		t.Fatalf("audit section = %+v, want connected with the one row", body.Audit)
	}
	if body.Audit.Recent[0].Action != "GRAVITY_RECOMPUTE" {
		t.Errorf("recent[0] = %+v", body.Audit.Recent[0])
	}
}

func TestAuditWriteFailureIsCountedNotSwallowed(t *testing.T) {
	store := &fakeAuditStore{fail: true}
	recorder := operatoraudit.NewRecorder(store)
	server := accessServer(recorder, []string{"op_all"}, nil)

	req := httptest.NewRequest(http.MethodPost, "/v1/operator/gravity/recompute", nil)
	req.Header.Set("Authorization", "Bearer op_all_token")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	// The action still succeeds: it already happened, and rolling it back would use data
	// consistency to paper over an audit gap. What must not happen is silence.
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	recorded, failed := recorder.Counts()
	if recorded != 1 || failed != 1 {
		t.Fatalf("counts = (%d recorded, %d failed), want (1, 1)", recorded, failed)
	}
	var body struct {
		Audit struct {
			WriteFailed int64 `json:"writeFailed"`
		} `json:"audit"`
	}
	_ = json.Unmarshal(consoleGet(server, "access", "op_all_token").Body.Bytes(), &body)
	if body.Audit.WriteFailed != 1 {
		t.Fatalf("the access page must surface the gap, got writeFailed=%d", body.Audit.WriteFailed)
	}
}

// No database means no audit. The page must say so rather than show an empty list, which
// reads as "nothing happened" — the same shape as a clean record.
func TestAuditReportsNotConnectedWithoutAStore(t *testing.T) {
	server := accessServer(operatoraudit.NewRecorder(nil), []string{"op_all"}, nil)
	var body struct {
		Audit struct {
			Connected bool `json:"connected"`
		} `json:"audit"`
	}
	_ = json.Unmarshal(consoleGet(server, "access", "op_all_token").Body.Bytes(), &body)
	if body.Audit.Connected {
		t.Fatal("a recorder with no store must report connected=false")
	}
}

// OPS-SCOPE-WIRED-001：PROXY_OPERATOR_SCOPES 里的 id 打错一个字母，最坏的情况是**静默无害**：
// 那个假 id 本来就没权限（所以什么事都没发生），而真正想收紧的那个人一条条目都没配上 ——
// 于是他照样全 scope，写配置的人却以为已经收紧了。这是文档层面的 fail-open，
// 只能靠启动时点名（cmd/api 把它打进启动日志）。
func TestOrphanScopeEntriesAreReported(t *testing.T) {
	gate := NewStaticOperatorGate([]string{"op_real"}).WithPrincipalScopes(map[string]map[OperatorScope]bool{
		"op_ral": {ScopeCase: true}, // 想收紧 op_real，打错成 op_ral
	})
	orphan := gate.OrphanScopePrincipals()
	if len(orphan) != 1 || orphan[0] != "op_ral" {
		t.Fatalf("orphan scope entries = %q, want exactly the one that is not allowlisted", orphan)
	}
	// 警告的意义全在这第二行上：被担心漏权限的那个人，此刻确实还是全 scope。
	all := gate.ScopesFor(command.Actor{Type: "USER", ID: "u"}, command.Principal{Type: "INDIVIDUAL", ID: "op_real"}, nil)
	if len(all) != len(allOperatorScopes) {
		t.Fatalf("op_real holds %d scopes, want all %d —— 这条警告存在就是因为收紧根本没生效", len(all), len(allOperatorScopes))
	}
	// 那个打错的 id 什么都没有（所以他不是运营，警告只是说「这条配置没起作用」）。
	if got := gate.ScopesFor(command.Actor{Type: "USER", ID: "u"}, command.Principal{Type: "INDIVIDUAL", ID: "op_ral"}, nil); len(got) != 0 {
		t.Fatalf("非白名单 id 拿到了 %v scope", got)
	}
	// 配对上了就不该报；没配 scope 也不该报。
	clean := NewStaticOperatorGate([]string{"op_real"}).WithPrincipalScopes(map[string]map[OperatorScope]bool{
		"op_real": {ScopeCase: true},
	})
	if got := clean.OrphanScopePrincipals(); len(got) != 0 {
		t.Fatalf("clean config reported %q", got)
	}
	if got := NewStaticOperatorGate([]string{"op_real"}).OrphanScopePrincipals(); len(got) != 0 {
		t.Fatalf("no scope config reported %q", got)
	}
	var nilGate *StaticOperatorGate
	if got := nilGate.OrphanScopePrincipals(); got != nil {
		t.Fatalf("nil gate must not panic, got %q", got)
	}
}
