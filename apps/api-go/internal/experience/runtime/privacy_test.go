package runtime

import "testing"

func TestPrivacyFilter(t *testing.T) {
	props := map[string]any{"text": "正常文案", "price_accept_p75": 123, "income_inference": "high"}
	out := FilterSensitiveProps(props)
	if _, ok := out["price_accept_p75"]; ok {
		t.Fatal("sensitive not filtered")
	}
	if out["text"] != "正常文案" {
		t.Fatal("normal prop lost")
	}
	forbidden := map[string]any{"text": "因为我们判断你收入较高，所以给你推荐……"}
	out2 := FilterSensitiveProps(forbidden)
	if _, ok := out2["text"]; ok {
		t.Fatal("forbidden explanation not filtered")
	}
}

func TestChannelPolicy(t *testing.T) {
	if !IsChannelAllowed("SOFT_NUDGE", "FEED") {
		t.Fatal("SOFT_NUDGE should allow FEED")
	}
	if IsChannelAllowed("SOFT_NUDGE", "PUSH") {
		t.Fatal("SOFT_NUDGE should not allow PUSH")
	}
	if !IsChannelAllowed("ACTIVE", "PUSH") {
		t.Fatal("ACTIVE should allow PUSH")
	}
}
