package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
)

// GET /v1/experience/surface?surface_id=home — returns latest SurfacePlan snapshot (poll fallback)
// §18.3 Realtime Fallback: reject delta → request latest snapshot
func (s *Server) experienceSurface(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	surfaceID := r.URL.Query().Get("surface_id")
	if surfaceID == "" {
		surfaceID = "home"
	}
	// For MVP, synthesize a snapshot using a demo intent + default capability.
	// In production this reads from surface_plan store.
	cap := runtime.ClientCapability{
		ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2",
		Capabilities: []string{"stack:v3", "grid:v2", "merchant_card:v5", "delta_patch:v2"},
	}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	cap.Limits.SupportsStreamDelta = true

	intent := runtime.ExperienceIntent{
		IntentID: "exp_snapshot_" + surfaceID, Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.82, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_snapshot", DecisionID: "dec_snapshot",
		ExpiresAt: time.Now().Add(15 * time.Minute), ReasonCodes: []string{"snapshot"},
	}
	compiler := runtime.NewSurfaceCompiler("surface_policy_v5")
	result, err := compiler.Compile(runtime.CompileRequest{Intent: intent, ClientCapability: cap})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "compile_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"surface_plan": result.SurfacePlan,
		"ui_schema":    result.UISchema,
		"as_of":        time.Now().UTC().Format(time.RFC3339),
	})
}

// GET /v1/experience/metrics — §22 可观测性快照（JSON，仅运营/本地）
func (s *Server) experienceMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	m := runtime.GlobalMetrics.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"compile_count":           m.CompileCount,
		"compile_latency_p50_ms":  m.CompileLatencyP50.Milliseconds(),
		"compile_latency_p95_ms":  m.CompileLatencyP95.Milliseconds(),
		"validation_fail":         m.ValidationFailCount,
		"capability_fallback":     m.CapabilityFallbackCount,
		"delta_apply_success":     m.DeltaApplySuccess,
		"delta_reject":            m.DeltaRejectCount,
		"snapshot_recovery":       m.SnapshotRecoveryCount,
		"no_ui_change":            m.NoUIChangeCount,
	})
}

// GET /v1/experience/delta?surface_id=home&base_version=184 — returns delta or 409 if mismatch
// Also supports SSE when Accept: text/event-stream
func (s *Server) experienceDelta(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}
	surfaceID := r.URL.Query().Get("surface_id")
	if surfaceID == "" {
		surfaceID = "home"
	}
	baseVerStr := r.URL.Query().Get("base_version")
	baseVer, err := strconv.Atoi(baseVerStr)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "base_version_required"})
		return
	}
	cap := runtime.ClientCapability{
		ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2",
		Capabilities: []string{"stack:v3", "grid:v2", "merchant_card:v5", "delta_patch:v2"},
	}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	cap.Limits.SupportsStreamDelta = true

	intent := runtime.ExperienceIntent{
		IntentID: "exp_delta_" + surfaceID, Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.82, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_delta", DecisionID: "dec_delta",
		ExpiresAt: time.Now().Add(15 * time.Minute), ReasonCodes: []string{"eta_64m"},
	}
	compiler := runtime.NewSurfaceCompiler("surface_policy_v5")
	result, err := compiler.Compile(runtime.CompileRequest{
		Intent: intent, ClientCapability: cap, CurrentSurfaceVersion: &baseVer,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "compile_failed"})
		return
	}
	if result.Delta == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no_delta"})
		return
	}
	// §13 client rule: if local_version != base_version → reject delta
	// Here we just return it; client will validate.

	// SSE branch
	if r.Header.Get("Accept") == "text/event-stream" {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "sse_not_supported"})
			return
		}
		data, _ := json.Marshal(result.Delta)
		fmt.Fprintf(w, "event: surface_delta\n")
		fmt.Fprintf(w, "data: %s\n\n", string(data))
		flusher.Flush()
		// MVP: single event then close. Production keeps connection open.
		return
	}
	writeJSON(w, http.StatusOK, result.Delta)
}
