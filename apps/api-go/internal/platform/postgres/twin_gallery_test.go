package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/media"
)

// AI-TWIN-GALLERY-001 — Postgres round-trip for the two 图库 queries.
//
// ListByPersona / ListByOwner are new repository methods; the risk worth
// pinning down is the same shape as the LC-06/LC-07 holes in
// media_ai_provenance_test.go — a query that reads the right columns but
// filters on the wrong scope (persona vs owner) would silently leak one
// gallery's photos into the other, or hide a real photo behind the READY
// filter. Both tabs must only ever show what they claim to show.

func TestTwinGalleryListByPersonaOnlyReturnsThatPersonasReadyAIAssets(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)
	personaSvc := pgPersonaService()
	svc.WithAIPersonaService(personaSvc)

	run := time.Now().UnixNano()
	owner := "user_gallery_persona_" + itoa(run)
	// CREATIVE：不涉及真人 likeness，不需要活体同意，最小化跟 LC-07 的耦合——
	// 这条测的是图库范围查询本身，不是同意闸门。
	persona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID: owner, DisplayName: "Gallery Twin " + itoa(run), PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}
	otherPersona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID: owner, DisplayName: "Other Twin " + itoa(run), PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("CreatePersona (other): %v", err)
	}

	readyAI := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_ai_ready_" + itoa(run) + ".png",
		"mimeType": "image/png", "aiGenerationSource": "AI_PERSONA", "personaId": persona.ID, "subjectId": owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{readyAI}) })
	if code := pgMarkReady(t, svc, ctx, owner, readyAI); code != "" {
		t.Fatalf("MarkMediaReady: unexpected rejection %s", code)
	}

	// 还在 PROCESSING：READY 过滤器必须挡住它，不然图库会显示还没生成完的图。
	pendingAI := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_ai_pending_" + itoa(run) + ".png",
		"mimeType": "image/png", "aiGenerationSource": "AI_PERSONA", "personaId": persona.ID, "subjectId": owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{pendingAI}) })

	// 另一个分身的 AI 资产：persona_id 范围必须挡住，不然会把别的分身的图混进来。
	otherAI := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_ai_other_" + itoa(run) + ".png",
		"mimeType": "image/png", "aiGenerationSource": "AI_PERSONA", "personaId": otherPersona.ID, "subjectId": owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{otherAI}) })
	if code := pgMarkReady(t, svc, ctx, owner, otherAI); code != "" {
		t.Fatalf("MarkMediaReady (other persona): unexpected rejection %s", code)
	}

	// 这个人自己上传的原始照片：persona_id 为空，ListByPersona 不该返回它。
	rawUpload := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_raw_for_persona_check_" + itoa(run) + ".jpg",
		"mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{rawUpload}) })
	if code := pgMarkReady(t, svc, ctx, owner, rawUpload); code != "" {
		t.Fatalf("MarkMediaReady (raw): unexpected rejection %s", code)
	}

	got, err := repo.ListByPersona(ctx, persona.ID)
	if err != nil {
		t.Fatalf("ListByPersona: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ListByPersona: want exactly 1 asset, got %d: %+v", len(got), got)
	}
	if got[0].MediaAssetID != readyAI {
		t.Fatalf("ListByPersona: got %q, want the READY asset %q", got[0].MediaAssetID, readyAI)
	}
	if got[0].AIGenerationSource != "AI_PERSONA" || got[0].PersonaID != persona.ID {
		t.Fatalf("ListByPersona: wrong provenance on returned asset: %+v", got[0])
	}
}

func TestTwinGalleryListByOwnerOnlyReturnsThatOwnersReadyAssets(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	owner := "user_gallery_owner_" + itoa(run)
	otherOwner := "user_gallery_owner_other_" + itoa(run)

	readyRaw := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_owner_ready_" + itoa(run) + ".jpg",
		"mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{readyRaw}) })
	if code := pgMarkReady(t, svc, ctx, owner, readyRaw); code != "" {
		t.Fatalf("MarkMediaReady: unexpected rejection %s", code)
	}

	// 还没就绪：不该出现在这个人的原始图库里。
	pendingRaw := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_owner_pending_" + itoa(run) + ".jpg",
		"mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{pendingRaw}) })

	// 另一个人的照片：owner_principal_id 范围必须挡住。
	otherRaw := pgCreateAsset(t, svc, ctx, otherOwner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_owner_other_" + itoa(run) + ".jpg",
		"mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{otherRaw}) })
	if code := pgMarkReady(t, svc, ctx, otherOwner, otherRaw); code != "" {
		t.Fatalf("MarkMediaReady (other owner): unexpected rejection %s", code)
	}

	got, err := repo.ListByOwner(ctx, owner)
	if err != nil {
		t.Fatalf("ListByOwner: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ListByOwner: want exactly 1 asset, got %d: %+v", len(got), got)
	}
	if got[0].MediaAssetID != readyRaw {
		t.Fatalf("ListByOwner: got %q, want the READY asset %q", got[0].MediaAssetID, readyRaw)
	}
}

// AI-TWIN-GALLERY-001: the service-level split (source=ai / source=raw) must
// exclude an AI-generated asset from the raw tab even though ListByOwner
// alone would return every READY asset the owner has, AI-generated or not.
func TestTwinGalleryServiceSourceSplitExcludesAIFromRawTab(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)
	personaSvc := pgPersonaService()
	svc.WithAIPersonaService(personaSvc)

	run := time.Now().UnixNano()
	owner := "user_gallery_split_" + itoa(run)
	persona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID: owner, DisplayName: "Split Twin " + itoa(run), PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}

	aiAsset := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_split_ai_" + itoa(run) + ".png",
		"mimeType": "image/png", "aiGenerationSource": "AI_PERSONA", "personaId": persona.ID, "subjectId": owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{aiAsset}) })
	if code := pgMarkReady(t, svc, ctx, owner, aiAsset); code != "" {
		t.Fatalf("MarkMediaReady (ai): unexpected rejection %s", code)
	}

	rawAsset := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/gallery_split_raw_" + itoa(run) + ".jpg",
		"mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{rawAsset}) })
	if code := pgMarkReady(t, svc, ctx, owner, rawAsset); code != "" {
		t.Fatalf("MarkMediaReady (raw): unexpected rejection %s", code)
	}

	aiTab, err := svc.ListPersonaGallery(ctx, owner, persona.ID, "ai")
	if err != nil {
		t.Fatalf("ListPersonaGallery(ai): %v", err)
	}
	if len(aiTab) != 1 || aiTab[0].MediaAssetID != aiAsset {
		t.Fatalf("ai tab: want only %q, got %+v", aiAsset, aiTab)
	}

	rawTab, err := svc.ListPersonaGallery(ctx, owner, persona.ID, "raw")
	if err != nil {
		t.Fatalf("ListPersonaGallery(raw): %v", err)
	}
	if len(rawTab) != 1 || rawTab[0].MediaAssetID != rawAsset {
		t.Fatalf("raw tab: want only %q (AI asset must not leak into raw), got %+v", rawAsset, rawTab)
	}
}
