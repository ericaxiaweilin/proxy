package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/media"
)

// MediaRepository 持久化 MediaAsset（PRD 06A：processing_status/playback/thumbnail/duration/codec）。
type MediaRepository struct {
	pool *pgxpool.Pool
}

func NewMediaRepository(pool *pgxpool.Pool) *MediaRepository {
	return &MediaRepository{pool: pool}
}

func (r *MediaRepository) CreateAsset(ctx context.Context, a media.MediaAsset) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO media.media_assets (
			media_asset_id, owner_principal_type, owner_principal_id, media_type,
			original_storage_key, playback_storage_key, thumbnail_storage_key,
			mime_type, width, height, duration_ms, codec,
			processing_status, playback_url, thumbnail_url, source_bytes, checksum_sha256,
			orientation, color_space, has_alpha, animated, moderation_status, visibility_class,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
		a.MediaAssetID, a.OwnerPrincipalType, a.OwnerPrincipalID, a.MediaType,
		a.OriginalStorageKey, a.PlaybackStorageKey, a.ThumbnailStorageKey,
		a.MimeType, a.Width, a.Height, a.DurationMs, a.Codec,
		a.ProcessingStatus, a.PlaybackURL, a.ThumbnailURL, a.SourceBytes, a.ChecksumSHA256,
		a.Orientation, a.ColorSpace, a.HasAlpha, a.Animated, a.ModerationStatus, a.VisibilityClass,
		a.CreatedAt, a.UpdatedAt,
	)
	return err
}

func (r *MediaRepository) GetAsset(ctx context.Context, id string) (media.MediaAsset, error) {
	var a media.MediaAsset
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT media_asset_id, owner_principal_type, owner_principal_id, media_type,
			original_storage_key, playback_storage_key, thumbnail_storage_key,
			mime_type, width, height, duration_ms, codec,
			processing_status, playback_url, thumbnail_url, source_bytes, checksum_sha256,
			orientation, color_space, has_alpha, animated, moderation_status, visibility_class,
			created_at, updated_at
		FROM media.media_assets WHERE media_asset_id = $1`, id).Scan(
		&a.MediaAssetID, &a.OwnerPrincipalType, &a.OwnerPrincipalID, &a.MediaType,
		&a.OriginalStorageKey, &a.PlaybackStorageKey, &a.ThumbnailStorageKey,
		&a.MimeType, &a.Width, &a.Height, &a.DurationMs, &a.Codec,
		&a.ProcessingStatus, &a.PlaybackURL, &a.ThumbnailURL, &a.SourceBytes, &a.ChecksumSHA256,
		&a.Orientation, &a.ColorSpace, &a.HasAlpha, &a.Animated, &a.ModerationStatus, &a.VisibilityClass,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return media.MediaAsset{}, media.ErrAssetNotFound
	}
	return a, err
}

func (r *MediaRepository) UpdateAsset(ctx context.Context, a media.MediaAsset, expectedStatus string) error {
	commandTag, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		UPDATE media.media_assets
		SET playback_storage_key=$1, thumbnail_storage_key=$2, mime_type=$3,
			width=$4, height=$5, duration_ms=$6, codec=$7,
			processing_status=$8, playback_url=$9, thumbnail_url=$10,
			source_bytes=$11, checksum_sha256=$12, orientation=$13, color_space=$14,
			has_alpha=$15, animated=$16, moderation_status=$17, visibility_class=$18,
			updated_at=$19
		WHERE media_asset_id=$20 AND processing_status=$21`,
		a.PlaybackStorageKey, a.ThumbnailStorageKey, a.MimeType,
		a.Width, a.Height, a.DurationMs, a.Codec,
		a.ProcessingStatus, a.PlaybackURL, a.ThumbnailURL,
		a.SourceBytes, a.ChecksumSHA256, a.Orientation, a.ColorSpace,
		a.HasAlpha, a.Animated, a.ModerationStatus, a.VisibilityClass,
		a.UpdatedAt, a.MediaAssetID, expectedStatus,
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() != 1 {
		return media.ErrStatusTransition
	}
	return nil
}

func (r *MediaRepository) Snapshot(ctx context.Context) ([]media.MediaAsset, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT media_asset_id, owner_principal_type, owner_principal_id, media_type,
			original_storage_key, playback_storage_key, thumbnail_storage_key,
			mime_type, width, height, duration_ms, codec,
			processing_status, playback_url, thumbnail_url, source_bytes, checksum_sha256,
			orientation, color_space, has_alpha, animated, moderation_status, visibility_class,
			created_at, updated_at
		FROM media.media_assets ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []media.MediaAsset{}
	for rows.Next() {
		var a media.MediaAsset
		if err := rows.Scan(
			&a.MediaAssetID, &a.OwnerPrincipalType, &a.OwnerPrincipalID, &a.MediaType,
			&a.OriginalStorageKey, &a.PlaybackStorageKey, &a.ThumbnailStorageKey,
			&a.MimeType, &a.Width, &a.Height, &a.DurationMs, &a.Codec,
			&a.ProcessingStatus, &a.PlaybackURL, &a.ThumbnailURL, &a.SourceBytes, &a.ChecksumSHA256,
			&a.Orientation, &a.ColorSpace, &a.HasAlpha, &a.Animated, &a.ModerationStatus, &a.VisibilityClass,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

var _ media.Repository = (*MediaRepository)(nil)
