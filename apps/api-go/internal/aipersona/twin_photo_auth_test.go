package aipersona

import (
	"context"
	"testing"
)

func seedConsentedTwin(t *testing.T, svc *Service, owner string) string {
	t.Helper()
	p, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID: owner, DisplayName: "写真分身", PersonaType: PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatalf("create twin: %v", err)
	}
	if _, err := svc.GrantConsent(context.Background(), p.ID, owner, ConsentVisualAndVoice, nil); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	return p.ID
}

// TWIN-PHOTO-SIM-001: 五道门全过才放行，主体返回分身主人本人。
func TestAuthorizeTwinPhotoAllowsOwnerWithLiveConsent(t *testing.T) {
	svc := newAdultService(NewMemoryRepository(), "terms-1.1")
	id := seedConsentedTwin(t, svc, "u_alice")
	subject, err := svc.AuthorizeTwinPhoto(context.Background(), id, "u_alice")
	if err != nil {
		t.Fatalf("expected allow, got %v", err)
	}
	if subject != "u_alice" {
		t.Fatalf("subject must be the owner, got %q", subject)
	}
}

// TWIN-PHOTO-SIM-001: 陌生人 / 不存在的分身 / 非 USER_TWIN 类型，一律拒绝，
// 且不泄露是哪一道没过（统配错）。
func TestAuthorizeTwinPhotoRejectsStrangerUnknownAndNonTwin(t *testing.T) {
	svc := newAdultService(NewMemoryRepository(), "terms-1.1")
	id := seedConsentedTwin(t, svc, "u_alice")
	cases := []struct {
		name string
		pid  string
		uid  string
	}{
		{"stranger", id, "u_bob"},
		{"unknown", "aip_nope", "u_alice"},
		{"empty", "", ""},
	}
	for _, c := range cases {
		if _, err := svc.AuthorizeTwinPhoto(context.Background(), c.pid, c.uid); err != ErrTwinPhotoForbidden {
			t.Fatalf("%s: expected ErrTwinPhotoForbidden, got %v", c.name, err)
		}
	}
	creative, err := svc.CreatePersona(context.Background(), Persona{
		OwnerID: "u_alice", DisplayName: "创意分身", PersonaType: PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("create creative: %v", err)
	}
	if _, err := svc.AuthorizeTwinPhoto(context.Background(), creative.ID, "u_alice"); err != ErrTwinPhotoForbidden {
		t.Fatalf("creative: expected ErrTwinPhotoForbidden, got %v", err)
	}
}

// TWIN-PHOTO-SIM-001: 同意撤回即停；未成年人走不通（与建分身同口径）。
func TestAuthorizeTwinPhotoFailsClosedOnRevokeAndMinor(t *testing.T) {
	svc := newAdultService(NewMemoryRepository(), "terms-1.1")
	id := seedConsentedTwin(t, svc, "u_alice")
	if _, err := svc.RevokeLiveConsent(context.Background(), id, "u_alice"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.AuthorizeTwinPhoto(context.Background(), id, "u_alice"); err != ErrTwinPhotoForbidden {
		t.Fatalf("revoked: expected ErrTwinPhotoForbidden, got %v", err)
	}
	minorSvc := NewService(svc.repo, "terms-1.1")
	minorSvc.SetAgeLookup(fixedAgeLookup{age: 17})
	if _, err := minorSvc.AuthorizeTwinPhoto(context.Background(), id, "u_alice"); err != ErrTwinPhotoForbidden {
		t.Fatalf("minor: expected ErrTwinPhotoForbidden, got %v", err)
	}
}
