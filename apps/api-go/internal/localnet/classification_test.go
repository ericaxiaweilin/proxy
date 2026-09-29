package localnet

import "testing"

// ACTIVITY-REF-001：帖文里的活动引用（contextType ACTIVITY + contextId activityId
// + relationType REFERS_TO）必须原样活过建帖与重分类。
//
// 为什么这条值得钉：mergeClassificationRefs 是**唯一**会改写客户端 refs 的地方
// （见本文件下方那段 `ref.RelationType == "AUTO_CLASSIFIED"` 的过滤）。标记值一旦
// 取成 AUTO_CLASSIFIED，用户发出的活动引用会被静默抹掉 —— 客户端以为发成功了，
// 动态里那条引用凭空消失，而且不会有任何报错。
//
// 客户端侧的判定是白名单（只有明确带 REFERS_TO 才算实体引用），所以这里的
// 契约是：**非 AUTO_CLASSIFIED 的客户端 ref 一律原样保留**。
func TestMergeClassificationRefsKeepsActivityEntityRef(t *testing.T) {
	entityRef := ContextRef{ContextType: "ACTIVITY", ContextID: "act_westlake", RelationType: "REFERS_TO"}
	// 分类器重算时产出的标签：同一个 contextType，但 contextId 是人话。
	generated := []ContextRef{{ContextType: "ACTIVITY", ContextID: "活动"}}

	merged := mergeClassificationRefs([]ContextRef{entityRef}, generated)

	keptEntity := false
	keptLabel := false
	for _, ref := range merged {
		if ref == entityRef {
			keptEntity = true
		}
		if ref.ContextType == "ACTIVITY" && ref.ContextID == "活动" && ref.RelationType == "AUTO_CLASSIFIED" {
			keptLabel = true
		}
	}
	if !keptEntity {
		t.Fatalf("activity entity ref was dropped by reclassification: %+v", merged)
	}
	// 标签也要在：实体引用和分类标签是两件事，不该互相顶掉 —— 客户端 chip 行
	// 画的是标签，活动卡片画的是引用，两边同时存在才是对的。
	if !keptLabel {
		t.Fatalf("classification label missing after merge: %+v", merged)
	}
}

// 反向：上一轮的 AUTO_CLASSIFIED 标签必须被丢掉重算。别为了放行活动引用，
// 把这个既有契约一起放过去 —— 那样正文改了、旧标签却留着，筛选会按老词命中。
func TestMergeClassificationRefsDropsStaleClassificationLabels(t *testing.T) {
	stale := ContextRef{ContextType: "ACTIVITY", ContextID: "活动", RelationType: "AUTO_CLASSIFIED"}
	merged := mergeClassificationRefs([]ContextRef{stale}, nil)
	for _, ref := range merged {
		if ref.RelationType == "AUTO_CLASSIFIED" {
			t.Fatalf("stale classification label survived reclassification: %+v", merged)
		}
	}
}
