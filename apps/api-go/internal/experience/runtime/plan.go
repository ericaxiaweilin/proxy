package runtime

import "time"

type SurfacePlan struct {
	SurfacePlanID      string            `json:"surface_plan_id"`
	SurfaceID          string            `json:"surface_id"`
	SurfaceVersion     int               `json:"surface_version"`
	DecisionID         string            `json:"decision_id"`
	ExperienceIntentID string            `json:"experience_intent_id"`
	ContextSnapshotID  string            `json:"context_snapshot_id"`
	RenderMode         string            `json:"render_mode"`
	NativeComponent    *string           `json:"native_component,omitempty"`
	SchemaRef          *string           `json:"schema_ref,omitempty"`
	Slots              map[string][]string `json:"slots"`
	TTLS               int               `json:"ttl_s"`
	FallbackPlanID     *string           `json:"fallback_plan_id,omitempty"`
	PolicyVersion      string            `json:"policy_version"`
}

var validRenderModes = map[string]bool{
	"NATIVE_COMPONENT":      true,
	"PRIMITIVE_COMPOSITION": true,
	"FALLBACK":              true,
}

func (p SurfacePlan) Validate() error {
	if p.SurfacePlanID == "" || p.SurfaceID == "" || p.DecisionID == "" || p.ExperienceIntentID == "" {
		return &ValidationError{Code: "PLAN_MISSING_FIELD", Message: "surface_plan_id/surface_id/decision_id/experience_intent_id required"}
	}
	if !validRenderModes[p.RenderMode] {
		return &ValidationError{Code: "PLAN_RENDER_MODE_INVALID", Message: "invalid render_mode"}
	}
	if p.TTLS <= 0 {
		return &ValidationError{Code: "PLAN_TTL_INVALID", Message: "ttl_s must be > 0"}
	}
	if p.PolicyVersion == "" {
		return &ValidationError{Code: "PLAN_POLICY_MISSING", Message: "policy_version required"}
	}
	if p.Slots == nil {
		p.Slots = map[string][]string{}
	}
	return nil
}

// SurfaceDelta — §12/§13 Versioned Delta

type DeltaOperation struct {
	Op         string         `json:"op"`
	Slot       string         `json:"slot,omitempty"`
	Node       string         `json:"node,omitempty"`
	TargetNode string         `json:"target_node,omitempty"`
	Patch      map[string]any `json:"patch,omitempty"`
	Position   *int           `json:"position,omitempty"`
}

var validOps = map[string]bool{
	"insert": true, "remove": true, "update": true, "move": true, "replace": true, "show": true, "hide": true, "invalidate": true,
}

type SurfaceDelta struct {
	SurfaceID   string           `json:"surface_id"`
	BaseVersion int              `json:"base_version"`
	NewVersion  int              `json:"new_version"`
	DeltaID     string           `json:"delta_id"`
	CreatedAt   time.Time        `json:"created_at"`
	ExpiresAt   *time.Time       `json:"expires_at,omitempty"`
	Operations  []DeltaOperation `json:"operations"`
}

func (d SurfaceDelta) Validate() error {
	if d.SurfaceID == "" || d.DeltaID == "" {
		return &ValidationError{Code: "DELTA_MISSING_FIELD", Message: "surface_id/delta_id required"}
	}
	if d.NewVersion <= d.BaseVersion {
		return &ValidationError{Code: "DELTA_VERSION_INVALID", Message: "new_version must be > base_version"}
	}
	if len(d.Operations) == 0 {
		return &ValidationError{Code: "DELTA_NO_OPS", Message: "operations required"}
	}
	for _, op := range d.Operations {
		if !validOps[op.Op] {
			return &ValidationError{Code: "DELTA_OP_INVALID", Message: "invalid op: " + op.Op}
		}
	}
	return nil
}

func CanApplyDelta(localVersion int, delta SurfaceDelta) bool {
	return localVersion == delta.BaseVersion
}
