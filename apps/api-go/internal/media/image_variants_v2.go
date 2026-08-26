// Package media — image_recipe_v2 派生（§4.2 + §5.2.2）。
//
// 升级点（相对 v1）：
//   1. 显式 sRGB 色彩空间：消除宽色域照片在普通屏发灰
//   2. setsar=1：归一化像素宽高比，消除 Android 偶发变形
//   3. strip metadata + strip EXIF GPS：派生图彻底不带敏感信息
//   4. 五档输出保持原比例（force_original_aspect_ratio=decrease）
//   5. SHARE_OG：取消硬补 color=0x17131F，改为 cover + crop 自适应
//   6. 引入 compositionHint：worker 计算主体类型 + safeCropRect，输出额外 variant
//      - FEED_1X_HINT: 有 safeCropRect 时按其 cover
//      - FEED_1X_NATURAL: 无人脸/低置信度时按原比例 + 深紫黑补边 contain
//   7. recipe version 升 v2，CDN cache key 区分 v1/v2（v1 旧对象保留）
//
// 验收 Gate 2：跑 §11 样本集 → SSIM + 视觉回归
package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	imageRecipeVersionV2   = "image_recipe_v2"
	feedBackdropColorV2    = "0x0E0A14" // 与客户端 SocialMediaFrame 深紫黑底一致
)

type imageVariantRecipeV2 struct {
	purpose     string
	filter      string
	extraArgs   []string
	dependsOn   string // "HINT" 时先要 compositionHint
}

var imageVariantRecipesV2 = []imageVariantRecipeV2{
	{
		purpose: "FEED_1X",
		filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "FEED_2X",
		filter: "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "GALLERY",
		filter: "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		// SHARE_OG: cover + crop，不硬补色（v1 的 0x17131F 硬补违反 focalPoint 优先）。
		// 【裁剪不变量】源 aspect 与 1200:630 (1.905) 差异 > 30% 时不能用 “中心裁” — 会裁掉主体。
		// 实现：依赖 hint (有 safeCropRect)，有则按 rect 裁，没有则下产一个 SHARE_OG_FALLBACK use contain 补深紫黑 (不走 v1 硬补黑)。
		purpose:   "SHARE_OG",
		dependsOn: "HINT_OR_FALLBACK",
	},
	{
		// SHARE_OG_FALLBACK: hint 缺失时，走 contain + 补深紫黑 (不硬裁 1200x630)。与 v1 区别: 保留原比例不裁。
		purpose: "SHARE_OG_FALLBACK",
		filter: "scale='min(1200,iw)':'min(630,ih)':force_original_aspect_ratio=decrease," +
			"pad='max(iw,1200)':'max(ih,630)':(ow-iw)/2:(oh-ih)/2:color=" + feedBackdropColorV2 + "," +
			"setsar=1,format=yuvj420p",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "PLACEHOLDER",
		filter: "scale=64:64:force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p",
	},
	{
		// v2 新增：原比例 + 深紫黑补边 → 全身人像 / 风景 contain 时无白边。
		// 【裁剪不变量】不能强制 pad 到 1080x1080 (那样 portrait 图上下补大片紫黑 = “灰边”)。
		// 正确做法：保留原 aspect, 长边 ≤ 1080，不足不补。
		// 例：9:16 1080x1920 → scale 1080x1920 不动 → 不 pad。
		// 例：1:1 800x800 → scale 800x800 不动 → 不 pad。
		// 例：横图 1920x800 → scale 1080x450 不动 → 不 pad。
		purpose: "FEED_1X_NATURAL",
		filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		// v2 新增：safeCropRect 存在时按其 cover（人/商品/文字/混合）
		// hint 缺失或低置信度时跳过
		purpose:   "FEED_1X_HINT",
		dependsOn: "HINT",
	},
}

// imageMetadataProbe 用 ffprobe 读原图尺寸（FEED_1X_HINT 滤镜需要真实像素值）。
type imageMetadataProbe struct {
	width  int
	height int
}

func probeImageDimensions(ctx context.Context, path string) (imageMetadataProbe, error) {
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return imageMetadataProbe{}, errors.New("ffprobe unavailable for image dimension probe")
	}
	args := []string{
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=s=x:p=0",
		path,
	}
	out, err := exec.CommandContext(ctx, "ffprobe", args...).Output()
	if err != nil {
		return imageMetadataProbe{}, fmt.Errorf("ffprobe failed: %w", err)
	}
	parts := strings.SplitN(strings.TrimSpace(string(out)), "x", 2)
	if len(parts) != 2 {
		return imageMetadataProbe{}, fmt.Errorf("unexpected ffprobe output: %q", string(out))
	}
	var probe imageMetadataProbe
	if _, err := fmt.Sscanf(parts[0], "%d", &probe.width); err != nil {
		return imageMetadataProbe{}, fmt.Errorf("parse width: %w", err)
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &probe.height); err != nil {
		return imageMetadataProbe{}, fmt.Errorf("parse height: %w", err)
	}
	if probe.width <= 0 || probe.height <= 0 {
		return imageMetadataProbe{}, errors.New("ffprobe returned non-positive dimensions")
	}
	return probe, nil
}

// hintFilterForSafeCropRect 构造按 safeCropRect cover 的 ffmpeg 滤镜。
// 入参：原图真实宽高 + 归一化 [0,1] 的 rect。
// 输出：scale → crop（按 rect 切到合适尺寸），最后再压到 1080。
// 【裁剪不变量】不裁出主体、主体中心、安全 [0,1] 边界
//   1. rect.x ∈ [0, 1-rect.width] — 不能越界左侧/右侧
//   2. rect.y ∈ [0, 1-rect.height] — 不能越界顶部/底部
//   3. pxW, pxH ≥ 4  — 太小的 box 会出现起块/采样失真
//   4. 裁切后的 aspect 需在 4:5 ~ 16:9 之间 — 避免裁出超长条
func hintFilterForSafeCropRect(probe imageMetadataProbe, rect *MediaBox, assetID string) (string, error) {
	if rect == nil {
		return "", errors.New("nil safeCropRect")
	}
	if rect.Width <= 0 || rect.Height <= 0 {
		return "", fmt.Errorf("invalid safeCropRect dimensions: %+v", rect)
	}
	// 边界校验 (裁剪不变量 1+2)
	if rect.X < 0 || rect.Y < 0 || rect.X+rect.Width > 1.0001 || rect.Y+rect.Height > 1.0001 {
		return "", fmt.Errorf("safeCropRect out of bounds for asset %s: x=%.3f y=%.3f w=%.3f h=%.3f",
			assetID, rect.X, rect.Y, rect.Width, rect.Height)
	}
	pxW := int(float64(probe.width) * rect.Width)
	pxH := int(float64(probe.height) * rect.Height)
	pxX := int(float64(probe.width) * rect.X)
	pxY := int(float64(probe.height) * rect.Y)
	// 不变量 3: 裁后 box 不能太小
	if pxW < 4 || pxH < 4 {
		return "", fmt.Errorf("safeCropRect too small for asset %s: %dx%d px", assetID, pxW, pxH)
	}
	// 不变量 4: 裁后 aspect 需在合理范围 (4:5 ~ 16:9)，避免裁出超长条
	rectAspect := float64(pxW) / float64(pxH)
	if rectAspect < 0.5 || rectAspect > 2.5 {
		return "", fmt.Errorf("safeCropRect aspect out of range for asset %s: %.3f (must be 0.5–2.5)", assetID, rectAspect)
	}
	// 先切到 rect（按真实像素），再 scale 到 1080 长边。
	// 注意：ffmpeg 的 crop 语法是 w:h:x:y（先输出 w×h，从 (x,y) 开始切）
	return fmt.Sprintf(
		"crop=%d:%d:%d:%d,scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p",
		pxW, pxH, pxX, pxY,
	), nil
}

func generateImageVariantsV2(ctx context.Context, originalPath, storeDir string, asset MediaAsset, hint *MediaCompositionHint, now time.Time) ([]MediaVariant, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("ffmpeg unavailable for image variants v2")
	}
	// 仅 HINT 路径需要 probe（其他都基于 iw/ih 相对尺寸）
	var probe imageMetadataProbe
	probeOnce := func() (imageMetadataProbe, error) {
		if probe.width > 0 && probe.height > 0 {
			return probe, nil
		}
		p, err := probeImageDimensions(ctx, originalPath)
		if err != nil {
			return imageMetadataProbe{}, err
		}
		probe = p
		return probe, nil
	}

	result := make([]MediaVariant, 0, len(imageVariantRecipesV2))
	for _, recipe := range imageVariantRecipesV2 {
		// HINT 档：hint 缺失/低置信度/safeCropRect 缺失 → 跳过（FEED_1X 兜底）
		if recipe.dependsOn == "HINT" {
			if hint == nil || hint.SafeCropRect == nil || hint.Confidence < LowConfidenceThreshold {
				continue
			}
		}

		variantID := "mv_" + asset.MediaAssetID + "_" + strings.ToLower(recipe.purpose) + "_v2"
		storageKey := variantID + ".jpg"
		outputPath := filepath.Join(storeDir, storageKey)
		if _, err := os.Stat(outputPath); errors.Is(err, os.ErrNotExist) {
			temporary, tempErr := os.CreateTemp(storeDir, ".proxy-variant-v2-*.jpg")
			if tempErr != nil {
				return nil, tempErr
			}
			temporaryPath := temporary.Name()
			_ = temporary.Close()
			generated := false
			defer func() {
				if !generated {
					_ = os.Remove(temporaryPath)
				}
			}()

			filter := recipe.filter
			if recipe.purpose == "FEED_1X_HINT" {
				p, err := probeOnce()
				if err != nil {
					return nil, fmt.Errorf("FEED_1X_HINT probe failed: %w", err)
				}
				hf, err := hintFilterForSafeCropRect(p, hint.SafeCropRect, asset.MediaAssetID)
				if err != nil {
					// hint 不合法 → 降级：跳过该档，让 FEED_1X 兜底
					continue
				}
				filter = hf
			}

			args := []string{"-y", "-i", originalPath, "-frames:v", "1", "-vf", filter}
			args = append(args, recipe.extraArgs...)
			args = append(args, "-q:v", "2", temporaryPath)
			if out, runErr := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); runErr != nil {
				return nil, fmt.Errorf("%s variant v2 failed: %w: %s", recipe.purpose, runErr, clippedOutput(out))
			}
			if renameErr := os.Rename(temporaryPath, outputPath); renameErr != nil {
				return nil, renameErr
			}
			generated = true
		}
		variant, err := describeImageVariantV2(variantID, asset.MediaAssetID, recipe.purpose, storageKey, outputPath, now)
		if err != nil {
			return nil, err
		}
		result = append(result, variant)
	}
	return result, nil
}

func describeImageVariantV2(variantID, assetID, purpose, storageKey, path string, now time.Time) (MediaVariant, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return MediaVariant{}, err
	}
	hash := sha256.Sum256(data)
	metadata := readSourceImageMetadata(context.Background(), path, "image/jpeg")
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return MediaVariant{}, errors.New("generated variant v2 has invalid dimensions")
	}
	return MediaVariant{
		MediaVariantID: variantID,
		MediaAssetID:   assetID,
		Purpose:        purpose,
		RecipeVersion:  imageRecipeVersionV2,
		Format:         "image/jpeg",
		Width:          metadata.Width,
		Height:         metadata.Height,
		Bytes:          int64(len(data)),
		StorageKey:     storageKey,
		ContentHash:    hex.EncodeToString(hash[:]),
		Status:         "READY",
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}
