package api

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// STORE-ATTRIBUTION-P1：门店预约与承载工作台。
//
//	GET /v1/operator/store-board?days=   每个 ACTIVE 门店这段时间拿到多少预约、取消多少，
//	                                      以及那家店自己发布的最新承载快照（多快以前）。
//
// 这一页必须和派单工作台一样回答「没配库」：没有数据库时回 NOT_CONNECTED + 一句说明，
// 一个数都不给。给一片空白会被读成「所有门店都没生意」。
//
// 算不出来的数是 null（界面显示「—」）：空分母、或者那家店从来没有承载快照，
// 都如实是 null，不回 0。这一页的口径写在 storeboard.Board 上。
const (
	storeBoardDefaultDays = 30
	storeBoardMinDays     = 1
	storeBoardMaxDays     = 90
)

// storeBoardWindow：?days= 解析成 [1, 90]。写坏的值落回默认 30，而不是报错 ——
// 运营手敲一个 500 不该看到 400，只该看到被夹住的 90。
func storeBoardWindow(raw string) int {
	days := storeBoardDefaultDays
	if v, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
		days = v
	}
	if days < storeBoardMinDays {
		return storeBoardMinDays
	}
	if days > storeBoardMaxDays {
		return storeBoardMaxDays
	}
	return days
}

func (s *Server) operatorStoreBoard(w http.ResponseWriter, r *http.Request) {
	if s.StoreBoard == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"dataSource": OperatorNotConnectedSource,
			"notes":      []string{"没配库"},
		})
		return
	}
	days := storeBoardWindow(r.URL.Query().Get("days"))
	now := time.Now().UTC()
	board, err := s.StoreBoard.Board(r.Context(), now.Add(-time.Duration(days)*24*time.Hour))
	if err != nil {
		log.Printf("operator store board: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store_board_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": days,
		"board":      board,
	})
}
