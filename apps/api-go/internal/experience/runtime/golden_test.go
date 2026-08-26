package runtime

import (
	"testing"
	"time"
)

// §24.2 Golden Surface Test — same Intent+Capability+Policy → stable SurfacePlan
func TestGoldenSurface(t *testing.T) {
	GlobalThrottler = NewThrottler(1*time.Millisecond, 0.01) // disable throttling for golden
	GlobalPatternRegistry = NewPatternRegistry()
	intent := ExperienceIntent{
		IntentID: "exp_golden_1", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.82, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_golden", DecisionID: "dec_golden",
		ExpiresAt: time.Now().Add(15 * time.Minute), ReasonCodes: []string{"eta_64m"},
	}
	cap := ClientCapability{
		ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2",
		Capabilities: []string{"stack:v3", "grid:v2", "merchant_card:v5"},
	}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	compiler := NewSurfaceCompiler("surface_policy_v5")
	r1, err := compiler.Compile(CompileRequest{Intent: intent, ClientCapability: cap})
	if err != nil {
		t.Fatalf("compile 1 failed: %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	GlobalThrottler = NewThrottler(1*time.Millisecond, 0.01)
	r2, err := compiler.Compile(CompileRequest{Intent: intent, ClientCapability: cap})
	if err != nil {
		t.Fatalf("compile 2 failed: %v", err)
	}
	if r1.SurfacePlan.SurfacePlanID != r2.SurfacePlan.SurfacePlanID || r1.SurfacePlan.RenderMode != r2.SurfacePlan.RenderMode {
		t.Fatalf("golden mismatch: %+v vs %+v", r1.SurfacePlan, r2.SurfacePlan)
	}
	if len(r1.UISchema.Root.Children) != len(r2.UISchema.Root.Children) {
		t.Fatal("golden schema children mismatch")
	}
}

// §24.3 Delta Replay Test — v184 snapshot + delta185 + delta186 → final
func TestDeltaReplay(t *testing.T) {
	delta185 := SurfaceDelta{
		SurfaceID: "home", BaseVersion: 184, NewVersion: 185, DeltaID: "delta_185",
		CreatedAt: time.Now(), Operations: []DeltaOperation{{Op: "insert", Slot: "top_context", Node: "rain_context_31"}},
	}
	delta186 := SurfaceDelta{
		SurfaceID: "home", BaseVersion: 185, NewVersion: 186, DeltaID: "delta_186",
		CreatedAt: time.Now(), Operations: []DeltaOperation{{Op: "update", Node: "fast_delivery", Patch: map[string]any{"eta": "30m"}}},
	}
	// replay must be sequential
	if !CanApplyDelta(184, delta185) {
		t.Fatal("should apply 185 at 184")
	}
	if !CanApplyDelta(185, delta186) {
		t.Fatal("should apply 186 at 185")
	}
	if CanApplyDelta(184, delta186) {
		t.Fatal("should not skip version")
	}
	// out-of-order → fallback to snapshot
	if CanApplyDelta(186, delta185) {
		t.Fatal("out of order should be rejected")
	}
}

// §24.4 Compatibility — old client missing grid:v2 → fallback
func TestCompatibilityFallback(t *testing.T) {
	GlobalThrottler = NewThrottler(1*time.Millisecond, 0.01)
	intent := ExperienceIntent{
		IntentID: "exp_compat", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.9, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_1", DecisionID: "dec_1",
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	oldCap := ClientCapability{ClientVersion: "1.2", Platform: "ios", UIRuntimeVersion: "1.0", Capabilities: []string{"stack:v1"}}
	oldCap.Limits.MaxSchemaDepth = 1
	oldCap.Limits.MaxNodes = 80
	compiler := NewSurfaceCompiler("surface_policy_v5")
	_, err := compiler.Compile(CompileRequest{Intent: intent, ClientCapability: oldCap, CurrentSurfaceVersion: intPtr(10)})
	if err == nil {
		t.Fatal("expected fallback error for old client")
	}
	// verify metrics recorded fallback
	if GlobalMetrics.CapabilityFallbackCount == 0 {
		t.Fatal("expected fallback metric")
	}
}
