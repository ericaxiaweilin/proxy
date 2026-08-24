package postgres

import (
	"context"
	"errors"
	"time"

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
			original_storage_key, COALESCE(playback_storage_key,''), COALESCE(thumbnail_storage_key,''),
			COALESCE(mime_type,''), COALESCE(width,0), COALESCE(height,0), COALESCE(duration_ms,0), COALESCE(codec,''),
			processing_status, COALESCE(playback_url,''), COALESCE(thumbnail_url,''), COALESCE(source_bytes,0), COALESCE(checksum_sha256,''),
			COALESCE(orientation,1), COALESCE(color_space,''), has_alpha, animated, moderation_status, visibility_class,
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
			original_storage_key, COALESCE(playback_storage_key,''), COALESCE(thumbnail_storage_key,''),
			COALESCE(mime_type,''), COALESCE(width,0), COALESCE(height,0), COALESCE(duration_ms,0), COALESCE(codec,''),
			processing_status, COALESCE(playback_url,''), COALESCE(thumbnail_url,''), COALESCE(source_bytes,0), COALESCE(checksum_sha256,''),
			COALESCE(orientation,1), COALESCE(color_space,''), has_alpha, animated, moderation_status, visibility_class,
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

func (r *MediaRepository) UpsertVariant(ctx context.Context, variant media.MediaVariant) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO media.media_variants (
			media_variant_id, media_asset_id, purpose, recipe_version, format,
			width, height, bytes, storage_key, content_hash, status, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (media_asset_id, purpose, recipe_version) DO UPDATE SET
			media_variant_id=EXCLUDED.media_variant_id,
			format=EXCLUDED.format, width=EXCLUDED.width, height=EXCLUDED.height,
			bytes=EXCLUDED.bytes, storage_key=EXCLUDED.storage_key,
			content_hash=EXCLUDED.content_hash, status=EXCLUDED.status,
			updated_at=EXCLUDED.updated_at`,
		variant.MediaVariantID, variant.MediaAssetID, variant.Purpose, variant.RecipeVersion,
		variant.Format, variant.Width, variant.Height, variant.Bytes, variant.StorageKey,
		variant.ContentHash, variant.Status, variant.CreatedAt, variant.UpdatedAt,
	)
	return err
}

func (r *MediaRepository) ListVariants(ctx context.Context, mediaAssetID string) ([]media.MediaVariant, error) {
	rows, err := queryerForContext(ctx, r.pool).Query(ctx, `
		SELECT media_variant_id, media_asset_id, purpose, recipe_version, format,
			width, height, COALESCE(bytes,0), storage_key, COALESCE(content_hash,''), status, created_at, updated_at
		FROM media.media_variants
		WHERE media_asset_id=$1
		ORDER BY purpose`, mediaAssetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []media.MediaVariant{}
	for rows.Next() {
		var variant media.MediaVariant
		if err := rows.Scan(
			&variant.MediaVariantID, &variant.MediaAssetID, &variant.Purpose, &variant.RecipeVersion,
			&variant.Format, &variant.Width, &variant.Height, &variant.Bytes, &variant.StorageKey,
			&variant.ContentHash, &variant.Status, &variant.CreatedAt, &variant.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, variant)
	}
	return result, rows.Err()
}

func (r *MediaRepository) GetVariant(ctx context.Context, variantID string) (media.MediaVariant, error) {
	var variant media.MediaVariant
	err := queryerForContext(ctx, r.pool).QueryRow(ctx, `
		SELECT media_variant_id, media_asset_id, purpose, recipe_version, format,
			width, height, COALESCE(bytes,0), storage_key, COALESCE(content_hash,''), status, created_at, updated_at
		FROM media.media_variants WHERE media_variant_id=$1`, variantID).Scan(
		&variant.MediaVariantID, &variant.MediaAssetID, &variant.Purpose, &variant.RecipeVersion,
		&variant.Format, &variant.Width, &variant.Height, &variant.Bytes, &variant.StorageKey,
		&variant.ContentHash, &variant.Status, &variant.CreatedAt, &variant.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return media.MediaVariant{}, media.ErrAssetNotFound
	}
	return variant, err
}

func (r *MediaRepository) EnqueueProcessingJob(ctx context.Context, job media.ProcessingJob) error {
	_, err := queryerForContext(ctx, r.pool).Exec(ctx, `
		INSERT INTO media.processing_jobs (
			job_id, media_asset_id, recipe_version, status, attempts,
			available_at, created_at, updated_at
		) VALUES ($1,$2,$3,'PENDING',0,$4,$4,$4)
		ON CONFLICT (media_asset_id, recipe_version) DO UPDATE SET
			status = CASE
				WHEN media.processing_jobs.status IN ('COMPLETED','PROCESSING','PENDING') THEN media.processing_jobs.status
				ELSE 'PENDING'
			END,
			available_at = CASE
				WHEN media.processing_jobs.status IN ('COMPLETED','PROCESSING','PENDING') THEN media.processing_jobs.available_at
				ELSE EXCLUDED.available_at
			END,
			last_error = CASE
				WHEN media.processing_jobs.status IN ('COMPLETED','PROCESSING','PENDING') THEN media.processing_jobs.last_error
				ELSE NULL
			END,
			updated_at = EXCLUDED.updated_at`,
		job.JobID, job.MediaAssetID, job.RecipeVersion, job.AvailableAt.UTC())
	return err
}

func (r *MediaRepository) ClaimProcessingJobs(ctx context.Context, workerID string, limit int, now time.Time) ([]media.ProcessingJob, error) {
	if limit <= 0 {
		return []media.ProcessingJob{}, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE media.processing_jobs
		SET status='PENDING', worker_id=NULL, processing_at=NULL, available_at=$1::timestamptz, updated_at=$1::timestamptz
		WHERE status='PROCESSING' AND processing_at < ($1::timestamptz - interval '5 minutes')`, now.UTC()); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		WITH claimed AS (
			SELECT job_id FROM media.processing_jobs
			WHERE status IN ('PENDING','FAILED') AND available_at <= $1::timestamptz
			ORDER BY available_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE media.processing_jobs jobs
		SET status='PROCESSING', attempts=jobs.attempts+1, worker_id=$3,
			processing_at=$1::timestamptz, updated_at=$1::timestamptz
		FROM claimed WHERE jobs.job_id=claimed.job_id
		RETURNING jobs.job_id, jobs.media_asset_id, jobs.recipe_version,
			jobs.status, jobs.attempts, jobs.available_at, COALESCE(jobs.last_error,'')`,
		now.UTC(), limit, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []media.ProcessingJob{}
	for rows.Next() {
		var job media.ProcessingJob
		if err := rows.Scan(&job.JobID, &job.MediaAssetID, &job.RecipeVersion, &job.Status, &job.Attempts, &job.AvailableAt, &job.LastError); err != nil {
			return nil, err
		}
		result = append(result, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *MediaRepository) MarkProcessingJobCompleted(ctx context.Context, workerID, jobID string, completedAt time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE media.processing_jobs
		SET status='COMPLETED', worker_id=NULL, processing_at=NULL, updated_at=$1
		WHERE job_id=$2 AND status='PROCESSING' AND worker_id=$3`, completedAt.UTC(), jobID, workerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return media.ErrProcessingJobNotClaimed
	}
	return nil
}

func (r *MediaRepository) MarkProcessingJobFailed(ctx context.Context, workerID, jobID, reason string, next time.Time, deadLetter bool) error {
	status := "FAILED"
	if deadLetter {
		status = "DEAD_LETTER"
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE media.processing_jobs
		SET status=$1, available_at=$2, last_error=$3, worker_id=NULL,
			processing_at=NULL, updated_at=$2
		WHERE job_id=$4 AND status='PROCESSING' AND worker_id=$5`,
		status, next.UTC(), reason, jobID, workerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return media.ErrProcessingJobNotClaimed
	}
	return nil
}

var _ media.Repository = (*MediaRepository)(nil)
var _ media.ProcessingJobRepository = (*MediaRepository)(nil)
