package tagging

import (
	"reflect"
	"testing"
)

func TestExtractTopicsFindsFineGrainedTopicsInThreeLanguages(t *testing.T) {
	got := ExtractTopics("周末去西湖徒步，路上喝了杯 Coffee，晚上吃了 phở #摄影")
	want := []string{"咖啡", "美食", "徒步", "摄影"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if got := ExtractTopics("Hôm nay đi chơi cầu lông với bạn"); !reflect.DeepEqual(got, []string{"羽毛球"}) {
		t.Fatalf("vietnamese badminton: %v", got)
	}
	if ExtractTopics("   ") != nil || ExtractTopics("") != nil {
		t.Fatal("empty text has no topics")
	}
}

func TestAsciiKeywordsUseWordBoundariesSoPetDoesNotMatchCarpet(t *testing.T) {
	if got := ExtractTopics("I bought a new carpet"); len(got) != 0 {
		t.Fatalf("carpet is not a pet: %v", got)
	}
	if got := ExtractTopics("walking my pet today"); !reflect.DeepEqual(got, []string{"宠物"}) {
		t.Fatalf("pet as a word: %v", got)
	}
}

// 话题词表刻意不含夜生活 / 按摩 / KTV / 陪酒：平台不给用户贴这类标签（陪同业务的法律边界）。
func TestRiskyServiceCategoriesAreNotTopics(t *testing.T) {
	for _, bad := range []string{"夜生活", "按摩", "KTV", "陪酒", "nightlife", "massage"} {
		if got := ExtractTopics("今晚去" + bad); len(got) != 0 {
			t.Errorf("%q must not become a profile topic, got %v", bad, got)
		}
	}
	for _, topic := range Topics() {
		for _, bad := range []string{"夜生活", "按摩", "KTV", "陪酒"} {
			if topic == bad {
				t.Fatalf("lexicon contains the excluded topic %q", bad)
			}
		}
	}
}

func TestEveryTopicIsAValidControlledValue(t *testing.T) {
	for _, topic := range Topics() {
		if !ValidValue(topic) {
			t.Errorf("topic %q is not a valid tag value", topic)
		}
	}
}

func TestSceneIsInferredFromTheBodyOnlyWhenTheClientDidNotSetOneAndNightlifeNeverProfiles(t *testing.T) {
	if InferScene("新发现一家咖啡店") != "COFFEE" || InferScene("周末去西湖徒步") != "OUTDOOR" || InferScene("拍了好多照片 #摄影") != "PHOTO" {
		t.Fatal("coffee / outdoor / photo posts are recognised from the text")
	}
	if InferScene("今天心情不错") != "" || InferScene("") != "" {
		t.Fatal("a body with no topic stays unknown — never guessed")
	}
	for _, scene := range []string{"NIGHTLIFE", "SPA", "UNKNOWN", ""} {
		if ProfilableScene(scene) {
			t.Errorf("%q must not become an interest/aversion tag", scene)
		}
	}
	for _, scene := range []string{"COFFEE", "OUTDOOR", "PHOTO", "BRUNCH"} {
		if !ProfilableScene(scene) {
			t.Errorf("%q is a normal scene", scene)
		}
	}
	for topic, scene := range topicToScene {
		if !ValidValue(scene) || !ValidValue(topic) {
			t.Errorf("mapping %s→%s has an invalid tag value", topic, scene)
		}
	}
}
