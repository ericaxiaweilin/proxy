package ordernumber

import (
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
