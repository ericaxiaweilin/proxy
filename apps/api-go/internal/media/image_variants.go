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

const imageRecipeVersion = "image_recipe_v1"

type imageVariantRecipe struct {
	purpose string
	filter  string
}

var imageVariantRecipes = []imageVariantRecipe{
	// v1 派生（兑底不可去）：加 autorotate + setsar=1 + yuvj420p 优化，
	// 消除 iPhone HEIC 偶发 landscape 误显示 (EXIF orientation flag 未读) 与
	// Android 宽色域照片发灰问题。与 v2 风格统一但保持 ffmpeg 拼字符串。
	// 【ffmpeg 9 兼容】去 colorspace filter：ffmpeg 9 单 jpg 输入下 colorspace=srgb 简写已删除，
	// 默认输出就是 sRGB (bt709 + pc range)，不要多此一举。仍保 setsar + yuvj420p。
	{purpose: "FEED_1X", filter: "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p"},
	{purpose: "FEED_2X", filter: "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p"},
	{purpose: "GALLERY", filter: "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p"},
	{purpose: "SHARE_OG", filter: "scale=1200:630:force_original_aspect_ratio=decrease,pad=1200:630:(ow-iw)/2:(oh-ih)/2:color=0x17131F,setsar=1,format=yuvj420p"},
	{purpose: "PLACEHOLDER", filter: "scale=64:64:force_original_aspect_ratio=decrease,setsar=1,format=yuvj420p"},
}

func generateImageVariants(ctx context.Context, originalPath, storeDir string, asset MediaAsset, now time.Time) ([]MediaVariant, error) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return nil, errors.New("ffmpeg unavailable for image variants")
	}
	result := make([]MediaVariant, 0, len(imageVariantRecipes))
	for _, recipe := range imageVariantRecipes {
		variantID := "mv_" + asset.MediaAssetID + "_" + strings.ToLower(recipe.purpose) + "_v1"
		storageKey := variantID + ".jpg"
		outputPath := filepath.Join(storeDir, storageKey)
		if _, err := os.Stat(outputPath); errors.Is(err, os.ErrNotExist) {
			temporary, tempErr := os.CreateTemp(storeDir, ".proxy-variant-*.jpg")
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
			args := []string{
				"-y", "-autorotate", "-i", originalPath, "-frames:v", "1", "-vf", recipe.filter,
				"-map_metadata", "-1", "-q:v", "2", temporaryPath,
			}
			if out, runErr := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); runErr != nil {
				return nil, fmt.Errorf("%s variant failed: %w: %s", recipe.purpose, runErr, clippedOutput(out))
			}
			if renameErr := os.Rename(temporaryPath, outputPath); renameErr != nil {
				return nil, renameErr
			}
			generated = true
		}
		variant, err := describeImageVariant(ctx, variantID, asset.MediaAssetID, recipe.purpose, storageKey, outputPath, now)
		if err != nil {
			return nil, err
		}
		result = append(result, variant)
	}
	return result, nil
}

func describeImageVariant(ctx context.Context, variantID, assetID, purpose, storageKey, path string, now time.Time) (MediaVariant, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return MediaVariant{}, err
	}
	hash := sha256.Sum256(data)
	metadata := readSourceImageMetadata(ctx, path, "image/jpeg")
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return MediaVariant{}, errors.New("generated variant has invalid dimensions")
	}
	return MediaVariant{
		MediaVariantID: variantID,
		MediaAssetID:   assetID,
		Purpose:        purpose,
		RecipeVersion:  imageRecipeVersion,
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

func variantStorageKey(variants []MediaVariant, purpose, fallback string) string {
	for _, variant := range variants {
		if variant.Purpose == purpose && variant.Status == "READY" {
			return variant.StorageKey
		}
	}
	return fallback
}

// pickVariant 返回指定 purpose 的 READY 派生变体（主色提取用，需要整条记录拿 StorageKey）。
// 未找到返回零值 MediaVariant{}（调用方需自行判断 StorageKey 是否为空）。
func pickVariant(variants []MediaVariant, purpose string) MediaVariant {
	for _, variant := range variants {
		if variant.Purpose == purpose && variant.Status == "READY" {
			return variant
		}
	}
	return MediaVariant{}
}

func variantURL(variants []MediaVariant, purpose, fallback string) string {
	for _, variant := range variants {
		if variant.Purpose == purpose && variant.Status == "READY" {
			return "/v1/media/variant/" + variant.MediaVariantID
		}
	}
	return fallback
}
