package business

import (
	"encoding/json"
	"testing"
)

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

func TestR35OperatingHomeUsesPersistedSignals(t *testing.T) {
	s := New()
	created := s.Handle(businessEnvelope("owner", "CreateBusinessAccount", "new", map[string]any{"name": "店"}))
	var body map[string]any
	if err := json.Unmarshal([]byte(created.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	biz := body["businessId"].(string)
	storeResult := s.Handle(businessEnvelope("owner", "CreateBusinessStore", "new", map[string]any{"businessId": biz, "name": "店", "address": "河内"}))
	var storeBody map[string]any
	_ = json.Unmarshal([]byte(storeResult.OperationRef), &storeBody)
	store := storeBody["storeId"].(string)
	demand := businessEnvelope("system", "RecordAggregatedDemandSignal", biz, map[string]any{"businessId": biz, "totalMatchingDemand": 38, "confirmedArrivals": 18, "highProbabilityArrivals": 11, "confidence": .84})
	demand.Actor.Type = "SYSTEM"
	if got := s.Handle(demand); got.Outcome != "ACCEPTED" {
		t.Fatalf("demand: %+v", got)
	}
	if got := s.Handle(businessEnvelope("owner", "UpsertSceneSupplySnapshot", biz, map[string]any{"businessId": biz, "storeId": store, "sceneId": "westlake", "currentCapacityPct": 58, "forecastCapacityPct": 94, "acceptingTraffic": true, "confidence": .91})); got.Outcome != "ACCEPTED" {
		t.Fatalf("supply: %+v", got)
	}
	got := s.Handle(businessEnvelope("owner", "GetMerchantOperatingHome", biz, map[string]any{"businessId": biz}))
	var homeBody struct {
		Home OperatingHome `json:"home"`
	}
	_ = json.Unmarshal([]byte(got.OperationRef), &homeBody)
	if homeBody.Home.Decision.Kind != "STOP_TRAFFIC" {
		t.Fatalf("expected persisted signal decision: %+v", homeBody.Home)
	}
}
