package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/identity"
	"github.com/proxy-app/proxy-api/internal/media"
)

// AI-TWIN-GALLERY-001: the HTTP layer's job is auth + scope enforcement on
// top of the already-tested repository/service queries (see
// internal/platform/postgres/twin_gallery_test.go for the data-scope
// coverage). These pin: no token → 401, wrong caller → 403 (a gallery is
// private even though the sibling persona endpoints skip auth), and a
// correctly authenticated owner gets exactly their own scoped items.

type galleryTestFixture struct {
	server    *Server
	persona   aipersona.Persona
	ownerToken string
	otherToken string
}

func newGalleryTestFixture(t *testing.T) galleryTestFixture {
	t.Helper()
	personaSvc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	personaSvc.SetAgeLookup(twinCenterAdultLookup{})
	mediaRepo := media.NewMemoryRepository()
	mediaSvc := media.NewWithDependencies(mediaRepo, nil)

	persona, err := personaSvc.CreatePersona(context.Background(), aipersona.Persona{
		OwnerID: "user_gallery_owner", DisplayName: "Gallery Twin", PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}

	now := time.Now().UTC()
	seed := func(id, owner, personaID, source string) {
		t.Helper()
		if err := mediaRepo.CreateAsset(context.Background(), media.MediaAsset{
			MediaAssetID: id, OwnerPrincipalType: "INDIVIDUAL", OwnerPrincipalID: owner,
			MediaType: "IMAGE", OriginalStorageKey: "media/" + id + ".jpg",
			ProcessingStatus: "READY", ModerationStatus: "APPROVED", VisibilityClass: "OWNER_ONLY",
			AIGenerationSource: source, AIGenerated: source != "USER_UPLOADED", PersonaID: personaID,
			ThumbnailURL: "/v1/media/thumb/" + id, PlaybackURL: "/v1/media/play/" + id,
			CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			t.Fatalf("seed asset %s: %v", id, err)
		}
	}
	seed("ma_gallery_ai_1", "user_gallery_owner", persona.ID, "AI_PERSONA")
	seed("ma_gallery_raw_1", "user_gallery_owner", "", "USER_UPLOADED")
	seed("ma_gallery_intruder", "user_gallery_intruder", "", "USER_UPLOADED")

	server := &Server{
		AIPersona: personaSvc,
		Media:     mediaSvc,
		Authenticator: strictAuthenticator{validTokens: map[string]identity.AuthenticatedSession{
			"owner_token": {
				Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_gallery_owner"},
			},
			"intruder_token": {
				Principal: command.Principal{Type: "INDIVIDUAL", ID: "user_gallery_intruder"},
			},
		}},
	}
	return galleryTestFixture{server: server, persona: *persona, ownerToken: "owner_token", otherToken: "intruder_token"}
}

func galleryRequest(path, token string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

func TestPersonaGalleryRequiresAuth(t *testing.T) {
	fx := newGalleryTestFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routePersonaItem(recorder, galleryRequest("/v1/ai/personas/"+fx.persona.ID+"/media?source=ai", ""))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (%s)", recorder.Code, recorder.Body.String())
	}
}

func TestPersonaGalleryRejectsNonOwner(t *testing.T) {
	fx := newGalleryTestFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routePersonaItem(recorder, galleryRequest("/v1/ai/personas/"+fx.persona.ID+"/media?source=ai", fx.otherToken))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — a gallery must not be listable by guessing a persona id (%s)", recorder.Code, recorder.Body.String())
	}
}

func TestPersonaGalleryRejectsInvalidSource(t *testing.T) {
	fx := newGalleryTestFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routePersonaItem(recorder, galleryRequest("/v1/ai/personas/"+fx.persona.ID+"/media?source=bogus", fx.ownerToken))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestPersonaGalleryAITabReturnsOnlyThisPersonasAIAssets(t *testing.T) {
	fx := newGalleryTestFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routePersonaItem(recorder, galleryRequest("/v1/ai/personas/"+fx.persona.ID+"/media?source=ai", fx.ownerToken))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Items []twinGalleryMediaItem `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Items) != 1 || payload.Items[0].ID != "ma_gallery_ai_1" {
		t.Fatalf("ai tab items = %+v, want exactly [ma_gallery_ai_1]", payload.Items)
	}
}

func TestPersonaGalleryRawTabExcludesAIAndOtherOwners(t *testing.T) {
	fx := newGalleryTestFixture(t)
	recorder := httptest.NewRecorder()
	fx.server.routePersonaItem(recorder, galleryRequest("/v1/ai/personas/"+fx.persona.ID+"/media?source=raw", fx.ownerToken))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Items []twinGalleryMediaItem `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Items) != 1 || payload.Items[0].ID != "ma_gallery_raw_1" {
		t.Fatalf("raw tab items = %+v, want exactly [ma_gallery_raw_1] (no AI asset, no other owner's photo)", payload.Items)
	}
}
