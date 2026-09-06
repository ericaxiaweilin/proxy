package business

const merchantDemandPrivacyThreshold = 10

// AggregatedDemandSignal contains no user IDs or individual traces. Counts
// below the privacy threshold are treated as unavailable, never rounded up.
type AggregatedDemandSignal struct {
	TotalMatchingDemand     int
	ConfirmedArrivals       int
	HighProbabilityArrivals int
	Confidence              float64
}

type SceneSupplySnapshot struct {
	CurrentCapacityPct  int
	ForecastCapacityPct int
	AcceptingTraffic    bool
	Confidence          float64
}

type ResolvedOperatingState struct {
	Balance  DemandSupplyBalance
	Forecast OperatingForecast
	Decision OperatingDecision
}

func ResolveOperatingState(demand *AggregatedDemandSignal, supply *SceneSupplySnapshot) ResolvedOperatingState {
	unknown := ResolvedOperatingState{
		Balance:  DemandSupplyBalance{State: "INSUFFICIENT_SIGNAL", Reason: "privacy-safe demand and future capacity signals are required"},
		Forecast: OperatingForecast{Status: "UNAVAILABLE", Assumptions: []string{}},
		Decision: OperatingDecision{Kind: "NO_ACTION", Title: "暂不主动加流量", Reason: "缺少通过隐私阈值的聚合需求和未来容量信号"},
	}
	if demand == nil || supply == nil || demand.TotalMatchingDemand < merchantDemandPrivacyThreshold || demand.Confidence <= 0 || supply.Confidence <= 0 {
		return unknown
	}
	confidence := demand.Confidence
	if supply.Confidence < confidence {
		confidence = supply.Confidence
	}
	state := "BALANCED"
	decision := OperatingDecision{Kind: "NO_ACTION", Title: "保持当前经营节奏", Reason: "未来需求与供给处于可控范围"}
	if supply.ForecastCapacityPct >= 90 || !supply.AcceptingTraffic {
		state = "OVER_CAPACITY_RISK"
		decision = OperatingDecision{Kind: "STOP_TRAFFIC", Title: "暂停主动引流", Reason: "未来容量接近上限，先保护现场体验", RequiresApproval: true}
	} else if supply.ForecastCapacityPct >= 80 {
		state = "CAPACITY_TIGHT"
		decision = OperatingDecision{Kind: "NO_ACTION", Title: "暂不增加流量", Reason: "未来容量偏紧，继续观察到店与离店变化"}
	} else if demand.ConfirmedArrivals+demand.HighProbabilityArrivals > 0 {
		state = "DEMAND_RISING"
		decision = OperatingDecision{Kind: "NO_ACTION", Title: "需求正在上升", Reason: "已有未来到店信号，暂不追加干预"}
	} else if demand.TotalMatchingDemand <= merchantDemandPrivacyThreshold && supply.ForecastCapacityPct < 50 {
		state = "SUPPLY_EXCESS"
		decision = OperatingDecision{Kind: "LOW_PEAK_FILL", Title: "可评估低峰补量", Reason: "隐私阈值已通过且未来供给充足", RequiresApproval: true}
	}
	return ResolvedOperatingState{
		Balance:  DemandSupplyBalance{State: state, Confidence: confidence, PrivacyThresholdPassed: true, Reason: decision.Reason},
		Forecast: OperatingForecast{Status: "AVAILABLE", Confidence: confidence, Version: 1, Assumptions: []string{"uses supplied future-capacity snapshot"}},
		Decision: decision,
	}
}
