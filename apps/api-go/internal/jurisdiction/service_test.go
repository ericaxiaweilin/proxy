package jurisdiction

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestParseJurisdiction(t *testing.T) {
	cases := []struct {
		in     string
		want   Jurisdiction
		errSub string
	}{
		{"VN-79", Jurisdiction{Country: CountryVietnam, Region: RegionHCMCity}, ""},
		{"VN-HN", Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}, ""},
		{"VN-DNG", Jurisdiction{Country: CountryVietnam, Region: RegionDaNang}, ""},
		{"vn-79", Jurisdiction{Country: CountryVietnam, Region: RegionHCMCity}, ""},
		{" KR-11", Jurisdiction{}, "unsupported country"},
		{"VN-XX", Jurisdiction{}, "unknown region"},
		{"VN", Jurisdiction{}, "missing"},
		{"", Jurisdiction{}, "too short"},
		{"  VN-HN  ", Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}, ""},
	}
	for _, c := range cases {
		got, err := ParseJurisdiction(c.in)
		if c.errSub == "" {
			if err != nil {
				t.Fatalf("%q: unexpected error %v", c.in, err)
			}
			if got != c.want {
				t.Fatalf("%q: got %+v, want %+v", c.in, got, c.want)
			}
		} else {
			if err == nil {
				t.Fatalf("%q: expected error", c.in)
			}
			if !contains(err.Error(), c.errSub) {
				t.Fatalf("%q: error %q must contain %q", c.in, err.Error(), c.errSub)
			}
		}
	}
}

func TestResolveFallsBackToDefault(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	row, err := svc.Resolve(context.Background(), "user_alice")
	if err != nil {
		t.Fatal(err)
	}
	if row.Jurisdiction != DefaultJurisdiction {
		t.Fatalf("expected default %v, got %v", DefaultJurisdiction, row.Jurisdiction)
	}
	if row.Source != "DEFAULT" {
		t.Fatalf("expected Source=DEFAULT, got %q", row.Source)
	}
}

func TestSetThenResolve(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	j := Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}
	if err := svc.Set(context.Background(), "user_alice", j, "USER_SELF"); err != nil {
		t.Fatal(err)
	}
	row, err := svc.Resolve(context.Background(), "user_alice")
	if err != nil {
		t.Fatal(err)
	}
	if row.Jurisdiction != j {
		t.Fatalf("expected %v, got %v", j, row.Jurisdiction)
	}
	if row.Source != "USER_SELF" {
		t.Fatalf("expected Source=USER_SELF, got %q", row.Source)
	}
	if row.UpdatedAt.IsZero() {
		t.Fatal("UpdatedAt must be set")
	}
}

func TestSetUpdatesExistingRow(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	// First choice: Hanoi.
	if err := svc.Set(context.Background(), "user_alice",
		Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}, "USER_SELF"); err != nil {
		t.Fatal(err)
	}
	// User moves to HCMC.
	if err := svc.Set(context.Background(), "user_alice",
		Jurisdiction{Country: CountryVietnam, Region: RegionHCMCity}, "USER_SELF"); err != nil {
		t.Fatal(err)
	}
	row, _ := svc.Resolve(context.Background(), "user_alice")
	if row.Jurisdiction.Region != RegionHCMCity {
		t.Fatalf("expected region HCM, got %q", row.Jurisdiction.Region)
	}
}

func TestSetRejectsEmptyUserID(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	if err := svc.Set(context.Background(), "",
		Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}, "USER_SELF"); err == nil {
		t.Fatal("empty userID must error")
	}
}

func TestSetRejectsUnknownRegion(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	if err := svc.Set(context.Background(), "user_alice",
		Jurisdiction{Country: CountryVietnam, Region: "XX"}, "USER_SELF"); err == nil {
		t.Fatal("unknown region must error")
	}
}

func TestResolveRejectsEmptyUserID(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	if _, err := svc.Resolve(context.Background(), ""); err == nil {
		t.Fatal("empty userID must error")
	}
}

func TestSetNowFuncPinsUpdatedAt(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc.SetNowFunc(func() time.Time { return now })
	if err := svc.Set(context.Background(), "user_alice",
		Jurisdiction{Country: CountryVietnam, Region: RegionHanoi}, "USER_SELF"); err != nil {
		t.Fatal(err)
	}
	row, _ := svc.Resolve(context.Background(), "user_alice")
	if !row.UpdatedAt.Equal(now) {
		t.Fatalf("expected UpdatedAt=%v, got %v", now, row.UpdatedAt)
	}
}

func TestSetDefaultOverride(t *testing.T) {
	repo := NewMemoryRepository()
	svc := NewService(repo)
	svc.SetDefault(Jurisdiction{Country: CountryVietnam, Region: RegionHanoi})
	row, err := svc.Resolve(context.Background(), "user_bob")
	if err != nil {
		t.Fatal(err)
	}
	if row.Jurisdiction.Region != RegionHanoi {
		t.Fatalf("expected region HN, got %q", row.Jurisdiction.Region)
	}
}

func TestParseAndStringRoundTrip(t *testing.T) {
	for _, r := range AllowedRegions {
		j := Jurisdiction{Country: CountryVietnam, Region: r}
		s := j.String()
		got, err := ParseJurisdiction(s)
		if err != nil {
			t.Fatalf("round-trip %q: %v", s, err)
		}
		if got != j {
			t.Fatalf("round-trip %q: %+v != %+v", s, got, j)
		}
	}
}

func TestRepositoryNotFoundPath(t *testing.T) {
	repo := NewMemoryRepository()
	_, err := repo.Get(context.Background(), "user_nope")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
