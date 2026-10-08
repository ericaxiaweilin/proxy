package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// MARKET-FAST-001：市场发单看板。这里只钉三件 handler 能被钉住的事：门、窗口，以及
// 「算不出来的数是 null 而不是 0」这件事没有在序列化时被悄悄改掉。
// SQL 本身（四个组各一条查询）在 internal/dispatch/postgres_market_stats.go。

type marketBoardSource struct {
	stats dispatch.MarketStats
	since time.Time
	calls int
}

func (m *marketBoardSource) Stats(context.Context, time.Time) (dispatch.Stats, error) {
	return dispatch.Stats{}, nil
}

func (m *marketBoardSource) MarketStats(_ context.Context, since time.Time) (dispatch.MarketStats, error) {
	m.calls++
	m.since = since
	return m.stats, nil
}

// statsOnlySource 只实现了 dispatch.Stats（看板接线之前的状态）：必须回 503 说清楚缺什么，
// 不能回一片空白让人以为「这段时间一单都没跑」。
type statsOnlySource struct{}

func (statsOnlySource) Stats(context.Context, time.Time) (dispatch.Stats, error) {
	return dispatch.Stats{}, nil
}

func marketBoardServer(t *testing.T, source DispatchStatsSource) *Server {
	t.Helper()
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay"}, nil)
	server.Dispatch = &dispatch.Engine{Repo: dispatch.NewMemory()}
	server.DispatchStats = source
	return server
}

func floatPtr(v float64) *float64 { return &v }
func intPtr(v int) *int           { return &v }
func near(got, want, tolerance float64) bool {
	return math.Abs(got-want) <= tolerance
}

type marketBoardBody struct {
	DataSource string               `json:"dataSource"`
	WindowDays int                  `json:"windowDays"`
	Stats      dispatch.MarketStats `json:"stats"`
}

func decodeBoard(t *testing.T, rec *httptest.ResponseRecorder) marketBoardBody {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("market board read got %d %s", rec.Code, rec.Body.String())
	}
	var body marketBoardBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return body
}

// 一页有数时：门要关住非运营，数要原样透传，窗口要真的落到 since 上。
func TestMarketBoardIsOperatorOnlyAndPassesTheStatsThrough(t *testing.T) {
	src := &marketBoardSource{stats: dispatch.MarketStats{
		Running: 3, Assigned: 2, Exhausted: 1, Cancelled: 0, WaitingForApplicants: 2,
		ConfirmRate: floatPtr(2.0 / 3.0), MedianMinutesToAssign: floatPtr(4.5),
		Selections: 10, Expired: 4, ExpiryRate: floatPtr(0.4),
		Invitations: 3, InvitedPeople: 6, InvitedThenApplied: intPtr(2), InvitedThenAppliedRate: floatPtr(2.0 / 6.0),
		InviteSkipped: map[string]int{"opportunity_has_no_location": 2, "nobody_suitable_nearby": 5},
		OwnerTookOver: 1,
	}}
	server := marketBoardServer(t, src)

	if rec := consoleGet(server, "market-dispatch", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session must be 401, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := consoleGet(server, "market-dispatch", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("an ordinary user must be 403, got %d %s", rec.Code, rec.Body.String())
	}

	body := decodeBoard(t, consoleGet(server, "market-dispatch", "op_all_token"))
	if body.DataSource != OperatorLiveSource || body.WindowDays != marketBoardDefaultDays {
		t.Fatalf("dataSource=%q windowDays=%d, want LIVE / %d", body.DataSource, body.WindowDays, marketBoardDefaultDays)
	}
	got := body.Stats
	if got.Running != 3 || got.Assigned != 2 || got.Exhausted != 1 || got.Cancelled != 0 || got.WaitingForApplicants != 2 {
		t.Fatalf("run counts did not pass through: %+v", got)
	}
	if got.ConfirmRate == nil || !near(*got.ConfirmRate, 2.0/3.0, 1e-9) {
		t.Fatalf("confirmRate = %v, want 0.6667", got.ConfirmRate)
	}
	if got.MedianMinutesToAssign == nil || !near(*got.MedianMinutesToAssign, 4.5, 1e-9) {
		t.Fatalf("medianMinutesToAssign = %v, want 4.5", got.MedianMinutesToAssign)
	}
	if got.Selections != 10 || got.Expired != 4 || got.Invitations != 3 || got.InvitedPeople != 6 || got.OwnerTookOver != 1 {
		t.Fatalf("step counters did not pass through: %+v", got)
	}
	if got.ExpiryRate == nil || !near(*got.ExpiryRate, 0.4, 1e-9) {
		t.Fatalf("expiryRate = %v, want 0.4", got.ExpiryRate)
	}
	if got.InvitedThenApplied == nil || *got.InvitedThenApplied != 2 || got.InvitedThenAppliedRate == nil ||
		!near(*got.InvitedThenAppliedRate, 2.0/6.0, 1e-9) {
		t.Fatalf("invite effect did not pass through: %+v", got)
	}
	if got.InviteSkipped["opportunity_has_no_location"] != 2 || got.InviteSkipped["nobody_suitable_nearby"] != 5 {
		t.Fatalf("skip reasons did not pass through: %+v", got.InviteSkipped)
	}
	if src.calls != 1 {
		t.Fatalf("the source was asked exactly once, got %d", src.calls)
	}
	if waited := time.Since(src.since); waited < 6*24*time.Hour || waited > 8*24*time.Hour {
		t.Fatalf("the default window must be the last 7 days, since was %s ago", waited)
	}
}

// 一个数都算不出来的时候（分母为 0 / 没人被接过 / 没人被邀过）：JSON 里必须是 null。
// 这一页要是把 null 变成 0，运营会读成「确认率 0% = 一单没成」「邀请转化 0% = 邀了没用」，
// 而真相常常是「这段时间没有单跑到终态 / 从来没邀过人」—— 两种结论要采取的动作完全不同。
func TestMarketBoardRefusesToInventMetricsWhenNothingIsComputable(t *testing.T) {
	server := marketBoardServer(t, &marketBoardSource{stats: dispatch.MarketStats{InviteSkipped: map[string]int{}}})
	rec := consoleGet(server, "market-dispatch", "op_all_token")
	body := decodeBoard(t, rec)

	if body.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q, want LIVE (有数据源，只是这个窗口里没有可算的数)", body.DataSource)
	}
	for _, field := range []string{"confirmRate", "medianMinutesToAssign", "expiryRate", "invitedThenApplied", "invitedThenAppliedRate"} {
		if !strings.Contains(rec.Body.String(), `"`+field+`":null`) {
			t.Fatalf("%s must be JSON null, not 0 — body: %s", field, rec.Body.String())
		}
	}
	// 空 wire 集合是 {} 不是 null：页面直接遍历它，不该为此写一层判空。
	if !strings.Contains(rec.Body.String(), `"inviteSkipped":{}`) {
		t.Fatalf("an empty reason map must serialize as {}, body: %s", rec.Body.String())
	}
	var raw struct {
		Stats map[string]any `json:"stats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if raw.Stats["confirmRate"] != nil || raw.Stats["expiryRate"] != nil || raw.Stats["invitedThenApplied"] != nil {
		t.Fatalf("null metrics decoded as something else: %+v", raw.Stats)
	}
	if body.Stats.Running != 0 || body.Stats.WaitingForApplicants != 0 {
		t.Fatalf("counts are 0 because nothing ran, that is a real count: %+v", body.Stats)
	}
}

// 窗口夹在 [1, 90]；数据源没接看板就说缺；没配库就说没接派单。
func TestMarketBoardClampsTheWindowAndNamesTheMissingSource(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", 7}, {"?days=30", 30}, {"?days=500", 90}, {"?days=0", 1}, {"?days=-3", 1}, {"?days=abc", 7}, {"?days=+30", 30},
	} {
		src := &marketBoardSource{}
		server := marketBoardServer(t, src)
		body := decodeBoard(t, consoleGet(server, "market-dispatch"+tc.query, "op_all_token"))
		if body.WindowDays != tc.want {
			t.Fatalf("?%s windowDays = %d, want %d", tc.query, body.WindowDays, tc.want)
		}
		if waited := time.Since(src.since); waited < (time.Duration(tc.want)-1)*24*time.Hour ||
			waited > (time.Duration(tc.want)+1)*24*time.Hour {
			t.Fatalf("?%s since was %s ago, want ~%d days", tc.query, waited, tc.want)
		}
	}

	// 接了 dispatch.Stats 但没接 MarketStats 的部署：缺口要说出来。
	partial := marketBoardServer(t, statsOnlySource{})
	rec := consoleGet(partial, "market-dispatch", "op_all_token")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "market_stats_unavailable") {
		t.Fatalf("a source without MarketStats must say so, got %d %s", rec.Code, rec.Body.String())
	}

	// 没配库：跟派单工作台一样回 NOT_CONNECTED，一个数都不给。
	bare := accessServer(operatoraudit.NewRecorder(nil), []string{"op_all"}, nil)
	rec = consoleGet(bare, "market-dispatch", "op_all_token")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), OperatorNotConnectedSource) {
		t.Fatalf("without a database the board must say NOT_CONNECTED, got %d %s", rec.Code, rec.Body.String())
	}
	var bareBody map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &bareBody)
	for key := range bareBody {
		if key != "dataSource" && key != "notes" {
			t.Fatalf("NOT_CONNECTED must not carry any metric, found %q", key)
		}
	}
}
