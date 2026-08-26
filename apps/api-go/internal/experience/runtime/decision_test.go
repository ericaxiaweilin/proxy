package runtime

import "testing"

func TestDecideRainCase(t *testing.T) {
	snap := ContextSnapshot{SnapshotID: "ctx_1842", Weather: "heavy_rain", MobilityFriction: 0.72, DeliveryCapacity: 0.61, CommuteETA: 64, DecisionID: "dec_82A1"}
	intent, reason := Decide(snap)
	if intent == nil {
		t.Fatalf("expected intent, got no_ui_change: %s", reason)
	}
	if intent.Type != "HELP_USER_HANDLE_RAIN_AFTER_WORK" || intent.Priority < 0.8 {
		t.Fatalf("unexpected intent: %+v", intent)
	}
}

func TestDecideNoChange(t *testing.T) {
	snap := ContextSnapshot{SnapshotID: "ctx_1", Weather: "light_rain", MobilityFriction: 0.27, DeliveryCapacity: 0.88, CommuteETA: 31, DecisionID: "dec_1"}
	intent, _ := Decide(snap)
	if intent != nil {
		t.Fatal("expected NO_UI_CHANGE for light rain + low ETA")
	}
}
