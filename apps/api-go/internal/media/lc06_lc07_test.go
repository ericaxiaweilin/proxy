package media

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/command"
)

// COMP-AI-MINOR-001：这批用例测的是 LC-06/07（AI 生成标注 + likeness consent），
// 不是年龄。年龄查询先放行一个成年人，否则每条用例都会先被年龄卡住，
// 测的就不是它声称要测的东西。
type adultAgeLookup struct{}

func (adultAgeLookup) AgeAt(context.Context, string, time.Time) (int, error) { return 30, nil }

func newAdultPersonaService(repo aipersona.Repository) *aipersona.Service {
	svc := aipersona.NewService(repo, "terms-1.1")
	svc.SetAgeLookup(adultAgeLookup{})
	return svc
}

// R16.7-P1-K (LC-06) + R16.7-P1-I (LC-07) tests.
//
// The test scenarios focus on the boundary that
// markReady + createAsset enforce:
//
//   1. USER_UPLOADED (the default) reads as AIGenerated=false
//      and can transition to READY without consent.
//   2. AI_PERSONA with a USER_TWIN persona + live consent can
//      transition to READY; the asset's LikenessConsentID is
//      stamped.
//   3. AI_PERSONA with a USER_TWIN persona and NO consent is
//      rejected at MarkMediaReady (LC-07 fail-closed).
//   4. AI_PERSONA with a CREATIVE persona can transition to
//      READY without consent (no real-person likeness).
//   5. AIGenerationSource = UNKNOWN is rejected at
//      MarkMediaReady (LC-06 fail-closed).
//   6. AI_PERSONA referencing a non-existent persona id is
//      rejected at MarkMediaReady (LC-07 fail-closed).
//
// We use a memory repository + a memory aipersona.Service
// wired via WithAIPersonaService. The legacy test path
// (no persona service) is exercised by an extra test that
// proves the existing test suite still passes without
// consent enforcement.

// helper: seed the asset in PROCESSING status so the
// MarkMediaReady handler is the only thing standing
// between the asset and READY. We use the repository
// directly to skip the CompleteUpload → worker → READY
// pipeline because that pipeline auto-promotes via
// ProcessAssetNow, which would mask the MarkMediaReady
// path we want to test.
func driveToReady(t *testing.T, s *Service, repo *MemoryRepository, id, originalKey string) {
	t.Helper()
	asset, err := repo.GetAsset(t.Context(), id)
	if err != nil {
		t.Fatalf("seed GetAsset: %v", err)
	}
	asset.ProcessingStatus = "PROCESSING"
	asset.OriginalStorageKey = originalKey
	if err := repo.UpdateAsset(t.Context(), asset, "UPLOADING"); err != nil {
		t.Fatalf("seed UpdateAsset: %v", err)
	}
}

func newServiceWithMemory() (*Service, *MemoryRepository) {
	repo := NewMemoryRepository()
	return NewWithDependencies(repo, nil), repo
}

func TestLC06UserUploadedDefaultHasAIGeneratedFalse(t *testing.T) {
	s, repo := newServiceWithMemory()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/jpeg",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	asset, _ := repo.GetAsset(t.Context(), view.MediaAssetID)
	if asset.AIGenerated {
		t.Fatal("USER_UPLOADED must set AIGenerated=false")
	}
	if asset.AIGenerationSource != "USER_UPLOADED" {
		t.Fatalf("AIGenerationSource: got %q, want USER_UPLOADED", asset.AIGenerationSource)
	}
}

func TestLC06AIPersonaCreateRejectsMissingPersonaID(t *testing.T) {
	s, _ := newServiceWithMemory()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		// personaId missing
	}, ""))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "AI_PERSONA_ID_REQUIRED" {
		t.Fatalf("expected AI_PERSONA_ID_REQUIRED, got %+v", r.Error)
	}
}

func TestLC06UnknownSourceRejectedAtMarkReady(t *testing.T) {
	s, repo := newServiceWithMemory()
	// Hand-craft an asset with AIGenerationSource = UNKNOWN.
	// We reach into the repository because the createAsset
	// boundary normalises unknown values to USER_UPLOADED;
	// the UNKNOWN state is the post-create state of an asset
	// whose producer was misconfigured.
	now := time.Now().UTC()
	asset := MediaAsset{
		MediaAssetID:       "ma_lc06_unknown",
		OwnerPrincipalType: "BUSINESS",
		OwnerPrincipalID:   "business_001",
		MediaType:          "VIDEO",
		OriginalStorageKey: "uploads/misconfigured.mp4",
		ProcessingStatus:   "PROCESSING",
		ModerationStatus:   "QUARANTINED",
		VisibilityClass:    "OWNER_ONLY",
		CreatedAt:          now,
		UpdatedAt:          now,
		AIGenerationSource: "UNKNOWN",
		AIGenerated:        true,
	}
	if err := repo.CreateAsset(t.Context(), asset); err != nil {
		t.Fatal(err)
	}
	r := s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.mp4",
		"thumbnailStorageKey": "thumb/x.jpg",
	}, "ma_lc06_unknown"))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "AI_LABEL_MISSING" {
		t.Fatalf("expected AI_LABEL_MISSING, got %+v", r.Error)
	}
}

func TestLC07UserTwinWithoutConsentRejectedAtMarkReady(t *testing.T) {
	s, repo := newServiceWithMemory()
	// Wire the persona service with one persona and zero
	// consents. The markReady gate should refuse to publish
	// the asset.
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)
	persona, err := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "user_subject_1",
		DisplayName: "Alice Twin",
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Create the asset with AI_PERSONA.
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          "user_subject_1",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	// MarkMediaReady must fail with AI_LIKENESS_CONSENT_MISSING.
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.png",
		"thumbnailStorageKey": "thumb/x.png",
	}, view.MediaAssetID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "AI_LIKENESS_CONSENT_MISSING" {
		t.Fatalf("expected AI_LIKENESS_CONSENT_MISSING, got %+v", r.Error)
	}
}

func TestLC07UserTwinWithLiveConsentStampedOnAsset(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)
	persona, _ := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "user_subject_1",
		DisplayName: "Alice Twin",
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	// Grant consent BEFORE uploading the asset.
	consent, err := personaSvc.GrantConsent(t.Context(), persona.ID, "user_subject_1", aipersona.ConsentVisualAndVoice, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          "user_subject_1",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	// MarkMediaReady must succeed; LikenessConsentID is stamped.
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.png",
		"thumbnailStorageKey": "thumb/x.png",
	}, view.MediaAssetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", r.Outcome, r.Error)
	}
	asset, _ := repo.GetAsset(t.Context(), view.MediaAssetID)
	if asset.LikenessConsentID != consent.ID {
		t.Fatalf("LikenessConsentID: got %q, want %q", asset.LikenessConsentID, consent.ID)
	}
	if asset.ProcessingStatus != "READY" {
		t.Fatalf("ProcessingStatus: got %q, want READY", asset.ProcessingStatus)
	}
}

func TestLC07CreativePersonaNeedsNoConsent(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)
	persona, _ := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "business_001",
		DisplayName: "Concierge 1",
		PersonaType: aipersona.PersonaTypeCreative,
	})
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          "business_001",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.png",
		"thumbnailStorageKey": "thumb/x.png",
	}, view.MediaAssetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", r.Outcome, r.Error)
	}
	asset, _ := repo.GetAsset(t.Context(), view.MediaAssetID)
	if asset.LikenessConsentID != "" {
		t.Fatalf("CREATIVE persona must not stamp LikenessConsentID, got %q", asset.LikenessConsentID)
	}
}

func TestLC07UnknownPersonaRejectedAtMarkReady(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          "aip_does_not_exist",
		"subjectId":          "user_subject_1",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.png",
		"thumbnailStorageKey": "thumb/x.png",
	}, view.MediaAssetID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "AI_PERSONA_NOT_FOUND" {
		t.Fatalf("expected AI_PERSONA_NOT_FOUND, got %+v", r.Error)
	}
}

func TestLC06InvalidSourceRejectedAtCreate(t *testing.T) {
	s, _ := newServiceWithMemory()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "GARAGE_GENERATED",
	}, ""))
	if r.Outcome != "REJECTED" {
		t.Fatalf("expected REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_AI_GENERATION_SOURCE" {
		t.Fatalf("expected INVALID_AI_GENERATION_SOURCE, got %+v", r.Error)
	}
}

func TestLC07AIPersonaDefaultsSubjectIDToOwner(t *testing.T) {
	s, repo := newServiceWithMemory()
	personaRepo := aipersona.NewMemoryRepository()
	personaSvc := newAdultPersonaService(personaRepo)
	s.WithAIPersonaService(personaSvc)
	persona, _ := personaSvc.CreatePersona(t.Context(), aipersona.Persona{
		OwnerID:     "business_001",
		DisplayName: "Bob Twin",
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	// No subjectId in the create payload — should fall back
	// to the principal id ("business_001") and find the
	// live consent that we grant to that subject.
	if _, err := personaSvc.GrantConsent(t.Context(), persona.ID, "business_001", aipersona.ConsentVisual, nil); err != nil {
		t.Fatal(err)
	}
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s (%+v)", r.Outcome, r.Error)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/x.png",
		"thumbnailStorageKey": "thumb/x.png",
	}, view.MediaAssetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %s (%+v)", r.Outcome, r.Error)
	}
	asset, _ := repo.GetAsset(t.Context(), view.MediaAssetID)
	if asset.SubjectID != "business_001" {
		t.Fatalf("SubjectID should default to owner, got %q", asset.SubjectID)
	}
	if asset.LikenessConsentID == "" {
		t.Fatal("LikenessConsentID must be stamped")
	}
}

func TestLC07LegacyServiceNoPersonaWiredStillPublishes(t *testing.T) {
	// This is the backstop: existing tests do not wire a
	// persona service. Their MarkMediaReady calls must
	// continue to succeed. Without this backstop, the
	// legacy test surface would be in a degraded state.
	s, repo := newServiceWithMemory()
	r := s.Handle(envelopeFor("CreateMediaAsset", map[string]any{
		"mediaType":          "VIDEO",
		"originalStorageKey": "uploads/test_video.mp4",
		"mimeType":           "image/jpeg",
	}, ""))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s", r.Outcome)
	}
	var view struct {
		MediaAssetID string `json:"mediaAssetId"`
	}
	_ = json.Unmarshal([]byte(r.OperationRef), &view)
	driveToReady(t, s, repo, view.MediaAssetID, "uploads/test_video.mp4")
	r = s.Handle(envelopeFor("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "playback/photo.jpg",
		"thumbnailStorageKey": "thumb/photo.jpg",
	}, view.MediaAssetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("legacy MarkMediaReady must succeed: %s (%+v)", r.Outcome, r.Error)
	}
	_ = command.Envelope{}
}

// AI-POSTS-001: 5 小美写真资产种子。APPROVED + PUBLIC + READY 才能进
// Feed；AI_PERSONA + PersonaID 挂好 provenance；幂等可重跑。
func TestSeedXiaomeiAssets(t *testing.T) {
	s := New()
	ctx := context.Background()
	if err := s.SeedXiaomeiAssets(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.SeedXiaomeiAssets(ctx); err != nil {
		t.Fatal("reseed must be idempotent")
	}
	for _, id := range []string{"ai_001", "ai_002", "ai_003", "ai_004", "ai_005"} {
		assetID := "seed_media_xiaomei_" + id[len("ai_"):]
		a, err := s.repository.GetAsset(ctx, assetID)
		if err != nil {
			t.Fatalf("missing seeded asset %s: %v", assetID, err)
		}
		if a.ModerationStatus != "APPROVED" || a.VisibilityClass != "PUBLIC" || a.ProcessingStatus != "READY" {
			t.Fatalf("asset %s must be feed-visible: %+v", assetID, a)
		}
		if !a.AIGenerated || a.AIGenerationSource != "AI_PERSONA" || a.PersonaID != id {
			t.Fatalf("asset %s must carry AI provenance: %+v", assetID, a)
		}
		if a.MediaType != "IMAGE" {
			t.Fatalf("asset %s must be IMAGE, got %q", assetID, a.MediaType)
		}
	}
}
