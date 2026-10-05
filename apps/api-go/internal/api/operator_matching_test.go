package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/matching"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-MATCHING-TUNABLES-001：撮合引擎管理。
//
// 这一组钉的是**门、校验、留痕、界面三列账**。SQL 不在这里 —— 假存储证明不了列名与
// JSON path，那部分在 internal/platform/postgres 的集成测试里对真库跑
// （OPS-MERCHANT-001 就是这么补上的：内存桩全绿，而那句 SQL 解析期就炸）。

type fakeMatching struct {
	stored     map[string]matching.TunableChange
	setValues  []map[string]float64
	setBy      []string
	trace      []matching.TraceBatch
	summary    matching.TraceSummary
	failRead   bool
	failWrite  bool
	writeCalls int
}

func (f *fakeMatching) TunableOverrides(context.Context) (map[string]matching.TunableChange, error) {
	if f.failRead {
		return nil, errors.New("boom")
	}
	if f.stored == nil {
		return map[string]matching.TunableChange{}, nil
	}
	return f.stored, nil
}

func (f *fakeMatching) SetTunableOverrides(_ context.Context, values map[string]float64, by string) (map[string]int, error) {
	f.writeCalls++
	if f.failWrite {
		return nil, errors.New("db is down")
	}
	f.setValues = append(f.setValues, values)
	f.setBy = append(f.setBy, by)
	versions := map[string]int{}
	for key := range values {
		versions[key] = 1
	}
	return versions, nil
}

func (f *fakeMatching) DecisionTrace(context.Context, int) ([]matching.TraceBatch, matching.TraceSummary, error) {
	return f.trace, f.summary, nil
}

func matchingServer(audit *operatoraudit.Recorder, store matching.ConsoleStore) *Server {
	server := accessServer(audit, []string{"op_all", "op_pay", "op_none"}, map[string]map[OperatorScope]bool{
		"op_pay":  {ScopePayments: true},
		"op_none": {},
	})
	server.Matching = store
	return server
}

func postOperatorJSON(server *Server, path, token string, body any) *httptest.ResponseRecorder {
	raw, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/operator/"+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

// 门必须是 MARKETPLACE（动的是全平台撮合口径），不是「是运营就行」。
// 每次改动 —— 包括被拒的 —— 都要留痕：事后有人问「那周为什么便宜排在可靠前面」，
// 得查得到是谁、按什么理由改的。
func TestOperatorMatchingTunablesDoorIsMarketplaceAndAudited(t *testing.T) {
	t.Cleanup(func() { matching.SetTunables(matching.DefaultTunables()) })
	matching.SetTunables(matching.DefaultTunables())
	store := &fakeMatching{}
	auditStore := &fakeAuditStore{}
	server := matchingServer(operatoraudit.NewRecorder(auditStore), store)

	// 只持有 PAYMENTS 的运营：撮合口径与他无关。
	if rec := postOperatorJSON(server, "matching/tunables", "op_pay_token", map[string]any{
		"tunables": map[string]float64{"reliabilityWeight": 45}, "reason": "测试",
	}); rec.Code != http.StatusForbidden {
		t.Fatalf("PAYMENTS-only operator got %d, want 403 —— 门没落在 MARKETPLACE 上", rec.Code)
	}
	// 被显式清空权限的运营，同样不行。
	if rec := postOperatorJSON(server, "matching/tunables", "op_none_token", map[string]any{
		"tunables": map[string]float64{"reliabilityWeight": 45}, "reason": "测试",
	}); rec.Code != http.StatusForbidden {
		t.Fatalf("zero-scope operator got %d, want 403", rec.Code)
	}
	// 普通用户连读都不行，没会话 401。
	if rec := consoleGet(server, "matching", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("ordinary user got %d reading the engine, want 403", rec.Code)
	}
	if rec := consoleGet(server, "matching", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session got %d, want 401", rec.Code)
	}
	if store.writeCalls != 0 {
		t.Fatalf("被拒的尝试写进了库里 (%d 次) —— 门后面的代码不该跑", store.writeCalls)
	}

	// 有 MARKETPLACE 的运营改一个数：库里要有、进程里立刻生效、审计留下 from/to 和理由。
	if rec := postOperatorJSON(server, "matching/tunables", "op_all_token", map[string]any{
		"tunables": map[string]float64{"reliabilityWeight": 45},
		"reason":   "反馈说太偏袒便宜，先加重履约",
	}); rec.Code != http.StatusOK {
		t.Fatalf("legit write got %d %s", rec.Code, rec.Body.String())
	}
	if len(store.setValues) != 1 || store.setValues[0]["reliabilityWeight"] != 45 {
		t.Fatalf("库里写的是 %v", store.setValues)
	}
	if store.setBy[0] != "op_all" {
		t.Fatalf("updated_by = %q —— 「谁改的」不能有第二个答案", store.setBy[0])
	}
	if got := matching.CurrentTunables().ReliabilityWeight; got != 45 {
		t.Fatalf("旋钮没在进程里生效: %g（界面说改了、引擎还在按旧数跑，又是一笔两份账）", got)
	}
	if len(auditStore.rows) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(auditStore.rows))
	}
	row := auditStore.rows[0]
	if row.Action != "MATCHING_TUNABLES_UPDATE" || row.Outcome != operatoraudit.OutcomeOK {
		t.Errorf("audit row = %+v", row)
	}
	if row.Scope != string(ScopeMarketplace) {
		t.Errorf("scope = %q, want MARKETPLACE（真正过的那道门）", row.Scope)
	}
	detail, _ := json.Marshal(row.Detail)
	if !strings.Contains(string(detail), `"reason"`) || !strings.Contains(string(detail), `"from"`) {
		t.Fatalf("审计详情里没有理由或改动前后值: %s", detail)
	}

	// 越界的值必须整套拒掉、一个都不落库，并且**留下被拒的记录**。
	before := matching.CurrentTunables()
	if rec := postOperatorJSON(server, "matching/tunables", "op_all_token", map[string]any{
		"tunables": map[string]float64{"responseWeight": 80, "reliabilityWeight": 200},
		"reason":   "把便宜排前面",
	}); rec.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range write got %d, want 400", rec.Code)
	}
	if len(store.setValues) != 1 {
		t.Fatalf("越界的一整套被写进了库里 (%d 次)", len(store.setValues))
	}
	if matching.CurrentTunables() != before {
		t.Fatal("被拒绝的请求改动了生效值")
	}
	if len(auditStore.rows) != 2 || auditStore.rows[1].Outcome != operatoraudit.OutcomeDenied {
		t.Fatalf("被拒的尝试必须留痕: %+v", auditStore.rows)
	}

	// 没有理由 = 不收。
	if rec := postOperatorJSON(server, "matching/tunables", "op_all_token", map[string]any{
		"tunables": map[string]float64{"reliabilityWeight": 40},
	}); rec.Code != http.StatusBadRequest {
		t.Fatalf("缺少 reason 的请求 got %d, want 400", rec.Code)
	}
}

// 这一页最要紧的性质：当前值 / 默认值 / 库里存的，三列一起摆。
// 生效值与库里不一致时（别的实例改了没重载，或那个值已经越界）必须报出来。
func TestOperatorMatchingPageShowsCurrentDefaultAndStoredProvenance(t *testing.T) {
	t.Cleanup(func() { matching.SetTunables(matching.DefaultTunables()) })
	matching.SetTunables(matching.DefaultTunables())
	at := time.Date(2026, 10, 5, 9, 30, 0, 0, time.UTC)
	store := &fakeMatching{stored: map[string]matching.TunableChange{
		"reliabilityWeight": {Key: "reliabilityWeight", Value: 45, UpdatedBy: "op_all", UpdatedAt: at, Version: 3},
	}}
	server := matchingServer(nil, store)

	rec := consoleGet(server, "matching", "op_all_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string        `json:"dataSource"`
		Tunables   []tunableView `json:"tunables"`
		Warnings   []string      `json:"warnings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q", body.DataSource)
	}
	if len(body.Tunables) != len(matching.TunableDefs()) {
		t.Fatalf("界面上 %d 个旋钮，定义表里有 %d 个 —— 漏一个就会让人以为那个不能调",
			len(body.Tunables), len(matching.TunableDefs()))
	}
	overridden := 0
	for _, v := range body.Tunables {
		if v.Description == "" {
			t.Fatalf("旋钮 %q 没有说明：运营看不到它管什么，就不敢调也不敢确认", v.Key)
		}
		if v.DefaultValue == 0 {
			t.Fatalf("%q 没有默认值可对照", v.Key)
		}
		if v.Source == "OVERRIDE" {
			overridden++
			if v.UpdatedBy != "op_all" || v.Version != 3 || v.StoredValue == nil || *v.StoredValue != 45 {
				t.Fatalf("OVERRIDE 那一列的来历不全: %+v", v)
			}
		}
	}
	if overridden != 1 {
		t.Fatalf("有 %d 项被标成 OVERRIDE，库里其实只有 reliabilityWeight 一项", overridden)
	}
	// 库里存 45、进程还在按 40 跑：这个缝隙必须写在脸上。
	joined := strings.Join(body.Warnings, "\n")
	if !strings.Contains(joined, "reliabilityWeight") {
		t.Fatalf("库里 45 / 引擎 40 这种对不上居然一个字都没有: %v", body.Warnings)
	}

	// 加载之后（两边一致）不该再有这条。
	matching.SetTunables(mustTestTunables(t, map[string]float64{"reliabilityWeight": 45}))
	after := consoleGet(server, "matching", "op_all_token")
	var afterBody struct{ Warnings []string }
	if err := json.Unmarshal(after.Body.Bytes(), &afterBody); err != nil {
		t.Fatal(err)
	}
	for _, w := range afterBody.Warnings {
		if strings.Contains(w, "库里存的是") {
			t.Fatalf("两边已经一致了还在报分歧: %q", w)
		}
	}

	// 没有库：一个数都不给。
	noStore := matchingServer(nil, nil)
	rec = consoleGet(noStore, "matching", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), OperatorNotConnectedSource) {
		t.Fatalf("没有库却给了别的状态: %d %s", rec.Code, rec.Body.String())
	}
}

func TestOperatorMatchingTraceReportsWhatItActuallyRead(t *testing.T) {
	rank := matching.Breakdown{Reliability: 30, Total: 60}
	store := &fakeMatching{
		trace: []matching.TraceBatch{{
			BatchID: "cb_1", NeedID: "need_1", MarketID: "hanoi", CandidateCount: 2,
			Candidates: []matching.TraceCandidate{
				{AgentID: "agent_a", Name: "阿明", ReferencePrice: 300000, Ranking: &rank},
				{AgentID: "agent_b", Name: "小美", ReferencePrice: 200000},
			},
		}},
		summary: matching.TraceSummary{Batches: 7, WithRank: 1},
	}
	server := matchingServer(nil, store)
	rec := consoleGet(server, "matching/trace", "op_all_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Summary matching.TraceSummary `json:"summary"`
		Batches []matching.TraceBatch `json:"batches"`
		Notes   []string              `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Summary.Batches != 7 || len(body.Batches) != 1 || body.Batches[0].Candidates[0].Ranking.Total != 60 {
		t.Fatalf("读回来的不是库里那份快照: %+v", body)
	}
	if !strings.Contains(strings.Join(body.Notes, "\n"), "7") {
		t.Fatalf("页面没交代盘子里到底有几次撮合: %v", body.Notes)
	}
	// 一次留痕都没有时，要说清「空白是事实」而不是「没接线」。
	empty := consoleGet(matchingServer(nil, &fakeMatching{}), "matching/trace", "op_all_token")
	if !strings.Contains(empty.Body.String(), "一次撮合留痕都没有") {
		t.Fatalf("空表没有解释: %s", empty.Body.String())
	}
}

func TestOperatorMatchingWriteFailureKeepsEngineAndAudits(t *testing.T) {
	t.Cleanup(func() { matching.SetTunables(matching.DefaultTunables()) })
	matching.SetTunables(matching.DefaultTunables())
	auditStore := &fakeAuditStore{}
	server := matchingServer(operatoraudit.NewRecorder(auditStore), &fakeMatching{failWrite: true})
	before := matching.CurrentTunables()
	rec := postOperatorJSON(server, "matching/tunables", "op_all_token", map[string]any{
		"tunables": map[string]float64{"fitPoints": 80}, "reason": "偏袒便宜",
	})
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500（库里没写进去就不能说改了）", rec.Code)
	}
	if matching.CurrentTunables() != before {
		t.Fatal("落库失败却把进程里的生效值换了 —— 界面与引擎又各说一套")
	}
	if len(auditStore.rows) != 1 || auditStore.rows[0].Outcome != operatoraudit.OutcomeError {
		t.Fatalf("写失败必须留一条 ERROR 审计: %+v", auditStore.rows)
	}
}

func mustTestTunables(t *testing.T, over map[string]float64) matching.Tunables {
	t.Helper()
	next, err := matching.DefaultTunables().With(over)
	if err != nil {
		t.Fatal(err)
	}
	return next
}
