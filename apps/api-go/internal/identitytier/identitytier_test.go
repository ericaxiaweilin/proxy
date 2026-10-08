package identitytier

import "testing"

func TestResolveWalksTheLadderAndStopsAtTheTop(t *testing.T) {
	for _, c := range []struct {
		pts   int
		tier  string
		stars int
	}{{-5, "BRONZE", 1}, {0, "BRONZE", 1}, {99, "BRONZE", 1}, {100, "BRONZE", 2}, {250, "BRONZE", 3}, {500, "SILVER", 1}, {1799, "SILVER", 3}, {1800, "GOLD", 1}, {99999, "GOLD", 3}} {
		l := Resolve(User, c.pts)
		if l.Tier != c.tier || l.Stars != c.stars {
			t.Fatalf("%d -> %s%d, want %s%d", c.pts, l.Tier, l.Stars, c.tier, c.stars)
		}
	}
	if l := Resolve(User, 99999); !l.Highest || l.Next != nil {
		t.Fatal("the top level has no next")
	}
	if l := Resolve(User, 40); l.Next == nil || l.ToNext != 60 {
		t.Fatalf("distance to next: %+v", l)
	}
}

func TestLadderIsStrictlyIncreasingAndOnlyUsersEarnTodayWithoutInventedRules(t *testing.T) {
	l := Ladder(User)
	for i := 1; i < len(l); i++ {
		if l[i].Min <= l[i-1].Min {
			t.Fatalf("ladder must increase: %+v", l)
		}
	}
	if len(EarnRules(User)) == 0 || len(EarnRules(Provider)) != 0 || len(EarnRules(Merchant)) != 0 {
		t.Fatal("provider / merchant earn rules are not decided yet — none are invented")
	}
	if Valid("X") || !Valid(Merchant) {
		t.Fatal("kinds")
	}
}
