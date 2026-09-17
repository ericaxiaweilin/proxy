package realityscene

import (
	"reflect"
	"testing"
)

func TestEvaluateSceneBadgesFirstCheckin(t *testing.T) {
	got := EvaluateSceneBadges([]string{"hoankiem"}, nil)
	want := []string{"first_checkin", "landmark"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("first checkin at hoankiem: got %v want %v", got, want)
	}
	if len(EvaluateSceneBadges(nil, nil)) != 0 {
		t.Fatal("no check-in must earn nothing")
	}
}

func TestEvaluateSceneBadgesSetsAndXiaomei(t *testing.T) {
	// 湖边三连
	two := EvaluateSceneBadges([]string{"hoankiem", "trucbach"}, nil)
	if contains(two, "lake_trio") {
		t.Fatalf("two lakes must not earn lake_trio: %v", two)
	}
	all := EvaluateSceneBadges([]string{"hoankiem", "trucbach", "tranquoc"}, nil)
	if !contains(all, "lake_trio") {
		t.Fatalf("three lakes must earn lake_trio: %v", all)
	}
	// 小美同框（trucbach 是 ai_002 绑定场景）
	xm := EvaluateSceneBadges([]string{"trucbach"}, nil)
	if !contains(xm, "xiaomei_company") {
		t.Fatalf("persona-bound scene must earn xiaomei_company: %v", xm)
	}
	unbound := EvaluateSceneBadges([]string{"nguyenphilan"}, nil)
	if contains(unbound, "xiaomei_company") {
		t.Fatalf("unbound scene must not earn xiaomei_company: %v", unbound)
	}
	// 咖啡猎手
	both := EvaluateSceneBadges([]string{"threebeans", "threebeans_bn"}, nil)
	if !contains(both, "coffee_hunter") {
		t.Fatalf("both coffee scenes must earn coffee_hunter: %v", both)
	}
	// 足迹不算打卡；10 个**不同**场景的足迹才得足迹地图
	foot := make([]string, 10)
	for i := range foot {
		foot[i] = "scene_" + string(rune('a'+i))
	}
	fp := EvaluateSceneBadges(nil, foot)
	if !reflect.DeepEqual(fp, []string{"footprint_10"}) {
		t.Fatalf("ten footprints only: got %v", fp)
	}
	// 去重
	dup := EvaluateSceneBadges([]string{"hoankiem", "hoankiem", "hoankiem"}, nil)
	if len(dup) != 2 {
		t.Fatalf("duplicates must not inflate: %v", dup)
	}
}

func TestNewlyEarnedBadges(t *testing.T) {
	got := NewlyEarnedBadges([]string{"first_checkin", "checkin_3", "lake_trio"}, []string{"checkin_3"})
	want := []string{"first_checkin", "lake_trio"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("delta: got %v want %v", got, want)
	}
	if len(NewlyEarnedBadges([]string{"a", "b"}, []string{"a", "b"})) != 0 {
		t.Fatal("no delta expected")
	}
}

func contains(ids []string, id string) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

func TestAIVisitsForBoundScene(t *testing.T) {
	// threebeans 绑定晴晴（ai_001）；nguyenphilan 无绑定。
	visits := aiVisitsFor("threebeans")
	if len(visits) == 0 {
		t.Fatal("threebeans must have a bound Xiaomei")
	}
	found := false
	for _, v := range visits {
		if v.PersonaID == "ai_001" && v.DisplayName != "" && v.BoundScene == "threebeans" {
			found = true
		}
	}
	if !found {
		t.Fatalf("ai_001 missing from threebeans visits: %+v", visits)
	}
	if len(aiVisitsFor("nguyenphilan")) != 0 {
		t.Fatal("unbound scene must have no AI visits")
	}
}
