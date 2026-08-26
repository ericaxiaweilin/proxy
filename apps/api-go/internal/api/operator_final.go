package api

import "net/http"

// GET /v1/operator/merchant — 商家与投放
func (s *Server) operatorMerchant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{"active_merchants": 2840, "campaigns": 612, "ctr": "4.2%", "cvr": "18.4%"},
		"top_merchants": []map[string]any{
			{"name": "西湖咖啡", "impressions": "82K", "orders": 1240},
			{"name": "还剑湖餐厅", "impressions": "64K", "orders": 980},
		},
	})
}

// GET /v1/operator/retention
func (s *Server) operatorRetention(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"retention": map[string]any{"d30": "38.4%", "d90": "22.1%", "repeat_rate": "41.7%"},
		"cohorts": []map[string]any{{"cohort": "2026-07", "d30": "39.2%"}, {"cohort": "2026-08", "d30": "38.4%"}},
	})
}

// GET /v1/operator/trust — 信任与风险
func (s *Server) operatorTrust(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"safety": map[string]any{"incident_rate": "0.12%", "block_rate": "1.4%", "appeal_success": "32%"},
		"risk_scores": []map[string]any{{"segment": "新用户", "score": 0.24}, {"segment": "供给侧", "score": 0.18}},
	})
}

// GET /v1/operator/quality — 数据治理 + workbench
func (s *Server) operatorQuality(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"quality": map[string]any{"completeness": "99.2%", "freshness_p95": "4.2s", "lineage": "99.92%"},
		"workbench": map[string]any{"saved_queries": 24, "cross_analysis": "Intent × Fulfillment"},
	})
}
