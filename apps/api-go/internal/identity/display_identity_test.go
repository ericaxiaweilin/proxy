package identity

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/clock"
)

// fakeClock is a minimal clock.Clock for tests. clock.Clock is an
// interface — see apps/api-go/internal/clock.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock(t time.Time) *fakeClock { return &fakeClock{now: t} }
func (f *fakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}
func (f *fakeClock) advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now = f.now.Add(d)
}

// runWith is a small helper to start a subtest with a context.
func runWith(t *testing.T, fn func(context.Context)) {
	t.Helper()
	ctx := context.Background()
	fn(ctx)
}

func TestValidateAlias_RejectsEmptyAndReserved(t *testing.T) {
	cases := []struct {
		alias string
		want  error
	}{
		{"", ErrDisplayIdentityAliasInvalid},
		{"   ", ErrDisplayIdentityAliasInvalid},
		{"real", ErrDisplayIdentityAliasInvalid},
		{"Real", ErrDisplayIdentityAliasInvalid}, // case-insensitive reserved check
		{"default", ErrDisplayIdentityAliasInvalid},
		{"self", ErrDisplayIdentityAliasInvalid},
		{"me", ErrDisplayIdentityAliasInvalid},
		{"work", nil},
		{" 工作号 ", nil}, // leading/trailing spaces are trimmed, not rejected
		{string(make([]byte, 33)), ErrDisplayIdentityAliasInvalid}, // 33 chars
	}
	for _, c := range cases {
		got := ValidateAlias(c.alias)
		if !errors.Is(got, c.want) {
			t.Errorf("ValidateAlias(%q) = %v, want %v", c.alias, got, c.want)
		}
	}
}

func TestDisplayIdentityService_Create_HappyPath(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		d, err := svc.Create(ctx, CreateInput{
			OwnerID:     "user_alice",
			Type:        DisplayIdentityPublic,
			Alias:       "工作号",
			DisplayName: "Linh",
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if d.ID == "" || d.OwnerID != "user_alice" {
			t.Errorf("unexpected identity: %+v", d)
		}
		if d.Type != DisplayIdentityPublic {
			t.Errorf("type = %q, want PUBLIC", d.Type)
		}
		if d.ExpiresAt != nil {
			t.Errorf("PUBLIC identity must not have ExpiresAt, got %v", d.ExpiresAt)
		}
	})
}

func TestDisplayIdentityService_Create_BurnerSetsExpiresAt(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		d, err := svc.Create(ctx, CreateInput{
			OwnerID:     "user_alice",
			Type:        DisplayIdentityBurner,
			Alias:       "backup",
			DisplayName: "Mai",
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if d.ExpiresAt == nil {
			t.Fatalf("BURNER must have ExpiresAt set")
		}
		want := clk.Now().Add(BurnerDefaultLifetime)
		if !d.ExpiresAt.Equal(want) {
			t.Errorf("ExpiresAt = %v, want %v", d.ExpiresAt, want)
		}
	})
}

func TestDisplayIdentityService_Create_RejectsEmptyOwnerID(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		_, err := svc.Create(ctx, CreateInput{OwnerID: "", Alias: "x", DisplayName: "y", Type: DisplayIdentityPublic})
		if !errors.Is(err, ErrDisplayIdentityForbidden) {
			t.Errorf("err = %v, want ErrDisplayIdentityForbidden", err)
		}
	})
}

func TestDisplayIdentityService_Create_RejectsInvalidType(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		_, err := svc.Create(ctx, CreateInput{
			OwnerID: "u", Alias: "x", DisplayName: "y", Type: DisplayIdentityType("GHOST"),
		})
		if !errors.Is(err, ErrDisplayIdentityAliasInvalid) {
			t.Errorf("err = %v, want ErrDisplayIdentityAliasInvalid", err)
		}
	})
}

func TestDisplayIdentityService_Create_CapReached(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		for i := 0; i < MaxDisplayIdentitiesPerUser; i++ {
			_, err := svc.Create(ctx, CreateInput{
				OwnerID:     "user_eve",
				Type:        DisplayIdentityPublic,
				Alias:       "alias-" + string(rune('a'+i)),
				DisplayName: "Name",
			})
			if err != nil {
				t.Fatalf("Create #%d: %v", i, err)
			}
		}
		_, err := svc.Create(ctx, CreateInput{
			OwnerID:     "user_eve",
			Type:        DisplayIdentityPublic,
			Alias:       "one-more",
			DisplayName: "Name",
		})
		if !errors.Is(err, ErrDisplayIdentityCapReached) {
			t.Errorf("err = %v, want ErrDisplayIdentityCapReached", err)
		}
	})
}

func TestDisplayIdentityService_Create_RejectsDuplicateAlias(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		_, err := svc.Create(ctx, CreateInput{OwnerID: "u1", Alias: "work", DisplayName: "A", Type: DisplayIdentityPublic})
		if err != nil {
			t.Fatalf("first Create: %v", err)
		}
		_, err = svc.Create(ctx, CreateInput{OwnerID: "u1", Alias: "work", DisplayName: "B", Type: DisplayIdentityPublic})
		if !errors.Is(err, ErrDisplayIdentityConflict) {
			t.Errorf("err = %v, want ErrDisplayIdentityConflict", err)
		}
		// Same alias, different owner — should be fine
		_, err = svc.Create(ctx, CreateInput{OwnerID: "u2", Alias: "work", DisplayName: "B", Type: DisplayIdentityPublic})
		if err != nil {
			t.Errorf("different owner, same alias: err = %v, want nil", err)
		}
	})
}

func TestDisplayIdentity_IsActive(t *testing.T) {
	now := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	burned := now.Add(-time.Hour)
	expired := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	cases := []struct {
		name string
		d    DisplayIdentity
		want bool
	}{
		{"public no expires", DisplayIdentity{}, true},
		{"burned", DisplayIdentity{BurnedAt: &burned}, false},
		{"expired", DisplayIdentity{ExpiresAt: &expired}, false},
		{"future", DisplayIdentity{ExpiresAt: &future}, true},
		{"burned and future", DisplayIdentity{BurnedAt: &burned, ExpiresAt: &future}, false},
	}
	for _, c := range cases {
		got := c.d.IsActive(now)
		if got != c.want {
			t.Errorf("%s: IsActive = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDisplayIdentity_VisibilityFor(t *testing.T) {
	public := DisplayIdentity{Type: DisplayIdentityPublic}
	private := DisplayIdentity{Type: DisplayIdentityPrivate}
	burner := DisplayIdentity{Type: DisplayIdentityBurner}

	cases := []struct {
		d     DisplayIdentity
		v     ViewerKind
		want  bool
	}{
		{public, ViewerKindSelf, true},
		{public, ViewerKindStranger, true},
		{private, ViewerKindSelf, true},
		{private, ViewerKindKnownContact, true},
		{private, ViewerKindStranger, false},
		{burner, ViewerKindSelf, true},
		{burner, ViewerKindStranger, true},
	}
	for i, c := range cases {
		got := c.d.VisibilityFor(c.v)
		if got != c.want {
			t.Errorf("case %d: %+v.VisibilityFor(%q) = %v, want %v", i, c.d, c.v, got, c.want)
		}
	}
}

func TestDisplayIdentityService_Burn(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		d, err := svc.Create(ctx, CreateInput{
			OwnerID: "user_x", Type: DisplayIdentityPublic, Alias: "a", DisplayName: "X",
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		// wrong owner
		_, err = svc.Burn(ctx, BurnInput{IdentityID: d.ID, OwnerID: "user_y"})
		if !errors.Is(err, ErrDisplayIdentityForbidden) {
			t.Errorf("wrong owner: err = %v, want ErrDisplayIdentityForbidden", err)
		}
		// correct owner
		burned, err := svc.Burn(ctx, BurnInput{IdentityID: d.ID, OwnerID: "user_x"})
		if err != nil {
			t.Fatalf("Burn: %v", err)
		}
		if burned.BurnedAt == nil {
			t.Errorf("BurnedAt not set")
		}
		// burn again
		_, err = svc.Burn(ctx, BurnInput{IdentityID: d.ID, OwnerID: "user_x"})
		if !errors.Is(err, ErrDisplayIdentityBurned) {
			t.Errorf("double-burn: err = %v, want ErrDisplayIdentityBurned", err)
		}
	})
}

func TestDisplayIdentityService_SweepExpiredBurners(t *testing.T) {
	start := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	clk := newFakeClock(start)
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		d1, err := svc.Create(ctx, CreateInput{OwnerID: "u1", Type: DisplayIdentityBurner, Alias: "soon", DisplayName: "S"})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		d2, err := svc.Create(ctx, CreateInput{OwnerID: "u1", Type: DisplayIdentityPublic, Alias: "perm", DisplayName: "P"})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		_ = d1
		_ = d2
		// Sweep before expiry — should be no-op
		burned, err := svc.SweepExpiredBurners(ctx, []string{"u1"})
		if err != nil {
			t.Fatalf("Sweep #1: %v", err)
		}
		if len(burned) != 0 {
			t.Errorf("Sweep #1 burned %d, want 0", len(burned))
		}
		// Advance past BurnerDefaultLifetime
		clk.advance(BurnerDefaultLifetime + time.Minute)
		burned, err = svc.SweepExpiredBurners(ctx, []string{"u1"})
		if err != nil {
			t.Fatalf("Sweep #2: %v", err)
		}
		if len(burned) != 1 {
			t.Errorf("Sweep #2 burned %d, want 1 (only the BURNER)", len(burned))
		}
	})
}

func TestDisplayIdentityService_ListForSwitch_OrdersBurnerFirst(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		// create order: public first, then private, then burner
		_, err := svc.Create(ctx, CreateInput{OwnerID: "u", Type: DisplayIdentityPublic, Alias: "work", DisplayName: "W"})
		if err != nil {
			t.Fatal(err)
		}
		clk.advance(time.Hour)
		_, err = svc.Create(ctx, CreateInput{OwnerID: "u", Type: DisplayIdentityPrivate, Alias: "home", DisplayName: "H"})
		if err != nil {
			t.Fatal(err)
		}
		clk.advance(time.Hour)
		_, err = svc.Create(ctx, CreateInput{OwnerID: "u", Type: DisplayIdentityBurner, Alias: "burn", DisplayName: "B"})
		if err != nil {
			t.Fatal(err)
		}
		sw, err := svc.ListForSwitch(ctx, "u")
		if err != nil {
			t.Fatal(err)
		}
		if len(sw.Available) != 3 {
			t.Fatalf("len(Available) = %d, want 3", len(sw.Available))
		}
		if sw.Available[0].Type != DisplayIdentityBurner {
			t.Errorf("first available = %q, want BURNER (so users see expiring identity first)", sw.Available[0].Type)
		}
		if sw.Active.ID != sw.Available[0].ID {
			t.Errorf("Active = %v, want first of Available = %v", sw.Active.ID, sw.Available[0].ID)
		}
	})
}

func TestMemoryDisplayIdentityRepository_Update_VersionConflict(t *testing.T) {
	clk := newFakeClock(time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC))
	svc := NewDisplayIdentityService(nil, clk)
	runWith(t, func(ctx context.Context) {
		d, err := svc.Create(ctx, CreateInput{OwnerID: "u", Alias: "a", DisplayName: "A", Type: DisplayIdentityPublic})
		if err != nil {
			t.Fatal(err)
		}
		// Fetch the underlying repo to do a stale update
		repo := svc.repo
		d.DisplayName = "B"
		if err := repo.Update(ctx, d, 0); err == nil { // wrong version
			t.Errorf("expected version conflict, got nil")
		} else if !errors.Is(err, ErrDisplayIdentityConflict) {
			t.Errorf("err = %v, want ErrDisplayIdentityConflict", err)
		}
	})
}

// touch the clock import to silence unused-import linter in case some
// subtests are commented out
var _ = clock.System{}
