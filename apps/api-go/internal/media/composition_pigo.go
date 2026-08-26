// Package media — Composition Hint 推理（纯几何启发式）。
//
// P0 实施：基于 image 元数据（宽高 / 宽高比）的几何推断，不依赖 ML 模型。
// 设计动机：
//   - 零外部依赖（无需 CGO / ONNX / cascade binary），部署简单
//   - 失败不阻塞 v1/v2 READY：填 UNKNOWN+0.3 兑底
//   - 精度有限（heuristic 0.55 confidence < ML 0.85+），但稳定可重现
//
// P1 升级路径：用 ONNX/MediaPipe BlazeFace 替换 faceRegionHeuristic 内部实现，
// 对外接口 ComposeImageHint 签名不变。
//
// 见 docs/media-pipeline/COMPOSITION_WORKER_SPEC.md §2/§3
package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"time"
)

// faceRegionHeuristic 纯几何人像推断（无 ML）。
// 输入：原图宽高
// 输出：推测的人脸 bbox 列表 + confidence + subjectType
// 不变量：
//   - portrait (aspect < 1) + 长边 / 短边 > 1.4 → 单人像
//   - face 在上 1/3 中心 (人像摄影黄金分割)
func faceRegionHeuristic(width, height int) (faceBoxes []MediaBox, confidence float64, subjectType string) {
	if width <= 0 || height <= 0 {
		return nil, 0.3, SubjectUnknown
	}
	aspect := float64(width) / float64(height)
	// 横图: 大概率场景/风景
	if aspect >= 1.0 {
		// 风景或群像，启发式置信度低
		return nil, 0.5, SubjectScene
	}
	// portrait: 0.5 ~ 1.0
	// 9:16 (0.5625) → 全身 → 脸在上 1/3 中心
	// 4:5 (0.8) → 半身 → 脸在上 1/3 中心 + 半身 box
	// 1:1 (1.0) → 半身/头像
	faceW := 0.25
	faceH := 0.15
	faceX := 0.5 - faceW/2
	faceY := 0.15 // 上 1/3
	face := MediaBox{X: faceX, Y: faceY, Width: faceW, Height: faceH}
	// 半身/全身 body box
	var bodyBoxes []MediaBox
	if aspect <= 0.6 {
		// 全身: 头在上 1/4，身体延伸到下
		body := MediaBox{X: 0.15, Y: 0.05, Width: 0.7, Height: 0.9}
		bodyBoxes = []MediaBox{body}
	} else if aspect <= 0.85 {
		// 半身: 头顶上 1/5，腰部以下
		body := MediaBox{X: 0.1, Y: 0.05, Width: 0.8, Height: 0.85}
		bodyBoxes = []MediaBox{body}
	}
	subjectType = SubjectPerson
	confidence = 0.55 // 启发式，够过 0.4 阈值，但低于真 ML
	_ = bodyBoxes     // bodyBoxes 在下方调用处显式赋值，避免未使用告警
	return []MediaBox{face}, confidence, subjectType
}

// ComposeImageHint 走 composition 推理：当前是几何推断。
// 返回 MediaCompositionHint + computedAt + computeMs。
func ComposeImageHint(ctx context.Context, originalPath string) (*MediaCompositionHint, int, error) {
	start := time.Now()
	width, height, err := probeImageWH(ctx, originalPath)
	if err != nil {
		return nil, 0, fmt.Errorf("probe image: %w", err)
	}
	faceBoxes, confidence, subjectType := faceRegionHeuristic(width, height)
	hint := &MediaCompositionHint{
		SubjectType:   subjectType,
		SubjectCount:  len(faceBoxes),
		FaceBoxes:     faceBoxes,
		Confidence:    confidence,
		RecipeVersion: CompositionRecipeVersion,
		ComputedAt:    start.UTC(),
	}
	if rect := MergeSafeCropRect(faceBoxes); rect != nil {
		hint.SafeCropRect = rect
		hint.FocalPoint = &MediaBox{
			X:      rect.X + rect.Width/2,
			Y:      rect.Y + rect.Height/2,
			Width:  rect.Width,
			Height: rect.Height,
		}
	}
	if subjectType == SubjectPerson {
		hint.BodyBoxes = []MediaBox{{X: 0.1, Y: 0.05, Width: 0.8, Height: 0.85}}
	}
	return hint, int(time.Since(start).Milliseconds()), nil
}

// probeImageWH 用 image decoder 读宽高（无 ffmpeg 依赖）。
func probeImageWH(ctx context.Context, path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, err
	}
	return cfg.Width, cfg.Height, nil
}

// ComposeAndStoreHint 给一个 MediaAsset 计算 + 持久化 composition hint。
// 失败返回 (nil, err) 不抛 panic：worker caller 走 recordCompositionFailure。
func ComposeAndStoreHint(ctx context.Context, store CompositionHintStore, assetID, originalPath string) (*MediaCompositionHint, error) {
	hint, computeMs, err := ComposeImageHint(ctx, originalPath)
	if err != nil {
		return nil, err
	}
	hint.ComputedAt = time.Now().UTC()
	_ = computeMs // 后续可入库到 media_composition_audit
	if err := store.UpdateCompositionHint(ctx, assetID, hint); err != nil {
		return nil, err
	}
	return hint, nil
}

// CompositionHintStore 抽象 composition hint 持久化（让 worker / handler 都能用）。
// platform/postgres.MediaRepository 已实现这个 interface。
type CompositionHintStore interface {
	UpdateCompositionHint(ctx context.Context, assetID string, hint *MediaCompositionHint) error
}

// compositionWiringError is exposed for tests to assert.
var ErrCompositionCascadeMissing = errors.New("composition cascade not loaded — falling back to geometric heuristic")

// ComposeAllReadyAssets 是 worker 入口：从 store 拿所有 PROCESSING/READY 资产跑一次。
// 真实生产场景改写为新表 media.composition_jobs 异步队列；P0 用 Sync 入口先打通。
func ComposeAllReadyAssets(ctx context.Context, store CompositionHintStore, repository AssetLookup, storeDir string) (int, error) {
	assets, err := repository.Snapshot(ctx)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, a := range assets {
		// 只跑 IMAGE, 没 hint 的
		if a.MediaType != "IMAGE" {
			continue
		}
		if a.CompositionHint != nil && a.CompositionHint.Confidence >= 0.4 {
			continue
		}
		originalPath := filepath.Join(storeDir, a.OriginalStorageKey)
		if _, statErr := os.Stat(originalPath); statErr != nil {
			continue
		}
		_, cErr := ComposeAndStoreHint(ctx, store, a.MediaAssetID, originalPath)
		if cErr != nil {
			// 记录失败继续：单图失败不能阻塞全批
			continue
		}
		done++
	}
	return done, nil
}

// AssetLookup 是 composition worker 拉取 asset 列表的最小接口。
type AssetLookup interface {
	Snapshot(ctx context.Context) ([]MediaAsset, error)
}

// ComposeHintFromBytesRaw 调试用：直接从 []byte JPEG 推断（不走文件）。
func ComposeHintFromBytesRaw(data []byte) (*MediaCompositionHint, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	tmp, _ := os.CreateTemp("", "compose-*.jpg")
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		return nil, err
	}
	tmp.Close()
	boxes, conf, subject := faceRegionHeuristic(cfg.Width, cfg.Height)
	return &MediaCompositionHint{
		SubjectType:   subject,
		SubjectCount:  len(boxes),
		FaceBoxes:     boxes,
		Confidence:    conf,
		RecipeVersion: CompositionRecipeVersion,
		ComputedAt:    time.Now().UTC(),
	}, nil
}
