package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/decisionengine"
)

// DecisionStatsSource 是引擎总览要的留痕统计（decisionengine.Postgres 满足它）。
type DecisionStatsSource interface {
	Stats(ctx context.Context, now time.Time) (decisionengine.Stats, error)
}

type evaluateInput struct {
	UserID    string `json:"userId"`
	EventType string `json:"eventType"`
	Action    string `json:"action"`
	Subject   string `json:"subject"`
}

// decisionsEvaluate：POST /v1/operator/decisions/evaluate（DECISION-ENGINE-001）。
//
// 不要和 /v1/decisions/evaluate 混：那个是 OPS-ENGINE-API-001 的上下文规则判定（暴雨规则，
// 无状态、不记账）；这个是「该不该对这个人做这个动作」的干预决策，每次都记进 decision.evaluations。
//
// 今天只对运营开放（控制台「引擎总览」里的试算）：caller 固定为 operator_console，
// 由服务端写，调用方改不了 —— 留痕里「谁问的」必须可信。产品内的调用方（引导推送 worker）
// 在进程内直接调引擎，不走这个 HTTP 口。判断本身只读，不发任何东西；但每次都记账。
func (s *Server) decisionsEvaluate(w http.ResponseWriter, r *http.Request) {
	if s.Decisions == nil {
		notConnected("决策引擎（没有配数据库）", personalizationSpec+" §9 §11 §13")(w, r)
		return
	}
	var in evaluateInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	d, err := s.Decisions.Evaluate(r.Context(), decisionengine.Request{
		UserID: in.UserID, EventType: in.EventType, Action: in.Action, Subject: in.Subject, Caller: "operator_console",
	})
	if errors.Is(err, decisionengine.ErrInvalidRequest) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err != nil {
		log.Printf("decisions evaluate: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "decision_evaluate_failed"})
		return
	}
	writeJSON(w, http.StatusOK, d)
}
