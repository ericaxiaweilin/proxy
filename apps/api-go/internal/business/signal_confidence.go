package business

// MERCHANT-SIGNAL-SEED-001（2026-10-01，用户「经营脉搏 未来需求…都是空的」）
//
// resolver 要求 demand.Confidence > 0 且 supply.Confidence > 0 才肯给任何结论，
// 所以 confidence 不能随手写个 0.9 —— 那个数字会被商家当成"我有多少把握"，
// 而它其实跟证据量无关。这里把它定义成**只由样本量决定**，样本少就低。
//
// 口径是 n/(n+k)：k 取隐私阈值（10）。这是标准的收缩比例，不含魔法常数 ——
//   · n 刚好等于阈值 10 → 0.5（一半把握，正是"刚好够发"的诚实表达）
//   · n = 30        → 0.75
//   · n = 90        → 0.9
//   · n → ∞        → 1（但不会到 1，因为 CHECK 也不允许）
// 样本不足阈值一律返回 0：低于隐私线本来就不该发出去（MERCHANT-DEMAND-PRIVACY），
// 返回 0 让调用方走"信号不足"，而不是发一个勉强的低置信度出去。
func SampleConfidence(sampleSize, threshold int) float64 {
	if threshold <= 0 || sampleSize < threshold {
		return 0
	}
	return float64(sampleSize) / float64(sampleSize+threshold)
}
