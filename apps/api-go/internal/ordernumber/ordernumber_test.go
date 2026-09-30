package ordernumber

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestFormatUsesCategoryVietnamDateTimeAndPaddedSequence(t *testing.T) {
	// 2026-09-28 03:00:22 UTC = 越南当天 10:00:22。
	moment := time.Date(2026, 9, 28, 3, 0, 22, 0, time.UTC)
	if got := Format(CategoryCafe, moment, 1); got != "100260928100022000001" {
		t.Fatalf("got %q", got)
	}
	if got := Format(CategoryCafe, moment, 1234567); got != "1002609281000221234567" {
		t.Fatalf("sequence past 999999 must widen, not truncate: got %q", got)
	}
}

func TestDayCutsAtVietnamMidnightNotUTC(t *testing.T) {
	// 2026-09-28 18:30 UTC = 2026-09-29 01:30 in Vietnam.
	if got := Format(CategoryRestaurant, time.Date(2026, 9, 28, 18, 30, 0, 0, time.UTC), 7); got != "101260929013000000007" {
		t.Fatalf("got %q", got)
	}
	// 2026-09-28 16:59 UTC = 23:59 the same Vietnam day.
	if got := Format(CategoryRestaurant, time.Date(2026, 9, 28, 16, 59, 0, 0, time.UTC), 7); got != "101260928235900000007" {
		t.Fatalf("got %q", got)
	}
}

func TestCategoryForVenueType(t *testing.T) {
	cases := map[string]string{
		"CAFE": "100", "RESTAURANT": "101", "PARK": "102",
		"LAKE": "103", "STREET": "104", "OTHER": "109",
		"": "109", "UNKNOWN": "109",
	}
	for venue, want := range cases {
		if got := CategoryForVenueType(venue); got != want {
			t.Fatalf("venue %q: got %q want %q", venue, got, want)
		}
	}
}

// ORDER-NO-001：编号全数字、结构可校验、并发不重号。
func TestValidChecksStructureNotJustDigits(t *testing.T) {
	moment := time.Date(2026, 9, 28, 3, 0, 22, 0, time.UTC)
	for _, category := range []string{CategoryCafe, CategoryService, CategoryDemand, CategoryActivity} {
		if number := Format(category, moment, 1); !Valid(number) {
			t.Fatalf("%q must validate", number)
		}
	}
	for _, bad := range []string{
		"",
		"100260928100022",       // 太短
		"1002609281000220000a1", // 非数字
		"999260928100022000001", // 类别没登记
		"100261399100022000001", // 13 月 99 日
		"100260928256000000001", // 25:60:00
		// 16 位是 main 时代已发出的合法形状，这里不合法是因为**校验位错**
		//（260929000000123 的正确校验位是 8）。见 TestValidAcceptsLegacyAllDigitNumbers。
		"2609290000001236",
	} {
		if Valid(bad) {
			t.Fatalf("%q must not validate", bad)
		}
	}
	if wide := Format(CategoryCafe, moment, 1234567); !Valid(wide) {
		t.Fatalf("a widened sequence must still validate: %q", wide)
	}
}

// ORDER-NO-LEGACY-COMPAT-001：main 时代**已经发出去的号**必须继续通过校验。
// 客服反查（internal/numberlookup 调本函数）和 DB 守卫都靠它；只认 21 位会让
// 历史号在库里写不动、查不到，而干净库跑测试全绿抓不到。
func TestValidAcceptsLegacyAllDigitNumbers(t *testing.T) {
	for _, ok := range []string{
		"2609290000012342",  // 16 位：main 的 Format(1234) 那一批
		"26092910000000004", // 17 位：全局序号超过 9 位后自然加宽的形状
	} {
		if !Valid(ok) {
			t.Fatalf("%q 是 main 时代已发出的号，必须通过校验", ok)
		}
	}
	for _, bad := range []string{
		"260929000001234",  // 15 位：短于任何一套规范
		"2609290000012343", // 校验位错（正确是 2）
		"26092900000123a2", // 非数字
	} {
		if Valid(bad) {
			t.Fatalf("%q 必须不通过", bad)
		}
	}
}

func TestOrderNumberFormatAndUniqueness(t *testing.T) {
	allocator := NewMemory()
	allocator.now = func() time.Time { return time.Date(2026, 9, 28, 3, 0, 22, 0, time.UTC) }
	first, _ := allocator.Next(context.Background(), CategoryService)
	second, _ := allocator.Next(context.Background(), CategoryService)
	other, _ := allocator.Next(context.Background(), CategoryDemand)
	if first != "200260928100022000001" || second != "200260928100022000002" || other != "201260928100022000001" {
		t.Fatalf("counters are per category: %s %s %s", first, second, other)
	}
	if _, err := allocator.Next(context.Background(), "999"); err == nil {
		t.Fatal("an unregistered category must be refused")
	}

	live := NewMemory()
	seen := sync.Map{}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				number, err := live.Next(context.Background(), CategoryService)
				if err != nil || !Valid(number) {
					t.Errorf("bad allocation %q %v", number, err)
					return
				}
				if _, dup := seen.LoadOrStore(number, true); dup {
					t.Errorf("duplicate order number %s", number)
				}
			}
		}()
	}
	wg.Wait()
}
