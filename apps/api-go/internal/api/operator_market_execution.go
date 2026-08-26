package api

import (
	"net/http"
)

// GET /v1/operator/decision-engine — engine health + policy resolver snapshot
func (s *Server) operatorDecisionEngine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"engine": map[string]any{
			"evaluate_calls_30d": "18.6M",
			"p99_ms":             82,
			"evidence_pass":      "71.4%",
			"active_orchestrate": "8.2%",
			"human_value_block":  "4.2%",
			"lineage_complete":   "99.92%",
		},
		"policy_resolver": map[string]any{
			"policy_version": "surface_policy_v5",
			"guardrails":     []string{"Explicit Negative", "Privacy", "Anger Risk", "Intervention Budget", "Safety"},
		},
		"trace_sample": map[string]any{
			"decision_id": "dec_82A1",
			"context_snapshot_id": "ctx_1842",
			"chain": []string{"Context Field", "Decision Engine", "Experience Intent", "Orchestrator", "Surface Compiler", "SurfacePlan", "Delta"},
		},
	})
}

// GET /v1/operator/clarification-gate
func (s *Server) operatorClarificationGate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"gates": []map[string]any{
			{"state": "PASS", "desc": "明确意图 · 可直接撮合", "example": "周六下午想在西湖拍照", "allow": true},
			{"state": "CLARIFY", "desc": "需一次追问 · 目标/时间/预算缺失", "example": "想拍照", "allow": false},
			{"state": "BLOCK", "desc": "风险/隐私阻断", "example": "未成年人陪同", "allow": false},
		},
		"question_preview": map[string]any{
			"qtext":   "你更偏好哪种拍摄风格？",
			"choices": []string{"自然跟拍", "摆拍写真", "纪实抓拍"},
			"reason":  "用于匹配摄影师能力标签，未回答前不进入 Matching。",
		},
	})
}

// GET /v1/operator/supply-health
func (s *Server) operatorSupplyHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"bands": []map[string]any{
			{"segment": "摄影师 · 河内", "health": 0.82, "status": "healthy"},
			{"segment": "化妆师 · 河内", "health": 0.64, "status": "warn"},
			{"segment": "模特 · 胡志明", "health": 0.38, "status": "bad"},
		},
		"activation_ladder": []map[string]any{
			{"k": "Candidate Pull", "v": "1.2K", "d": "符合能力图谱"},
			{"k": "Invite", "v": "860", "d": "发送邀约"},
			{"k": "Offer", "v": "420", "d": "生成 Offer"},
			{"k": "Accept", "v": "210", "d": "完成履约"},
		},
	})
}
