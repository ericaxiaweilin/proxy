package business

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

// MERCHANT-SIGNAL-SEED-001：SQL seed 里的 confidence 是**字面量**，Go 里的
// SampleConfidence 是**定义**。两处必然会漂移 —— 改了一处、另一处还按旧的算，
// 商家看到的"把握"就和样本量对不上，而且没有任何测试会响。
//
// 这条测试把两处钉在一起：seed 写死的数字必须等于 SampleConfidence(样本量, 10)。
// 要改口径就改 SampleConfidence，然后改 seed 的字面量，两者一起被这条测试看着。
const seedFile = "../../scripts/seed_merchant_operating_signals.sql"

var (
	// demand 那行：(business_id, total, confirmed, highProb, confidence, ...)
	seedDemandConfidence = regexp.MustCompile(
		`'(biz_devseed_[0-9]+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+),\s*now\(\),\s*'SEED_TEST'`)
	// supply 那行：(business_id, store, scene, current, forecast, accepting, confidence, ...)
	seedSupplyConfidence = regexp.MustCompile(
		`'(biz_devseed_[0-9]+)',\s*'(store_devseed_[0-9]+)',\s*'([a-z_0-9]+)',\s*(\d+),\s*(\d+),\s*(true|false),\s*([0-9.]+),\s*now\(\),\s*'SEED_TEST'`)
)

func readSeedSQL(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(seedFile))
	if err != nil {
		t.Fatalf("read seed: %v", err)
	}
	return string(b)
}

func TestSeedDemandConfidenceMatchesSampleConfidence(t *testing.T) {
	// 每一家 SEED_TEST 的 demand 行都要对上公式 —— 只钉第一家的话，
	// 后面加的行改了口径没人知道。
	matches := seedDemandConfidence.FindAllStringSubmatch(readSeedSQL(t), -1)
	if len(matches) == 0 {
		t.Fatal("seed 里找不到 demand 行 —— 商家页会退回 INSUFFICIENT_SIGNAL")
	}
	for _, m := range matches {
		biz := m[1]
		total, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatalf("total_matching_demand 不可解析: %v", err)
		}
		want, err := strconv.ParseFloat(m[5], 64)
		if err != nil {
			t.Fatalf("confidence 不可解析: %v", err)
		}
		if got := SampleConfidence(total, merchantDemandPrivacyThreshold); got != want {
			t.Fatalf("%s demand confidence 漂了：seed 写 %v，SampleConfidence(%d, %d)=%v"+
				" —— 改口径要连字面量一起改（信号包里的 signal_confidence.go）",
				biz, want, total, merchantDemandPrivacyThreshold, got)
		}
		// 光对上公式不够：还得真能过隐私阈值，否则这家店的页还是空的。
		if total < merchantDemandPrivacyThreshold {
			t.Fatalf("total=%d 过不了隐私阈值 %d —— 这家店的经营页还是空的", total, merchantDemandPrivacyThreshold)
		}
	}
}

// 各店供给观测样本（座位数），与 seed 注释里写明的口径一致。
// 加店就加一行 —— 漏了的话下面这条会因为找不到样本而直接失败，不会静默跳过。
var seedSupplySamples = map[string]int{
	"biz_devseed_01": 40,
	"biz_devseed_03": 40,
	"biz_devseed_04": 40,
	"biz_devseed_06": 40,
	"biz_devseed_09": 40,
	"biz_devseed_12": 40,
}

func TestSeedSupplyConfidenceMatchesSampleConfidence(t *testing.T) {
	matches := seedSupplyConfidence.FindAllStringSubmatch(readSeedSQL(t), -1)
	if len(matches) == 0 {
		t.Fatal("seed 里找不到 supply 行 —— 商家页会退回 INSUFFICIENT_SIGNAL")
	}
	for _, m := range matches {
		biz := m[1]
		seats, ok := seedSupplySamples[biz]
		if !ok {
			t.Fatalf("%s 的供给样本量没在 seedSupplySamples 里声明 —— 加店要加一行", biz)
		}
		want, err := strconv.ParseFloat(m[7], 64)
		if err != nil {
			t.Fatalf("confidence 不可解析: %v", err)
		}
		if got := SampleConfidence(seats, merchantDemandPrivacyThreshold); got != want {
			t.Fatalf("%s supply confidence 漂了：seed 写 %v，SampleConfidence(%d, %d)=%v",
				biz, want, seats, merchantDemandPrivacyThreshold, got)
		}
	}
}

// 光有 confidence 不够：resolver 还在 total_matching_demand 上卡隐私阈值。
// 样本量一旦改小到阈值以下，两条 parity 测试照样绿，而商家页又空了 ——
// 所以这条把"种子数据必须真的能解锁结论"钉住。
func TestSeededSignalsUnlockAConclusion(t *testing.T) {
	raw := readSeedSQL(t)
	demands := seedDemandConfidence.FindAllStringSubmatch(raw, -1)
	supplies := seedSupplyConfidence.FindAllStringSubmatch(raw, -1)
	if len(demands) == 0 || len(supplies) == 0 {
		t.Fatal("seed 结构变了，下面这条就测不到东西了")
	}
	byBiz := map[string][]string{}
	for _, sm := range supplies {
		byBiz[sm[1]] = sm
	}
	for _, dm := range demands {
		biz := dm[1]
		sm, ok := byBiz[biz]
		if !ok {
			t.Fatalf("%s 有需求信号没有供给快照 —— 经营页还是空的", biz)
		}
		total, _ := strconv.Atoi(dm[2])
		confirmed, _ := strconv.Atoi(dm[3])
		highProb, _ := strconv.Atoi(dm[4])
		demandConf, _ := strconv.ParseFloat(dm[5], 64)
		current, _ := strconv.Atoi(sm[4])
		forecast, _ := strconv.Atoi(sm[5])
		accepting := sm[6] == "true"
		supplyConf, _ := strconv.ParseFloat(sm[7], 64)

		got := ResolveOperatingState(
			&AggregatedDemandSignal{
				BusinessID:              biz,
				TotalMatchingDemand:     total,
				ConfirmedArrivals:       confirmed,
				HighProbabilityArrivals: highProb,
				Confidence:              demandConf,
			},
			&SceneSupplySnapshot{
				BusinessID:          biz,
				StoreID:             sm[2],
				SceneID:             sm[3],
				CurrentCapacityPct:  current,
				ForecastCapacityPct: forecast,
				AcceptingTraffic:    accepting,
				Confidence:          supplyConf,
			},
		)
		if got.Balance.State == "INSUFFICIENT_SIGNAL" {
			t.Fatalf("%s 种入之后仍然是 INSUFFICIENT_SIGNAL —— 这次改动的目的没达到", biz)
		}
		if got.Forecast.Status != "AVAILABLE" {
			t.Fatalf("%s 种入之后未来需求仍是 %q，页面还是空的", biz, got.Forecast.Status)
		}
		// 每家店的设计状态（seed 文件头那张表）。状态变了 = 口径变了，
		// 要么改 seed，要么改 resolver —— 不能静默漂。
		wantState := map[string]string{
			"biz_devseed_01": "DEMAND_RISING",
			"biz_devseed_03": "BALANCED",
			"biz_devseed_04": "CAPACITY_TIGHT",
			"biz_devseed_06": "SUPPLY_EXCESS",
			"biz_devseed_09": "OVER_CAPACITY_RISK",
			"biz_devseed_12": "DEMAND_RISING",
		}[biz]
		if wantState == "" {
			t.Fatalf("%s 没在期望状态表里 —— 加店要加一行", biz)
		}
		if got.Balance.State != wantState {
			t.Fatalf("%s 期望 %s，实际 %s —— 口径漂了", biz, wantState, got.Balance.State)
		}
	}
}
