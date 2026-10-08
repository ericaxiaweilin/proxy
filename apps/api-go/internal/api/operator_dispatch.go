package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/dispatch"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// DISPATCH-LOOP-001：派单调度工作台。
//
//	GET  /v1/operator/dispatch            派单列表（默认：在派 + 待人工）+ 顶部几个数
//	GET  /v1/operator/dispatch/run?id=    一条派单的全部流水：卡在哪一步、为什么跳过谁
//	POST /v1/operator/dispatch/actions    重派 / 点名 / 停止（MARKETPLACE scope，必填理由，落审计）
//
// 页面上的每一个数都来自 dispatch.runs / dispatch.steps；算不出来的（没有被接过的单就没有
// 「中位成单时长」）返回 null，界面显示「—」而不是 0。

// DispatchStatsSource 是工作台顶部那几个数的来源。
type DispatchStatsSource interface {
	Stats(ctx context.Context, since time.Time) (dispatch.Stats, error)
}

type dispatchRunView struct {
	dispatch.Run
	// 等当前这位多久了（秒）；没有在等的人就没有这个字段。
	WaitingSeconds *int64 `json:"waitingSeconds,omitempty"`
	Tried          int    `json:"tried"`
	Remaining      int    `json:"remaining"`
}

func viewOfRun(r dispatch.Run, now time.Time) dispatchRunView {
	v := dispatchRunView{Run: r, Tried: r.Cursor, Remaining: len(r.Candidates) - r.Cursor}
	if v.Remaining < 0 {
		v.Remaining = 0
	}
	if r.CurrentExpiresAt != nil && r.CurrentOfferID != "" {
		waited := int64(now.Sub(r.CurrentExpiresAt.Add(-dispatch.OfferTTL)).Seconds())
		v.WaitingSeconds = &waited
	}
	return v
}

func (s *Server) operatorDispatch(w http.ResponseWriter, r *http.Request) {
	if s.Dispatch == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"dataSource": OperatorNotConnectedSource,
			"notes":      []string{"没配库：自动派单没有启用（dispatch.runs 在 migration 190）。"},
		})
		return
	}
	statuses := []string{dispatch.StatusRunning, dispatch.StatusExhausted}
	if q := strings.TrimSpace(r.URL.Query().Get("status")); q == "all" {
		statuses = nil
	} else if q != "" {
		statuses = strings.Split(q, ",")
	}
	runs, err := s.Dispatch.Repo.List(r.Context(), statuses, 200)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "dispatch_query_failed"})
		return
	}
	now := time.Now().UTC()
	views := make([]dispatchRunView, 0, len(runs))
	for _, run := range runs {
		views = append(views, viewOfRun(run, now))
	}
	out := map[string]any{"dataSource": OperatorLiveSource, "runs": views, "offerTtlSeconds": int(dispatch.OfferTTL / time.Second)}
	if s.DispatchStats != nil {
		since := now.Add(-7 * 24 * time.Hour)
		if stats, err := s.DispatchStats.Stats(r.Context(), since); err == nil {
			out["stats"] = map[string]any{
				"since": since, "running": stats.Running, "assigned": stats.Assigned,
				"exhausted": stats.Exhausted, "cancelled": stats.Cancelled,
				"medianMinutesToAssign": stats.MedianMinutesToAssign,
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) operatorDispatchRun(w http.ResponseWriter, r *http.Request) {
	if s.Dispatch == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dispatch_not_configured"})
		return
	}
	run, steps, err := s.Dispatch.Repo.Get(r.Context(), r.URL.Query().Get("id"))
	if errors.Is(err, dispatch.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "dispatch_run_not_found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "dispatch_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "run": viewOfRun(run, time.Now().UTC()), "steps": steps})
}

func (s *Server) operatorDispatchAction(w http.ResponseWriter, r *http.Request) {
	if s.Dispatch == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dispatch_not_configured"})
		return
	}
	var body struct {
		RunID   string `json:"runId"`
		Action  string `json:"action"` // retry | cancel | assign
		AgentID string `json:"agentId"`
		Price   int64  `json:"price"`
		Reason  string `json:"reason"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body) != nil ||
		body.RunID == "" || strings.TrimSpace(body.Reason) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "run_action_and_reason_required"})
		return
	}
	operator, _ := s.operatorIdentity(r)
	if operator == "" {
		operator = "unknown"
	}
	detail := map[string]any{"action": body.Action, "reason": body.Reason}
	var (
		run dispatch.Run
		err error
	)
	switch body.Action {
	case "retry":
		run, err = s.Dispatch.Retry(r.Context(), body.RunID, operator, body.Reason)
	case "cancel":
		run, err = s.Dispatch.Cancel(r.Context(), body.RunID, operator, body.Reason)
	case "assign":
		if body.AgentID == "" || body.Price <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "assign_needs_agent_and_price"})
			return
		}
		detail["agentId"], detail["price"] = body.AgentID, body.Price
		run, _, err = s.Dispatch.Assign(r.Context(), body.RunID, dispatch.Candidate{AgentID: body.AgentID, Price: body.Price, Currency: "VND"}, operator, body.Reason)
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_action"})
		return
	}
	entry := operatoraudit.Entry{TargetKind: "DispatchRun", TargetID: body.RunID, Detail: detail}
	switch {
	case errors.Is(err, dispatch.ErrNotFound):
		entry.Outcome = operatoraudit.OutcomeDenied
		s.auditWrite(r, "DISPATCH_RUN_ACTION", string(ScopeMarketplace), entry)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "dispatch_run_not_found"})
		return
	case errors.Is(err, dispatch.ErrVersionConflict):
		entry.Outcome = operatoraudit.OutcomeDenied
		detail["error"] = "version_conflict"
		s.auditWrite(r, "DISPATCH_RUN_ACTION", string(ScopeMarketplace), entry)
		writeJSON(w, http.StatusConflict, map[string]string{"error": "dispatch_run_changed_reload"})
		return
	case err != nil:
		// 规则拒绝（已派成、还有邀约在等、点名超预算…）：说清楚为什么，同样留痕。
		entry.Outcome = operatoraudit.OutcomeDenied
		detail["error"] = err.Error()
		s.auditWrite(r, "DISPATCH_RUN_ACTION", string(ScopeMarketplace), entry)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "dispatch_action_refused", "detail": err.Error()})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	detail["status"] = run.Status
	s.auditWrite(r, "DISPATCH_RUN_ACTION", string(ScopeMarketplace), entry)
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "run": viewOfRun(run, time.Now().UTC())})
}

// MARKET-FAST-001：市场发单看板。
//
//	GET /v1/operator/market-dispatch?days=   快速发单（kind='MARKET'）的表现：状态分布、确认率、
//	                                         中位成单时长、代选超时率、等人报名、主动邀请的效果。
//
// 跟 /v1/operator/dispatch 的分工：那一页是**现在**——逐条单卡在哪一步、为什么；这一页是
// **一段时间内**——快速发单到底成不成得了、邀人有没有用。口径写在 dispatch.MarketStats 上，
// 界面照抄，不各算一遍。
//
// 算不出来的数是 null（界面显示「—」）：分母为 0 时返回 0 会让运营以为「确认率 0% = 一单没成」，
// 而真相常常是「这段时间没有单跑到终态」。宁可空着，也不要编。

// marketDispatchStatsSource 是市场发单看板那几个数的来源。
// DispatchStats 上没有 MarketStats 时（只接了 dispatch.Stats 的旧接线）回答 503 ——
// 页面必须知道自己缺的是数据源，而不是把一片空白当成「这段时间一单都没跑」。
type marketDispatchStatsSource interface {
	MarketStats(ctx context.Context, since time.Time) (dispatch.MarketStats, error)
}

const (
	marketBoardDefaultDays = 7
	marketBoardMinDays     = 1
	marketBoardMaxDays     = 90
)

// marketBoardWindow：?days= 解析成 [1, 90]。写坏的值（abc、0、-3）落回默认 7，而不是报错 ——
// 运营手敲一个 500 不该看到 400，只该看到被夹住的 90。
func marketBoardWindow(raw string) int {
	days := marketBoardDefaultDays
	if v, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
		days = v
	}
	if days < marketBoardMinDays {
		return marketBoardMinDays
	}
	if days > marketBoardMaxDays {
		return marketBoardMaxDays
	}
	return days
}

func (s *Server) operatorMarketBoard(w http.ResponseWriter, r *http.Request) {
	if s.Dispatch == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"dataSource": OperatorNotConnectedSource,
			"notes":      []string{"没配库：自动派单没有启用（dispatch.runs 在 migration 190）。"},
		})
		return
	}
	source, ok := s.DispatchStats.(marketDispatchStatsSource)
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "market_stats_unavailable"})
		return
	}
	days := marketBoardWindow(r.URL.Query().Get("days"))
	now := time.Now().UTC()
	stats, err := source.MarketStats(r.Context(), now.Add(-time.Duration(days)*24*time.Hour))
	if err != nil {
		log.Printf("operator market board: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "market_stats_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": days,
		"stats":      stats,
	})
}
