package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/media"
)

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
