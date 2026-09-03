package ai
import "testing"
func TestTwinGate(t *testing.T){
 if !IsAllowed(CapTextDraft){t.Fatal()}
 if IsAllowed(CapStrangerDM){t.Fatal("DM OFF")}
 if IsAllowed(CapEconomicWrite){t.Fatal()}
 if !HighRiskFacet("payment"){t.Fatal()}
}
