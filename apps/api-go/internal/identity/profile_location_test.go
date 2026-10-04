package identity

import (
	"encoding/json"
	"testing"
)

// FOR-YOU-CANDIDATES-001（2026-10-04，用户：「改成一个单条件 30km 就可以，默认是能接单的」）：
// 新注册、没开过接单资料的人，只要上报过真实位置，就进 30km 内的「附近的人」；
// 附近接口只回距离，不把任何人的坐标发给别人；没有位置的人不进（距离未知 ≠ 很近）。
func TestUpdateMyLocationMakesANewUserNearbyWithoutLeakingCoordinates(t *testing.T) {
	svc := New(nil)
	for _, id := range []string{"user_new", "user_viewer", "user_silent"} {
		if _, err := svc.profileService.UpsertProfile(t.Context(), Profile{UserAccountID: id, Name: id, Handle: "@" + id, City: "Hà Nội", Version: 1}); err != nil {
			t.Fatalf("seed %s: %v", id, err)
		}
	}

	// 还剑湖往西 ~2km：在 30km 内。
	set := svc.Handle(profileEnvelope("UpdateMyLocation", "user_new", map[string]any{"latitude": 21.0285, "longitude": 105.8342}))
	if set.Outcome != "ACCEPTED" {
		t.Fatalf("update my location: %#v", set)
	}
	bad := svc.Handle(profileEnvelope("UpdateMyLocation", "user_new", map[string]any{"latitude": 91.0, "longitude": 0.0}))
	if bad.Error == nil || bad.Error.ErrorCode != "INVALID_LOCATION" {
		t.Fatalf("out-of-range location must be rejected: %#v", bad)
	}

	got := svc.Handle(profileEnvelope("ListNearbyProfiles", "user_viewer", map[string]any{
		"latitude": 21.0285, "longitude": 105.8542, "maxDistanceKm": 30.0, "limit": 500,
	}))
	if got.Outcome != "ACCEPTED" {
		t.Fatalf("nearby: %#v", got)
	}
	var body struct {
		Profiles []map[string]any `json:"profiles"`
	}
	if err := json.Unmarshal([]byte(got.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Profiles) != 1 || body.Profiles[0]["userAccountId"] != "user_new" {
		t.Fatalf("only the located new user is nearby (the silent one has no location): %+v", body.Profiles)
	}
	if _, leaked := body.Profiles[0]["latitude"]; leaked {
		t.Fatalf("nearby must not send anyone's coordinates: %+v", body.Profiles[0])
	}
	if _, ok := body.Profiles[0]["distanceM"]; !ok {
		t.Fatalf("nearby must carry the server-measured distance: %+v", body.Profiles[0])
	}

	far := svc.Handle(profileEnvelope("ListNearbyProfiles", "user_viewer", map[string]any{
		"latitude": 10.8231, "longitude": 106.6297, "maxDistanceKm": 30.0, "limit": 500,
	}))
	if err := json.Unmarshal([]byte(far.OperationRef), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Profiles) != 0 {
		t.Fatalf("from Ho Chi Minh City nobody in Hanoi is within 30km: %+v", body.Profiles)
	}
}
