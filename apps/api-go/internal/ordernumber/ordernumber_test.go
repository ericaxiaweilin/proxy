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
		"2609290000001236",      // 旧的 16 位（云端早期草案格式）
	} {
		if Valid(bad) {
			t.Fatalf("%q must not validate", bad)
		}
	}
	if wide := Format(CategoryCafe, moment, 1234567); !Valid(wide) {
		t.Fatalf("a widened sequence must still validate: %q", wide)
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
