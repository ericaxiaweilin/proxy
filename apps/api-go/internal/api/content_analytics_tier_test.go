package api

import "testing"

// CONTENT-ANALYTICS-001：逐人浏览明细（谁、看了几秒、放大几次）只给运营（ANALYTICS scope）；
// 用户侧的聚合战绩不能被误收进运营门，否则小美自己的面板会整块读不出来。
func TestPerPersonViewingDetailIsOperatorOnly(t *testing.T) {
	for _, cmd := range []string{"ListPostAudience", "ListMediaActivityForViewer", "ListInteractionEvents"} {
		if !requiresOperator(cmd) {
			t.Fatalf("%s exposes per-person behaviour and must be operator-only", cmd)
		}
		if scope, ok := RequiredOperatorScope(cmd); !ok || scope != ScopeAnalytics {
			t.Fatalf("%s must require the ANALYTICS scope, got %q %v", cmd, scope, ok)
		}
	}
	for _, cmd := range []string{"ListPostImpressionStats", "ListMediaImpressionStats", "GetContentAnalytics", "RecordMediaZoom"} {
		if requiresOperator(cmd) {
			t.Fatalf("%s is the user-side aggregate / event write and must stay open to the author", cmd)
		}
	}
}
