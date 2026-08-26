package runtime

import (
	"fmt"
	"time"
)

// ContextSnapshot — §2 Context Field 输入
type ContextSnapshot struct {
	SnapshotID        string  `json:"context_snapshot_id"`
	Weather           string  `json:"weather"` // light_rain / heavy_rain
	MobilityFriction  float64 `json:"mobility_friction"`  // 0..1
	DeliveryCapacity  float64 `json:"delivery_capacity"`  // 0..1
	CommuteETA        int     `json:"commute_eta"`        // minutes
	DecisionID        string  `json:"decision_id"`
}

// DecisionEngine — §2/§6 认知侧 → 表达侧桥梁
// 真实系统会由 Gravity/Resource/Supply/Human Value 模型计算；此处为规则化演示，保留与真实模型同构的输入输出
func Decide(snapshot ContextSnapshot) (*ExperienceIntent, string) {
	// §25 change_threshold: small changes should not trigger
	if snapshot.Weather == "light_rain" && snapshot.CommuteETA < 45 {
		return nil, "NO_UI_CHANGE: context change below threshold"
	}
	// §20 暴雨下班完整判定
	if snapshot.Weather == "heavy_rain" && snapshot.MobilityFriction > 0.5 && snapshot.DeliveryCapacity < 0.7 && snapshot.CommuteETA >= 50 {
		return &ExperienceIntent{
			IntentID:          fmt.Sprintf("exp_%s", snapshot.SnapshotID),
			Type:              "HELP_USER_HANDLE_RAIN_AFTER_WORK",
			Objective:         "REDUCE_TIME_AND_DECISION_COST",
			Priority:          0.82,
			InterventionLevel: "SOFT_NUDGE",
			ContextSnapshotID: snapshot.SnapshotID,
			DecisionID:        snapshot.DecisionID,
			AllowedActions:    []string{"open_fastest_plan"},
			ExpiresAt:         time.Now().Add(15 * time.Minute),
			ReasonCodes:       []string{"heavy_rain", "eta_64m", "mobility_friction_high"},
		}, ""
	}
	// generic fallback for other heavy contexts
	if snapshot.Weather == "heavy_rain" {
		return &ExperienceIntent{
			IntentID:          fmt.Sprintf("exp_%s", snapshot.SnapshotID),
			Type:              "HELP_USER_HANDLE_RAIN_AFTER_WORK",
			Objective:         "REDUCE_TIME_AND_DECISION_COST",
			Priority:          0.62,
			InterventionLevel: "SOFT_NUDGE",
			ContextSnapshotID: snapshot.SnapshotID,
			DecisionID:        snapshot.DecisionID,
			AllowedActions:    []string{"open_fastest_plan"},
			ExpiresAt:         time.Now().Add(10 * time.Minute),
			ReasonCodes:       []string{"heavy_rain"},
		}, ""
	}
	return nil, "NO_UI_CHANGE: no matching intent"
}
