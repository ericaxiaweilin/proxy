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
	thin := Evidence{UserID: "u", TopicViews: map[string]TopicEvidence{"桌游": {Events: 4, QuickSkips: 4, First: ago(time.Hour), Last: ago(time.Hour)}}}
	if got := Derive(thin, now); len(got) != 0 {
		t.Fatalf("4 impressions is below the aversion floor, got %v", got)
	}
}

func TestTopicInterestGrowsWithWeightAndNeverReachesOne(t *testing.T) {
	mk := func(weight float64) Tag {
		ev := Evidence{UserID: "u", Signals: []Signal{{Axis: AxisInterestTopic, Value: "咖啡", Weight: weight, N: 8, First: ago(48 * time.Hour), Last: ago(time.Hour)}}}
		tag, ok := find(Derive(ev, now), AxisInterestTopic, "咖啡")
		if !ok {
			t.Fatalf("expected an interest tag at weight %v", weight)
		}
		return tag
	}
	low, mid, huge := mk(0.7), mk(4), mk(10_000)
	if !(low.Strength < mid.Strength && mid.Strength < huge.Strength) {
		t.Fatalf("strength must grow with weight: %v %v %v", low.Strength, mid.Strength, huge.Strength)
	}
	if huge.Strength >= 1.0001 || huge.Strength < 0.99 {
		t.Fatalf("saturating strength should approach but not exceed 1, got %v", huge.Strength)
	}
	if mid.Strength < 0.6 || mid.Strength > 0.66 {
		t.Fatalf("the topic scale is 4: weight 4 gives ~0.63, got %v", mid.Strength)
	}
	if mid.Source != SourceBehavior || mid.SourceDiversity != 1 || mid.RuleVersion != RuleVersion {
		t.Fatalf("provenance fields wrong: %+v", mid)
	}
}

func TestQuickSkipsBecomeAversionNotInterest(t *testing.T) {
	ev := Evidence{UserID: "u", TopicViews: map[string]TopicEvidence{"桌游": {Events: 10, DwellMs: 4000, QuickSkips: 9, First: ago(24 * time.Hour), Last: ago(time.Hour)}}}
	tags := Derive(ev, now)
	if _, ok := find(tags, AxisAversionTopic, "桌游"); !ok {
		t.Fatalf("9/10 quick skips must be an aversion tag: %v", tags)
	}
	if _, ok := find(tags, AxisInterestTopic, "桌游"); ok {
		t.Fatal("a topic cannot be both an interest and an aversion")
	}
}

func TestExplicitActionsOutweighPassiveViewingAndMarkTheSource(t *testing.T) {
	passive := Evidence{UserID: "u", Activities: map[string]ActivityEvidence{"徒步": {Views: 3, DwellMs: 30_000, First: ago(time.Hour), Last: ago(time.Hour)}}}
	explicit := Evidence{UserID: "u", Activities: map[string]ActivityEvidence{"徒步": {Views: 3, DwellMs: 30_000, Interested: 1, Joined: 1, First: ago(time.Hour), Last: ago(time.Hour)}}}
	p, _ := find(Derive(passive, now), AxisInterestActivity, "徒步")
	e, _ := find(Derive(explicit, now), AxisInterestActivity, "徒步")
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
	old := Evidence{UserID: "u", TopicViews: map[string]TopicEvidence{"桌游": {Events: 9, QuickSkips: 9, First: ago(90 * 24 * time.Hour), Last: ago(60 * 24 * time.Hour)}}}
	if got := Derive(old, now); len(got) != 0 {
		t.Fatalf("evidence older than the ttl must not produce a tag: %v", got)
	}
	dirty := Evidence{UserID: "u", TopicViews: map[string]TopicEvidence{"咖啡 店 \n 你好!!": {Events: 9, QuickSkips: 9, First: ago(time.Hour), Last: ago(time.Hour)}}}
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
	live := Tag{Axis: AxisInterestTopic, Value: "咖啡", ExpiresAt: now.Add(time.Hour)}
	dead := Tag{Axis: AxisInterestTopic, Value: "摄影", ExpiresAt: now.Add(-time.Hour)}
	unknown := Tag{Axis: "MERCHANT_AUDIENCE", Value: "X", ExpiresAt: now.Add(time.Hour)}
	got := FilterForUse([]Tag{live, dead, unknown}, UseMatching, now)
	if len(got) != 1 || got[0].Value != "咖啡" {
		t.Fatalf("only the live, registered tag may be read: %v", got)
	}
	if len(FilterForUse([]Tag{live}, Use("merchant_targeting"), now)) != 0 {
		t.Fatal("merchant_targeting is not an allowed use of any axis")
	}
}

func TestOverlapRewardsSharedInterestAndPenalisesAversion(t *testing.T) {
	a := []Tag{{Axis: AxisInterestTopic, Value: "咖啡", Strength: 0.8}, {Axis: AxisInterestTopic, Value: "徒步", Strength: 0.4}}
	b := []Tag{{Axis: AxisInterestTopic, Value: "咖啡", Strength: 0.6}}
	if got := Overlap(a, b); got != 0.6 {
		t.Fatalf("min strength of the shared tag, got %v", got)
	}
	if got := Overlap(a, []Tag{{Axis: AxisInterestTopic, Value: "摄影", Strength: 0.9}}); got != 0 {
		t.Fatalf("nothing shared must be 0, got %v", got)
	}
	avoids := append(append([]Tag{}, a...), Tag{Axis: AxisAversionTopic, Value: "咖啡", Strength: 0.8})
	if Overlap(avoids, b) >= Overlap(a, b) {
		t.Fatal("an aversion to the shared scene must lower the score")
	}
}

// TAG-SYSTEM-002：一条显式场所行为同时贡献 店 / 类型 / 风格 / 区 四个轴；信号少就置信度低，而不是不出标签。
func TestAffinityKeepsTheFineGrainedValuesAndTrustsThinEvidenceLess(t *testing.T) {
	sig := func(axis, value string, w float64) Signal {
		return Signal{Axis: axis, Value: value, Weight: w, N: 1, First: ago(72 * time.Hour), Last: ago(time.Hour), Explicit: true}
	}
	ev := Evidence{UserID: "u", Signals: []Signal{
		sig(AxisVenueFavorite, "cafe_giang", 3), sig(AxisVenueKind, "咖啡", 3), sig(AxisVenueStyle, "店招", 3), sig(AxisDistrict, "Hoàn Kiếm", 3),
		sig(AxisVenueFavorite, "cafe_dinh", 1), sig(AxisVenueKind, "咖啡", 1), sig(AxisVenueStyle, "店招", 1), sig(AxisDistrict, "Hoàn Kiếm", 1),
		sig(AxisVenueKind, "餐厅", 1), // 只有一条：不够出标签
	}}
	tags := Derive(ev, now)
	if _, ok := find(tags, AxisVenueFavorite, "cafe_giang"); !ok {
		t.Fatal("one explicit save of a specific venue is enough for the venue itself")
	}
	if kind, ok := find(tags, AxisVenueKind, "咖啡"); !ok || kind.EvidenceCount != 2 || kind.Source != SourceExplicit {
		t.Fatalf("two coffee venues give a kind tag (unicode value, explicit source): %+v ok=%v", kind, ok)
	}
	single, ok := find(tags, AxisVenueKind, "餐厅")
	if !ok {
		t.Fatal("even one restaurant is a kind tag: finer is better")
	}
	if kind, _ := find(tags, AxisVenueKind, "咖啡"); !(single.Confidence < kind.Confidence) {
		t.Fatalf("but one signal must be less trusted than two: single=%v two=%v", single.Confidence, kind.Confidence)
	}
	if d, ok := find(tags, AxisDistrict, "Hoàn_Kiếm"); !ok || d.Strength < 0.6 {
		t.Fatalf("district value is normalised (space -> underscore) and saturates: %+v ok=%v", d, ok)
	}
	if len(tags) < 5 {
		t.Fatalf("a single behaviour pair should already give a fine-grained set, got %d: %v", len(tags), tags)
	}
}

func TestDeclaredTagsAreAlwaysCurrentAndNeverExpireFromStaleness(t *testing.T) {
	long := ago(300 * 24 * time.Hour)
	ev := Evidence{UserID: "u", Signals: []Signal{
		{Axis: AxisSkill, Value: "CITY_COMPANION", Weight: 1, N: 1, First: long, Last: long, Explicit: true},
		{Axis: AxisLanguage, Value: "zh", Weight: 1, N: 1, First: long, Last: long, Explicit: true},
	}}
	tags := Derive(ev, now)
	skill, ok := find(tags, AxisSkill, "CITY_COMPANION")
	if !ok || !skill.LastSeen.Equal(now) || skill.Source != SourceExplicit || skill.Strength < 0.8 {
		t.Fatalf("a declared skill is a present-tense fact: %+v ok=%v", skill, ok)
	}
	if _, ok := find(tags, AxisLanguage, "zh"); !ok {
		t.Fatal("declared language must survive")
	}
}

func TestPassiveAndExplicitSignalsMixIntoMixedSource(t *testing.T) {
	ev := Evidence{UserID: "u", Signals: []Signal{
		{Axis: AxisCreatorAffinity, Value: "user_xiaomei", Weight: 2, N: 2, First: ago(48 * time.Hour), Last: ago(time.Hour)},
		{Axis: AxisCreatorAffinity, Value: "user_xiaomei", Weight: 3, N: 1, First: ago(24 * time.Hour), Last: ago(time.Hour), Explicit: true},
	}}
	tag, ok := find(Derive(ev, now), AxisCreatorAffinity, "user_xiaomei")
	if !ok || tag.Source != SourceMixed || tag.SourceDiversity != 2 || tag.EvidenceCount != 3 {
		t.Fatalf("mixed provenance expected: %+v ok=%v", tag, ok)
	}
}

func TestUnicodeValuesAreFineButPunctuationInjectionIsNot(t *testing.T) {
	for _, ok := range []string{"咖啡", "Hoàn_Kiếm", "city-walk", "21.03,105.85"} {
		if !ValidValue(ok) {
			t.Errorf("%q should be a valid controlled value", ok)
		}
	}
	for _, bad := range []string{"", "a b", "<script>", "x\ny", "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二"} {
		if ValidValue(bad) {
			t.Errorf("%q must be refused", bad)
		}
	}
}

func TestUsageAndChatPatternsNeedEnoughEvidenceAndNeverTouchContent(t *testing.T) {
	ev := Evidence{UserID: "u",
		Usage: UsageEvidence{ScreenMs: map[string]int64{"market": 8 * 60_000, "feed": 2 * 60_000, "me": 60_000}, SessionMs: 5 * 40 * 60_000, Sessions: 12, ActiveDays: 5, First: ago(10 * 24 * time.Hour), Last: ago(time.Hour)},
		Chat:  ChatEvidence{Messages: 80, Conversations: 5, Initiated: 4, Replies: 20, FastReplies: 18, First: ago(10 * 24 * time.Hour), Last: ago(time.Hour)},
	}
	tags := Derive(ev, now)
	for _, want := range []string{"usage/intensity/heavy", "usage/focus/market", "chat/active", "chat/initiator", "chat/fast_reply"} {
		if _, ok := find(tags, AxisPattern, want); !ok {
			t.Errorf("expected pattern %s in %v", want, tags)
		}
	}
	if _, ok := find(tags, AxisPattern, "usage/focus/me"); ok {
		t.Error("a screen under 25% of the dwell is not the focus")
	}
	thin := Evidence{UserID: "u", Usage: UsageEvidence{ScreenMs: map[string]int64{"market": 60_000}, SessionMs: 60_000, ActiveDays: 1, Last: ago(time.Hour)},
		Chat: ChatEvidence{Messages: 5, Conversations: 1, Initiated: 1, Replies: 2, FastReplies: 2, Last: ago(time.Hour)}}
	if got := Derive(thin, now); len(got) != 0 {
		t.Fatalf("thin evidence gives no patterns: %v", got)
	}
	if LabelFor(AxisPattern, "chat/fast_reply") != "回复很快" || LabelFor(AxisPattern, "usage/focus/market") != "常看：市场" {
		t.Errorf("pattern labels come from the dictionary: %q", LabelFor(AxisPattern, "usage/focus/market"))
	}
}
