package api

import (
	"net/http"
)

// OperatorFixtureSource 标记本文件三个端点返回的是**占位数据**（OPS-TELEMETRY-001）。
//
// decision-engine / clarification-gate / supply-health 都不回查任何表：
// evaluate_calls_30d "18.6M"、lineage_complete "99.92%"、p99_ms 82、
// 各 segment 的 health 0.82/0.64/0.38、activation ladder 的 1.2K/860/420/210
// 全是字面量。
//
// 危险不在于"数字是假的"，而在于**它们长得像遥测**。运营打开控制台看到
// "决策引擎 30 天 1860 万次调用 · 谱系完整度 99.92%"，会认为引擎在跑；
// 而仓库里既没有决策引擎的实现，也没有任何一张表记录这些数字。
// 一个假的健康度比没有健康度更糟 —— 它让人停止怀疑。
//
// 本轮不删端点（控制台仍在引用），改为每个响应都显式带 dataSource，
// 让"这是占位数据"成为接口的一部分，而不是只存在于某人的记忆里。
// 接真实遥测属于 OPS-TELEMETRY-001。
const OperatorFixtureSource = "FIXTURE"

// GET /v1/operator/decision-engine — engine health + policy resolver snapshot
func (s *Server) operatorDecisionEngine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorFixtureSource,
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
			"decision_id":         "dec_82A1",
			"context_snapshot_id": "ctx_1842",
			"chain":               []string{"Context Field", "Decision Engine", "Experience Intent", "Orchestrator", "Surface Compiler", "SurfacePlan", "Delta"},
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
		"dataSource": OperatorFixtureSource,
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
		"dataSource": OperatorFixtureSource,
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
