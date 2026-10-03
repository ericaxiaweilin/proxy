package business

import "testing"

func TestSampleConfidenceIsDrivenBySampleSizeOnly(t *testing.T) {
	// 刚好够发：一半把握。不是 0.9，也不是 1。
	if got := SampleConfidence(10, 10); got != 0.5 {
		t.Fatalf("threshold-sized sample should be 0.5, got %v", got)
	}
	if got := SampleConfidence(30, 10); got != 0.75 {
		t.Fatalf("30/10 should be 0.75, got %v", got)
	}
	if got := SampleConfidence(90, 10); got != 0.9 {
		t.Fatalf("90/10 should be 0.9, got %v", got)
	}
}

func TestSampleConfidenceGrowsMonotonicallyAndStaysBelowOne(t *testing.T) {
	prev := 0.0
	for n := 10; n <= 400; n += 10 {
		got := SampleConfidence(n, 10)
		if got <= prev {
			t.Fatalf("confidence must grow with sample size: n=%d got %v after %v", n, got, prev)
		}
		if got >= 1 || got <= 0 {
			t.Fatalf("confidence must stay in (0,1): n=%d got %v", n, got)
		}
		prev = got
	}
}

func TestSampleConfidenceBelowPrivacyThresholdIsWithheld(t *testing.T) {
	// 低于隐私线：如实不发布。返回 0 而不是给一个勉强的低分 ——
	// 硬凑一个 0.05 会让"信号不足"读起来像"有一点信号"。
	for _, n := range []int{0, 1, 5, 9} {
		if got := SampleConfidence(n, 10); got != 0 {
			t.Fatalf("n=%d is below the privacy threshold, must be withheld, got %v", n, got)
		}
	}
}

func TestSampleConfidenceDoesNotDivideByZeroOnBadThreshold(t *testing.T) {
	// 阈值配错（0 或负数）不能让整个商家页 500。
	for _, k := range []int{0, -1} {
		if got := SampleConfidence(50, k); got != 0 {
			t.Fatalf("threshold=%d must withhold rather than panic, got %v", k, got)
		}
	}
}
