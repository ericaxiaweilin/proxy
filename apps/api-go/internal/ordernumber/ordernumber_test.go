package ordernumber

import (
	"context"
	"sync"
	"testing"
	"time"
)

// ORDER-NO-001：订单编号全数字、带校验位、日期段按越南时间、并发不重号。
func TestOrderNumberFormatAndUniqueness(t *testing.T) {
	// 2026-09-28 23:30 UTC 在越南已经是 09-29。
	number := Format(1234, time.Date(2026, 9, 28, 23, 30, 0, 0, time.UTC))
	if len(number) != 16 || number[:15] != "260929000001234" {
		t.Fatalf("unexpected number %q", number)
	}
	if !Valid(number) {
		t.Fatalf("%q must validate", number)
	}
	for i := 0; i < len(number); i++ {
		mutated := []byte(number)
		mutated[i] = '0' + (mutated[i]-'0'+1)%10
		if Valid(string(mutated)) {
			t.Fatalf("a single mistyped digit at %d must fail validation: %s", i, mutated)
		}
	}
	for _, bad := range []string{"", "26092900000123", "ord_1234567890123", "2609290000012a47"} {
		if Valid(bad) {
			t.Fatalf("%q must not validate", bad)
		}
	}
	if wide := Format(1_000_000_000, time.Now()); len(wide) != 17 || !Valid(wide) {
		t.Fatalf("sequences beyond 9 digits must widen, not wrap: %q", wide)
	}

	allocator := NewMemory()
	seen := sync.Map{}
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				n, err := allocator.Next(context.Background())
				if err != nil || !Valid(n) {
					t.Errorf("bad allocation %q %v", n, err)
					return
				}
				if _, dup := seen.LoadOrStore(n, true); dup {
					t.Errorf("duplicate order number %s", n)
				}
			}
		}()
	}
	wg.Wait()
}
