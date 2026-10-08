package tagging

import (
	"testing"
	"time"
)

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func ago(d time.Duration) time.Time { return now.Add(-d) }

func find(tags []Tag, axis, value string) (Tag, bool) {
	for _, t := range tags {
		if t.Axis == axis && t.Value == value {
			return t, true
		}
	}
	return Tag{}, false
}

func TestNoEvidenceNoTagsAndTooLittleEvidenceNoTags(t *testing.T) {
	if got := Derive(Evidence{UserID: "u"}, now); len(got) != 0 {
		t.Fatalf("no evidence must give no tags, got %v", got)
	}
	thin := Evidence{UserID: "u", Scenes: map[string]SceneEvidence{"COFFEE": {Events: 4, DwellMs: 200000, First: ago(time.Hour), Last: ago(time.Hour)}}}
	if got := Derive(thin, now); len(got) != 0 {
		t.Fatalf("4 impressions is below the floor, got %v", got)
	}
}

func TestSceneInterestGrowsWithDwellAndNeverReachesOne(t *testing.T) {
	mk := func(ms int64) Tag {
		ev := Evidence{UserID: "u", Scenes: map[string]SceneEvidence{"COFFEE": {Events: 8, DwellMs: ms, First: ago(48 * time.Hour), Last: ago(time.Hour)}}}
		tag, ok := find(Derive(ev, now), AxisInterestScene, "COFFEE")
		if !ok {
			t.Fatalf("expected an interest tag at %dms", ms)
		}
		return tag
	}
	low, mid, huge := mk(20_000), mk(90_000), mk(100_000_000)
	if !(low.Strength < mid.Strength && mid.Strength < huge.Strength) {
		t.Fatalf("strength must grow with dwell: %v %v %v", low.Strength, mid.Strength, huge.Strength)
	}
	if huge.Strength >= 1.0001 || huge.Strength < 0.99 {
		t.Fatalf("saturating strength should approach but not exceed 1, got %v", huge.Strength)
	}
	if mid.Strength < 0.6 || mid.Strength > 0.66 {
		t.Fatalf("90s of dwell is the documented ~0.63, got %v", mid.Strength)
	}
	if mid.Source != SourceBehavior || mid.SourceDiversity != 1 || mid.RuleVersion != RuleVersion {
		t.Fatalf("provenance fields wrong: %+v", mid)
	}
}

func TestQuickSkipsBecomeAversionNotInterest(t *testing.T) {
	ev := Evidence{UserID: "u", Scenes: map[string]SceneEvidence{"SPA": {Events: 10, DwellMs: 4000, QuickSkips: 9, First: ago(24 * time.Hour), Last: ago(time.Hour)}}}
	tags := Derive(ev, now)
	if _, ok := find(tags, AxisAversionScene, "SPA"); !ok {
		t.Fatalf("9/10 quick skips must be an aversion tag: %v", tags)
	}
	if _, ok := find(tags, AxisInterestScene, "SPA"); ok {
		t.Fatal("a scene cannot be both an interest and an aversion")
	}
}

func TestExplicitActionsOutweighPassiveViewingAndMarkTheSource(t *testing.T) {
	passive := Evidence{UserID: "u", Activities: map[string]ActivityEvidence{"HIKING": {Views: 3, DwellMs: 30_000, First: ago(time.Hour), Last: ago(time.Hour)}}}
	explicit := Evidence{UserID: "u", Activities: map[string]ActivityEvidence{"HIKING": {Views: 3, DwellMs: 30_000, Interested: 1, Joined: 1, First: ago(time.Hour), Last: ago(time.Hour)}}}
	p, _ := find(Derive(passive, now), AxisInterestActivity, "HIKING")
	e, _ := find(Derive(explicit, now), AxisInterestActivity, "HIKING")
	if e.Strength <= p.Strength {
		t.Fatalf("explicit interest/join must raise strength: passive=%v explicit=%v", p.Strength, e.Strength)
	}
	if p.Source != SourceBehavior || e.Source != SourceMixed || e.SourceDiversity != 2 || e.Confidence <= p.Confidence {
		t.Fatalf("source/diversity/confidence: passive=%+v explicit=%+v", p, e)
	}
	onlyExplicit := Evidence{UserID: "u", Activities: map[string]ActivityEvidence{"YOGA": {Joined: 1, First: ago(time.Hour), Last: ago(time.Hour)}}}
	y, ok := find(Derive(onlyExplicit, now), AxisInterestActivity, "YOGA")
	if !ok || y.Source != SourceExplicit {
		t.Fatalf("a join with no viewing is an explicit tag: %+v", y)
	}
}

func TestRhythmNeedsEnoughEventsAndADominantBucket(t *testing.T) {
	ev := Evidence{UserID: "u"}
	// 周六 20:00 越南时间 = 13:00 UTC。
	sat := time.Date(2026, 10, 10, 13, 0, 0, 0, time.UTC)
	ev.HourCounts[HourSlot(sat)] = 10
	ev.HourCounts[HourSlot(sat.Add(24*time.Hour))] = 4 // 周日同时段
	if tag, ok := find(Derive(ev, now), AxisRhythm, "WEEKEND_EVENING"); !ok || tag.Strength < 0.99 {
		t.Fatalf("14 weekend-evening events should give WEEKEND_EVENING, got %+v ok=%v", tag, ok)
	}
	spread := Evidence{UserID: "u"}
	for slot := 0; slot < 168; slot += 7 {
		spread.HourCounts[slot] = 1
	}
	for _, tag := range Derive(spread, now) {
		if tag.Axis == AxisRhythm {
			t.Fatalf("evenly spread activity has no dominant rhythm: %+v", tag)
		}
	}
	few := Evidence{UserID: "u"}
	few.HourCounts[HourSlot(sat)] = 5
	if got := Derive(few, now); len(got) != 0 {
		t.Fatalf("5 events is below the rhythm floor: %v", got)
	}
}

func TestCityAndAreaRules(t *testing.T) {
	ev := Evidence{UserID: "u",
		Cities: map[string]int{"HANOI": 8, "BACNINH": 2},
		Cells:  map[string]CellEvidence{"21.03,105.85": {Days: 4, First: ago(72 * time.Hour), Last: ago(time.Hour)}, "21.00,105.80": {Days: 2, First: ago(time.Hour), Last: ago(time.Hour)}},
	}
	tags := Derive(ev, now)
	if tag, ok := find(tags, AxisCity, "HANOI"); !ok || tag.Strength != 0.8 {
		t.Fatalf("HANOI should be 80%% of events: %+v", tag)
	}
	if _, ok := find(tags, AxisArea, "21.03,105.85"); !ok {
		t.Fatal("4 distinct days in a cell is an area tag")
	}
	if _, ok := find(tags, AxisArea, "21.00,105.80"); ok {
		t.Fatal("2 days is below the floor")
	}
}

func TestExpiredEvidenceDoesNotBecomeATagAndGarbageValuesAreRefused(t *testing.T) {
	old := Evidence{UserID: "u", Scenes: map[string]SceneEvidence{"COFFEE": {Events: 9, DwellMs: 200000, First: ago(90 * 24 * time.Hour), Last: ago(60 * 24 * time.Hour)}}}
	if got := Derive(old, now); len(got) != 0 {
		t.Fatalf("evidence older than the ttl must not produce a tag: %v", got)
	}
	dirty := Evidence{UserID: "u", Scenes: map[string]SceneEvidence{"咖啡 店 \n 你好": {Events: 9, DwellMs: 200000, First: ago(time.Hour), Last: ago(time.Hour)}}}
	if got := Derive(dirty, now); len(got) != 0 {
		t.Fatalf("free text is not a controlled value: %v", got)
	}
}

func TestCoarseCellNeverKeepsTheRawFix(t *testing.T) {
	cell, ok := CoarseCell(21.0287913, 105.8523441)
	if !ok || cell != "21.02,105.85" {
		t.Fatalf("expected the 0.01 grid cell, got %q ok=%v", cell, ok)
	}
	if _, ok := CoarseCell(91, 0); ok {
		t.Fatal("out-of-range latitude must be refused")
	}
}

func TestReadingRequiresAnAllowedUseAndSkipsExpired(t *testing.T) {
	live := Tag{Axis: AxisInterestScene, Value: "COFFEE", ExpiresAt: now.Add(time.Hour)}
	dead := Tag{Axis: AxisInterestScene, Value: "SPA", ExpiresAt: now.Add(-time.Hour)}
	unknown := Tag{Axis: "MERCHANT_AUDIENCE", Value: "X", ExpiresAt: now.Add(time.Hour)}
	got := FilterForUse([]Tag{live, dead, unknown}, UseMatching, now)
	if len(got) != 1 || got[0].Value != "COFFEE" {
		t.Fatalf("only the live, registered tag may be read: %v", got)
	}
	if len(FilterForUse([]Tag{live}, Use("merchant_targeting"), now)) != 0 {
		t.Fatal("merchant_targeting is not an allowed use of any axis")
	}
}

func TestOverlapRewardsSharedInterestAndPenalisesAversion(t *testing.T) {
	a := []Tag{{Axis: AxisInterestScene, Value: "COFFEE", Strength: 0.8}, {Axis: AxisInterestScene, Value: "HIKING", Strength: 0.4}}
	b := []Tag{{Axis: AxisInterestScene, Value: "COFFEE", Strength: 0.6}}
	if got := Overlap(a, b); got != 0.6 {
		t.Fatalf("min strength of the shared tag, got %v", got)
	}
	if got := Overlap(a, []Tag{{Axis: AxisInterestScene, Value: "SPA", Strength: 0.9}}); got != 0 {
		t.Fatalf("nothing shared must be 0, got %v", got)
	}
	avoids := append(append([]Tag{}, a...), Tag{Axis: AxisAversionScene, Value: "COFFEE", Strength: 0.8})
	if Overlap(avoids, b) >= Overlap(a, b) {
		t.Fatal("an aversion to the shared scene must lower the score")
	}
}
