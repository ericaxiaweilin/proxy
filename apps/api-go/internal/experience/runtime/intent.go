package runtime

import "time"

// ExperienceIntent — §6 Decision 与 UI 之间的语义层
// Decision Engine 只产出 Intent，不直接控制 UI
type ExperienceIntent struct {
	IntentID          string   `json:"intent_id"`
	Type              string   `json:"type"`
	Objective         string   `json:"objective"`
	Priority          float64  `json:"priority"`
	InterventionLevel string   `json:"intervention_level"`
	ContextSnapshotID string   `json:"context_snapshot_id"`
	DecisionID        string   `json:"decision_id"`
	AllowedActions    []string `json:"allowed_actions"`
	ForbiddenActions  []string `json:"forbidden_actions"`
	RequiredInfo      []string `json:"required_information"`
	ExpiresAt         time.Time `json:"expires_at"`
	ReasonCodes       []string `json:"reason_codes"`
}

var validObjectives = map[string]bool{
	"REDUCE_TIME_AND_DECISION_COST": true,
	"INCREASE_CONVENIENCE":          true,
	"ENSURE_SAFETY":                 true,
	"IMPROVE_FULFILLMENT":           true,
	"REDUCE_RISK":                   true,
	"GENERAL_ASSIST":                true,
}

var validInterventions = map[string]bool{
	"PASSIVE":    true,
	"SOFT_NUDGE": true,
	"ACTIVE":     true,
	"PUSH":       true,
	"POPUP":      true,
}

func (e ExperienceIntent) Validate() error {
	if e.IntentID == "" || e.Type == "" || e.DecisionID == "" || e.ContextSnapshotID == "" {
		return &ValidationError{Code: "INTENT_MISSING_FIELD", Message: "intent_id/type/decision_id/context_snapshot_id required"}
	}
	if !validObjectives[e.Objective] {
		return &ValidationError{Code: "INTENT_OBJECTIVE_INVALID", Message: "invalid objective"}
	}
	if !validInterventions[e.InterventionLevel] {
		return &ValidationError{Code: "INTENT_INTERVENTION_INVALID", Message: "invalid intervention_level"}
	}
	if e.Priority < 0 || e.Priority > 1 {
		return &ValidationError{Code: "INTENT_PRIORITY_INVALID", Message: "priority must be 0..1"}
	}
	if e.ExpiresAt.IsZero() || e.ExpiresAt.Before(time.Now().Add(-time.Minute)) {
		// allow slight clock skew but not expired intent
		if !e.ExpiresAt.IsZero() && e.ExpiresAt.Before(time.Now()) {
			return &ValidationError{Code: "INTENT_EXPIRED", Message: "intent expired"}
		}
	}
	return nil
}

type ValidationError struct {
	Code    string
	Message string
}

func (e *ValidationError) Error() string { return e.Code + ": " + e.Message }
