package identitytier

import "testing"

func TestResolveWalksTheLadderAndStopsAtTheTop(t *testing.T) {
	for _, c := range []struct {
		pts   int
		tier  string
		stars int
	}{{-5, "BRONZE", 1}, {0, "BRONZE", 1}, {149, "BRONZE", 1}, {150, "BRONZE", 2}, {300, "BRONZE", 3}, {500, "SILVER", 1}, {999, "SILVER", 3}, {1000, "GOLD", 1}, {2000, "PLATINUM", 1}, {99999, "PLATINUM", 3}} {
		l := Resolve(User, c.pts)
		if l.Tier != c.tier || l.Stars != c.stars {
			t.Fatalf("%d -> %s%d, want %s%d", c.pts, l.Tier, l.Stars, c.tier, c.stars)
		}
	}
	if l := Resolve(User, 99999); !l.Highest || l.Next != nil {
		t.Fatal("the top level has no next")
	}
	if l := Resolve(User, 40); l.Next == nil || l.ToNext != 110 {
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
	if len(EarnRules(User)) == 0 || len(EarnRules(Provider)) != 3 || len(EarnRules(Merchant)) != 1 {
		t.Fatal("providers earn from orders served / satisfaction / repeat clients; merchants one point per hosted order")
	}
	if Valid("X") || !Valid(Merchant) {
		t.Fatal("kinds")
	}
}

func TestMerchantLadderIsFiveStarsWithExponentialDifficulty(t *testing.T) {
	l := Ladder(Merchant)
	if len(l) != 5 {
		t.Fatalf("1-5 stars: %d", len(l))
	}
	for i := 2; i < len(l); i++ {
		if (l[i].Min - l[i-1].Min) < (l[i-1].Min - l[i-2].Min) {
			t.Fatalf("each star must be harder than the last: %+v", l)
		}
	}
	if r := Resolve(Merchant, 599); r.Stars != 3 || r.Tier != "STAR" {
		t.Fatalf("599 = 3 stars: %+v", r)
	}
	if r := Resolve(Merchant, 5000); r.Stars != 5 || !r.Highest {
		t.Fatalf("top star: %+v", r)
	}
	if Resolve(User, 5000).Tier != "PLATINUM" {
		t.Fatal("users keep the bronze..platinum ladder")
	}
}

// 按数据推算：每月接待 100 单 = 每月 100 分 → 3 个月 3 星，12 个月 5 星。
func TestMerchantLadderMatchesTheCalibration(t *testing.T) {
	const perMonth = 100
	at := func(months int) int { return Resolve(Merchant, perMonth*months).Stars }
	if at(1) != 1 || at(3) != 3 || at(6) != 4 || at(12) != 5 || at(11) != 4 {
		t.Fatalf("1m=%d 3m=%d 6m=%d 11m=%d 12m=%d", at(1), at(3), at(6), at(11), at(12))
	}
}
