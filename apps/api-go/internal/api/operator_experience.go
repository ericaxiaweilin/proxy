package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

// GET /v1/operator/context-field — versioned ContextSnapshot (mock, real reads from Context Field store)
func (s *Server) operatorContextField(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	snap := runtime.ContextSnapshot{
		SnapshotID: "ctx_1842", Weather: "heavy_rain", MobilityFriction: 0.72, DeliveryCapacity: 0.61, CommuteETA: 64, DecisionID: "dec_82A1",
	}
	intent, noChangeReason := runtime.Decide(snap)
	writeJSON(w, http.StatusOK, map[string]any{
		"context_snapshot": snap,
		"decision": map[string]any{
			"intent":        intent,
			"no_ui_change":  noChangeReason,
		},
		"as_of": time.Now().UTC().Format(time.RFC3339),
	})
}

// GET /v1/operator/surface-plans?surface_id=home — last 10 SurfacePlans (mock from GlobalPatternRegistry + metrics)
func (s *Server) operatorSurfacePlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	surfaceID := r.URL.Query().Get("surface_id")
	if surfaceID == "" {
		surfaceID = "home"
	}
	// synthesize latest plan via compiler for demo
	cap := runtime.ClientCapability{
		ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2",
		Capabilities: []string{"stack:v3", "grid:v2", "merchant_card:v5", "delta_patch:v2"},
	}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	cap.Limits.SupportsStreamDelta = true
	snap := runtime.ContextSnapshot{SnapshotID: "ctx_1842", Weather: "heavy_rain", MobilityFriction: 0.72, DeliveryCapacity: 0.61, CommuteETA: 64, DecisionID: "dec_82A1"}
	intent, _ := runtime.Decide(snap)
	var plan any
	var schema any
	if intent != nil {
		compiler := runtime.NewSurfaceCompiler("surface_policy_v5")
		res, err := compiler.Compile(runtime.CompileRequest{Intent: *intent, ClientCapability: cap})
		if err == nil {
			plan = res.SurfacePlan
			schema = res.UISchema
		}
	}
	metrics := runtime.GlobalMetrics.Snapshot()
	cands := runtime.GlobalPatternRegistry.Candidates(1, 0)
	patterns := make([]map[string]any, 0, len(cands))
	for _, c := range cands {
		patterns = append(patterns, map[string]any{"signature": string(c.Signature), "render_count": c.Stats.RenderCount, "stability": c.Stats.SchemaStability})
	}
	// ensure JSON-serializable
	b, _ := json.Marshal(plan)
	var planJSON any
	_ = json.Unmarshal(b, &planJSON)
	b2, _ := json.Marshal(schema)
	var schemaJSON any
	_ = json.Unmarshal(b2, &schemaJSON)

	writeJSON(w, http.StatusOK, map[string]any{
		"surface_id": surfaceID,
		"latest_plan": planJSON,
		"latest_schema": schemaJSON,
		"metrics": map[string]any{
			"compile_count": metrics.CompileCount, "capability_fallback": metrics.CapabilityFallbackCount,
			"delta_reject": metrics.DeltaRejectCount, "no_ui_change": metrics.NoUIChangeCount,
		},
		"pattern_candidates": patterns,
		"policy_version": "surface_policy_v5",
	})
}

// GET /v1/operator/execution-runtime — supply/budget/execution overview (mock wiring to runtime budget/throttler)
func (s *Server) operatorExecutionRuntime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	budget := runtime.DefaultBudget()
	throttled := runtime.GlobalThrottler.ShouldSuppress("home", 0.82)
	writeJSON(w, http.StatusOK, map[string]any{
		"budget": map[string]any{
			"max_schema_payload_bytes": budget.MaxSchemaPayloadBytes,
			"max_delta_payload_bytes":  budget.MaxDeltaPayloadBytes,
			"max_nodes":                budget.MaxNodes,
			"max_images":               budget.MaxImages,
		},
		"throttler": map[string]any{
			"home_suppressed_at_0_82": throttled,
			"cooldown_ms":             30000,
		},
		"channel_policy": map[string]any{
			"soft_nudge_push_allowed": runtime.IsChannelAllowed("SOFT_NUDGE", "PUSH"),
			"active_push_allowed":     runtime.IsChannelAllowed("ACTIVE", "PUSH"),
		},
	})
}
