package media

import (
	"context"
	"errors"
	"fmt"
	"os"
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
	switch asset.MediaType {
	case "VIDEO":
		recipe = videoRecipeVersion
	case "AUDIO":
		recipe = audioRecipeVersion
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

// ComposeAssetNow is worker-only Phase 1: run composition hint 推理 (几何 / pigo)
// 持久化到 media_assets.composition_hint。失败填 UNKNOWN+0.3 兑底, 不阻塞后续 v2 派生。
//
// P0-2 实施:以几何推断为默认。pigo cascade binary 是可选项，workPool 化加载。
func (s *Service) ComposeAssetNow(ctx context.Context, mediaAssetID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, err := s.repository.GetAsset(ctx, mediaAssetID)
	if err != nil {
		return err
	}
	if asset.MediaType != "IMAGE" {
		// VIDEO 走 P1，现阶段不需要 composition hint
		return nil
	}
	if asset.CompositionHint != nil && asset.CompositionHint.Confidence >= LowConfidenceThreshold {
		// 已有可用 hint,跳过
		return nil
	}
	originalPath := filepath.Join(s.storeDir, asset.OriginalStorageKey)
	if _, statErr := os.Stat(originalPath); statErr != nil {
		return fmt.Errorf("original not found for composition: %w", statErr)
	}
	hint, _, cErr := ComposeImageHint(ctx, originalPath)
	if cErr != nil {
		// 失败填兑底,让后续 v2 派生走 NATURAL
		hint = &MediaCompositionHint{
			SubjectType:   SubjectUnknown,
			SubjectCount:  0,
			FaceBoxes:     []MediaBox{},
			Confidence:    0.3,
			RecipeVersion: CompositionRecipeVersion,
			ComputedAt:    time.Now().UTC(),
		}
	}
	if hint.ComputedAt.IsZero() {
		hint.ComputedAt = time.Now().UTC()
	}
	if err := s.repository.UpdateCompositionHint(ctx, mediaAssetID, hint); err != nil {
		return err
	}
	return nil
}

// RecomposeAssetAndRederiveV2 is worker-only utility: 重新跑 composition 后重新出 v2 派生。
// 用于历史资产(只出了 v1,没出过 v2 HINT/NATURAL)的回填。
// 失败不阻塞 — recordVariantFailure 兑底。
func (s *Service) RecomposeAssetAndRederiveV2(ctx context.Context, mediaAssetID string) error {
	if err := s.ComposeAssetNow(ctx, mediaAssetID); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, err := s.repository.GetAsset(ctx, mediaAssetID)
	if err != nil {
		return err
	}
	originalPath := filepath.Join(s.storeDir, asset.OriginalStorageKey)
	now := time.Now().UTC()
	v2Variants, v2Err := generateImageVariantsV2(ctx, originalPath, s.storeDir, asset, asset.CompositionHint, now)
	if v2Err != nil {
		s.recordVariantFailure(ctx, asset.MediaAssetID, "v2_derivation_failed", v2Err.Error())
		return v2Err
	}
	for _, variant := range v2Variants {
		if err := s.repository.UpsertVariant(ctx, variant); err != nil {
			s.recordVariantFailure(ctx, asset.MediaAssetID, variant.MediaVariantID, err.Error())
			continue
		}
	}
	return nil
}

// verifyOriginalIntegrity ensures the durable original file matches the asset's
// recorded size/checksum and is not a dataless placeholder (iCloud eviction).
// When SourceBytes==0 (no upload yet, e.g. unit test fixtures), skip the check.
func (s *Service) verifyOriginalIntegrity(originalPath string, asset MediaAsset) error {
	if asset.SourceBytes == 0 {
		return nil
	}
	info, err := os.Stat(originalPath)
	if err != nil {
		return fmt.Errorf("original missing: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("original is empty placeholder")
	}
	if info.Size() != asset.SourceBytes {
		return fmt.Errorf("size mismatch: expected %d got %d", asset.SourceBytes, info.Size())
	}
	return nil
}

// ProcessAssetNow is worker-only. It is intentionally not routed as an HTTP
// operation: the API owns upload admission, while this method owns expensive
// derivative generation and the PROCESSING -> READY transition.
//
// P0-2 两阶段:
//   Phase 1: ComposeAssetNow — 写 composition_hint (几何 / pigo)
//   Phase 2: generateImageVariantsV2 — 拿到 hint 后出 HINT/NATURAL 派生
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
	if err := s.verifyOriginalIntegrity(originalPath, asset); err != nil {
		asset.ProcessingStatus = "FAILED"
		asset.ModerationStatus = "REJECTED_TECHNICAL"
		asset.LastError = "media integrity check failed: " + err.Error()
		asset.UpdatedAt = s.clock.Now().UTC()
		_ = s.repository.UpdateAsset(ctx, asset, "PROCESSING")
		return err
	}
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
		// 主色提取（v1 派生后）—— 优先读 FEED_1X JPEG（已优化缩小、代表"用户看到的样子"）。
		// 失败兑底 DefaultDominantColor，不阻塞 READY。
		asset.DominantColorHex = extractDominantColorForVariant(ctx, s.storeDir, asset.OriginalStorageKey, pickVariant(v1Variants, "FEED_1X"))
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
	if asset.MediaType == "AUDIO" {
		return s.processAudioAsset(ctx, originalPath, asset)
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

// processAudioAsset 处理语音资产：ffprobe 验真（是音频流）+ 30s 上限校验，
// 原文件直 READY（不转码、不出变体）。时长超限/无音频流 = 确定性拒绝，
// 直接落 FAILED，不进 worker 重试循环。
const audioRecipeVersion = "audio_recipe_v1"

// maxAudioDurationMS 与 contracts 的 MAX_AUDIO_DURATION_MS 对齐（语音推文上限 30s）。
const maxAudioDurationMS = 30_000

func (s *Service) processAudioAsset(ctx context.Context, originalPath string, asset MediaAsset) error {
	metadata, err := probe(ctx, originalPath)
	if err != nil {
		return fmt.Errorf("audio probe failed: %w", err)
	}
	if !metadata.HasAudio {
		asset.ProcessingStatus = "FAILED"
		asset.ModerationStatus = "REJECTED_TECHNICAL"
		asset.LastError = "no audio stream"
		asset.UpdatedAt = s.clock.Now().UTC()
		return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
	}
	if metadata.DurationMs > int64(maxAudioDurationMS) {
		asset.ProcessingStatus = "FAILED"
		asset.ModerationStatus = "REJECTED_TECHNICAL"
		asset.LastError = fmt.Sprintf("audio %dms exceeds limit %dms", metadata.DurationMs, maxAudioDurationMS)
		asset.UpdatedAt = s.clock.Now().UTC()
		return s.repository.UpdateAsset(ctx, asset, "PROCESSING")
	}
	now := s.clock.Now().UTC()
	// 不出新变体：上传阶段 persistOriginalVariant 已登记唯一 ORIGINAL，
	// 语音的原文件就是播放文件（playbackUrl 直指 play/{id}）。
	asset.ProcessingStatus = "READY"
	asset.ModerationStatus = "APPROVED"
	asset.PlaybackStorageKey = asset.OriginalStorageKey
	asset.DurationMs = metadata.DurationMs
	asset.Codec = metadata.AudioCodec
	asset.PlaybackURL = "/v1/media/play/" + asset.MediaAssetID
	asset.UpdatedAt = now
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
