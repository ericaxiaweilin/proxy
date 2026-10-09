package treasure

import (
	"testing"
	"time"
)

func TestPresenceNeedsAGoodFixAndBeingAtTheStore(t *testing.T) {
	const lat, lng = 21.0285, 105.8542
	near := Location{Lat: lat + 0.0003, Lng: lng, AccuracyM: 20} // ≈33m
	if d, err := CheckPresence(near, lat, lng); err != nil || d < 20 || d > 50 {
		t.Fatalf("33m away with a good fix opens: %d %v", d, err)
	}
	if _, err := CheckPresence(Location{Lat: lat + 0.003, Lng: lng, AccuracyM: 20}, lat, lng); err != ErrTooFar {
		t.Fatalf("330m is too far: %v", err)
	}
	if _, err := CheckPresence(Location{Lat: lat, Lng: lng, AccuracyM: 400}, lat, lng); err != ErrAccuracy {
		t.Fatalf("a 400m-accuracy fix proves nothing: %v", err)
	}
	if _, err := CheckPresence(Location{Lat: 0, Lng: 0, AccuracyM: 5}, lat, lng); err != ErrBadLocation {
		t.Fatalf("null island is not a location: %v", err)
	}
}

func TestSpeedAcrossTwoStoresMustLookHuman(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	prev := &Prev{Lat: 21.0285, Lng: 105.8542, At: now.Add(-10 * time.Minute)}
	if !SpeedPlausible(prev, 21.0285, 105.8542, now) {
		t.Fatal("the same store is always plausible")
	}
	if !SpeedPlausible(prev, 21.0385, 105.8542, now) { // ≈1.1km in 10 min = 6.7 km/h
		t.Fatal("a walk is plausible")
	}
	if SpeedPlausible(prev, 10.7769, 106.7009, now) { // Hanoi → HCMC in 10 minutes
		t.Fatal("teleporting between cities is not")
	}
	if !SpeedPlausible(nil, 10.7769, 106.7009, now) {
		t.Fatal("the first open has nothing to compare with")
	}
}

func TestCompanionWindowAndLocalDay(t *testing.T) {
	start := time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC)
	for off, want := range map[time.Duration]bool{-3 * time.Hour: false, -2 * time.Hour: true, 0: true, 5*time.Hour + 59*time.Minute: true, 6 * time.Hour: false} {
		if CompanionWindowOpen(start, start.Add(off)) != want {
			t.Fatalf("offset %v want %v", off, want)
		}
	}
	// 越南当地 00:30（UTC 前一天 17:30）属于当地新的一天。
	n := time.Date(2026, 10, 8, 17, 30, 0, 0, time.UTC)
	if got := LocalDayStart(n); !got.Equal(time.Date(2026, 10, 8, 17, 0, 0, 0, time.UTC)) {
		t.Fatalf("local day starts at 00:00 ICT: %v", got)
	}
}
