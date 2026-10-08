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

	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/storeboard"
)

// STORE-ATTRIBUTION-P1：门店预约与承载工作台。这里只钉 handler 能被钉住的事：门、窗口、
// 缺数据源时的形状，以及最要紧的一条 —— **算不出来的数必须原样留在 JSON 的 null 上**。
// SQL 本身（三组各一条查询）在 internal/storeboard 与它的 postgres 集成测试里。

type fakeStoreBoardSource struct {
	board storeboard.Board
	since time.Time
	calls int
}

func (f *fakeStoreBoardSource) Board(_ context.Context, since time.Time) (storeboard.Board, error) {
	f.calls++
	f.since = since
	return f.board, nil
}

func storeBoardServer(t *testing.T, source storeboard.Source) *Server {
	t.Helper()
	server := accessServer(operatoraudit.NewRecorder(&fakeAuditStore{}), []string{"op_all", "op_pay"}, nil)
	server.StoreBoard = source
	return server
}

// floatPtr / intPtr 住在 operator_market_board_test.go（同包），boolPtr 只有这一页用。
func boolPtr(v bool) *bool { return &v }

type storeBoardBody struct {
	DataSource string           `json:"dataSource"`
	WindowDays int              `json:"windowDays"`
	Board      storeboard.Board `json:"board"`
}

func decodeStoreBoard(t *testing.T, rec *httptest.ResponseRecorder) storeBoardBody {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("store board read got %d %s", rec.Code, rec.Body.String())
	}
	var body storeBoardBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	return body
}

// 一页有数时：门要关住非运营，数要原样透传，窗口要真的落到 since 上。
func TestStoreBoardIsOperatorOnlyAndPassesTheBoardThrough(t *testing.T) {
	at := time.Date(2026, 10, 7, 9, 30, 0, 0, time.UTC)
	src := &fakeStoreBoardSource{board: storeboard.Board{
		Coverage:        storeboard.Coverage{Bookings: 4, Attributed: 3, Rate: floatPtr(0.75)},
		AttributedSince: &at,
		Stores: []storeboard.StoreRow{
			{
				StoreID: "st_a", Name: "木光咖啡", BusinessID: "biz_a",
				Bookings: 2, Cancelled: 1, CancelRate: floatPtr(1.0 / 3.0),
				CapacityPct: intPtr(61), ForecastPct: intPtr(74),
				AcceptingTraffic: boolPtr(true), SnapshotAt: &at, SnapshotAgeMinutes: intPtr(12),
			},
			{StoreID: "st_b", Name: "巷口面馆", BusinessID: "biz_b"},
		},
		UnclaimedScenes: 1,
	}}
	server := storeBoardServer(t, src)

	if rec := consoleGet(server, "store-board", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session must be 401, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := consoleGet(server, "store-board", "user_token"); rec.Code != http.StatusForbidden {
		t.Fatalf("an ordinary user must be 403, got %d %s", rec.Code, rec.Body.String())
	}

	body := decodeStoreBoard(t, consoleGet(server, "store-board", "op_all_token"))
	if body.DataSource != OperatorLiveSource || body.WindowDays != storeBoardDefaultDays {
		t.Fatalf("dataSource=%q windowDays=%d, want LIVE / %d", body.DataSource, body.WindowDays, storeBoardDefaultDays)
	}
	board := body.Board
	if board.Coverage.Bookings != 4 || board.Coverage.Attributed != 3 ||
		board.Coverage.Rate == nil || math.Abs(*board.Coverage.Rate-0.75) > 1e-9 {
		t.Fatalf("coverage did not pass through: %+v", board.Coverage)
	}
	if board.AttributedSince == nil || !board.AttributedSince.Equal(at) {
		t.Fatalf("attributedSince did not pass through: %v", board.AttributedSince)
	}
	if len(board.Stores) != 2 {
		t.Fatalf("stores did not pass through: %+v", board.Stores)
	}
	first := board.Stores[0]
	if first.StoreID != "st_a" || first.Name != "木光咖啡" || first.Bookings != 2 || first.Cancelled != 1 {
		t.Fatalf("first store row wrong: %+v", first)
	}
	if first.CancelRate == nil || math.Abs(*first.CancelRate-1.0/3.0) > 1e-9 ||
		first.CapacityPct == nil || *first.CapacityPct != 61 ||
		first.ForecastPct == nil || *first.ForecastPct != 74 ||
		first.AcceptingTraffic == nil || !*first.AcceptingTraffic ||
		first.SnapshotAt == nil || first.SnapshotAgeMinutes == nil || *first.SnapshotAgeMinutes != 12 {
		t.Fatalf("snapshot fields did not pass through: %+v", first)
	}
	if board.UnclaimedScenes != 1 {
		t.Fatalf("unclaimedScenes did not pass through: %d", board.UnclaimedScenes)
	}
	if src.calls != 1 {
		t.Fatalf("the source was asked exactly once, got %d", src.calls)
	}
	if waited := time.Since(src.since); waited < 29*24*time.Hour || waited > 31*24*time.Hour {
		t.Fatalf("the default window must be the last 30 days, since was %s ago", waited)
	}
}

// 一个数都算不出来的时候（没有一单 / 分母为 0 / 那家店从来没上报过承载）：
// JSON 里必须是 null。序列化把 null 变成 0 的话，运营会读成「归因率 0%」「这家店没人来」
// 「承载 0% = 明确空了」，而真相是「这段时间没有单」「从来没上报过」—— 三种结论要采取
// 的动作完全不同（等 / 去接负载上报 / 去看现场）。
func TestStoreBoardRefusesToInventMetricsWhenNothingIsComputable(t *testing.T) {
	server := storeBoardServer(t, &fakeStoreBoardSource{board: storeboard.Board{
		Stores: []storeboard.StoreRow{{StoreID: "st_b", Name: "巷口面馆", BusinessID: "biz_b"}},
	}})
	rec := consoleGet(server, "store-board", "op_all_token")
	body := decodeStoreBoard(t, rec)

	if body.DataSource != OperatorLiveSource {
		t.Fatalf("dataSource = %q, want LIVE（有数据源，只是这个窗口里没有可算的数）", body.DataSource)
	}
	for _, field := range []string{
		"attributedSince", "rate", "cancelRate", "capacityPct", "forecastPct",
		"acceptingTraffic", "snapshotAt", "snapshotAgeMinutes",
	} {
		if !strings.Contains(rec.Body.String(), `"`+field+`":null`) {
			t.Fatalf("%s must be JSON null, not 0 — body: %s", field, rec.Body.String())
		}
	}
	var raw struct {
		Board struct {
			Coverage map[string]any   `json:"coverage"`
			Stores   []map[string]any `json:"stores"`
		} `json:"board"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if raw.Board.Coverage["rate"] != nil {
		t.Fatalf("coverage.rate decoded as something else: %+v", raw.Board.Coverage)
	}
	row := raw.Board.Stores[0]
	for _, field := range []string{"capacityPct", "forecastPct", "acceptingTraffic", "snapshotAt", "snapshotAgeMinutes", "cancelRate"} {
		if row[field] != nil {
			t.Fatalf("a store with no snapshot must report %s = null, got %v", field, row[field])
		}
	}
	// 计数是 0，因为真的没有单 —— 这是真计数，不是算不出来。
	if body.Board.Coverage.Bookings != 0 || body.Board.Stores[0].Bookings != 0 {
		t.Fatalf("counts are 0 because nothing ran, that is a real count: %+v", body.Board)
	}
	// 空 wire 集合是 [] 不是 null：页面直接遍历它，不该为此写一层判空。
	if !strings.Contains(rec.Body.String(), `"stores":[`) {
		t.Fatalf("an empty store list must serialize as [], body: %s", rec.Body.String())
	}
}

// 窗口夹在 [1, 90]；没配库就说没配，一个数都不给。
func TestStoreBoardClampsTheWindowAndNamesTheMissingSource(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", 30}, {"?days=7", 7}, {"?days=90", 90}, {"?days=500", 90}, {"?days=0", 1}, {"?days=-3", 1}, {"?days=abc", 30},
	} {
		src := &fakeStoreBoardSource{}
		server := storeBoardServer(t, src)
		body := decodeStoreBoard(t, consoleGet(server, "store-board"+tc.query, "op_all_token"))
		if body.WindowDays != tc.want {
			t.Fatalf("?%s windowDays = %d, want %d", tc.query, body.WindowDays, tc.want)
		}
		if waited := time.Since(src.since); waited < (time.Duration(tc.want)-1)*24*time.Hour ||
			waited > (time.Duration(tc.want)+1)*24*time.Hour {
			t.Fatalf("?%s since was %s ago, want ~%d days", tc.query, waited, tc.want)
		}
	}

	bare := accessServer(operatoraudit.NewRecorder(nil), []string{"op_all"}, nil)
	rec := consoleGet(bare, "store-board", "op_all_token")
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
	if !strings.Contains(rec.Body.String(), "没配库") {
		t.Fatalf("NOT_CONNECTED must say what is missing: %s", rec.Body.String())
	}
}
