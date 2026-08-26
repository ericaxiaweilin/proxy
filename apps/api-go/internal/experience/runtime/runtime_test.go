package runtime

import (
	"testing"
	"time"
)

func TestIntentValidation(t *testing.T) {
	intent := ExperienceIntent{
		IntentID: "exp_rain_31", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.82, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_1842", DecisionID: "dec_82A1",
		ExpiresAt: time.Now().Add(15 * time.Minute), ReasonCodes: []string{"heavy_rain"},
	}
	if err := intent.Validate(); err != nil {
		t.Fatalf("valid intent rejected: %v", err)
	}
	bad := intent
	bad.Priority = 2
	if err := bad.Validate(); err == nil {
		t.Fatal("expected priority error")
	}
}

func TestUISchemaValidation(t *testing.T) {
	schema := UISchema{
		SchemaVersion: "ui_schema_v3",
		Root: UISchemaNode{Type: "stack", Children: []UISchemaNode{
			{Type: "title", Props: map[string]any{"text": "雨势正在变大"}},
			{Type: "eta", Props: map[string]any{"value_min": 64}},
			{Type: "merchant_list", Props: map[string]any{"limit": 3}, DataRef: "candidate_set_82"},
		}},
	}
	if err := ValidateUISchema(schema); err != nil {
		t.Fatalf("valid schema rejected: %v", err)
	}
	bad := schema
	bad.Root.Children[0].Props = map[string]any{"text": "<script>alert(1)</script>"}
	if err := ValidateUISchema(bad); err == nil {
		t.Fatal("expected script error")
	}
}

func TestCompilerRainCase(t *testing.T) {
	compiler := NewSurfaceCompiler("surface_policy_v5")
	intent := ExperienceIntent{
		IntentID: "exp_rain_31", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.82, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_1842", DecisionID: "dec_82A1",
		AllowedActions: []string{"open_fastest_plan"}, ExpiresAt: time.Now().Add(15 * time.Minute),
		ReasonCodes: []string{"eta_64m", "heavy_rain"},
	}
	cap := ClientCapability{
		ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2",
		Capabilities: []string{"stack:v3", "grid:v2", "merchant_card:v5", "delta_patch:v2"},
	}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	cap.Limits.SupportsStreamDelta = true

	cur := 184
	result, err := compiler.Compile(CompileRequest{Intent: intent, ClientCapability: cap, CurrentSurfaceVersion: &cur})
	if err != nil {
		t.Fatalf("compile failed: %v", err)
	}
	if result.SurfacePlan.SurfaceVersion != 185 {
		t.Fatalf("expected version 185 got %d", result.SurfacePlan.SurfaceVersion)
	}
	if result.SurfacePlan.RenderMode != "PRIMITIVE_COMPOSITION" {
		t.Fatalf("expected primitive composition")
	}
	if result.UISchema == nil {
		t.Fatal("expected ui schema")
	}
	if result.Delta == nil {
		t.Fatal("expected delta for incremental compile")
	}
	if !CanApplyDelta(184, *result.Delta) {
		t.Fatal("delta should be applicable at 184")
	}
	if CanApplyDelta(183, *result.Delta) {
		t.Fatal("delta should not be applicable at 183")
	}
	// verify schema contains rain alert + metric grid
	foundAlert, foundMetric := false, false
	for _, ch := range result.UISchema.Root.Children {
		if ch.Type == "alert" {
			foundAlert = true
		}
		if ch.Type == "grid" {
			foundMetric = true
		}
	}
	if !foundAlert || !foundMetric {
		t.Fatalf("expected alert and grid in rain schema")
	}
}

func TestCompilerCapabilityFallback(t *testing.T) {
	compiler := NewSurfaceCompiler("")
	intent := ExperienceIntent{
		IntentID: "exp_rain_31", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.9, InterventionLevel: "SOFT_NUDGE",
		ContextSnapshotID: "ctx_1", DecisionID: "dec_1",
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	cap := ClientCapability{ClientVersion: "1.0", Platform: "ios", UIRuntimeVersion: "1.0", Capabilities: []string{"stack:v1"}}
	cap.Limits.MaxSchemaDepth = 1 // too shallow → fallback
	cap.Limits.MaxNodes = 80
	_, err := compiler.Compile(CompileRequest{Intent: intent, ClientCapability: cap, CurrentSurfaceVersion: intPtr(10)})
	if err == nil {
		t.Fatal("expected capability error")
	}
}

func TestOrchestratorNoUIChange(t *testing.T) {
	orch := NewOrchestrator(nil)
	intent := ExperienceIntent{
		IntentID: "exp_low", Type: "HELP_USER_HANDLE_RAIN_AFTER_WORK",
		Objective: "REDUCE_TIME_AND_DECISION_COST", Priority: 0.05, InterventionLevel: "PASSIVE",
		ContextSnapshotID: "ctx_1", DecisionID: "dec_1",
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	cap := ClientCapability{ClientVersion: "2.7.1", Platform: "ios", UIRuntimeVersion: "3.2", Capabilities: []string{"stack:v3", "grid:v2"}}
	cap.Limits.MaxSchemaDepth = 8
	cap.Limits.MaxNodes = 80
	_, err := orch.Orchestrate(OrchestrateRequest{Intent: intent, Capability: cap})
	if err == nil || err.Error() != "NO_UI_CHANGE: priority below intervention threshold" {
		t.Fatalf("expected NO_UI_CHANGE, got %v", err)
	}
}

func intPtr(v int) *int { return &v }
