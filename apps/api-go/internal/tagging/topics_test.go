package tagging

import "testing"

func values(hits []TopicHit) map[string]float64 {
	m := map[string]float64{}
	for _, h := range hits {
		m[h.Value] = h.Factor
	}
	return m
}

func TestTopicHitsComeFromTheTaxonomyWithAncestorRollup(t *testing.T) {
	got := values(TopicHits("今天在 Highlands 喝了杯拿铁，还拍了几张照片"))
	if got["drink/coffee/latte"] != 1 || got["drink/coffee"] != 0.5 {
		t.Fatalf("a latte post hits the leaf and rolls up to its parent: %v", got)
	}
	if TopicHits("   ") != nil && len(TopicHits("   ")) != 0 {
		t.Fatal("blank text has no topics")
	}
	if len(TopicHits("I bought a new carpet")) != 0 {
		t.Fatal("ascii keywords match on word boundaries (pet must not hit carpet)")
	}
}

// 分类库不含夜生活 / 按摩 / KTV / 陪酒：平台不给用户贴这类标签（陪同业务的法律边界）。
func TestRiskyServiceCategoriesAreNotTopics(t *testing.T) {
	for _, bad := range []string{"夜生活", "按摩", "KTV", "陪酒", "nightlife", "massage"} {
		if got := TopicHits("今晚去" + bad); len(got) != 0 {
			t.Errorf("%q must not become a profile topic, got %v", bad, got)
		}
	}
}

func TestEveryTaxonomyTopicIsAValidControlledValue(t *testing.T) {
	tx, err := DefaultTaxonomy()
	if err != nil {
		t.Fatal(err)
	}
	for id := range tx.nodes {
		if id == "interest" || len(id) < 9 || id[:9] != "interest/" {
			continue
		}
		if !ValidValue(id[9:]) {
			t.Errorf("%q is not a valid tag value", id)
		}
	}
}
