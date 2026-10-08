package activity

import "testing"

func slot(id, venue, scene, label string, people, joined, capacity int) VenueSlotLoad {
	return VenueSlotLoad{ActivityID: id, Title: id, VenueName: venue, SceneID: scene, TimeLabel: label, People: people, Joined: joined, Capacity: capacity}
}

func TestAnOrderThatPushesAVenueToTheLineIsFlaggedButNeverBlocked(t *testing.T) {
	// 38 人 + 这一对 2 人 = 40 人 = 80%：到线，建议换（但只是 Crowded=true，没有任何拒绝的概念）。
	all := []VenueSlotLoad{
		slot("a_busy", "Cafe A", "scene_a", "周六 15:00", 38, 19, 0),
		slot("b_quiet", "Cafe B", "scene_b", "周六 15:00", 6, 3, 0),
	}
	got, ok := ComputeCrowding("a_busy", all)
	if !ok || !got.Crowded || got.LoadPct != 80 || got.PeopleNow != 38 || got.Projected != 40 || !got.Estimate {
		t.Fatalf("40/50 is the line: %+v", got)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].ActivityID != "b_quiet" || got.Alternatives[0].LoadPct != 16 {
		t.Fatalf("the quieter venue at the same time is suggested: %+v", got.Alternatives)
	}
}

func TestBelowTheLineNothingIsSuggested(t *testing.T) {
	got, ok := ComputeCrowding("a", []VenueSlotLoad{slot("a", "Cafe A", "s", "周六 15:00", 36, 18, 0), slot("b", "Cafe B", "s2", "周六 15:00", 0, 0, 0)})
	if !ok || got.Crowded || len(got.Alternatives) != 0 || got.LoadPct != 76 {
		t.Fatalf("38/50 = 76%% is fine and must not nag with alternatives: %+v", got)
	}
}

func TestTwoActivitiesAtTheSameVenueAndTimeAddUp(t *testing.T) {
	all := []VenueSlotLoad{slot("a1", "Cafe A", "s", "周六 15:00", 20, 10, 0), slot("a2", "Cafe A", "s", "周六 15:00", 20, 10, 0), slot("x", "Cafe X", "sx", "周六 15:00", 0, 0, 0)}
	got, _ := ComputeCrowding("a1", all)
	if got.PeopleNow != 40 || !got.Crowded {
		t.Fatalf("the venue's people at that time are summed across its activities: %+v", got)
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].ActivityID != "x" {
		t.Fatalf("the same venue's other activity is never an alternative: %+v", got.Alternatives)
	}
}

func TestAlternativesSkipFullAndEquallyCrowdedAndDifferentTimesAndAreCapped(t *testing.T) {
	all := []VenueSlotLoad{
		slot("target", "A", "sa", "周六 15:00", 40, 20, 0),
		slot("full", "F", "sf", "周六 15:00", 2, 5, 5),       // 名额满了
		slot("crowded", "C", "sc", "周六 15:00", 40, 20, 0),  // 同样偏满
		slot("other_time", "T", "st", "周日 10:00", 0, 0, 0), // 别的时间标签不在比较范围内
		slot("g1", "G1", "g1", "周六 15:00", 10, 5, 0),
		slot("g2", "G2", "g2", "周六 15:00", 4, 2, 0),
		slot("g3", "G3", "g3", "周六 15:00", 8, 4, 0),
		slot("g4", "G4", "g4", "周六 15:00", 12, 6, 0),
	}
	got, _ := ComputeCrowding("target", all)
	ids := []string{}
	for _, a := range got.Alternatives {
		ids = append(ids, a.ActivityID)
	}
	if len(ids) != 3 || ids[0] != "g2" || ids[1] != "g3" || ids[2] != "g1" {
		t.Fatalf("emptiest first, at most 3, never full / equally crowded / another time: %v", ids)
	}
}

func TestUnknownActivityIsNotInventedAndVenuesWithoutASceneAreMatchedByName(t *testing.T) {
	if _, ok := ComputeCrowding("missing", []VenueSlotLoad{slot("a", "A", "s", "x", 0, 0, 0)}); ok {
		t.Fatal("an activity that is not in the data gets no answer")
	}
	all := []VenueSlotLoad{slot("a1", " Cafe A ", "", "周六", 20, 1, 0), slot("a2", "cafe a", "", "周六", 20, 1, 0)}
	if got, _ := ComputeCrowding("a1", all); got.PeopleNow != 40 {
		t.Fatalf("no scene id ⇒ the venue name (case / space insensitive) is the key: %+v", got)
	}
}
