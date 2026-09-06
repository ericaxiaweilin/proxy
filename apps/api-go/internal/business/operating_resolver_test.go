package business

import "testing"

func TestR35ResolverFailsClosedBelowPrivacyThreshold(t *testing.T) {
	got := ResolveOperatingState(&AggregatedDemandSignal{TotalMatchingDemand: 9, Confidence: .9}, &SceneSupplySnapshot{ForecastCapacityPct: 20, AcceptingTraffic: true, Confidence: .9})
	if got.Balance.PrivacyThresholdPassed || got.Decision.Kind != "NO_ACTION" || got.Forecast.Status != "UNAVAILABLE" {
		t.Fatalf("must fail closed: %+v", got)
	}
}

func TestR35ResolverStopsTrafficFromFutureCapacity(t *testing.T) {
	got := ResolveOperatingState(&AggregatedDemandSignal{TotalMatchingDemand: 38, ConfirmedArrivals: 18, HighProbabilityArrivals: 11, Confidence: .84}, &SceneSupplySnapshot{CurrentCapacityPct: 58, ForecastCapacityPct: 94, AcceptingTraffic: true, Confidence: .91})
	if got.Balance.State != "OVER_CAPACITY_RISK" || got.Decision.Kind != "STOP_TRAFFIC" {
		t.Fatalf("future risk must stop traffic: %+v", got)
	}
	if got.Balance.Confidence != .84 {
		t.Fatalf("confidence must use weakest input: %v", got.Balance.Confidence)
	}
}

func TestR35ResolverKeepsNoActionFirstClass(t *testing.T) {
	got := ResolveOperatingState(&AggregatedDemandSignal{TotalMatchingDemand: 24, Confidence: .8}, &SceneSupplySnapshot{CurrentCapacityPct: 55, ForecastCapacityPct: 63, AcceptingTraffic: true, Confidence: .7})
	if got.Balance.State != "BALANCED" || got.Decision.Kind != "NO_ACTION" || got.Forecast.Status != "AVAILABLE" {
		t.Fatalf("balanced state: %+v", got)
	}
}
