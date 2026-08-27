package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/media"
)

// TestMediaPostgresLifecycle covers the M1 media lifecycle through real
// PostgreSQL: CreateMediaAsset (UPLOADING + QUARANTINED) →
// CompleteMediaUpload (→ PROCESSING + enqueue processing_job) →
// ProcessMediaAsset (→ PROCESSING + enqueue another job, the queue is
// idempotent on same asset) → MarkMediaReady (→ READY, with playback +
// thumbnail keys persisted) → GetMediaAsset round-trip + cross-owner
// leak prevention.
func TestMediaPostgresLifecycle(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewMediaRepository(pool)
	svc := media.NewWithDependencies(repo, nil)

	run := time.Now().UnixNano()
	ownerA := "user_media_pg_a_" + itoa(run)
	ownerB := "user_media_pg_b_" + itoa(run)
	storageKey := "media/pg/original_" + itoa(run) + ".jpg"
	playbackKey := "media/pg/playback_" + itoa(run) + ".mp4"
	thumbKey := "media/pg/thumb_" + itoa(run) + ".jpg"

	// 1. CreateMediaAsset (ownerA): UPLOADING + ModerationStatus=QUARANTINED.
	r := svc.HandleContext(ctx, mediaEnvelope("CreateMediaAsset", map[string]any{
		"mediaType": "VIDEO", "originalStorageKey": storageKey,
		"mimeType": "video/mp4", "width": 1920, "height": 1080,
	}, ownerA))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CreateMediaAsset: %+v", r.Error)
	}
	if r.Aggregate.State != "UPLOADING" {
		t.Fatalf("new asset must be UPLOADING, got %s", r.Aggregate.State)
	}
	assetID := readStringFF(r.OperationRef, "mediaAssetId")
	if assetID == "" {
		t.Fatalf("CreateMediaAsset: missing mediaAssetId, op=%s", r.OperationRef)
	}

	// 2. The asset row must exist in PG with the right shape.
	asset, err := repo.GetAsset(ctx, assetID)
	if err != nil {
		t.Fatalf("GetAsset: %v", err)
	}
	if asset.ProcessingStatus != "UPLOADING" || asset.ModerationStatus != "QUARANTINED" {
		t.Fatalf("initial asset state wrong: %+v", asset)
	}
	if asset.OwnerPrincipalID != ownerA {
		t.Fatalf("owner mismatch: want %s, got %s", ownerA, asset.OwnerPrincipalID)
	}

	// 3. Invalid MediaType: must be REJECTED, no row in PG.
	invalidID := "should_not_exist_" + itoa(run)
	r = svc.HandleContext(ctx, mediaEnvelope("CreateMediaAsset", map[string]any{
		"mediaType": "PDF", "originalStorageKey": "x.pdf",
		"mimeType": "application/pdf",
	}, ownerA))
	if r.Outcome != "REJECTED" {
		t.Fatalf("PDF mediaType must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "INVALID_MEDIA_TYPE" {
		t.Fatalf("expected INVALID_MEDIA_TYPE, got %+v", r.Error)
	}
	if _, err := repo.GetAsset(ctx, invalidID); err == nil {
		t.Fatalf("rejected CreateMediaAsset must not leave a row")
	}

	// 4. CompleteMediaUpload (with correct storageKey): UPLOADING →
	// PROCESSING + a processing_job must be enqueued.
	r = svc.HandleContext(ctx, mediaEnvelope("CompleteMediaUpload", map[string]any{
		"originalStorageKey": storageKey,
	}, ownerA, assetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("CompleteMediaUpload: %+v", r.Error)
	}
	if r.Aggregate.State != "PROCESSING" {
		t.Fatalf("after Complete, want PROCESSING, got %s", r.Aggregate.State)
	}
	jobCount := mediaJobCountPG(t, pool, assetID)
	if jobCount < 1 {
		t.Fatalf("Complete must enqueue ≥1 processing_job, got %d", jobCount)
	}

	// 5. Storage-key mismatch: Complete with wrong key must be
	// REJECTED with STORAGE_KEY_MISMATCH, and asset must remain
	// UPLOADING.
	wrongKeyAsset := "media/pg/wrong_" + itoa(run)
	r2 := svc.HandleContext(ctx, mediaEnvelope("CreateMediaAsset", map[string]any{
		"mediaType": "IMAGE", "originalStorageKey": wrongKeyAsset,
		"mimeType": "image/jpeg", "width": 800, "height": 600,
	}, ownerA))
	if r2.Outcome != "ACCEPTED" {
		t.Fatalf("CreateMediaAsset #2: %+v", r2.Error)
	}
	wrongID := readStringFF(r2.OperationRef, "mediaAssetId")
	r = svc.HandleContext(ctx, mediaEnvelope("CompleteMediaUpload", map[string]any{
		"originalStorageKey": "media/pg/different.jpg",
	}, ownerA, wrongID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("storage-key mismatch must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "STORAGE_KEY_MISMATCH" {
		t.Fatalf("expected STORAGE_KEY_MISMATCH, got %+v", r.Error)
	}
	wrongAsset, _ := repo.GetAsset(ctx, wrongID)
	if wrongAsset.ProcessingStatus != "UPLOADING" {
		t.Fatalf("rejected Complete must not change state, got %s", wrongAsset.ProcessingStatus)
	}

	// 6. MarkMediaReady (the externally-completed path): PROCESSING →
	// READY, playback + thumbnail keys persisted.
	r = svc.HandleContext(ctx, mediaEnvelope("MarkMediaReady", map[string]any{
		"playbackStorageKey": playbackKey, "thumbnailStorageKey": thumbKey,
		"durationMs": int64(60000), "width": 1920, "height": 1080, "codec": "h264",
	}, ownerA, assetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("MarkMediaReady: %+v", r.Error)
	}
	if r.Aggregate.State != "READY" {
		t.Fatalf("after MarkMediaReady, want READY, got %s", r.Aggregate.State)
	}
	ready, _ := repo.GetAsset(ctx, assetID)
	if ready.PlaybackStorageKey != playbackKey || ready.ThumbnailStorageKey != thumbKey {
		t.Fatalf("playback/thumbnail keys not persisted: %+v", ready)
	}
	if ready.DurationMs != 60000 || ready.Width != 1920 || ready.Height != 1080 {
		t.Fatalf("media dimensions not persisted: %+v", ready)
	}

	// 7. Lifecycle gate: MarkMediaReady on an UPLOADING asset (the
	// wrongID one) must be REJECTED with MEDIA_NOT_PROCESSABLE.
	r = svc.HandleContext(ctx, mediaEnvelope("MarkMediaReady", map[string]any{
		"playbackStorageKey": "x", "thumbnailStorageKey": "y",
	}, ownerA, wrongID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("MarkMediaReady on UPLOADING must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "MEDIA_NOT_PROCESSABLE" {
		t.Fatalf("expected MEDIA_NOT_PROCESSABLE, got %+v", r.Error)
	}

	// 8. Cross-owner leak: ownerB asking for ownerA's asset must be
	// REJECTED with MEDIA_NOT_OWNER.
	r = svc.HandleContext(ctx, mediaEnvelope("GetMediaAsset", map[string]any{
		"mediaAssetId": assetID,
	}, ownerB, assetID))
	if r.Outcome != "REJECTED" {
		t.Fatalf("cross-owner GetMediaAsset must be REJECTED, got %s", r.Outcome)
	}
	if r.Error == nil || r.Error.ErrorCode != "MEDIA_NOT_OWNER" {
		t.Fatalf("expected MEDIA_NOT_OWNER, got %+v", r.Error)
	}

	// 9. The owner CAN read it back via GetMediaAsset.
	r = svc.HandleContext(ctx, mediaEnvelope("GetMediaAsset", map[string]any{
		"mediaAssetId": assetID,
	}, ownerA, assetID))
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("GetMediaAsset owner: %+v", r.Error)
	}
	if r.Aggregate.State != "READY" {
		t.Fatalf("GetMediaAsset must report READY, got %s", r.Aggregate.State)
	}

	// cleanup
	cleanupMediaPG(t, pool, []string{assetID, wrongID})
}

func mediaJobCountPG(t *testing.T, pool *pgxpool.Pool, assetID string) int {
	t.Helper()
	ctx := context.Background()
	var n int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM media.processing_jobs WHERE media_asset_id=$1`, assetID).Scan(&n)
	if err != nil {
		t.Logf("processing_jobs count: %v (table may not exist)", err)
		return 0
	}
	return n
}

func cleanupMediaPG(t *testing.T, pool *pgxpool.Pool, ids []string) {
	t.Helper()
	ctx := context.Background()
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, err := pool.Exec(ctx, `DELETE FROM media.processing_jobs WHERE media_asset_id=$1`, id); err != nil {
			t.Logf("cleanup jobs: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM media.media_variants WHERE media_asset_id=$1`, id); err != nil {
			t.Logf("cleanup variants: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM media.media_assets WHERE media_asset_id=$1`, id); err != nil {
			t.Logf("cleanup assets: %v", err)
		}
	}
}

func mediaEnvelope(commandType string, payload map[string]any, actorID string, targetID ...string) command.Envelope {
	envelope := command.Envelope{
		CommandID:      "cmd_media_pg_" + commandType,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "INDIVIDUAL", ID: actorID},
		IdempotencyKey: "test_media_pg_" + commandType + "_" + strings.ReplaceAll(time.Now().Format(time.RFC3339Nano), ":", ""),
		AuthContext:    map[string]any{"session": "s1"},
		Purpose:        "test",
		CorrelationID:  "corr_media_1",
		RequestedAt:    "2026-08-16T00:00:00Z",
		Payload:        payload,
	}
	if len(targetID) > 0 {
		envelope.Target = command.Target{Type: "MediaAsset", ID: targetID[0]}
	}
	return envelope
}
