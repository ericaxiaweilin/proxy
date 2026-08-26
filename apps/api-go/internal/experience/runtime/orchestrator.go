package runtime

// ExperienceOrchestrator — §7
// 负责 Intent → SurfacePlan，不直接控制 UI 细节
type ExperienceOrchestrator struct {
	compiler *SurfaceCompiler
}

// NewOrchestrator creates orchestrator with compiler
func NewOrchestrator(compiler *SurfaceCompiler) *ExperienceOrchestrator {
	if compiler == nil {
		compiler = NewSurfaceCompiler("")
	}
	return &ExperienceOrchestrator{compiler: compiler}
}

type OrchestrateRequest struct {
	Intent                ExperienceIntent  `json:"intent"`
	Capability            ClientCapability  `json:"capability"`
	CurrentSurfaceVersion *int              `json:"current_surface_version,omitempty"`
}

// Orchestrate §7 策略：Intent → 是否有成熟 Native Experiences → No → Primitive Composer → Capability → Policy → SurfacePlan
func (o *ExperienceOrchestrator) Orchestrate(req OrchestrateRequest) (*CompileResult, error) {
	// NO_UI_CHANGE is valid per §18.4 / §28.12
	if req.Intent.Priority < 0.15 {
		return nil, &ValidationError{Code: "NO_UI_CHANGE", Message: "priority below intervention threshold"}
	}
	compileReq := CompileRequest{
		Intent:                req.Intent,
		ClientCapability:      req.Capability,
		CurrentSurfaceVersion: req.CurrentSurfaceVersion,
	}
	return o.compiler.Compile(compileReq)
}
