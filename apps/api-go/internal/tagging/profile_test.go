package tagging

import (
	"testing"
	"time"
)

func tg(axis, value string, strength float64) Tag {
	return Tag{Axis: axis, Value: value, Strength: strength, Confidence: 1, ExpiresAt: now.Add(time.Hour), ComputedAt: now}
}

func TestAffinityIsFinerThanOverlapMoreSharedTagsMeansCloser(t *testing.T) {
	me := []Tag{tg(AxisVenueKind, "咖啡", .8), tg(AxisInterestTopic, "摄影", .7), tg(AxisInterestTopic, "徒步", .6), tg(AxisDistrict, "Hoàn_Kiếm", .8)}
	one := []Tag{tg(AxisVenueKind, "咖啡", .8), tg(AxisInterestTopic, "游泳", .9)}
	many := []Tag{tg(AxisVenueKind, "咖啡", .8), tg(AxisInterestTopic, "摄影", .7), tg(AxisInterestTopic, "徒步", .6), tg(AxisDistrict, "Hoàn_Kiếm", .8)}
	if a1, a2 := Affinity(me, one, now), Affinity(me, many, now); !(a1 > 0 && a2 > a1) || a2 < 0.99 {
		t.Fatalf("sharing one big category must score lower than sharing the whole fine-grained set: one=%v many=%v", a1, a2)
	}
	if Affinity(me, nil, now) != 0 || Affinity(nil, me, now) != 0 {
		t.Fatal("no tags on either side is 0, not a punishment")
	}
	if Affinity(me, []Tag{tg(AxisInterestTopic, "桌游", 1)}, now) != 0 {
		t.Fatal("nothing shared is 0")
	}
}

func TestAversionCancelsInterestInTheVector(t *testing.T) {
	a := []Tag{tg(AxisInterestScene, "SPA", .9), tg(AxisInterestTopic, "摄影", .5)}
	b := []Tag{tg(AxisInterestScene, "SPA", .9), tg(AxisInterestTopic, "摄影", .5)}
	withAversion := append(append([]Tag{}, a...), tg(AxisAversionScene, "SPA", .9))
	if Affinity(withAversion, b, now) >= Affinity(a, b, now) {
		t.Fatal("someone who flicks past SPA must not match someone who loves it as well as a neutral person does")
	}
}

func TestExpiredTagsDoNotCountInTheVector(t *testing.T) {
	dead := tg(AxisInterestTopic, "摄影", 1)
	dead.ExpiresAt = now.Add(-time.Hour)
	if Affinity([]Tag{dead}, []Tag{tg(AxisInterestTopic, "摄影", 1)}, now) != 0 {
		t.Fatal("expired tags are not part of the person any more")
	}
}

func TestProfileGroupsByAxisKeepsTheStrongestAndWritesAFlatSummary(t *testing.T) {
	var tags []Tag
	for i, v := range []string{"摄影", "徒步", "咖啡", "骑行", "瑜伽", "展览", "音乐"} {
		tags = append(tags, tg(AxisInterestTopic, v, 0.9-float64(i)*0.1))
	}
	tags = append(tags, tg(AxisDistrict, "Hoàn_Kiếm", .8), tg(AxisPriceBand, "100K_300K", .7))
	p := BuildProfile("u", tags, 3)
	if p.TagCount != 9 || p.AxisCount != 3 {
		t.Fatalf("counts: %+v", p)
	}
	var topic *Dimension
	for i := range p.Dimensions {
		if p.Dimensions[i].Axis == AxisInterestTopic {
			topic = &p.Dimensions[i]
		}
	}
	if topic == nil || len(topic.Tags) != 3 || topic.Tags[0].Value != "摄影" || topic.Tags[2].Value != "咖啡" {
		t.Fatalf("topic axis should keep the 3 strongest in order: %+v", topic)
	}
	if p.Summary == "" || len(BuildProfile("u", nil, 3).Dimensions) != 0 || BuildProfile("u", nil, 3).Summary != "" {
		t.Fatalf("summary only from existing tags: %q", p.Summary)
	}
}

func TestPriceBandAndTimeSlotAreCoarseOnPurposeAndNeverInvented(t *testing.T) {
	for vnd, want := range map[int64]string{0: "", -5: "", 50_000: "LT_100K", 100_000: "100K_300K", 299_999: "100K_300K", 300_000: "300K_800K", 800_000: "GE_800K"} {
		if got := PriceBandOf(vnd); got != want {
			t.Errorf("PriceBandOf(%d)=%q want %q", vnd, got, want)
		}
	}
	// 周六 20:00 越南时间 = 13:00 UTC
	if got := TimeSlotOf("2026-10-10T13:00:00Z"); got != "WEEKEND_EVENING" {
		t.Errorf("TimeSlotOf = %q", got)
	}
	if TimeSlotOf("周六晚上") != "" || TimeSlotOf("") != "" {
		t.Error("free-text start times are not parsed or invented")
	}
}

func TestSharedTagsAreTheReasonsForAMatchStrongestFirstAndNeverAversions(t *testing.T) {
	me := []Tag{tg(AxisInterestTopic, "摄影", .9), tg(AxisInterestTopic, "徒步", .4), tg(AxisDistrict, "Hoàn_Kiếm", .9), tg(AxisAversionScene, "SPA", .9)}
	her := []Tag{tg(AxisInterestTopic, "摄影", .6), tg(AxisInterestTopic, "徒步", .8), tg(AxisDistrict, "Hoàn_Kiếm", .9), tg(AxisAversionScene, "SPA", .9), tg(AxisInterestTopic, "桌游", 1)}
	got := SharedTags(me, her, now, 10)
	if len(got) != 3 {
		t.Fatalf("摄影, 徒步, 区 are shared; 桌游 is hers alone; the aversion is not a shared reason: %+v", got)
	}
	if got[0].Value != "摄影" || got[0].Strength != .6 {
		t.Fatalf("strongest shared interest first, strength = the weaker of the two: %+v", got[0])
	}
	equal := SharedTags([]Tag{tg(AxisDistrict, "X", .8), tg(AxisInterestTopic, "摄影", .8)}, []Tag{tg(AxisDistrict, "X", .8), tg(AxisInterestTopic, "摄影", .8)}, now, 10)
	if len(equal) != 2 || equal[0].Axis != AxisInterestTopic {
		t.Fatalf("at equal strength a positive interest outranks a neutral axis: %+v", equal)
	}
	if len(SharedTags(me, her, now, 1)) != 1 {
		t.Fatal("limit applies")
	}
}
