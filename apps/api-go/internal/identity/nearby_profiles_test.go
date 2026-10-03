package identity

import "testing"

// HOME-RAIL-SERVER-001: the nearby read must return only people whose distance
// the server actually measured, nearest first, and must never report a
// coordinate-less person as "0 m away".
//
// Why this matters: PERSON-DISTANCE-ZERO-001 excludes coordinate-less people
// from every radius, so the rail could only show its 7 local fixture people.
// This read is what makes the rail live — and it is also the one place a
// fabricated 0 could sneak back in and put every stranger at your feet.
func TestListProfilesNearbyOrdersByMeasuredDistance(t *testing.T) {
	repo := NewMemoryProfileRepository()
	// Four anchors so the ordering is unambiguous. Distances are Hanoi → X,
	// measured rather than guessed: Hue and Da Nang are both ~606 km out,
	// so the "mid" anchor is Nam Dinh (~85 km) — that puts one person clearly
	// inside a 200 km cap and the rest clearly outside. My first pass annotated
	// Hue as ~420 km and the 500 km cap assertion then failed, which is exactly
	// how a wrong distance annotation shows up.
	anchors := []struct {
		id  string
		lat float64
		lng float64
	}{
		{"near", 21.0278, 105.8342},     // Hanoi itself, 0 km
		{"mid", 20.3528, 106.0741},      // Nam Dinh, ~85 km
		{"far", 16.4637, 107.5843},      // Hue, ~606 km
		{"furthest", 10.8231, 106.6297}, // Ho Chi Minh, ~1100 km
	}
	for _, a := range anchors {
		lat, lng := a.lat, a.lng
		if _, err := repo.UpsertProfile(t.Context(), Profile{UserAccountID: a.id, Name: a.id, Handle: "@" + a.id, City: "x", Latitude: &lat, Longitude: &lng, Version: 1}); err != nil {
			t.Fatalf("seed %s: %v", a.id, err)
		}
	}
	// Coordinate-less: must never appear, at any radius.
	if _, err := repo.UpsertProfile(t.Context(), Profile{UserAccountID: "nowhere", Name: "nowhere", Handle: "@nowhere", City: "x", Version: 1}); err != nil {
		t.Fatal(err)
	}

	got, err := repo.ListProfilesNearby(t.Context(), 21.0278, 105.8342, 0, nil, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 located profiles (the coordinate-less one must be excluded), got %d: %+v", len(got), got)
	}
	wantOrder := []string{"near", "mid", "far", "furthest"}
	for i, want := range wantOrder {
		if got[i].UserAccountID != want {
			t.Fatalf("position %d: want %s, got %s (full order %v)", i, want, got[i].UserAccountID, ids(got))
		}
		if got[i].DistanceM == nil {
			t.Fatalf("%s has no distanceM — the caller would render 「距离未知」 for a located person", want)
		}
	}
	// Ordering must be strictly ascending, and the nearest must be ~0 while the
	// furthest must be far — a store that returned everything as 0 would pass a
	// "count is right" assertion but fail here.
	if *got[0].DistanceM > 1 {
		t.Fatalf("the co-located person must be ~0 m away, got %f", *got[0].DistanceM)
	}
	if *got[3].DistanceM < 900_000 {
		t.Fatalf("Hanoi→HCMC is ~1100 km; got %f m — distances look fabricated", *got[3].DistanceM)
	}
	for i := 1; i < len(got); i++ {
		if *got[i].DistanceM <= *got[i-1].DistanceM {
			t.Fatalf("distances must ascend: %d is %f, %d is %f", i-1, *got[i-1].DistanceM, i, *got[i].DistanceM)
		}
	}
	// 500 km cap: mid(≈420) and near survive, far(≈600) and furthest do not.
	capped, err := repo.ListProfilesNearby(t.Context(), 21.0278, 105.8342, 500_000, nil, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(capped) != 2 {
		t.Fatalf("500 km cap should keep 2 (near + mid), got %d: %v", len(capped), ids(capped))
	}
	for _, p := range capped {
		if *p.DistanceM >= 500_000 {
			t.Fatalf("%s at %f m passed a 500 km cap", p.UserAccountID, *p.DistanceM)
		}
	}
	// A 1 m cap keeps ONLY the co-located person — someone standing on top of
	// you is inside every radius, however small. (I first asserted 0 here,
	// which is wrong: 0 m is inside a 1 m radius. The mistake is worth
	// recording because the naive version of it — "radius means strictly
	// greater than zero away" — would push everyone standing on the viewer out
	// of their own neighbourhood.)
	one_m, err := repo.ListProfilesNearby(t.Context(), 21.0278, 105.8342, 1, nil, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(one_m) != 1 || one_m[0].UserAccountID != "near" {
		t.Fatalf("a 1 m cap must keep only the co-located person, got %v", ids(one_m))
	}
	// Limit is honoured.
	one, err := repo.ListProfilesNearby(t.Context(), 21.0278, 105.8342, 0, nil, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 1 || one[0].UserAccountID != "near" {
		t.Fatalf("limit=1 must return the nearest only, got %v", ids(one))
	}
}

func ids(ps []Profile) []string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.UserAccountID)
	}
	return out
}
