package ai

// P0 AI-01/02/05: Twin R1 — Master §17.3/17.4, AC-07/08/15
type Capability string
const (
	CapTextDraft      Capability = "TEXT_DRAFT"
	CapPublicReply    Capability = "PUBLIC_REPLY"
	CapStrangerDM     Capability = "STRANGER_DM"
	CapInviteIntake   Capability = "INVITE_INTAKE"
	CapAutoAccept     Capability = "AUTO_ACCEPT"
	CapEconomicWrite  Capability = "ECONOMIC_WRITE"
)

func IsAllowed(cap Capability) bool {
	switch cap {
	case CapTextDraft, CapPublicReply, CapInviteIntake:
		return true
	case CapStrangerDM, CapAutoAccept, CapEconomicWrite:
		return false
	default:
		return false
	}
}

func HighRiskFacet(facet string) bool {
	switch facet {
	case "contact", "payment", "crypto", "adult":
		return true
	default:
		return false
	}
}
