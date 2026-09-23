package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/media"
)

// AI-MANAGE-009：模型读一个人的照片，没有本人形象授权就一张都拿不到；撤回后立刻拿不到。
func TestLikenessReferencePhotosRequireTheOwnersConsent(t *testing.T) {
	ctx := context.Background()
	personaSvc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	personaSvc.SetAgeLookup(twinCenterAdultLookup{})
	mediaRepo := media.NewMemoryRepository()
	server := &Server{AIPersona: personaSvc, Media: media.NewWithDependencies(mediaRepo, nil)}

	twin, err := personaSvc.CreatePersona(ctx, aipersona.Persona{OwnerID: "user_owner", DisplayName: "我的AI分身", PersonaType: aipersona.PersonaTypeUserTwin})
	if err != nil {
		t.Fatalf("create twin: %v", err)
	}
	now := time.Now().UTC()
	for _, a := range []struct{ id, owner, source string }{
		{"raw_mine", "user_owner", "USER_UPLOADED"},
		{"ai_mine", "user_owner", "AI_GENERATED"},
		{"raw_other", "user_other", "USER_UPLOADED"},
	} {
		if err := mediaRepo.CreateAsset(ctx, media.MediaAsset{
			MediaAssetID: a.id, OwnerPrincipalType: "INDIVIDUAL", OwnerPrincipalID: a.owner, MediaType: "IMAGE",
			OriginalStorageKey: "media/" + a.id + ".jpg", ProcessingStatus: "READY", ModerationStatus: "APPROVED",
			VisibilityClass: "OWNER_ONLY", AIGenerationSource: a.source, AIGenerated: a.source != "USER_UPLOADED",
			PersonaID: twin.ID, CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if _, err := server.likenessReferencePhotos(ctx, "user_owner"); !errors.Is(err, ErrLikenessConsentRequired) {
		t.Fatalf("without consent the model must get nothing, got err=%v", err)
	}

	if _, err := personaSvc.GrantConsent(ctx, twin.ID, "user_owner", aipersona.ConsentVisual, nil); err != nil {
		t.Fatalf("grant: %v", err)
	}
	photos, err := server.likenessReferencePhotos(ctx, "user_owner")
	if err != nil {
		t.Fatalf("with consent the model may read the owner's raw photos: %v", err)
	}
	if len(photos) != 1 || photos[0].MediaAssetID != "raw_mine" {
		t.Fatalf("only the owner's own uploaded originals, got %+v", photos)
	}

	live, _ := personaSvc.HasLiveConsent(ctx, twin.ID, "user_owner")
	if err := personaSvc.RevokeConsent(ctx, live.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := server.likenessReferencePhotos(ctx, "user_owner"); !errors.Is(err, ErrLikenessConsentRequired) {
		t.Fatalf("after revocation the model must get nothing again, got err=%v", err)
	}
}
