package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/research"
)

// OPS-RESEARCH-001（2026-10-08）：Research 页的后端 —— 实验注册 + 阶段流水线 + 影子评估。
//
// 四个口：
//   GET  /v1/operator/research                    盘点（阶段计数 + 明细 + 最近影子评估）
//   POST /v1/operator/research/experiments        注册实验（默认 DRAFT）
//   POST /v1/operator/research/experiments/stage  推阶段（DRAFT→LAB→SHADOW→PROD，可收尾）
//   POST /v1/operator/research/shadow             投一个真实 ContextSnapshot 跑影子判定
//
// 三个 POST 都走 operatorConsoleMethod（会话 + 白名单 + ANALYTICS）+ auditWrite ——
// 注册/推阶段/投影子都是在改平台实验状态，OPS-AUDIT-001 的口径适用。
// 影子判定复用 §20 的 evaluate 输入校验（同一份受控词表与区间），判定内核同一个 runtime.Decide。

type researchSnapshotInput struct {
	SnapshotID       string  `json:"context_snapshot_id"`
	Weather          string  `json:"weather"`
	MobilityFriction float64 `json:"mobility_friction"`
	DeliveryCapacity float64 `json:"delivery_capacity"`
	CommuteETA       int     `json:"commute_eta"`
	DecisionID       string  `json:"decision_id"`
}

// validateSnapshot 与 evaluateDecision 同一份口径（两处共用受控词表会漂，所以各自
// 引用同一个 evaluateAllowedWeather 表；区间在此重复声明是因为 evaluateRequest 的
// 校验绑在它的 handler 流程里）。
func (in researchSnapshotInput) validate() string {
	switch {
	case in.SnapshotID == "":
		return "context_snapshot_id_required"
	case !evaluateAllowedWeather[in.Weather]:
		return "weather_must_be_clear_light_rain_or_heavy_rain"
	case in.MobilityFriction < 0 || in.MobilityFriction > 1:
		return "mobility_friction_out_of_range"
	case in.DeliveryCapacity < 0 || in.DeliveryCapacity > 1:
		return "delivery_capacity_out_of_range"
	case in.CommuteETA < 0 || in.CommuteETA > 480:
		return "commute_eta_out_of_range"
	}
	return ""
}

func (s *Server) operatorResearchInventory(w http.ResponseWriter, r *http.Request) {
	if s.Research == nil {
		notConnected("Geometry Research / 影子流量（没有配数据库）", personalizationSpec)(w, r)
		return
	}
	inv, err := s.Research.Inventory(r.Context(), 10)
	if err != nil {
		log.Printf("operator research: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "research_inventory_failed"})
		return
	}
	notes := []string{
		"实验服务今天上线的是最小闭环：注册 → 推阶段 → SHADOW 阶段投真实快照跑影子判定（结果进库，不进 App）。",
		"没有流量分桶 / 置信区间 / 自动晋级 —— 没有行为样本之前那些是空转的机器；影子判定对账的就是下面这份记录。",
		"影子判定用的是与 /v1/decisions/evaluate 同一个内核（暴雨规则）—— 影子里看到的判定质量就是线上判定质量。",
	}
	if inv.StageCounts[string(research.StageShadow)] > 0 && len(inv.RecentShadowEvals) == 0 {
		notes = append(notes, "有实验在 SHADOW 阶段但一次影子评估都没有 —— 引擎没有在被影子验证，别把 SHADOW 当成「已在验证」。")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":          OperatorLiveSource,
		"stage_counts":        inv.StageCounts,
		"experiments":         inv.Experiments,
		"recent_shadow_evals": inv.RecentShadowEvals,
		"notes":               notes,
	})
}

type createExperimentInput struct {
	ExperimentID string `json:"experiment_id"`
	Name         string `json:"name"`
	Hypothesis   string `json:"hypothesis"`
	Surface      string `json:"surface"`
	TrafficPct   int    `json:"traffic_pct"`
}

func (s *Server) operatorResearchCreate(w http.ResponseWriter, r *http.Request) {
	if s.Research == nil {
		notConnected("Geometry Research / 影子流量（没有配数据库）", personalizationSpec)(w, r)
		return
	}
	var in createExperimentInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	e, err := s.Research.Create(r.Context(), research.Experiment{
		ExperimentID: in.ExperimentID, Name: in.Name, Hypothesis: in.Hypothesis,
		Surface: in.Surface, TrafficPct: in.TrafficPct,
	})
	if err != nil {
		// 唯一键冲突 / 校验失败都是调用方能修的 —— 400/409，不当 500 吞掉。
		if strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "range") || strings.Contains(err.Error(), "DRAFT") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "duplicate key") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "experiment_id_already_exists"})
			return
		}
		log.Printf("operator research create: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "research_create_failed"})
		return
	}
	s.auditWrite(r, "RESEARCH_CREATE_EXPERIMENT", string(ScopeAnalytics), operatoraudit.Entry{
		Outcome:    operatoraudit.OutcomeOK,
		TargetKind: "ResearchExperiment",
		TargetID:   e.ExperimentID,
		Detail:     map[string]any{"name": e.Name, "surface": e.Surface},
	})
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "experiment": e})
}

type transitionStageInput struct {
	ExperimentID string `json:"experiment_id"`
	To           string `json:"to"`
}

func (s *Server) operatorResearchTransition(w http.ResponseWriter, r *http.Request) {
	if s.Research == nil {
		notConnected("Geometry Research / 影子流量（没有配数据库）", personalizationSpec)(w, r)
		return
	}
	var in transitionStageInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	e, err := s.Research.Transition(r.Context(), in.ExperimentID, research.Stage(in.To))
	switch {
	case err == nil:
	case errors.Is(err, research.ErrIllegalTransition), errors.Is(err, research.ErrWrongStageForShadow):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	case strings.Contains(err.Error(), "not found"):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "experiment_not_found"})
		return
	case strings.Contains(err.Error(), "unknown stage"):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	default:
		log.Printf("operator research transition: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "research_transition_failed"})
		return
	}
	s.auditWrite(r, "RESEARCH_TRANSITION_STAGE", string(ScopeAnalytics), operatoraudit.Entry{
		Outcome:    operatoraudit.OutcomeOK,
		TargetKind: "ResearchExperiment",
		TargetID:   e.ExperimentID,
		Detail:     map[string]any{"to": string(e.Stage)},
	})
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "experiment": e})
}

func (s *Server) operatorResearchShadow(w http.ResponseWriter, r *http.Request) {
	if s.Research == nil {
		notConnected("Geometry Research / 影子流量（没有配数据库）", personalizationSpec)(w, r)
		return
	}
	var in struct {
		ExperimentID string                `json:"experiment_id"`
		Snapshot     researchSnapshotInput `json:"snapshot"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_body"})
		return
	}
	if in.ExperimentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "experiment_id_required"})
		return
	}
	if msg := in.Snapshot.validate(); msg != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	snapJSON, _ := json.Marshal(in.Snapshot)
	var snapMap map[string]any
	_ = json.Unmarshal(snapJSON, &snapMap)

	ev, err := s.Research.RecordShadowEvaluation(r.Context(), in.ExperimentID, "", snapMap)
	switch {
	case err == nil:
	case errors.Is(err, research.ErrWrongStageForShadow):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	case strings.Contains(err.Error(), "not found"):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "experiment_not_found"})
		return
	default:
		log.Printf("operator research shadow: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "research_shadow_failed"})
		return
	}
	s.auditWrite(r, "RESEARCH_SHADOW_EVALUATION", string(ScopeAnalytics), operatoraudit.Entry{
		Outcome:    operatoraudit.OutcomeOK,
		TargetKind: "ResearchExperiment",
		TargetID:   in.ExperimentID,
		Detail:     map[string]any{"evaluation_id": ev.EvaluationID, "intent": ev.Intent != nil},
	})
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "evaluation": ev})
}
