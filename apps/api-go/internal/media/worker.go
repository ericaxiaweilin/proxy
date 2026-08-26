package media

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"
)

var (
	ErrProcessingJobNotFound   = errors.New("media processing job not found")
	ErrProcessingJobNotClaimed = errors.New("media processing job is not claimed by this worker")
)

const videoRecipeVersion = "video_recipe_v1"

func processingJobFor(asset MediaAsset, now time.Time) ProcessingJob {
	recipe := imageRecipeVersion
	if asset.MediaType == "VIDEO" {
		recipe = videoRecipeVersion
	}
	return ProcessingJob{
		JobID: "mpj_" + asset.MediaAssetID + "_" + recipe, MediaAssetID: asset.MediaAssetID,
		RecipeVersion: recipe, Status: "PENDING", AvailableAt: now.UTC(),
	}
}

func (r *MemoryRepository) EnqueueProcessingJob(_ context.Context, job ProcessingJob) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.jobs[job.JobID]; ok {
		if existing.job.Status == "COMPLETED" || existing.job.Status == "PROCESSING" || existing.job.Status == "PENDING" {
			return nil
		}
		existing.job.Status = "PENDING"
		existing.job.AvailableAt = job.AvailableAt
		existing.job.LastError = ""
		existing.worker = ""
		r.jobs[job.JobID] = existing
		return nil
	}
	r.jobs[job.JobID] = memoryProcessingJob{job: job}
	return nil
}

func (r *MemoryRepository) ClaimProcessingJobs(_ context.Context, workerID string, limit int, now time.Time) ([]ProcessingJob, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]ProcessingJob, 0, limit)
	for id, record := range r.jobs {
		if len(result) >= limit || (record.job.Status != "PENDING" && record.job.Status != "FAILED") || record.job.AvailableAt.After(now) {
			continue
		}
		record.job.Status = "PROCESSING"
		record.job.Attempts++
		record.worker = workerID
		r.jobs[id] = record
		result = append(result, record.job)
	}
	return result, nil
}

func (r *MemoryRepository) MarkProcessingJobCompleted(_ context.Context, workerID, jobID string, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.jobs[jobID]
	if !ok {
		return ErrProcessingJobNotFound
	}
	if record.worker != workerID || record.job.Status != "PROCESSING" {
		return ErrProcessingJobNotClaimed
	}
	record.job.Status = "COMPLETED"
	record.worker = ""
	r.jobs[jobID] = record
	return nil
}

func (r *MemoryRepository) MarkProcessingJobFailed(_ context.Context, workerID, jobID, reason string, next time.Time, deadLetter bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.jobs[jobID]
	if !ok {
		return ErrProcessingJobNotFound
	}
	if record.worker != workerID || record.job.Status != "PROCESSING" {
		return ErrProcessingJobNotClaimed
	}
	record.job.Status = "FAILED"
	if deadLetter {
		record.job.Status = "DEAD_LETTER"
	}
	record.job.AvailableAt = next.UTC()
	record.job.LastError = reason
	record.worker = ""
	r.jobs[jobID] = record
	return nil
}

// ProcessAssetNow is worker-only. It is intentionally not routed as an HTTP
// operation: the API owns upload admission, while this method owns expensive
// derivative generation and the PROCESSING -> READY transition.
func (s *Service) ProcessAssetNow(ctx context.Context, mediaAssetID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	asset, err := s.repository.GetAsset(ctx, mediaAssetID)
	if err != nil {
		return err
	}
	if asset.ProcessingStatus == "READY" {
		return nil
	}
	if asset.ProcessingStatus != "PROCESSING" {
		return fmt.Errorf("asset %s is %s: %w", mediaAssetID, asset.ProcessingStatus, ErrStatusTransition)
	}
	originalPath := filepath.Join(s.storeDir, asset.OriginalStorageKey)
	if asset.MediaType == "IMAGE" {
		if err := validateQuarantinedImage(ctx, originalPath, asset); err != nil {
			return err
		}
		now := s.clock.Now().UTC()
		// v1 派生（兑底，不可去）。v1 失败 → 阻塞。
		v1Variants, err := generateImageVariants(ctx, originalPath, s.storeDir, asset, now)
		if err != nil {
			return err
		}
		for _, variant := range v1Variants {
			if err := s.repository.UpsertVariant(ctx, variant); err != nil {
				return err
			}
		}
		// v2 派生（带 compositionHint）。v2 失败 → 仅该档 FAILED，不阻塞 READY。
		// 客户端拿 v2 URL 404 时自动兑落到 v1（v1 FEED_1X 还在）。
		v2Variants, v2Err := generateImageVariantsV2(ctx, originalPath, s.storeDir, asset, asset.CompositionHint, now)
		if v2Err != nil {
			s.recordVariantFailure(ctx, asset.MediaAssetID, "v2_derivation_failed", v2Err.Error())
		} else {
			for _, variant := range v2Variants {
				if err := s.repository.UpsertVariant(ctx, variant); err != nil {
					s.recordVariantFailure(ctx, asset.MediaAssetID, variant.MediaVariantID, err.Error())
					continue
				}
			}
		}
		asset.ProcessingStatus = "READY"
		asset.ModerationStatus = "APPROVED"
		asset.PlaybackStorageKey = asset.OriginalStorageKey
		asset.ThumbnailStorageKey = variantStorageKey(v1Variants, "FEED_1X", asset.OriginalStorageKey)
		asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
		asset.ThumbnailURL = variantURL(v1Variants, "FEED_1X", "/v1/media/thumb/"+asset.MediaAssetID)
		asset.UpdatedAt = now
		return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
	}
	if s.processor == nil {
		asset.ProcessingStatus = "READY"
		asset.ModerationStatus = "APPROVED"
		asset.PlaybackStorageKey = asset.OriginalStorageKey
		asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
		asset.ThumbnailURL = "/v1/media/thumb/" + asset.MediaAssetID
		asset.UpdatedAt = s.clock.Now().UTC()
		return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
	}
	result, err := s.processor.Process(ctx, originalPath)
	if err != nil {
		return err
	}
	asset.ProcessingStatus = "READY"
	asset.ModerationStatus = "APPROVED"
	asset.PlaybackStorageKey = result.PlaybackStorageKey
	asset.ThumbnailStorageKey = result.ThumbnailStorageKey
	asset.Width = result.Metadata.Width
	asset.Height = result.Metadata.Height
	asset.DurationMs = result.Metadata.DurationMs
	asset.Codec = result.Metadata.Codec
	asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
	asset.ThumbnailURL = "/v1/media/thumb/" + asset.MediaAssetID
	asset.UpdatedAt = s.clock.Now().UTC()
	return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
}

func (s *Service) MarkAssetProcessingFailed(ctx context.Context, mediaAssetID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, err := s.repository.GetAsset(ctx, mediaAssetID)
	if err != nil {
		return err
	}
	if asset.ProcessingStatus == "FAILED" {
		return nil
	}
	if asset.ProcessingStatus != "PROCESSING" {
		return ErrStatusTransition
	}
	asset.ProcessingStatus = "FAILED"
	asset.ModerationStatus = "REJECTED_TECHNICAL"
	asset.UpdatedAt = s.clock.Now().UTC()
	return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
}

type Worker struct {
	Repository  ProcessingJobRepository
	Service     *Service
	WorkerID    string
	BatchSize   int
	MaxAttempts int
	Clock       func() time.Time
}

func (w Worker) RunOnce(ctx context.Context) (int, error) {
	if w.Repository == nil || w.Service == nil {
		return 0, errors.New("media worker dependencies are not configured")
	}
	if w.WorkerID == "" {
		w.WorkerID = "proxy-media-worker"
	}
	if w.BatchSize <= 0 {
		w.BatchSize = 4
	}
	if w.MaxAttempts <= 0 {
		w.MaxAttempts = 5
	}
	now := time.Now().UTC()
	if w.Clock != nil {
		now = w.Clock().UTC()
	}
	jobs, err := w.Repository.ClaimProcessingJobs(ctx, w.WorkerID, w.BatchSize, now)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, job := range jobs {
		if err := w.Service.ProcessAssetNow(ctx, job.MediaAssetID); err != nil {
			deadLetter := job.Attempts >= w.MaxAttempts
			if deadLetter {
				_ = w.Service.MarkAssetProcessingFailed(ctx, job.MediaAssetID)
			}
			next := now.Add(mediaBackoff(job.Attempts))
			if markErr := w.Repository.MarkProcessingJobFailed(ctx, w.WorkerID, job.JobID, err.Error(), next, deadLetter); markErr != nil {
				return processed, markErr
			}
			continue
		}
		if err := w.Repository.MarkProcessingJobCompleted(ctx, w.WorkerID, job.JobID, now); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func mediaBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	return time.Duration(1<<uint(attempt-1)) * time.Second
}

// recordVariantFailure 记录单档 variant 失败（仅日志，v2 兑底足够；后续接 metrics）。
func (s *Service) recordVariantFailure(_ context.Context, assetID, variantID, reason string) {
	if s.logger != nil {
		s.logger.Printf("media variant failed: asset=%s variant=%s reason=%s", assetID, variantID, reason)
	}
}
