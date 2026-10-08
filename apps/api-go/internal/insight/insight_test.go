package insight

import "testing"

func TestSmallCellsAreSuppressedNotRounded(t *testing.T) {
	for _, n := range []int{0, 1, 4} {
		c := SuppressCell("咖啡", n)
		if !c.Suppressed || c.Users != nil {
			t.Fatalf("%d users must be suppressed with no number at all, got %+v", n, c)
		}
	}
	c := SuppressCell("咖啡", MinCell)
	if c.Suppressed || c.Users == nil || *c.Users != MinCell {
		t.Fatalf("exactly MinCell people may be shown: %+v", c)
	}
}
