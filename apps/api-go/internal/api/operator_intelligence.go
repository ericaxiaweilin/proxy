package api

import "net/http"

// GET /v1/operator/fulfillment-attribution — § fulfillment attribution record (mock wiring to outcome/ledger)
func (s *Server) operatorFulfillmentAttribution(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"attribution": []map[string]any{
			{"order_id": "ord_82A1", "decision_id": "dec_82A1", "surface_plan_id": "sp_dec_82A1_v185", "delta_id": "delta_981", "outcome": "FULFILLED", "channel": "HOME"},
			{"order_id": "ord_82A2", "decision_id": "dec_82A2", "surface_plan_id": "sp_dec_82A2_v12", "delta_id": "delta_982", "outcome": "CANCELLED", "channel": "PUSH"},
		},
		"record_example": "decision→exposure→outcome 全链路可审计，Model inference ≠ Fact",
	})
}

// GET /v1/operator/behavior — behavior + interest modeling summary
func (s *Server) operatorBehavior(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"events": map[string]any{"deep_view": "2.75M", "strong_positive": "446K", "weak_negative": "1.06M", "strong_negative": "64K"},
		"top_interests": []map[string]any{
			{"tag": "摄影", "score": 0.82, "confidence": 0.74},
			{"tag": "咖啡", "score": 0.76, "confidence": 0.68},
			{"tag": "同行", "score": 0.71, "confidence": 0.62},
		},
	})
}

// GET /v1/operator/research — Geometry Research stages
func (s *Server) operatorResearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stages": []map[string]any{
			{"stage": "Lab", "desc": "Geometry Research Lab", "count": 12},
			{"stage": "Shadow", "desc": "影子流量验证", "count": 8},
			{"stage": "Prod", "desc": "生产灰度", "count": 5},
		},
		"field_flow": []map[string]any{
			{"k": "User Context", "v": "河内 · 还剑湖", "d": "位置/偏好"},
			{"k": "World Context", "v": "Light rain", "d": "天气/时间"},
			{"k": "Market Context", "v": "Lunch supply 0.82×", "d": "供给/价格"},
			{"k": "Gravity Field", "v": "Meal ↑", "d": "决策输入"},
		},
	})
}
