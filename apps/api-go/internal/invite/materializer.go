package invite

import "fmt"

// Canonical State Machine per Master PRD §23
// Invite: DRAFT -> SENT -> PENDING -> ACCEPTED/DECLINED/EXPIRED -> MATERIALIZED

type State string
const (
	StateDraft        State = "DRAFT"
	StateSent         State = "SENT"
	StatePending      State = "PENDING"
	StateAccepted     State = "ACCEPTED"
	StateDeclined     State = "DECLINED"
	StateExpired      State = "EXPIRED"
	StateMaterialized State = "MATERIALIZED"
)

type SourceContextType string
const (
	SourceProfile   SourceContextType = "PROFILE"
	SourceScene     SourceContextType = "SCENE"
	SourceActivity  SourceContextType = "ACTIVITY"
	SourceOpportunity SourceContextType = "OPPORTUNITY"
	SourceBusiness  SourceContextType = "BUSINESS"
	SourceAITwin    SourceContextType = "AI_TWIN"
)

type MaterializedType string
const (
	MaterializedPlan        MaterializedType = "Plan"
	MaterializedParticipation MaterializedType = "Participation"
	MaterializedOrderDraft  MaterializedType = "OrderDraft"
)

type Invite struct {
	ID                string
	SourceContextType SourceContextType
	SourceContextID   string
	TermsSnapshot     map[string]any
	State             State
	TermsVersion      int
}

func Materialize(inv Invite) (MaterializedType, error) {
	switch inv.SourceContextType {
	case SourceProfile, SourceScene:
		return MaterializedPlan, nil
	case SourceActivity:
		return MaterializedParticipation, nil
	case SourceOpportunity, SourceBusiness:
		return MaterializedOrderDraft, nil
	case SourceAITwin:
		return "", fmt.Errorf("AI_TWIN intake remains DRAFT awaiting human confirm")
	default:
		return "", fmt.Errorf("unknown source_context_type %s", inv.SourceContextType)
	}
}

func IsMaterialChange(oldTerms, newTerms map[string]any) bool {
	for _, k := range []string{"price", "time", "exactLocation", "scope"} {
		if oldTerms[k] != newTerms[k] {
			return true
		}
	}
	return false
}

func NextTermsVersion(current int, materialChange bool) int {
	if materialChange {
		return current + 1
	}
	return current
}
