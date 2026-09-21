package media

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/command"
)

func twinTestSetup(t *testing.T) (*Service, *aipersona.Service) {
	t.Helper()
	svc := NewWithDependencies(NewMemoryRepository(), nil)
	svc.SetStoreDir(t.TempDir())
	personaSvc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-test")
	personaSvc.SetAgeLookup(adultAgeLookup{})
	svc.WithAIPersonaService(personaSvc)
	return svc, personaSvc
}

func seedConsentedTwinFor(t *testing.T, personaSvc *aipersona.Service, owner string) string {
	t.Helper()
	p, err := personaSvc.CreatePersona(context.Background(), aipersona.Persona{
		OwnerID: owner, DisplayName: "写真分身", PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatalf("create twin: %v", err)
	}
	if _, err := personaSvc.GrantConsent(context.Background(), p.ID, owner, aipersona.ConsentVisualAndVoice, nil); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	return p.ID
}

// seedReadyPhoto 生成一张 lavfi 测试图落盘，并注册为 owner 名下 READY 的 IMAGE 资产。
func seedReadyPhoto(t *testing.T, svc *Service, owner, key string) string {
	t.Helper()
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for twin photo simulation test")
	}
	path := filepath.Join(storeDirOf(svc), key)
	cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=1:duration=1", "-frames:v", "1", "-y", path)
	if output, runErr := cmd.CombinedOutput(); runErr != nil {
		t.Fatalf("create photo fixture: %v: %s", runErr, output)
	}
	asset := MediaAsset{
		MediaAssetID: newID("ma_"), OwnerPrincipalType: "USER", OwnerPrincipalID: owner,
		MediaType: "IMAGE", OriginalStorageKey: key, MimeType: "image/jpeg",
		Width: 640, Height: 480, ModerationStatus: "APPROVED", VisibilityClass: "OWNER_ONLY",
		ProcessingStatus: "READY", AIGenerationSource: "USER_UPLOADED",
	}
	if err := svc.repository.CreateAsset(context.Background(), asset); err != nil {
		t.Fatalf("register fixture: %v", err)
	}
	return asset.MediaAssetID
}

func storeDirOf(s *Service) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.storeDir
}

func twinPhotoEnvelope(payload map[string]any, userID string) command.Envelope {
	return command.Envelope{
		CommandID: "cmd_twin_photo", CommandType: "RequestTwinPhoto", CommandVersion: 1,
		Actor: command.Actor{Type: "USER", ID: userID}, Principal: command.Principal{Type: "USER", ID: userID},
		Target: command.Target{Type: "MediaAsset", ID: ""}, IdempotencyKey: "twin-photo-" + userID,
		AuthContext: map[string]any{}, Purpose: "test", CorrelationID: "corr",
		RequestedAt: "2026-09-21T00:00:00Z", Payload: payload,
	}
}

func twinPhotoAssetID(t *testing.T, result command.Result) string {
	t.Helper()
	var body struct {
		Asset struct {
			MediaAssetID string `json:"mediaAssetId"`
		} `json:"asset"`
	}
	_ = json.Unmarshal([]byte(result.OperationRef), &body)
	if body.Asset.MediaAssetID == "" {
		t.Fatalf("missing asset id in %#v", result)
	}
	return body.Asset.MediaAssetID
}

// TWIN-PHOTO-SIM-001: 全链路——有同意的分身主人用自己的 READY 照片出仿真写真。
// 产物 READY 可播，来源 USER_UPLOADED（不配 AI 徽），分身归属另记三列，
// 文件真实落盘且是竖构图 1080x1440。
func TestRequestTwinPhotoSimHappyPath(t *testing.T) {
	svc, personaSvc := twinTestSetup(t)
	twinID := seedConsentedTwinFor(t, personaSvc, "u1")
	srcID := seedReadyPhoto(t, svc, "u1", "src_happy.jpg")
	result := svc.Handle(twinPhotoEnvelope(map[string]any{
		"twinPersonaId": twinID, "sourceAssetId": srcID, "template": "portrait",
	}, "u1"))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("expected ACCEPTED, got %#v", result)
	}
	assetID := twinPhotoAssetID(t, result)
	stored, err := svc.repository.GetAsset(context.Background(), assetID)
	if err != nil {
		t.Fatalf("produced asset must be readable: %v", err)
	}
	if stored.ProcessingStatus != "READY" || stored.MediaType != "IMAGE" {
		t.Fatalf("unexpected asset state: %#v", stored)
	}
	if stored.AIGenerationSource != "USER_UPLOADED" || stored.AIGenerated {
		t.Fatalf("sim output must not wear the AI badge: %#v", stored)
	}
	if !stored.TwinSimulated || stored.TwinPersonaID != twinID || len(stored.TwinSourceAssetIDs) != 1 || stored.TwinSourceAssetIDs[0] != srcID {
		t.Fatalf("twin provenance missing: %#v", stored)
	}
	if stored.Width != 1080 || stored.Height != 1440 {
		t.Fatalf("portrait template must be 1080x1440, got %dx%d", stored.Width, stored.Height)
	}
	if _, err := os.Stat(filepath.Join(storeDirOf(svc), stored.OriginalStorageKey)); err != nil {
		t.Fatalf("composed file must exist on disk: %v", err)
	}
}

// TWIN-PHOTO-SIM-001: 没同意 / 陌生人分身 / 服务没接 persona，一律拒绝。
func TestRequestTwinPhotoForbiddenPaths(t *testing.T) {
	svc, personaSvc := twinTestSetup(t)
	twinID := seedConsentedTwinFor(t, personaSvc, "u1")
	srcID := seedReadyPhoto(t, svc, "u1", "src_forbid.jpg")
	payload := func() map[string]any {
		return map[string]any{"twinPersonaId": twinID, "sourceAssetId": srcID, "template": "square"}
	}
	// 陌生人拿别人的分身出图。
	stranger := svc.Handle(twinPhotoEnvelope(payload(), "u2"))
	if stranger.Error == nil || stranger.Error.ErrorCode != "TWIN_PHOTO_FORBIDDEN" {
		t.Fatalf("stranger: expected TWIN_PHOTO_FORBIDDEN, got %#v", stranger)
	}
	// 同意撤回即停。
	if _, err := personaSvc.RevokeLiveConsent(context.Background(), twinID, "u1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	revoked := svc.Handle(twinPhotoEnvelope(payload(), "u1"))
	if revoked.Error == nil || revoked.Error.ErrorCode != "TWIN_PHOTO_FORBIDDEN" {
		t.Fatalf("revoked: expected TWIN_PHOTO_FORBIDDEN, got %#v", revoked)
	}
	// persona 服务没接线：fail-closed，不是放行。
	bare := NewWithDependencies(NewMemoryRepository(), nil)
	bare.SetStoreDir(t.TempDir())
	unwired := bare.Handle(twinPhotoEnvelope(payload(), "u1"))
	if unwired.Error == nil || unwired.Error.ErrorCode != "TWIN_PHOTO_UNAVAILABLE" {
		t.Fatalf("unwired: expected TWIN_PHOTO_UNAVAILABLE, got %#v", unwired)
	}
}

// TWIN-PHOTO-SIM-001: 来源图三不收——别人的 / 没 READY / 不是照片；模板只认两种。
func TestRequestTwinPhotoRejectsBadSourceAndTemplate(t *testing.T) {
	svc, personaSvc := twinTestSetup(t)
	twinID := seedConsentedTwinFor(t, personaSvc, "u1")
	mine := seedReadyPhoto(t, svc, "u1", "src_mine.jpg")
	theirs := seedReadyPhoto(t, svc, "u2", "src_theirs.jpg")
	cases := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{"other-owner", map[string]any{"twinPersonaId": twinID, "sourceAssetId": theirs, "template": "square"}, "TWIN_SOURCE_INVALID"},
		{"missing", map[string]any{"twinPersonaId": twinID, "sourceAssetId": "ma_nope", "template": "square"}, "TWIN_SOURCE_INVALID"},
		{"bad-template", map[string]any{"twinPersonaId": twinID, "sourceAssetId": mine, "template": "cinematic"}, "INVALID_TWIN_PHOTO_REQUEST"},
		{"empty-twin", map[string]any{"twinPersonaId": "", "sourceAssetId": mine, "template": "square"}, "INVALID_TWIN_PHOTO_REQUEST"},
	}
	for _, c := range cases {
		result := svc.Handle(twinPhotoEnvelope(c.payload, "u1"))
		if result.Error == nil || result.Error.ErrorCode != c.want {
			t.Fatalf("%s: expected %s, got %#v", c.name, c.want, result)
		}
	}
}
