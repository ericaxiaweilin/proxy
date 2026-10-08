package matching

import "testing"

// DISPATCH-RANK-002：距离 / 新人 / 负载三项。

func f(v float64) *float64 { return &v }

func TestCloserProviderWinsWhenRecordsAreEqual(t *testing.T) {
	base := Signals{Completed: 12, OnTime: 12, Rated: 6, SatisfactionSum: 6, WouldReuse: 5}
	near, far := base, base
	near.Lat, near.Lng = f(21.0285), f(105.8542) // 还剑湖
	far.Lat, far.Lng = f(21.1861), f(106.0763)   // 北宁，约 28km
	signals := WithDistances(map[string]Signals{"near": near, "far": far}, []string{"near", "far"}, f(21.0300), f(105.8500))
	ranked := Rank([]string{"far", "near"}, nil, signals, 0)
	if ranked[0].AgentID != "near" {
		t.Fatalf("with equal records the closer one goes first: %+v", ranked)
	}
	if ranked[0].Breakdown.DistanceKm == nil || *ranked[0].Breakdown.DistanceKm > 1 {
		t.Fatalf("the distance shown is in km and real: %+v", ranked[0].Breakdown)
	}
	if ranked[1].Breakdown.Distance <= 0 || ranked[1].Breakdown.Distance >= ranked[0].Breakdown.Distance {
		t.Fatalf("inside the radius, distance points fall off with km: near=%v far=%v", ranked[0].Breakdown.Distance, ranked[1].Breakdown.Distance)
	}
}

func TestATaskWithoutCoordinatesRanksExactlyAsBefore(t *testing.T) {
	signals := map[string]Signals{
		"a": {Completed: 12, OnTime: 11, Rated: 8, SatisfactionSum: 7.5, WouldReuse: 6, Lat: f(21.0), Lng: f(105.8)},
		"b": {Completed: 20, OnTime: 20, Rated: 10, SatisfactionSum: 9, WouldReuse: 8},
	}
	same := WithDistances(signals, []string{"a", "b"}, nil, nil)
	for id, s := range same {
		if s.DistanceM != nil {
			t.Fatalf("no task coordinates ⇒ no distance for %s", id)
		}
		if b := Score(s, 0, 0); b.Distance != 0 || b.DistanceKm != nil {
			t.Fatalf("no distance must mean 0 distance points, not a guess: %+v", b)
		}
	}
}

func TestOutsideTheRadiusEarnsNoDistancePoints(t *testing.T) {
	b := Score(Signals{Completed: 20, DistanceM: f(45_000)}, 0, 0)
	if b.Distance != 0 || b.DistanceKm == nil || *b.DistanceKm != 45 {
		t.Fatalf("45km is outside the default 30km radius: %+v", b)
	}
}

func TestNewcomerBoostCoversTheFirstTenOrdersAndFades(t *testing.T) {
	zero := Score(Signals{}, 0, 0).NewcomerBoost
	five := Score(Signals{Completed: 5, OnTime: 5}, 0, 0).NewcomerBoost
	ten := Score(Signals{Completed: 10, OnTime: 10}, 0, 0).NewcomerBoost
	if !(zero == 8 && five == 4 && ten == 0) {
		t.Fatalf("newcomer boost: 0 orders=8, 5 orders=4, 10 orders=0; got %v %v %v", zero, five, ten)
	}
}

func TestBusyProvidersAreSpreadOutAndThePenaltyIsCapped(t *testing.T) {
	base := Signals{Completed: 30, OnTime: 30, Rated: 20, SatisfactionSum: 20, WouldReuse: 20}
	busy, free := base, base
	busy.ActiveLoad = 2
	ranked := Rank([]string{"busy", "free"}, nil, map[string]Signals{"busy": busy, "free": free}, 0)
	if ranked[0].AgentID != "free" || ranked[1].Breakdown.LoadPenalty != 12 {
		t.Fatalf("two open jobs cost 12 points and the free one goes first: %+v", ranked)
	}
	swamped := base
	swamped.ActiveLoad = 50
	if p := Score(swamped, 0, 0).LoadPenalty; p != 18 {
		t.Fatalf("load penalty is capped at 18, got %v", p)
	}
}

func TestNewDefaultsArePinned(t *testing.T) {
	d := DefaultTunables()
	if d.DistanceWeight != 40 || d.RadiusKm != 30 || d.NewcomerBoost != 8 || d.NewcomerOrders != 10 || d.LoadPenaltyPerJob != 6 || d.LoadPenaltyCap != 18 {
		t.Fatalf("DISPATCH-RANK-002 defaults moved: %+v", d)
	}
	if _, err := d.With(map[string]float64{"radiusKm": 0}); err == nil {
		t.Fatal("a zero radius would divide by zero; the lower bound must reject it")
	}
}
