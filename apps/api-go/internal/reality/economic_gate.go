package reality

import "fmt"

// P0 PAY-01 / P10: Economic Authority — 仅 Human/Business/Payment System 可写
type ActorType string
const (
	ActorHuman    ActorType = "HUMAN"
	ActorBusiness ActorType = "BUSINESS"
	ActorAINative ActorType = "AI_NATIVE"
	ActorAITwin   ActorType = "AI_TWIN"
	ActorSystem   ActorType = "SYSTEM"
)

func CanWriteEconomic(actor ActorType) bool {
	switch actor {
	case ActorHuman, ActorBusiness, ActorSystem:
		return true
	case ActorAINative, ActorAITwin:
		return false
	default:
		return false
	}
}

func AssertEconomicWrite(actor ActorType) error {
	if !CanWriteEconomic(actor) {
		return fmt.Errorf("economic write denied for %s — AC-06", actor)
	}
	return nil
}
