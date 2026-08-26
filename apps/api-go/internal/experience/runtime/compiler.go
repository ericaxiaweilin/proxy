package runtime

import (
	"fmt"
	"time"
)

// SurfaceCompiler — §8 后端体验编译器
// 不生成任意代码，只编译受约束 Schema → SurfacePlan
type SurfaceCompiler struct {
	policyVersion string
	budget        Budget
}

func NewSurfaceCompiler(policyVersion string) *SurfaceCompiler {
	if policyVersion == "" {
		policyVersion = "surface_policy_v5"
	}
	return &SurfaceCompiler{policyVersion: policyVersion, budget: DefaultBudget()}
}

func NewSurfaceCompilerWithBudget(policyVersion string, budget Budget) *SurfaceCompiler {
	if policyVersion == "" {
		policyVersion = "surface_policy_v5"
	}
	return &SurfaceCompiler{policyVersion: policyVersion, budget: budget}
}

type CompileRequest struct {
	Intent                ExperienceIntent  `json:"experience_intent"`
	ClientCapability      ClientCapability  `json:"client_capability"`
	CurrentSurfaceVersion *int              `json:"current_surface_version,omitempty"`
	PolicyVersion         string            `json:"policy_version,omitempty"`
}

type CompileResult struct {
	SurfacePlan    SurfacePlan   `json:"surface_plan"`
	UISchema       *UISchema     `json:"ui_schema,omitempty"`
	Delta          *SurfaceDelta `json:"delta,omitempty"`
	FallbackPlanID *string       `json:"fallback_plan_id,omitempty"`
}

// Compile 执行 §8 流程：Select Pattern → Resolve Bindings → Compose Schema → Validate → Capability → Policy → SurfacePlan → Delta
func (c *SurfaceCompiler) Compile(req CompileRequest) (*CompileResult, error) {
	start := time.Now()
	var compileErr error
	defer func() {
		GlobalMetrics.RecordCompile(time.Since(start), compileErr != nil)
	}()
	if err := req.Intent.Validate(); err != nil {
		compileErr = fmt.Errorf("intent: %w", err)
		return nil, compileErr
	}
	if err := req.ClientCapability.Validate(); err != nil {
		compileErr = fmt.Errorf("capability: %w", err)
		return nil, compileErr
	}

	// 0. Anti-thrashing gate §25
	if GlobalThrottler.ShouldSuppress("home", req.Intent.Priority) {
		compileErr = &ValidationError{Code: "THROTTLED", Message: "suppressed by anti-thrashing"}
		return nil, compileErr
	}

	// 1. Human Value / Intervention guard — expired 已在 Intent.Validate 拦截
	// 2. Compose UI Schema (primitive composition for unpromoted intents)
	schema, renderMode, nativeComponent, err := c.composeSchema(req.Intent, req.ClientCapability)
	if err != nil {
		// §18.2 Compiler Fallback → 返回 fallback_plan
		fb := "fallback_stable_home"
		return &CompileResult{FallbackPlanID: &fb}, err
	}

	if err := ValidateUISchema(*schema); err != nil {
		fb := "fallback_stable_home"
		return &CompileResult{FallbackPlanID: &fb}, err
	}
	if err := c.budget.CheckSchema(*schema); err != nil {
		fb := "fallback_stable_home"
		compileErr = err
		return &CompileResult{FallbackPlanID: &fb}, compileErr
	}

	// 3. Capability Check — §11
	if err := c.capabilityCheck(schema, req.ClientCapability); err != nil {
		// degrade to fallback if unsupported
		GlobalMetrics.RecordCapabilityFallback()
		fb := "fallback_stable_home"
		compileErr = err
		return &CompileResult{FallbackPlanID: &fb}, compileErr
	}

	// 4. Build SurfacePlan
	schemaRef := fmt.Sprintf("uis_%s", req.Intent.IntentID)
	surfaceVersion := 1
	if req.CurrentSurfaceVersion != nil {
		surfaceVersion = *req.CurrentSurfaceVersion + 1
	}
	fallbackID := "fallback_stable_home"
	plan := SurfacePlan{
		SurfacePlanID:      fmt.Sprintf("sp_%s_v%d", req.Intent.DecisionID, surfaceVersion),
		SurfaceID:          "home",
		SurfaceVersion:     surfaceVersion,
		DecisionID:         req.Intent.DecisionID,
		ExperienceIntentID: req.Intent.IntentID,
		ContextSnapshotID:  req.Intent.ContextSnapshotID,
		RenderMode:         renderMode,
		NativeComponent:    nativeComponent,
		SchemaRef:          &schemaRef,
		Slots:              inferSlots(schema),
		TTLS:               600,
		FallbackPlanID:     &fallbackID,
		PolicyVersion:      c.policyVersion,
	}
	if req.PolicyVersion != "" {
		plan.PolicyVersion = req.PolicyVersion
	}

	// 5. Generate Delta if incremental
	var delta *SurfaceDelta
	if req.CurrentSurfaceVersion != nil {
		delta = &SurfaceDelta{
			SurfaceID:   plan.SurfaceID,
			BaseVersion: *req.CurrentSurfaceVersion,
			NewVersion:  plan.SurfaceVersion,
			DeltaID:     fmt.Sprintf("delta_%s_%d", req.Intent.IntentID, plan.SurfaceVersion),
			CreatedAt:   time.Now().UTC(),
			Operations:  inferDeltaOps(schema),
		}
	}

	// 6. Record pattern + throttler + metrics
	GlobalPatternRegistry.Record(*schema)
	GlobalThrottler.RecordChange(plan.SurfaceID, req.Intent.Priority)

	return &CompileResult{
		SurfacePlan:    plan,
		UISchema:       schema,
		Delta:          delta,
		FallbackPlanID: &fallbackID,
	}, nil
}

func (c *SurfaceCompiler) composeSchema(intent ExperienceIntent, cap ClientCapability) (*UISchema, string, *string, error) {
	// §9 雨天案例：HELP_USER_HANDLE_RAIN_AFTER_WORK → §20 已验证组合
	// 若未来晋升为 Native Experience Component，则 render_mode = NATIVE_COMPONENT
	switch intent.Type {
	case "HELP_USER_HANDLE_RAIN_AFTER_WORK":
		// 检查是否有晋升的 Native 组件可用
		if cap.IsSupported("rain_commute_card:v1") {
			name := "RainCommuteCard"
			return &UISchema{
				SchemaVersion: "ui_schema_v3",
				Root: UISchemaNode{
					Type: "stack",
					Props: map[string]any{"spacing": "m"},
					Children: []UISchemaNode{
						{Type: "alert", Props: map[string]any{"level": "context", "text": "雨势正在变大"}},
						{Type: "text", Props: map[string]any{"text": heavyRainText(intent)}},
					},
				},
			}, "NATIVE_COMPONENT", &name, nil
		}
		// Primitive Composition — §20 Step 3 完整结构
		return &UISchema{
			SchemaVersion: "ui_schema_v3",
			Root: UISchemaNode{
				Type: "stack",
				Props: map[string]any{"spacing": "m"},
				Children: []UISchemaNode{
					{Type: "alert", Props: map[string]any{"level": "context", "text": "雨势正在变大"}},
					{Type: "text", Props: map[string]any{"text": heavyRainText(intent)}},
					{Type: "grid", Props: map[string]any{"columns": 2}, Children: []UISchemaNode{
						{Type: "metric", Props: map[string]any{"label": "附近吃饭", "value": "3个选择"}},
						{Type: "metric", Props: map[string]any{"label": "直接配送", "value": "25–40分钟"}},
					}},
					{Type: "merchant_list", Props: map[string]any{"limit": 3}, DataRef: "candidate_set_82"},
					{Type: "primary_action", Props: map[string]any{"label": "看看最快方案"}, ActionID: "open_fastest_plan"},
				},
			},
		}, "PRIMITIVE_COMPOSITION", nil, nil
	default:
		// 通用回落：最小可行表达，保证不返回空
		return &UISchema{
			SchemaVersion: "ui_schema_v3",
			Root: UISchemaNode{
				Type:  "stack",
				Props: map[string]any{"spacing": "m"},
				Children: []UISchemaNode{
					{Type: "text", Props: map[string]any{"text": "已为你准备好最新方案"}},
					{Type: "primary_action", Props: map[string]any{"label": "查看"}, ActionID: "open_surface"},
				},
			},
		}, "PRIMITIVE_COMPOSITION", nil, nil
	}
}

func heavyRainText(intent ExperienceIntent) string {
	for _, rc := range intent.ReasonCodes {
		if rc == "eta_64m" {
			return "现在回家预计 64 分钟"
		}
	}
	return "现在回家预计时间较长"
}

func (c *SurfaceCompiler) recordNoUIChange() { GlobalMetrics.RecordNoUIChange() }

func (c *SurfaceCompiler) capabilityCheck(schema *UISchema, cap ClientCapability) error {
	stats := CollectStats(schema.Root, 1)
	if stats.Depth > cap.Limits.MaxSchemaDepth {
		return &ValidationError{Code: "CAPABILITY_DEPTH_EXCEEDED", Message: fmt.Sprintf("depth %d > limit %d", stats.Depth, cap.Limits.MaxSchemaDepth)}
	}
	if stats.Nodes > cap.Limits.MaxNodes {
		return &ValidationError{Code: "CAPABILITY_NODES_EXCEEDED", Message: fmt.Sprintf("nodes %d > limit %d", stats.Nodes, cap.Limits.MaxNodes)}
	}
	return nil
}

func inferSlots(schema *UISchema) map[string][]string {
	// §10 slots example: top_context / primary / secondary
	slots := map[string][]string{}
	hasAlert := false
	hasMerchantList := false
	for _, child := range schema.Root.Children {
		if child.Type == "alert" {
			hasAlert = true
		}
		if child.Type == "merchant_list" {
			hasMerchantList = true
		}
	}
	if hasAlert {
		slots["top_context"] = []string{"node_rain_31"}
	}
	if hasMerchantList {
		slots["primary"] = []string{"nearby_meal", "fast_delivery"}
		slots["secondary"] = []string{"coupon_wallet"}
	} else {
		slots["primary"] = []string{"generic_content"}
	}
	return slots
}

func inferDeltaOps(schema *UISchema) []DeltaOperation {
	ops := []DeltaOperation{}
	hasAlert := false
	for _, child := range schema.Root.Children {
		if child.Type == "alert" {
			hasAlert = true
		}
	}
	if hasAlert {
		ops = append(ops, DeltaOperation{Op: "insert", Slot: "top_context", Node: "rain_context_31"})
	}
	ops = append(ops, DeltaOperation{Op: "update", Node: "fast_delivery", Patch: map[string]any{"eta": "25–40分钟"}})
	// §12 remove example: outdoor_companion when raining
	if hasAlert {
		ops = append(ops, DeltaOperation{Op: "remove", Node: "outdoor_companion"})
	}
	return ops
}
