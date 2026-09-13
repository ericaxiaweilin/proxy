package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/media"
)

func fileExists(storeDir, key string) bool {
	if key == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(storeDir, key))
	return err == nil && info.Mode().IsRegular()
}

type consistencyReport struct {
	variants      int
	missingVarIDs []string
	missingAssets []string
	// readyByAsset: assets that still have at least one READY variant. Used so
	// a missing thumbnail alone does not condemn an asset.
	readyByAsset map[string]int
}

// scanConsistency is the MEDIA-FILE-001 consistency sweep.
//
// The database records an object as READY when its bytes were written, and
// nothing keeps that flag in sync afterwards. A file can vanish (manual
// cleanup, a partial restore, a moved data directory) while the row stays
// READY, and the server happily hands the client a URL that will 404 — which
// the client renders as a black frame, indistinguishable from "this post has
// no image". That is exactly how 104 of 528 READY variants (19.7%, across 27
// assets) went missing and nobody noticed until the feed looked broken.
func scanConsistency(ctx context.Context, pool *pgxpool.Pool, mediaStoreDir string) consistencyReport {
	report := consistencyReport{readyByAsset: map[string]int{}}
	rows, err := pool.Query(ctx, `
		SELECT media_variant_id, media_asset_id, purpose, storage_key
		FROM media.media_variants WHERE status = 'READY'`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var variantID, assetID, purpose, key string
		if err := rows.Scan(&variantID, &assetID, &purpose, &key); err != nil {
			panic(err)
		}
		report.variants++
		if fileExists(mediaStoreDir, key) {
			report.readyByAsset[assetID]++
			continue
		}
		report.missingVarIDs = append(report.missingVarIDs, variantID)
		if key == "" {
			fmt.Printf("MISSING-VARIANT %s | asset=%s | purpose=%s | storage_key empty\n", variantID, assetID, purpose)
		} else {
			fmt.Printf("MISSING-VARIANT %s | asset=%s | purpose=%s | file=%s\n", variantID, assetID, purpose, key)
		}
	}
	if err := rows.Err(); err != nil {
		panic(err)
	}
	// An asset is only broken when it has NOTHING servable left: no thumbnail
	// file, no playback file, and no READY variant whose bytes survived. A
	// missing thumbnail alone is fine — the read model falls back to the feed
	// or gallery derivative, which is the whole point of MEDIA-FILE-001.
	assets, err := pool.Query(ctx, `
		SELECT a.media_asset_id, a.processing_status, a.thumbnail_storage_key, a.playback_storage_key,
			COUNT(v.media_variant_id) FILTER (WHERE v.status = 'READY') AS ready_variants
		FROM media.media_assets a
		LEFT JOIN media.media_variants v ON v.media_asset_id = a.media_asset_id
		WHERE a.processing_status = 'READY'
		GROUP BY a.media_asset_id, a.processing_status, a.thumbnail_storage_key, a.playback_storage_key`)
	if err != nil {
		panic(err)
	}
	defer assets.Close()
	for assets.Next() {
		var assetID, status, thumb, playback string
		var readyVariants int64
		if err := assets.Scan(&assetID, &status, &thumb, &playback, &readyVariants); err != nil {
			panic(err)
		}
		if fileExists(mediaStoreDir, thumb) || fileExists(mediaStoreDir, playback) || readyVariants > 0 {
			continue
		}
		report.missingAssets = append(report.missingAssets, assetID)
		fmt.Printf("MISSING-ASSET %s | status=%s | thumb=%s | playback=%s | ready_variants=%d\n",
			assetID, status, thumb, playback, readyVariants)
	}
	if err := assets.Err(); err != nil {
		panic(err)
	}
	return report
}

func (r consistencyReport) broken() bool {
	return len(r.missingVarIDs) > 0 || len(r.missingAssets) > 0
}

// checkFiles fails when any READY object has no bytes behind it.
func checkFiles(ctx context.Context, pool *pgxpool.Pool, mediaStoreDir string) int {
	report := scanConsistency(ctx, pool, mediaStoreDir)
	fmt.Printf("media file consistency: variants=%d missing=%d assets-missing=%d\n",
		report.variants, len(report.missingVarIDs), len(report.missingAssets))
	if report.broken() {
		fmt.Println("FAIL: READY media objects without bytes. Run: go run ./cmd/media-audit --quarantine-missing")
		fmt.Println("      See docs/development/MEDIA_STORE_CONSISTENCY.md §3")
		return 1
	}
	return 0
}

// quarantineMissing makes the database tell the truth about objects whose
// bytes are gone: the variant row becomes REMOVED and an asset with nothing
// servable left becomes FAILED. Both are existing CHECK-constraint values, so
// no migration is needed. Status-only — no row and no file is deleted, and
// the IDs are printed so the change can be reviewed or reverted.
func quarantineMissing(ctx context.Context, pool *pgxpool.Pool, mediaStoreDir string) int {
	report := scanConsistency(ctx, pool, mediaStoreDir)
	if !report.broken() {
		fmt.Println("media file consistency: nothing to quarantine")
		return 0
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		panic(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, id := range report.missingVarIDs {
		if _, err := tx.Exec(ctx,
			`UPDATE media.media_variants SET status = 'REMOVED', updated_at = now() WHERE media_variant_id = $1`, id); err != nil {
			panic(err)
		}
		fmt.Printf("QUARANTINED-VARIANT %s -> REMOVED\n", id)
	}
	for _, id := range report.missingAssets {
		if _, err := tx.Exec(ctx,
			`UPDATE media.media_assets SET processing_status = 'FAILED', updated_at = now() WHERE media_asset_id = $1`, id); err != nil {
			panic(err)
		}
		fmt.Printf("QUARANTINED-ASSET %s -> FAILED\n", id)
	}
	if err := tx.Commit(ctx); err != nil {
		panic(err)
	}
	fmt.Printf("quarantined: variants=%d assets=%d\n", len(report.missingVarIDs), len(report.missingAssets))
	return 0
}

func main() {
	ctx := context.Background()
	mediaStoreDir, err := media.ResolveLocalStoreDir(os.Getenv("PROXY_MEDIA_STORE_DIR"))
	if err != nil {
		panic(err)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://proxy:proxy@localhost:5432/proxy"
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		panic(err)
	}
	defer pool.Close()
	if len(os.Args) > 1 && os.Args[1] == "--repair-legacy-published" {
		migration, err := os.ReadFile("migrations/024_restore_legacy_published_media.sql")
		if err != nil {
			panic(err)
		}
		tag, err := pool.Exec(ctx, string(migration))
		if err != nil {
			panic(err)
		}
		fmt.Printf("legacy published media repaired: %d rows\n", tag.RowsAffected())
	}
	if len(os.Args) > 1 && os.Args[1] == "--check-files" {
		os.Exit(checkFiles(ctx, pool, mediaStoreDir))
	}
	if len(os.Args) > 1 && os.Args[1] == "--quarantine-missing" {
		os.Exit(quarantineMissing(ctx, pool, mediaStoreDir))
	}
	rows, err := pool.Query(ctx, `
		SELECT p.id, p.author_id, COALESCE(p.author_display_name,''), p.body, p.media_refs::text,
			p.status, p.created_at::text,
			COALESCE(jsonb_agg(jsonb_build_object(
				'id', m.media_asset_id, 'status', m.processing_status,
				'moderation', m.moderation_status, 'original', m.original_storage_key,
				'playback', m.playback_storage_key, 'thumb', m.thumbnail_storage_key
			)) FILTER (WHERE m.media_asset_id IS NOT NULL), '[]'::jsonb)::text
		FROM localnet.posts p
		LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.media_refs) = 'array' THEN p.media_refs ELSE '[]'::jsonb END) ref ON true
		LEFT JOIN media.media_assets m ON m.media_asset_id = ref->>'mediaAssetId'
		GROUP BY p.id, p.author_id, p.author_display_name, p.body, p.media_refs, p.status, p.created_at
		ORDER BY p.created_at DESC`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, authorID, authorName, body, refs, status, created, assets string
		if err := rows.Scan(&id, &authorID, &authorName, &body, &refs, &status, &created, &assets); err != nil {
			panic(err)
		}
		fmt.Printf("POST %s | %s (%s) | %s | %s\nBODY %s\nREFS %s\nASSETS %s\n\n", id, authorName, authorID, status, created, body, refs, assets)
	}
	if err := rows.Err(); err != nil {
		panic(err)
	}
	fmt.Println("RECENT MEDIA ASSETS")
	mediaRows, err := pool.Query(ctx, `
		SELECT media_asset_id, owner_principal_id, processing_status, moderation_status,
			visibility_class, original_storage_key, created_at::text
		FROM media.media_assets ORDER BY created_at DESC LIMIT 20`)
	if err != nil {
		panic(err)
	}
	defer mediaRows.Close()
	for mediaRows.Next() {
		var id, owner, processing, moderation, visibility, original, created string
		if err := mediaRows.Scan(&id, &owner, &processing, &moderation, &visibility, &original, &created); err != nil {
			panic(err)
		}
		_, statErr := os.Stat(filepath.Join(mediaStoreDir, original))
		fmt.Printf("MEDIA %s | %s | %s/%s/%s | file=%t | %s | %s\n", id, owner, processing, moderation, visibility, statErr == nil, original, created)
	}
	if err := mediaRows.Err(); err != nil {
		panic(err)
	}
}
