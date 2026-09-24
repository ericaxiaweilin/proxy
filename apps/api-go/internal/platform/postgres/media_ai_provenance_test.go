package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/media"
)

// LC-06 / LC-07 —— AI 生成溯源在 Postgres 仓储上的往返测试。
//
// 为什么需要这一组（2026-09-21 P0）：
//
// internal/media/service.go 里的 LC-06 / LC-07 fail-closed 闸门早就写好了：
// MarkMediaReady 会在 aiGenerationSource == "UNKNOWN" 时拒绝发布（AI_LABEL_MISSING），
// 在 AI_PERSONA 资产查不到活体 likeness 同意时拒绝发布（AI_LIKENESS_CONSENT_MISSING）。
// MediaAsset 结构体也一直带着 AIGenerationSource / AIGenerated / PersonaID /
// SubjectID / LikenessConsentID。
//
// 但 media.media_assets 表里没有这 5 列，platform/postgres/media.go 的
// INSERT / SELECT / UPDATE 也没提过它们。后果是双向的：
//
//   - 写入侧：createAsset 算对了 AIGenerationSource，落库时被静默丢弃；
//   - 读取侧：读回来永远是 Go 零值。aiGenerationSource == ""，
//     而闸门比的是字面量 "UNKNOWN" —— "" 比不过，于是直接放行。
//
// 也就是说，LC-06 / LC-07 在真实部署路径上是**死代码**，越南 AI 法
// 134/2025/QH15 第 12 条要求的「AI 生成内容必须可标注」没有任何数据在支撑。
//
// 这个洞一直没被发现，是因为 media/lc06_lc07_test.go 用的是 MemoryRepository
// （整个 MediaAsset 结构体存在 map 里，字段当然不会丢），而 g3 的
// scripts/lc06-ai-media-e2e.sh 在第 1 步就挂了、根本走不到闸门。
//
// 所以这一组测试的每一对都是「红→绿」的：在补列 + 补 repository 之前，
// 下面每一条都会因为读回空值而以不同的方式失败（见各条注释）。
// 同时保留了两条反向用例（USER_UPLOADED / CREATIVE 必须照常发布），
// 防止修复退化成「一律拒绝」—— 那种守卫会被团队绕过，比没有还糟。

// pgAdultAge 让年龄查询放行一个成年人。
// COMP-AI-MINOR-001 的守卫在 CreatePersona 里，不先放行的话每条用例都会先被
// 「没有年龄证据」卡住，测的就不是它声称要测的东西。
type pgAdultAge struct{}

func (pgAdultAge) AgeAt(context.Context, string, time.Time) (int, error) { return 30, nil }

func pgPersonaService() *aipersona.Service {
	svc := aipersona.NewService(aipersona.NewMemoryRepository(), "terms-1.1")
	svc.SetAgeLookup(pgAdultAge{})
	return svc
}

// pgCreateAsset drives CreateMediaAsset through the service so the asset lands
// in the real table with whatever provenance the caller declared, then moves it
// to PROCESSING (the state MarkMediaReady insists on).
func pgCreateAsset(t *testing.T, svc *media.Service, ctx context.Context, owner string, payload map[string]any) string {
	t.Helper()
	r := svc.HandleContext(ctx, mediaEnvelope("CreateMediaAsset", payload, owner))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateMediaAsset: %s (%+v)", r.Outcome, r.Error)
	}
	assetID := readStringFF(r.OperationRef, "mediaAssetId")
	if assetID == "" {
		t.Fatalf("CreateMediaAsset: missing mediaAssetId, op=%s", r.OperationRef)
	}
	r = svc.HandleContext(ctx, mediaEnvelope("CompleteMediaUpload", map[string]any{
		"originalStorageKey": payload["originalStorageKey"],
	}, owner, assetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CompleteMediaUpload: %s (%+v)", r.Outcome, r.Error)
	}
	if r.Aggregate.State != "PROCESSING" {
		t.Fatalf("after Complete, want PROCESSING, got %s", r.Aggregate.State)
	}
	return assetID
}

func pgMarkReady(t *testing.T, svc *media.Service, ctx context.Context, owner, assetID string) string {
	t.Helper()
	r := svc.HandleContext(ctx, mediaEnvelope("MarkMediaReady", map[string]any{
		"playbackStorageKey":  "media/pg/prov_playback.mp4",
		"thumbnailStorageKey": "media/pg/prov_thumb.jpg",
	}, owner, assetID))
	if r.Outcome == "REJECTED" && r.Error != nil {
		return r.Error.ErrorCode
	}
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("MarkMediaReady: unexpected outcome %s (%+v)", r.Outcome, r.Error)
	}
	return ""
}

// 1. AI_PERSONA 的溯源必须原样往返。
// 修前：GetAsset 读回 AIGenerationSource == ""、PersonaID == ""、SubjectID == ""，
// 这一条在第一个断言就红。
func TestMediaProvenanceAIPersonaRoundTrip(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	owner := "user_media_prov_twin_" + itoa(run)
	// persona 与 subject 用两个明显不同的串：列相邻，写反了也能立刻看出来。
	personaID := "aip_pg_prov_" + itoa(run)
	subjectID := "user_pg_prov_subject_" + itoa(run)
	key := "media/pg/prov_ai_" + itoa(run) + ".png"

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": key, "mimeType": "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          personaID,
		"subjectId":          subjectID,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	asset, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.AIGenerationSource != "AI_PERSONA" {
		t.Fatalf("AIGenerationSource: got %q, want AI_PERSONA — 落库时被丢掉了", asset.AIGenerationSource)
	}
	if !asset.AIGenerated {
		t.Fatal("AIGenerated must be true for AI_PERSONA")
	}
	if asset.PersonaID != personaID {
		t.Fatalf("PersonaID: got %q, want %q", asset.PersonaID, personaID)
	}
	if asset.SubjectID != subjectID {
		t.Fatalf("SubjectID: got %q, want %q — 若两个值互换，说明 SELECT 的列顺序写错了", asset.SubjectID, subjectID)
	}
}

// 2. 批量读（GetAssets）也必须带溯源，而且不许把 persona 和 subject 写反。
// Feed 读模型走的是 GetAssets，不是 GetAsset；三条 SELECT 扫描点各写一遍，
// 任何一处列顺序写错都只会静默换值，不会编译报错。
func TestMediaProvenanceBatchReadKeepsPersonaAndSubjectApart(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	owner := "user_media_prov_batch_" + itoa(run)
	personaID := "aip_pg_batch_" + itoa(run)
	subjectID := "user_pg_batch_subject_" + itoa(run)
	key := "media/pg/prov_batch_" + itoa(run) + ".png"

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": key, "mimeType": "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          personaID,
		"subjectId":          subjectID,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	assets, err := repo.GetAssets(ctx, []string{assetID})
	if err != nil {
		t.Fatalf("GetAssets: %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("GetAssets: want 1 asset, got %d", len(assets))
	}
	got := assets[0]
	if got.PersonaID != personaID || got.SubjectID != subjectID {
		t.Fatalf("batch read swapped provenance: persona=%q (want %q), subject=%q (want %q)",
			got.PersonaID, personaID, got.SubjectID, subjectID)
	}
	if got.AIGenerationSource != "AI_PERSONA" || !got.AIGenerated {
		t.Fatalf("batch read lost the AI label: source=%q generated=%v", got.AIGenerationSource, got.AIGenerated)
	}
}

// 3. 反向用例（防止修复变成「一律拒绝」）：
// 没声明 aiGenerationSource 的普通上传，读回来必须是 USER_UPLOADED / false，
// 而且必须能正常发布。这条在修前也会「通过」—— 但理由是错的（读回空串），
// 所以它同时断言了字面值，把「碰巧通过」钉成「真的落库了」。
func TestMediaProvenanceUserUploadedIsLabelledAndPublishes(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	owner := "user_media_prov_plain_" + itoa(run)
	key := "media/pg/prov_plain_" + itoa(run) + ".jpg"

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": key, "mimeType": "image/jpeg",
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	asset, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.AIGenerationSource != "USER_UPLOADED" {
		t.Fatalf("AIGenerationSource: got %q, want USER_UPLOADED", asset.AIGenerationSource)
	}
	if asset.AIGenerated {
		t.Fatal("AIGenerated must be false for a plain upload")
	}
	if asset.PersonaID != "" || asset.SubjectID != "" || asset.LikenessConsentID != "" {
		t.Fatalf("plain upload must carry no persona/consent linkage: %+v", asset)
	}
	if code := pgMarkReady(t, svc, ctx, owner, assetID); code != "" {
		t.Fatalf("a plain upload must still publish, got %s", code)
	}
}

// 4. LC-06 fail-closed：UNKNOWN 溯源必须存得下、读得回、并且挡住发布。
// 修前：INSERT 根本没有这一列，UNKNOWN 存不进去；就算存进去，读回 "" 也不等于
// "UNKNOWN"，闸门放行 → 未标注的资产被发布。
func TestMediaUnknownProvenanceFailsClosedAtMarkReady(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	owner := "user_media_prov_unknown_" + itoa(run)
	assetID := "ma_pg_unknown_" + itoa(run)
	now := time.Now().UTC()

	// 直接落库：createAsset 会把闭集之外的来源在边界上就拒掉，
	// UNKNOWN 是「生产者没声明」这个状态本身，只能从别的写入路径出现。
	if err := repo.CreateAsset(ctx, media.MediaAsset{
		MediaAssetID:       assetID,
		OwnerPrincipalType: "INDIVIDUAL",
		OwnerPrincipalID:   owner,
		MediaType:          "IMAGE",
		OriginalStorageKey: "media/pg/prov_unknown_" + itoa(run) + ".png",
		MimeType:           "image/png",
		ProcessingStatus:   "PROCESSING",
		ModerationStatus:   "QUARANTINED",
		VisibilityClass:    "OWNER_ONLY",
		AIGenerationSource: "UNKNOWN",
		AIGenerated:        true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}); err != nil {
		t.Fatalf("seed UNKNOWN asset: %v", err)
	}
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	stored, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if stored.AIGenerationSource != "UNKNOWN" {
		t.Fatalf("UNKNOWN did not survive the round-trip: got %q", stored.AIGenerationSource)
	}
	if code := pgMarkReady(t, svc, ctx, owner, assetID); code != "AI_LABEL_MISSING" {
		t.Fatalf("an unlabelled asset must fail closed with AI_LABEL_MISSING, got %q", code)
	}
}

// 5. LC-07 fail-closed：USER_TWIN 分身没有活体同意时，必须挡住发布。
// 修前：PersonaID 读回 ""，闸门里 `asset.PersonaID != ""` 为假 → 整段跳过 →
// 资产被发布。这是三条红→绿里最锋利的一条：它证明的不只是「字段丢了」，
// 而是「合规闸门在真实路径上根本没跑」。
func TestMediaAIPersonaWithoutLiveConsentFailsClosedAtMarkReady(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)
	personaSvc := pgPersonaService()
	svc.WithAIPersonaService(personaSvc)

	run := time.Now().UnixNano()
	owner := "user_media_prov_noconsent_" + itoa(run)
	persona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID:     owner,
		DisplayName: "PG Twin " + itoa(run),
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/prov_noconsent_" + itoa(run) + ".png",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	if code := pgMarkReady(t, svc, ctx, owner, assetID); code != "AI_LIKENESS_CONSENT_MISSING" {
		t.Fatalf("USER_TWIN asset without a live consent must fail closed with AI_LIKENESS_CONSENT_MISSING, got %q", code)
	}
}

// 6. LC-07 的正向路径 + 盖章落库：有活体同意时发布成功，而且
// likenessConsentId 必须真的写进表里（MarkMediaReady 是通过 UpdateAsset 盖的章，
// 修前 UPDATE 里没有这一列，章盖在内存里、落库即丢）。
func TestMediaAIPersonaWithLiveConsentStampsConsentID(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)
	personaSvc := pgPersonaService()
	svc.WithAIPersonaService(personaSvc)

	run := time.Now().UnixNano()
	owner := "user_media_prov_consent_" + itoa(run)
	persona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID:     owner,
		DisplayName: "PG Twin Consent " + itoa(run),
		PersonaType: aipersona.PersonaTypeUserTwin,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}
	consent, err := personaSvc.GrantConsent(ctx, persona.ID, owner, aipersona.ConsentVisualAndVoice, nil)
	if err != nil {
		t.Fatalf("GrantConsent: %v", err)
	}

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/prov_consent_" + itoa(run) + ".png",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	if code := pgMarkReady(t, svc, ctx, owner, assetID); code != "" {
		t.Fatalf("a consented USER_TWIN asset must publish, got %s", code)
	}
	asset, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.ProcessingStatus != "READY" {
		t.Fatalf("ProcessingStatus: got %q, want READY", asset.ProcessingStatus)
	}
	if asset.LikenessConsentID != consent.ID {
		t.Fatalf("LikenessConsentID: got %q, want %q — 盖章没有落库（UPDATE 漏了这一列）", asset.LikenessConsentID, consent.ID)
	}
}

// 7. 反向用例：CREATIVE 分身没有真人 likeness，不需要同意，必须照常发布。
// 没有这一条，第 5 条可以被「凡 AI_PERSONA 一律拒绝」蒙过去。
func TestMediaCreativePersonaPublishesWithoutConsent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)
	personaSvc := pgPersonaService()
	svc.WithAIPersonaService(personaSvc)

	run := time.Now().UnixNano()
	owner := "business_media_prov_creative_" + itoa(run)
	persona, err := personaSvc.CreatePersona(ctx, aipersona.Persona{
		OwnerID:     owner,
		DisplayName: "PG Concierge " + itoa(run),
		PersonaType: aipersona.PersonaTypeCreative,
	})
	if err != nil {
		t.Fatalf("CreatePersona: %v", err)
	}

	assetID := pgCreateAsset(t, svc, ctx, owner, map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": "media/pg/prov_creative_" + itoa(run) + ".png",
		"mimeType":           "image/png",
		"aiGenerationSource": "AI_PERSONA",
		"personaId":          persona.ID,
		"subjectId":          owner,
	})
	t.Cleanup(func() { cleanupMediaPG(t, pool, []string{assetID}) })

	if code := pgMarkReady(t, svc, ctx, owner, assetID); code != "" {
		t.Fatalf("a CREATIVE persona asset has no real-person likeness and must publish, got %s", code)
	}
	asset, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.LikenessConsentID != "" {
		t.Fatalf("CREATIVE persona must not stamp a consent id, got %q", asset.LikenessConsentID)
	}
	if asset.AIGenerationSource != "AI_PERSONA" || asset.PersonaID != persona.ID {
		t.Fatalf("CREATIVE asset must keep its AI provenance: %+v", asset)
	}
}
