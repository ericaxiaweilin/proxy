package aipersona

import (
	"context"
	"errors"
	"testing"
	"time"
)

// COMP-AI-MINOR-001：这些用例要测的是「persona / likeness consent」本身，
// 不是年龄。年龄查询必须先放行一个成年人，否则每条用例都会先被年龄卡住，
// 测的就不是它声称要测的东西。
type fixedAgeLookup struct {
	age int
	err error
}

func (l fixedAgeLookup) AgeAt(context.Context, string, time.Time) (int, error) {
	return l.age, l.err
}

func newAdultService(repo Repository, termsVersion string) *Service {
	svc := NewService(repo, termsVersion)
	svc.SetAgeLookup(fixedAgeLookup{age: 30})
	return svc
}

func TestCreateAndGetPersona(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	p, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID:     "u_alice",
		DisplayName: "小美 (Twin)",
		PersonaType: PersonaTypeUserTwin,
		Description: "Alice 的中文数字分身",
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.ID == "" {
		t.Fatal("id must be assigned")
	}
	if p.CreatedAt.IsZero() {
		t.Fatal("created_at must be set")
	}
	got, err := svc.GetPersona(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.DisplayName != "小美 (Twin)" {
		t.Fatalf("display name: %q", got.DisplayName)
	}
}

func TestCreatePersonaRejectsEmptyFields(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	if _, err := svc.CreatePersona(context.Background(), Persona{PersonaType: PersonaTypeUserTwin, DisplayName: "x"}); err == nil {
		t.Fatal("empty owner id must error")
	}
	if _, err := svc.CreatePersona(context.Background(), Persona{OwnerID: "u", PersonaType: PersonaTypeUserTwin}); err == nil {
		t.Fatal("empty display name must error")
	}
	if _, err := svc.CreatePersona(context.Background(), Persona{OwnerID: "u", DisplayName: "x", PersonaType: PersonaType("NOPE")}); err == nil {
		t.Fatal("unknown persona type must error")
	}
}

func TestGrantConsentCreatesAndReuses(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	p, _ := svc.CreatePersona(context.Background(), Persona{OwnerID: "u_alice", DisplayName: "x", PersonaType: PersonaTypeUserTwin})
	c1, err := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisualAndVoice, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c1.RevokedAt != nil {
		t.Fatal("new consent must not be revoked")
	}
	// Re-grant under the same terms returns the same id.
	c2, err := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisualAndVoice, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c2.ID != c1.ID {
		t.Fatalf("expected reuse, got %q vs %q", c1.ID, c2.ID)
	}
}

func TestRevokedConsentStopsBeingLive(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	p, _ := svc.CreatePersona(context.Background(), Persona{OwnerID: "u_alice", DisplayName: "x", PersonaType: PersonaTypeUserTwin})
	c, _ := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisualAndVoice, nil)
	live, err := svc.HasLiveConsent(context.Background(), p.ID, "u_alice")
	if err != nil || live == nil {
		t.Fatalf("expected live, got %v %v", live, err)
	}
	if err := svc.RevokeConsent(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	live, err = svc.HasLiveConsent(context.Background(), p.ID, "u_alice")
	if err != nil {
		t.Fatal(err)
	}
	if live != nil {
		t.Fatal("expected nil after revoke")
	}
}

func TestExpiredConsentStopsBeingLive(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc.SetNowFunc(func() time.Time { return now })
	p, _ := svc.CreatePersona(context.Background(), Persona{OwnerID: "u_alice", DisplayName: "x", PersonaType: PersonaTypeUserTwin})
	// Grant with a 1-day expiry.
	expires := now.Add(24 * time.Hour)
	_, err := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisual, &expires)
	if err != nil {
		t.Fatal(err)
	}
	// Same day: live.
	live, _ := svc.HasLiveConsent(context.Background(), p.ID, "u_alice")
	if live == nil {
		t.Fatal("expected live before expiry")
	}
	// Move the clock past the expiry.
	svc.SetNowFunc(func() time.Time { return now.Add(48 * time.Hour) })
	live, _ = svc.HasLiveConsent(context.Background(), p.ID, "u_alice")
	if live != nil {
		t.Fatal("expected nil after expiry")
	}
}

func TestReconsentAfterRevoke(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	p, _ := svc.CreatePersona(context.Background(), Persona{OwnerID: "u_alice", DisplayName: "x", PersonaType: PersonaTypeUserTwin})
	c1, _ := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisual, nil)
	if err := svc.RevokeConsent(context.Background(), c1.ID); err != nil {
		t.Fatal(err)
	}
	// Re-consent under the same terms: a NEW row is written
	// (the old one stays as a revoked audit row).
	c2, err := svc.GrantConsent(context.Background(), p.ID, "u_alice", ConsentVisual, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c2.ID == c1.ID {
		t.Fatal("re-consent after revoke must produce a new id")
	}
	live, _ := svc.HasLiveConsent(context.Background(), p.ID, "u_alice")
	if live == nil || live.ID != c2.ID {
		t.Fatalf("live consent must be the new row, got %+v", live)
	}
}

func TestLatestConsentForUnknownPersona(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	live, err := svc.HasLiveConsent(context.Background(), "aip_does_not_exist", "u_alice")
	if err != nil {
		t.Fatal(err)
	}
	if live != nil {
		t.Fatal("expected nil live for unknown persona")
	}
}

func TestNormalizers(t *testing.T) {
	if got, _ := NormalizePersonaType("user_twin"); got != PersonaTypeUserTwin {
		t.Fatalf("user_twin normalization: %q", got)
	}
	if got, _ := NormalizeConsentKind("visual_and_voice"); got != ConsentVisualAndVoice {
		t.Fatalf("consent kind normalization: %q", got)
	}
	if _, err := NormalizePersonaType("nope"); err == nil {
		t.Fatal("unknown persona type must error")
	}
	if _, err := NormalizeConsentKind(""); err == nil {
		t.Fatal("empty consent kind must error")
	}
}

func TestListPersonasByOwnerSorted(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	// Three personas, two for the same owner.
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	svc.SetNowFunc(func() time.Time { return now })
	_, _ = svc.CreatePersona(context.Background(), Persona{OwnerID: "u_a", DisplayName: "a", PersonaType: PersonaTypeCreative})
	now = now.Add(time.Minute)
	svc.SetNowFunc(func() time.Time { return now })
	_, _ = svc.CreatePersona(context.Background(), Persona{OwnerID: "u_a", DisplayName: "b", PersonaType: PersonaTypeUserTwin})
	now = now.Add(time.Minute)
	svc.SetNowFunc(func() time.Time { return now })
	_, _ = svc.CreatePersona(context.Background(), Persona{OwnerID: "u_b", DisplayName: "c", PersonaType: PersonaTypeCreative})
	list, err := repo.ListPersonasByOwner(context.Background(), "u_a")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 personas for u_a, got %d", len(list))
	}
	if list[0].DisplayName != "b" || list[1].DisplayName != "a" {
		t.Fatalf("ordering wrong: %+v", list)
	}
}

func TestGrantConsentRejectsEmptyIDs(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	if _, err := svc.GrantConsent(context.Background(), "", "u", ConsentVisual, nil); err == nil {
		t.Fatal("empty persona id must error")
	}
	if _, err := svc.GrantConsent(context.Background(), "p", "", ConsentVisual, nil); err == nil {
		t.Fatal("empty subject id must error")
	}
	if _, err := svc.GrantConsent(context.Background(), "p", "u", ConsentKind("nope"), nil); err == nil {
		t.Fatal("unknown consent kind must error")
	}
}

func TestRevokeUnknownConsentErrors(t *testing.T) {
	repo := NewMemoryRepository()
	svc := newAdultService(repo, "terms-1.1")
	err := svc.RevokeConsent(context.Background(), "lic_does_not_exist")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// FLAKE-CONSENT-001: same-tick grants share GrantedAt; LatestConsent must
// still return the later insert (insertion order), not a random map pick.
// Without the tie-break, TestReconsentAfterRevoke flakes under full-suite
// load when revoke + re-grant land in one clock tick.
func TestLatestConsentTieBreaksByInsertionOrder(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	fixed := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	first := LikenessConsent{ID: "lic_first", PersonaID: "p", SubjectID: "u", ConsentKind: ConsentVisual, TermsVersion: "terms-1.1", GrantedAt: fixed}
	second := LikenessConsent{ID: "lic_second", PersonaID: "p", SubjectID: "u", ConsentKind: ConsentVisual, TermsVersion: "terms-1.1", GrantedAt: fixed}
	if err := repo.GrantConsent(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := repo.GrantConsent(ctx, second); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		latest, err := repo.LatestConsent(ctx, "p", "u", "terms-1.1", fixed)
		if err != nil {
			t.Fatal(err)
		}
		if latest == nil || latest.ID != "lic_second" {
			t.Fatalf("tie must resolve to later insert, got %+v", latest)
		}
	}
}
