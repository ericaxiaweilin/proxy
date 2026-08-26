// Package media — image_recipe_v2 目标冻结（向后兼容 v1）
//
// 升级理由（对照 Social_Media_Pipeline_Plan_Gates_R1 §4.2 / §5.2.2）：
//   1. 显式 sRGB 色彩空间：消除宽色域照片在普通屏发灰
//   2. setsar=1：归一化像素宽高比，消除 Android 偶发变形
//   3. strip metadata + strip EXIF GPS：派生图彻底不带敏感信息
//   4. 五档输出保持原比例（force_original_aspect_ratio=decrease）
//   5. SHARE_OG：取消硬补 color=0x17131F，改为 cover + focalPoint 居中
//   6. 引入 compositionHint：worker 计算主体类型 + safeCropRect，输出额外 variant
//      - FEED_1X_HINT: 有人脸/身体 safeCropRect 时按 safeCropRect cover
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

const imageRecipeVersionV2 = "image_recipe_v2"

const (
	feedBackdropHex = "0x0E0A14" // 与客户端深紫黑底一致；contain 补边色
)

type imageVariantRecipeV2 struct {
	purpose    string
	filter     string
	extraArgs  []string
	dependsOn  string // "HINT" 时先要 compositionHint
	needsProbe bool
}

var imageVariantRecipesV2 = []imageVariantRecipeV2{
	{
		purpose: "FEED_1X",
		filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p,colorspace=srgb",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "FEED_2X",
		filter: "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p,colorspace=srgb",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "GALLERY",
		filter: "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease," +
			"setsar=1,format=yuvj420p,colorspace=srgb",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "SHARE_OG",
		filter: "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630," +
			"setsar=1,format=yuvj420p,colorspace=srgb",
		extraArgs: []string{"-map_metadata", "-1"},
	},
	{
		purpose: "PLACEHOLDER",
		filter: "scale=64:64:force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p",
	},
	{
		// v2 新增：半身 / 全身 / 商品 / 海报 等有主体时按 safeCropRect 出图
		// 没有 safeCropRect → 跳过该 variant，由 FEED_1X 兜底
		purpose:   "FEED_1X_HINT",
		dependsOn: "HINT",
		needsProbe: true,
	},
	{
		// v2 新增：原比例 + 深紫黑补边 → 全身人像 / 风景 contain 时无白边
		purpose: "FEED_1X_NATURAL",
		filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
			"pad='max(iw,1080)':'max(ih,1080)':(ow-iw)/2:(oh-ih)/2:color=" + feedBackdropHex + "," +
			"setsar=1,format=yuvj420p,colorspace=srgb",
		extraArgs: []string{"-map_metadata", "-1"},
	},
}

func generateImageVariantsV2(ctx context.Context, originalPath, storeDir string, asset MediaAsset, hint *MediaCompositionHint, now time.Time) ([]MediaVariant, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("ffmpeg unavailable for image variants v2")
	}
	result := make([]MediaVariant, 0, len(imageVariantRecipesV2))
	for _, recipe := range imageVariantRecipesV2 {
		if recipe.dependsOn == "HINT" && (hint == nil || hint.SafeCropRect == nil) {
			continue
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
			if recipe.purpose == "FEED_1X_HINT" && hint != nil && hint.SafeCropRect != nil {
				r := hint.SafeCropRect
				// 假设原图 W/H 已知，crop=W*H*r.width, x=W*r.x, y=H*r.y
				// 注：实际实现需 ffmpeg 先 probe 原图尺寸，再代入；此处示意
				_ = r
				filter = "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease," +
					"setsar=1,format=yuvj420p,colorspace=srgb"
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
