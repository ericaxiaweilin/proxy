package api

import "net/http"

// GET /v1/operator/population
func (s *Server) operatorPopulation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{"registered": "428K", "mau": "186K", "new_30d": "31.2K", "with_tx": "72.4K"},
		"gender": []map[string]any{{"label": "Female", "pct": 61}, {"label": "Male", "pct": 34}, {"label": "Other / Unknown", "pct": 5}},
	})
}

// GET /v1/operator/tags
func (s *Server) operatorTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{"total_tags": 2480, "active": 1820, "neg": 34, "intent_tags": 420},
		"top_tags": []map[string]any{
			{"tag": "摄影_跟拍", "type": "intent", "count": 820},
			{"tag": "咖啡_探店", "type": "intent", "count": 640},
			{"tag": "hide_负反馈", "type": "neg", "count": 34},
		},
	})
}

// GET /v1/operator/intent-orchestration
func (s *Server) operatorIntentOrchestration(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"intent_funnel": []map[string]any{
			{"stage": "有效曝光", "count": "3.82M"},
			{"stage": "明确意图", "count": "24.8K"},
			{"stage": "候选匹配", "count": "17.1K"},
		},
		"orchestration": []map[string]any{
			{"step": "Gravity", "desc": "Meal gravity rising"},
			{"step": "Retrieval", "desc": "候选拉取"},
			{"step": "Ranking", "desc": "重排与 Human Value"},
		},
	})
}

// GET /v1/operator/engine-api
func (s *Server) operatorEngineAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"endpoints": []map[string]any{
			{"method": "POST", "path": "/v1/decisions/evaluate", "desc": "Gravity/Intent→Evidence→Resource→Human Value"},
			{"method": "POST", "path": "/v1/commands/CompileExperienceSurface", "desc": "Intent + Capability → SurfacePlan/Delta"},
			{"method": "GET", "path": "/v1/experience/metrics", "desc": "Runtime 可观测性"},
			{"method": "GET", "path": "/v1/operator/context-field", "desc": "ContextSnapshot 版本化"},
		},
		"state_lifecycle": []map[string]any{
			{"s": "DRAFT", "d": "草稿态"},
			{"s": "READY", "d": "可编排"},
			{"s": "BLOCKED", "d": "被 Human Value 阻断"},
		},
	})
}
