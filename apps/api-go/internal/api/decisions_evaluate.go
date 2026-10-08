package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

// OPS-ENGINE-API-001（2026-10-07）：§20 引擎调用面的第一个真实端点。
//
// 背景：运营后台「API / Runtime」页原来是 notConnected 桩，理由是
// 「/v1/decisions/evaluate 没有注册路由」。这个端点今天补上——它就是 spec §20
// 承诺的引擎判定入口：客户端/运营给一个 ContextSnapshot，引擎给判定。
//
// 判定内核是 experience/runtime.Decide：当前只有 §20 的暴雨规则（规则化演示，
// 与真实模型同构的输入输出——包注释原话）。这一页/端点不假装引擎更聪明：
// 响应里带 policy_version 与 reason_codes，规则就是规则。
//
// 输入不落库（Context Field store 未接），evaluator 是无状态纯计算 ——
// 所以这里没有 SQL、没有集成测试；有 API 测试钉判定行为与认证。

type evaluateRequest struct {
	SnapshotID       string  `json:"context_snapshot_id"`
	Weather          string  `json:"weather"`
	MobilityFriction float64 `json:"mobility_friction"`
	DeliveryCapacity float64 `json:"delivery_capacity"`
	CommuteETA       int     `json:"commute_eta"`
	DecisionID       string  `json:"decision_id"`
}

// evaluateAllowedWeather 是 ContextSnapshot.Weather 的受控词表。
// runtime.Decide 认 light_rain / heavy_rain，clear 是显式的「无需判定」，
// 之外的值是调用方笔误 —— 400，而不是静默按 clear 处理。
var evaluateAllowedWeather = map[string]bool{"clear": true, "light_rain": true, "heavy_rain": true}

func (s *Server) evaluateDecision(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	if s.Authenticator == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication_unavailable"})
		return
	}
	rawAccessToken, ok := bearerToken(r.Header.Get("Authorization"))
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	authenticated, err := s.Authenticator.Authenticate(r.Context(), rawAccessToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_access_token"})
		return
	}
	// 判定是纯计算，但它不是免费流量：按 actor 限流（同 command 的 rateAllow 闸）。
	if !s.rateAllow("actor:" + authenticated.Actor.ID + ":EvaluateDecision") {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req evaluateRequest
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	switch {
	case req.SnapshotID == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "context_snapshot_id_required"})
		return
	case !evaluateAllowedWeather[req.Weather]:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "weather_must_be_clear_light_rain_or_heavy_rain"})
		return
	case req.MobilityFriction < 0 || req.MobilityFriction > 1:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mobility_friction_out_of_range"})
		return
	case req.DeliveryCapacity < 0 || req.DeliveryCapacity > 1:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "delivery_capacity_out_of_range"})
		return
	case req.CommuteETA < 0 || req.CommuteETA > 480:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "commute_eta_out_of_range"})
		return
	}

	snap := runtime.ContextSnapshot{
		SnapshotID:       req.SnapshotID,
		Weather:          req.Weather,
		MobilityFriction: req.MobilityFriction,
		DeliveryCapacity: req.DeliveryCapacity,
		CommuteETA:       req.CommuteETA,
		DecisionID:       req.DecisionID,
	}
	intent, noChangeReason := runtime.Decide(snap)

	// 引擎今天只有一条判定规则，这句话要跟着响应走 —— 不然调用方会把
	// NO_UI_CHANGE 读成「引擎很确定没事」，而事实是「只有暴雨规则在判」。
	notes := []string{
		"当前判定内核只有 §20 暴雨规则（规则化演示，与真实模型同构）—— NO_UI_CHANGE 多数时候表示「规则没覆盖」，不是「没事」。",
		"输入不落库：Context Field store 未接，快照由调用方直传。",
	}
	resp := map[string]any{
		"policy_version":   "rain_rule_v1",
		"evaluated_at":     time.Now().UTC().Format(time.RFC3339),
		"context_snapshot": snap,
		"intent":           intent,
		"no_ui_change":     noChangeReason,
		"notes":            notes,
	}
	if intent != nil {
		log.Printf("decisions/evaluate: actor=%s intent=%s", authenticated.Actor.ID, intent.Type)
	}
	writeJSON(w, http.StatusOK, resp)
}
