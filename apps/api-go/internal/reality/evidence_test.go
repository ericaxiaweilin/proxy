package reality

import "testing"

func TestCanEstablishVisit(t *testing.T) {
	if !CanEstablishVisit(EvidenceMerchantScan) { t.Fatal("merchant should establish") }
	if CanEstablishVisit(EvidenceAIGenerated) { t.Fatal("AI should not") }
	if Confidence(EvidenceUserDeclared)!=1 { t.Fatal("confidence")}
	if !RequiresModeration(EvidenceUserDeclared) { t.Fatal("moderation")}
}

func TestEconomicGate(t *testing.T) {
	if !CanWriteEconomic(ActorHuman) { t.Fatal("human should")}
	if CanWriteEconomic(ActorAITwin) { t.Fatal("twin should not")}
	if AssertEconomicWrite(ActorAINative)==nil { t.Fatal("should deny")}
}
